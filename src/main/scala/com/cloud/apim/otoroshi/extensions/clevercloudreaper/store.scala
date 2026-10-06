package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import org.apache.pekko.util.ByteString
import otoroshi.env.Env
import otoroshi.security.IdGenerator
import otoroshi.utils.syntax.implicits.*

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/**
 * Everything the reaper persists, under `<storageRoot>:extensions:<extension>`. Only the leaders write
 * here: a worker's datastore is replaced by the leader's at each cluster sync, so the keys below are
 * also how the workers learn the state of the apps.
 */
class ReaperStore(env: Env, prefix: String) {

  private def redis = env.datastores.redis

  private def stateKey(appId: String): String   = s"$prefix:states:$appId"
  private def accessKey(appId: String): String  = s"$prefix:access:$appId"
  private def historyKey(appId: String): String = s"$prefix:history:$appId"
  private def wakeKey(appId: String): String    = s"$prefix:wakes:$appId"
  private def lockKey(appId: String): String    = s"$prefix:locks:$appId"
  private def disabledKey(routeId: String): String = s"$prefix:disabled:$routeId"
  private def costKey(appId: String): String    = s"$prefix:costs:$appId"
  private def pricesKey(zone: String, currency: String): String = s"$prefix:prices:$zone-$currency"
  private def savingsKey(appId: String): String = s"$prefix:savings-apps:$appId"
  private def savedDayKey(day: String): String  = s"$prefix:savings-days:$day"
  private val savedTotalKey: String             = s"$prefix:savings-total"
  private val settingsKey: String               = s"$prefix:settings"

  private def idOf(key: String): String = key.drop(key.lastIndexOf(":") + 1)

  private def readAll[A](pattern: String)(read: ByteString => Option[A])(using ec: ExecutionContext): Future[Map[String, A]] =
    redis.keys(pattern).flatMap {
      case keys if keys.isEmpty => Map.empty[String, A].vfuture
      case keys                 =>
        redis.mget(keys*).map { values =>
          keys.zip(values).flatMap { case (key, value) => value.flatMap(read).map(idOf(key) -> _) }.toMap
        }
    }

  // states

  def allStates()(using ec: ExecutionContext): Future[Map[String, AppState]] =
    readAll(s"$prefix:states:*")(bs => AppState.read(bs.utf8String))

  def state(appId: String)(using ec: ExecutionContext): Future[Option[AppState]] =
    redis.get(stateKey(appId)).map(_.flatMap(bs => AppState.read(bs.utf8String)))

  def saveState(state: AppState): Future[Boolean] = redis.set(stateKey(state.appId), state.json.stringify)

  def deleteState(appId: String): Future[Long] = redis.del(stateKey(appId), wakeKey(appId))

  // last accesses: one key per app, holding the latest access any node reported

  def allAccess()(using ec: ExecutionContext): Future[Map[String, Long]] =
    readAll(s"$prefix:access:*")(bs => bs.utf8String.toLongOption)

  /** Keeps the latest of what is stored and what is reported, per app. */
  def recordAccess(accesses: Map[String, Long])(using ec: ExecutionContext): Future[Map[String, Long]] =
    if (accesses.isEmpty) Map.empty[String, Long].vfuture
    else {
      val appIds = accesses.keys.toSeq
      redis.mget(appIds.map(accessKey)*).flatMap { stored =>
        val merged = appIds.zip(stored).map { case (appId, current) =>
          appId -> Math.max(accesses(appId), current.flatMap(_.utf8String.toLongOption).getOrElse(0L))
        }
        val changed = merged.filter { case (appId, value) => value == accesses(appId) }
        Future.sequence(changed.map { case (appId, value) => redis.set(accessKey(appId), value.toString) }).map(_ => merged.toMap)
      }
    }

  // history

  def pushHistory(transition: Transition, size: Int)(using ec: ExecutionContext): Future[Unit] =
    for {
      _ <- redis.lpush(historyKey(transition.appId), transition.json.stringify)
      _ <- redis.ltrim(historyKey(transition.appId), 0L, Math.max(0, size - 1).toLong)
    } yield ()

  def history(appId: String, from: Int, count: Int)(using ec: ExecutionContext): Future[Seq[Transition]] =
    redis.lrange(historyKey(appId), from.toLong, (from + count - 1).toLong).map(_.flatMap(bs => Transition.read(bs.utf8String)))

  // wake requests: kept until a start succeeds, so a wake asked while the app was locked is not lost

  def requestWake(appId: String, ttlMillis: Long): Future[Boolean] =
    redis.set(wakeKey(appId), System.currentTimeMillis().toString, pxMilliseconds = Some(ttlMillis))

  def clearWake(appId: String): Future[Long] = redis.del(wakeKey(appId))

  def wakesRequested(appIds: Seq[String])(using ec: ExecutionContext): Future[Set[String]] =
    if (appIds.isEmpty) Set.empty[String].vfuture
    else redis.mget(appIds.map(wakeKey)*).map(values => appIds.zip(values).collect { case (id, Some(_)) => id }.toSet)

  // routes the reaper was just disabled on: the proxy state of a node can still have them as they were

  def markDisabled(routeId: String, ttlMillis: Long): Future[Boolean] =
    redis.set(disabledKey(routeId), System.currentTimeMillis().toString, pxMilliseconds = Some(ttlMillis))

  def clearDisabled(routeId: String): Future[Long] = redis.del(disabledKey(routeId))

  def recentlyDisabled()(using ec: ExecutionContext): Future[Set[String]] =
    redis.keys(s"$prefix:disabled:*").map(_.map(idOf).toSet)

  // savings: what each app costs, the prices behind it, and what sleeping saved

  def allCosts()(using ec: ExecutionContext): Future[Map[String, AppCost]] =
    readAll(s"$prefix:costs:*")(bs => AppCost.read(bs.utf8String))

  def saveCost(cost: AppCost): Future[Boolean] = redis.set(costKey(cost.appId), cost.json.stringify)

  def prices(zone: String, currency: String)(using ec: ExecutionContext): Future[Option[PriceSystem]] =
    redis.get(pricesKey(zone, currency)).map(_.flatMap(bs => PriceSystem.read(bs.utf8String)))

  def savePrices(prices: PriceSystem): Future[Boolean] = redis.set(pricesKey(prices.zone, prices.currency), prices.json.stringify)

  def allSavings()(using ec: ExecutionContext): Future[Map[String, AppSavings]] =
    readAll(s"$prefix:savings-apps:*")(bs => AppSavings.read(bs.utf8String))

  def savings(appId: String)(using ec: ExecutionContext): Future[Option[AppSavings]] =
    redis.get(savingsKey(appId)).map(_.flatMap(bs => AppSavings.read(bs.utf8String)))

  /** Only ever called under the lock of the app: its document is read and written by one leader at a time. */
  def saveSavings(savings: AppSavings): Future[Boolean] = redis.set(savingsKey(savings.appId), savings.json.stringify)

  /** The totals of the whole install, as counters: any leader adds to them without a lock. */
  def addSaved(byDay: Map[String, Long])(using ec: ExecutionContext): Future[Unit] =
    Future
      .sequence(byDay.toSeq.filter(_._2 > 0L).map { case (day, micros) => redis.incrby(savedDayKey(day), micros) })
      .flatMap(_ => redis.incrby(savedTotalKey, byDay.values.sum))
      .map(_ => ())

  def savedDays(days: Seq[String])(using ec: ExecutionContext): Future[Map[String, Long]] =
    if (days.isEmpty) Map.empty[String, Long].vfuture
    else
      redis.mget(days.map(savedDayKey)*).map { values =>
        days.zip(values).collect { case (day, Some(v)) => day -> v.utf8String.toLongOption.getOrElse(0L) }.toMap
      }

  def savedTotal()(using ec: ExecutionContext): Future[Long] =
    redis.get(savedTotalKey).map(_.flatMap(_.utf8String.toLongOption).getOrElse(0L))

  // settings

  def settings()(using ec: ExecutionContext): Future[ReaperSettings] =
    redis.get(settingsKey).map(_.flatMap(bs => ReaperSettings.read(bs.utf8String)).getOrElse(ReaperSettings()))

  def saveSettings(settings: ReaperSettings): Future[Boolean] = redis.set(settingsKey, settings.json.stringify)

  // one leader at a time works on an app: the job, a wake up and a manual action can all race for it

  def withLock[A](appId: String, ttlMillis: Long = 60000L)(f: => Future[A])(using ec: ExecutionContext): Future[Option[A]] = {
    val token = IdGenerator.uuid
    val key   = lockKey(appId)
    env.datastores.rawDataStore
      .setnx(key, ByteString(token), Some(ttlMillis))(using ec, env)
      .flatMap {
        case false => None.vfuture
        case true  =>
          env.datastores.rawDataStore.get(key)(using ec, env).flatMap {
            case Some(value) if value.utf8String == token =>
              Try(f).fold(Future.failed, identity).map(Some(_)).andThen { case _ =>
                env.datastores.rawDataStore.get(key)(using ec, env).map {
                  case Some(v) if v.utf8String == token => env.datastores.rawDataStore.del(Seq(key))(using ec, env)
                  case _                                => ()
                }
              }
            case _                                        => None.vfuture
          }
      }
  }
}
