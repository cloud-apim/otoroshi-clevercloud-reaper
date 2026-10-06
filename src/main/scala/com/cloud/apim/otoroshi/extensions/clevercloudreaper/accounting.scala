package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import otoroshi.env.Env
import otoroshi.utils.syntax.implicits.*
import play.api.Logger
import play.api.libs.json.*

import java.time.YearMonth
import scala.collection.concurrent.TrieMap
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/**
 * Keeps what each app costs, and counts what its sleeps saved.
 *
 * Nothing is computed from the history: the cost of an app is read from Clever Cloud now and then and
 * stored, and each sleep is added to the stored totals once, when it ends. Only the sleeps still
 * running are computed when they are read, from when they started.
 */
class ReaperSavings(env: Env, conf: ReaperConfiguration, api: CleverCloudApi, store: ReaperStore, memory: ReaperMemory) {

  private val logger                 = Logger("cloud-apim-clevercloud-reaper-savings")
  private val throttled              = new ThrottledLogger(logger)
  private given ec: ExecutionContext = env.otoroshiExecutionContext

  private def settings = conf.savings
  private def zone     = conf.timezone

  // the prices of each zone, shared by its apps
  private val prices = new TrieMap[String, PriceSystem]()
  // apps whose cost could not be read: not asked again at every run
  private val failures   = new TrieMap[String, Long]()
  private val retryAfter = 10L * 60L * 1000L

  def enabled: Boolean = settings.enabled

  private def fresh(at: Long): Boolean = System.currentTimeMillis() - at < settings.refreshInterval.toMillis

  private def pricesOf(zoneId: String): Future[Option[PriceSystem]] =
    prices.get(zoneId).filter(p => fresh(p.fetchedAt)) match {
      case Some(p) => Some(p).vfuture
      case None    =>
        store.prices(zoneId, settings.currency).flatMap {
          case Some(p) if fresh(p.fetchedAt) =>
            prices.put(zoneId, p)
            Some(p).vfuture
          case stored                        =>
            api.priceSystem(zoneId, settings.currency).flatMap {
              case Right(p) if p.hourly.nonEmpty =>
                prices.put(zoneId, p)
                store.savePrices(p).map(_ => Some(p))
              case other                         =>
                throttled.warn(s"prices-$zoneId", s"could not read the clever cloud prices of zone $zoneId: $other")
                // stale prices beat no prices
                stored.vfuture
            }
        }
    }

  /** Reads the size of the app and the prices of its zone again, and stores what it costs. */
  def refresh(appId: String, ownerId: String): Future[Option[AppCost]] = {
    failures.put(appId, System.currentTimeMillis())
    api.application(ownerId, appId).flatMap {
      case Left(err)  =>
        throttled.warn(s"cost-$appId", s"could not read the size of $appId: $err")
        memory.cost(appId).vfuture
      case Right(app) =>
        app.sizing match {
          case None         =>
            throttled.warn(s"cost-$appId", s"clever cloud does not say the size of ${app.name} ($appId)")
            memory.cost(appId).vfuture
          case Some(sizing) =>
            pricesOf(app.zone.getOrElse("par")).flatMap {
              case None    => memory.cost(appId).vfuture
              case Some(p) =>
                AppCost.compute(appId, sizing, p, System.currentTimeMillis()) match {
                  case None       =>
                    throttled.warn(s"cost-$appId", s"no price for the flavor ${sizing.minFlavor} of ${app.name} ($appId) in ${p.zone}")
                    memory.cost(appId).vfuture
                  case Some(cost) =>
                    failures.remove(appId)
                    memory.putCost(cost)
                    store.saveCost(cost).map(_ => Some(cost))
                }
            }
        }
    }
  }

  /** What the app costs, read again when it is missing or old. */
  def costOf(state: AppState): Future[Option[AppCost]] =
    memory.cost(state.appId).filter(c => fresh(c.refreshedAt) && c.currency == settings.currency) match {
      case Some(cost) => Some(cost).vfuture
      case None       =>
        state.ownerId.orElse(conf.ownerId) match {
          case Some(owner) => refresh(state.appId, owner)
          case None        => memory.cost(state.appId).vfuture
        }
    }

  /** Keeps the costs of the managed apps fresh, a few at a time, from the full runs of the job. */
  def refreshDue(apps: Seq[AppState], max: Int = 5): Future[Unit] =
    if (!enabled) Future.unit
    else {
      val now = System.currentTimeMillis()
      val due = apps
        .filter(s => memory.cost(s.appId).forall(c => !fresh(c.refreshedAt) || c.currency != settings.currency))
        .filter(s => failures.get(s.appId).forall(at => now - at > retryAfter))
        .take(max)
      due.foldLeft(Future.unit) { (acc, state) =>
        acc.flatMap(_ => costOf(state).map(_ => ()).recover { case NonFatal(e) => logger.warn(s"could not refresh the cost of ${state.appId}", e) })
      }
    }

  /**
   * The sleep of an app ends: what it saved is added to the app and to the install. Called under the
   * lock of the app, by the leader that wakes it up.
   */
  def close(state: AppState, now: Long): Future[Option[SleepPeriod]] = {
    val since: Option[Long] = if (enabled) state.asleepSince else None
    since match {
      case None       => None.vfuture
      case Some(from) =>
        costOf(state)
          .flatMap {
            case None       =>
              throttled.warn(s"close-${state.appId}", s"the cost of ${state.appId} is unknown, its sleep is not counted")
              None.vfuture
            case Some(cost) =>
              val period = SleepPeriod(from, now, cost.hourlyMinMicros, Savings.saved(from, now, cost.hourlyMinMicros))
              val days   = Savings.byDay(from, now, cost.hourlyMinMicros, zone)
              for {
                current <- store.savings(state.appId)
                updated  = current
                             .filter(_.currency == settings.currency)
                             .getOrElse(AppSavings(state.appId, settings.currency))
                             .add(period, days, Savings.today(now, zone), settings.historyDays)
                _       <- store.saveSavings(updated)
                _       <- store.addSaved(days)
              } yield {
                memory.putSavings(updated)
                Some(period)
              }
          }
          .recover { case NonFatal(e) =>
            logger.error(s"could not count the sleep of ${state.appId}", e)
            None
          }
    }
  }

  // what sleeps still running have saved so far: computed when read, never stored

  private def running(): Seq[(AppState, AppCost)] =
    memory.allStates().filter(s => s.status == ReaperStatus.Down && s.asleepSince.isDefined).flatMap(s => memory.cost(s.appId).map(s -> _))

  private def runningDays(state: AppState, cost: AppCost, now: Long): Map[String, Long] =
    state.asleepSince.map(from => Savings.byDay(from, now, cost.hourlyMinMicros, zone)).getOrElse(Map.empty)

  /** The savings of one app, as the console and the api show them. */
  def appReport(appId: String): JsValue = {
    val now     = System.currentTimeMillis()
    val today   = Savings.today(now, zone)
    val state   = memory.state(appId)
    val cost    = memory.cost(appId)
    val saved   = memory.savings(appId).filter(_.currency == settings.currency)
    val current = for {
      s <- state.filter(_.status == ReaperStatus.Down)
      c <- cost
      f <- s.asleepSince
    } yield (f, Savings.saved(f, now, c.hourlyMinMicros), runningDays(s, c, now))
    val days    = Savings.merge(saved.map(_.days).getOrElse(Map.empty), current.map(_._3).getOrElse(Map.empty))
    Json.obj(
      "enabled"      -> enabled,
      "app_id"       -> appId,
      "currency"     -> settings.currency,
      "cost"         -> cost.map(_.json).getOrElse(JsNull).asValue,
      "total"        -> Savings.fromMicros(saved.map(_.totalMicros).getOrElse(0L) + current.map(_._2).getOrElse(0L)),
      "slept_hours"  -> Savings.round((saved.map(_.sleptMillis).getOrElse(0L) + current.map(c => now - c._1).getOrElse(0L)).toDouble / 3600000d),
      "sleeps"       -> saved.map(_.sleeps).getOrElse(0L),
      "last_sleep"   -> saved.flatMap(_.lastSleep).map(_.json).getOrElse(JsNull).asValue,
      "current"      -> current
        .map { case (from, micros, _) => Json.obj("since" -> from, "saved" -> Savings.fromMicros(micros)) }
        .getOrElse(JsNull)
        .asValue
    ) ++ Savings.summary(days, today)
  }

  /** What one app saved in all, for the columns of the routes table. */
  def appTotal(appId: String, now: Long = System.currentTimeMillis()): BigDecimal = {
    val closed  = memory.savings(appId).filter(_.currency == settings.currency).map(_.totalMicros).getOrElse(0L)
    val current = for {
      s <- memory.state(appId).filter(_.status == ReaperStatus.Down)
      c <- memory.cost(appId)
      f <- s.asleepSince
    } yield Savings.saved(f, now, c.hourlyMinMicros)
    Savings.fromMicros(closed + current.getOrElse(0L))
  }

  /** The savings of the whole install: the stored counters, plus the sleeps still running. */
  def globalReport(): Future[JsValue] = {
    val now     = System.currentTimeMillis()
    val today   = Savings.today(now, zone)
    // the days of the last twelve months, from the first of the month
    val first   = YearMonth.from(today).minusMonths(11).atDay(1)
    val dates   = Iterator.iterate(first)(_.plusDays(1)).takeWhile(!_.isAfter(today)).map(_.toString).toSeq
    val live    = running()
    val liveDays = live.map { case (s, c) => runningDays(s, c, now) }.foldLeft(Map.empty[String, Long])(Savings.merge)
    for {
      stored <- store.savedDays(dates)
      total  <- store.savedTotal()
    } yield {
      val days   = Savings.merge(stored, liveDays)
      val months = (11 to 0 by -1).map { n =>
        val month = YearMonth.from(today).minusMonths(n.toLong).toString
        Json.obj("month" -> month, "saved" -> Savings.fromMicros(Savings.sumWhere(days)(_.startsWith(month))))
      }
      Json.obj(
        "enabled"             -> enabled,
        "currency"            -> settings.currency,
        "total"               -> Savings.fromMicros(total + liveDays.values.sum),
        "asleep"              -> live.size,
        "saving_per_hour"     -> Savings.fromMicros(live.map(_._2.hourlyMinMicros).sum),
        "last_12_months"      -> JsArray(months),
        "apps_with_cost"      -> memory.allCosts().size
      ) ++ Savings.summary(days, today)
    }
  }
}
