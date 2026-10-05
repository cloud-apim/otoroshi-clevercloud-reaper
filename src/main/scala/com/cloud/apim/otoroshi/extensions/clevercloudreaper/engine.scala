package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import otoroshi.env.Env
import otoroshi.next.models.NgRoute
import otoroshi.utils.syntax.implicits.*
import otoroshi_plugins.com.cloud.apim.otoroshi.extensions.clevercloudreaper.CleverCloudReaper
import play.api.Logger
import play.api.libs.json.*

import java.time.Instant
import java.util.concurrent.atomic.{AtomicBoolean, AtomicLong, AtomicReference}
import scala.collection.concurrent.TrieMap
import scala.concurrent.duration.*
import scala.concurrent.{ExecutionContext, Future}
import scala.util.control.NonFatal

/**
 * Drives the apps through the state machine of `ReaperRules`. Runs on the leaders only: the job ticks
 * it, and wake ups and manual actions call it directly. A datastore lock per app keeps two leaders,
 * or a tick and a wake up, from working on the same app at once.
 */
class ReaperEngine(env: Env, conf: ReaperConfiguration, api: CleverCloudApi, store: ReaperStore, memory: ReaperMemory) {

  private val logger                  = Logger("cloud-apim-clevercloud-reaper")
  private val throttled               = new ThrottledLogger(logger)
  private given ec: ExecutionContext  = env.otoroshiExecutionContext

  private val running      = new AtomicBoolean(false)
  private val lastFullTick = new AtomicLong(0L)
  // wake ups asked on this leader: followed at the fast pace without waiting for the next full tick
  private val pendingWakes = new TrieMap[String, Long]()
  private val orphanSince  = new TrieMap[String, Long]()
  private val owners       = new TrieMap[String, String]()
  private val lastTick     = new AtomicReference[JsObject](Json.obj())

  // an app no route manages anymore is started again (and forgotten) after this long
  private val orphanDelay = 5.minutes
  private val wakeTtl     = 30.minutes
  // long enough for every node to sync its proxy state after the reaper is disabled on a route
  private val disabledTtl = 1.minute

  private val pluginId = s"cp:${classOf[CleverCloudReaper].getName}"

  def lastTickJson: JsObject = lastTick.get()

  /** Every app the reaper manages right now, from the routes this node runs. */
  def managedApps(routes: Seq[NgRoute] = env.proxyState.allRoutes()): Map[String, ManagedApp] =
    routes
      .flatMap { route =>
        route.plugins.slots.find(s => s.plugin == pluginId && s.enabled).flatMap { instance =>
          val config = CleverCloudReaperConfig.format.reads(instance.config.raw).getOrElse(CleverCloudReaperConfig.default)
          CleverAppIds.resolve(route, config).map(appId => (appId, route, config))
        }
      }
      .groupBy(_._1)
      .map { case (appId, items) => appId -> ManagedApp(appId, items.map(i => (i._2, i._3))) }

  private def sequentially[A](items: Seq[A])(f: A => Future[Unit]): Future[Unit] =
    items.foldLeft(Future.unit)((acc, item) => acc.flatMap(_ => f(item).recover { case NonFatal(e) => logger.error("reaper error", e) }))

  // ticks

  def tick(): Future[Unit] = {
    if (!running.compareAndSet(false, true)) Future.unit
    else {
      val now  = System.currentTimeMillis()
      val full = now - lastFullTick.get() >= conf.interval.toMillis
      doTick(now, full)
        .recover { case NonFatal(e) =>
          logger.error("error while running the clevercloud reaper", e)
          lastTick.set(Json.obj("at" -> now, "full" -> full, "error" -> e.getMessage))
        }
        .andThen { case _ => running.set(false) }
    }
  }

  private def doTick(now: Long, full: Boolean): Future[Unit] = {
    if (!api.configured) {
      throttled.warn("no-token", "the clevercloud reaper has no clever cloud api token (CLEVER_CLOUD_API_TOKEN), it does nothing")
      lastTick.set(Json.obj("at" -> now, "full" -> full, "error" -> "no clever cloud api token configured"))
      Future.unit
    } else store.recentlyDisabled().flatMap { disabled =>
      // a route the reaper was just disabled on can still be enabled in the proxy state of this node:
      // managing its app again would undo the release of the app
      val managed    = managedApps(env.proxyState.allRoutes().filterNot(r => disabled.contains(r.id)))
      if (full) lastFullTick.set(now)
      val candidates =
        if (full) managed.values.toSeq
        else
          managed.values.toSeq.filter { m =>
            memory.status(m.appId).forall(_.transitional) || pendingWakes.contains(m.appId)
          }
      val orphans    = if (full) handleOrphans(managed, now) else Future.unit
      orphans.flatMap { _ =>
        if (candidates.isEmpty) {
          if (full) lastTick.set(Json.obj("at" -> now, "full" -> full, "apps" -> 0))
          Future.unit
        } else {
          for {
            apps     <- api.summary()
            accesses <- store.allAccess()
            wakes    <- store.wakesRequested(candidates.map(_.appId))
            _        <- apps match {
                          case Left(err)         =>
                            throttled.warn("summary", s"could not list the clever cloud apps: $err")
                            lastTick.set(Json.obj("at" -> now, "full" -> full, "error" -> err.toString))
                            Future.unit
                          case Right(cleverApps) =>
                            throttled.reset("summary")
                            val byId = cleverApps.map(a => a.id -> a).toMap
                            cleverApps.foreach(a => owners.put(a.id, a.ownerId))
                            memory.mergeAccess(accesses)
                            sequentially(candidates) { m =>
                              process(
                                m,
                                byId.get(m.appId),
                                memory.lastAccess(m.appId),
                                wakes.contains(m.appId) || pendingWakes.contains(m.appId),
                                now
                              ).map(_ => ())
                            }.map { _ =>
                              lastTick.set(Json.obj("at" -> now, "full" -> full, "apps" -> candidates.size))
                            }
                        }
          } yield ()
        }
      }
    }
  }

  /** The reaper is on again on a route: it is not one that was just disabled anymore. */
  def routeEnabled(routeId: String): Future[Unit] = store.clearDisabled(routeId).map(_ => ())

  private def process(
      m: ManagedApp,
      cleverApp: Option[CleverApp],
      lastAccess: Option[Long],
      wakeRequested: Boolean,
      now: Long
  ): Future[Option[AppState]] =
    store.withLock(m.appId) {
      store.state(m.appId).flatMap { stored =>
        val base  = stored.getOrElse(AppState.initial(m.appId, now))
        val state = base.copy(
          routes = m.routeIds,
          gracePeriod = m.gracePeriodMillis,
          failTimeout = m.failTimeoutMillis,
          ownerId = cleverApp.map(_.ownerId).orElse(m.ownerId).orElse(base.ownerId),
          name = cleverApp.map(_.name).orElse(base.name),
          cleverState = cleverApp.map(_.state).orElse(base.cleverState),
          lastCheckAt = Some(now)
        )
        cleverApp match {
          case None      =>
            throttled.warn(
              s"unknown-${m.appId}",
              s"the clever cloud app ${m.appId} (routes: ${m.routeIds.mkString(", ")}) is not visible with the configured token"
            )
            save(state)
          case Some(app) =>
            throttled.reset(s"unknown-${m.appId}")
            val obs = Observation(
              now = now,
              cleverState = app.state,
              deployment = None,
              lastAccess = lastAccess,
              inUpRange = m.inUpRange(Instant.ofEpochMilli(now), conf.timezone),
              wakeRequested = wakeRequested,
              gracePeriod = m.gracePeriodMillis,
              failTimeout = m.failTimeoutMillis
            )
            val deployment =
              if (ReaperRules.needsDeployment(state, obs)) api.lastDeployment(app.ownerId, app.id)
              else Right(None).vfuture
            deployment.flatMap {
              case Left(err) =>
                throttled.warn(s"deployment-${app.id}", s"could not read the last deployment of ${app.name} (${app.id}): $err")
                save(state)
              case Right(d)  =>
                val result = ReaperRules.decide(state, obs.copy(deployment = d)) match {
                  case None           => save(state)
                  case Some(decision) => applyDecision(state, decision, app, now)
                }
                result.flatMap { next =>
                  // a wake up is settled once the app is up, starting, or beyond help
                  if (next.status == ReaperStatus.Up || next.status == ReaperStatus.WaitingForUp || next.status == ReaperStatus.Error) {
                    pendingWakes.remove(next.appId)
                    store.clearWake(next.appId).map(_ => next)
                  } else next.vfuture
                }
            }
        }
      }
    }

  private def applyDecision(state: AppState, decision: Decision, app: CleverApp, now: Long): Future[AppState] =
    decision.action match {
      case Some(ReaperAction.Stop) if conf.dryRun || memory.settings.killSwitch =>
        val mode = if (conf.dryRun) "dry-run" else "kill switch"
        throttled.info(s"dry-${app.id}", s"[$mode] would put ${app.name} (${app.id}) to sleep: ${decision.cause}")
        save(state)
      case Some(ReaperAction.Stop)                                               =>
        api.stop(app.ownerId, app.id).flatMap {
          case Left(err) =>
            logger.error(s"could not stop ${app.name} (${app.id}): $err")
            save(state)
          case Right(_)  => transition(state, decision, now, actionAt = Some(now))
        }
      case Some(ReaperAction.Start)                                              =>
        api.start(app.ownerId, app.id).flatMap {
          case Left(err) if err.code.contains(CleverError.NeverDeployed) =>
            transition(state, Decision(ReaperStatus.Error, "the app was never deployed, it cannot be started"), now, None)
          case Left(err)                                                  =>
            // the wake request stays: the next tick tries again, until the fail timeout
            logger.error(s"could not start ${app.name} (${app.id}): $err")
            save(state)
          case Right(_)                                                   =>
            val actionAt = if (decision.keepActionAt) state.actionAt.orElse(Some(now)) else Some(now)
            transition(state, decision, now, actionAt)
        }
      case None                                                                  =>
        transition(state, decision, now, actionAt = None)
    }

  private def save(state: AppState): Future[AppState] = {
    memory.putState(state)
    store.saveState(state).map(_ => state)
  }

  private def transition(state: AppState, decision: Decision, now: Long, actionAt: Option[Long]): Future[AppState] = {
    val changed = decision.status != state.status
    val next    = state.copy(
      status = decision.status,
      cause = Some(decision.cause),
      errorCause = if (decision.status == ReaperStatus.Error) Some(decision.cause) else None,
      lastStatusUpdate = if (changed) now else state.lastStatusUpdate,
      lastUpAt = if (decision.status == ReaperStatus.Up && changed) Some(now) else state.lastUpAt,
      lastDownAt = if (decision.status == ReaperStatus.Down && changed) Some(now) else state.lastDownAt,
      actionAt = actionAt
    )
    val t       = Transition(state.appId, state.status, decision.status, decision.cause, now)
    for {
      _ <- save(next)
      _ <- store.pushHistory(t, conf.historySize)
    } yield {
      val label = s"${next.name.getOrElse(next.appId)} (${next.appId})"
      if (decision.status == ReaperStatus.Error) logger.warn(s"$label: ${t.from} -> ${t.to}: ${t.cause}")
      else logger.info(s"$label: ${t.from} -> ${t.to}: ${t.cause}")
      CleverCloudReaperEvent(t, next, env).toAnalytics()(using env)
      if (decision.status == ReaperStatus.Error) CleverCloudReaperAppInErrorAlert(t, next, env).toAnalytics()(using env)
      next
    }
  }

  // apps nobody manages anymore: the plugin was removed, disabled, or its route deleted

  private def handleOrphans(managed: Map[String, ManagedApp], now: Long): Future[Unit] = {
    // nothing is loaded yet, everything would look like an orphan
    if (env.proxyState.allRoutes().isEmpty) Future.unit
    else {
      managed.keys.foreach(orphanSince.remove)
      val orphans = memory.allStates().map(_.appId).filterNot(managed.contains)
      orphanSince.keys.toSeq.diff(orphans).foreach(orphanSince.remove)
      sequentially(orphans) { appId =>
        val since = orphanSince.getOrElseUpdate(appId, now)
        if (now - since < orphanDelay.toMillis) Future.unit
        else {
          orphanSince.remove(appId)
          release(appId, "no route manages the app anymore").map(_ => ())
        }
      }
    }
  }

  // actions

  private def fetchApp(appId: String, ownerHint: Option[String]): Future[Either[CleverError, CleverApp]] =
    ownerHint.orElse(owners.get(appId)).orElse(memory.state(appId).flatMap(_.ownerId)).orElse(conf.ownerId) match {
      case Some(owner) => api.application(owner, appId)
      case None        =>
        api.summary().map(_.flatMap { apps =>
          apps.foreach(a => owners.put(a.id, a.ownerId))
          apps.find(_.id == appId).toRight(CleverError(404, s"app $appId is not visible with the configured token"))
        })
    }

  /** A request needs the app: starts it if it sleeps, or once it is stopped if it is going to sleep. */
  def wake(appId: String): Future[Option[AppState]] = {
    val now = System.currentTimeMillis()
    managedApps().get(appId) match {
      case None    => store.state(appId)
      case Some(m) =>
        pendingWakes.put(appId, now)
        for {
          _     <- store.requestWake(appId, wakeTtl.toMillis)
          app   <- fetchApp(appId, m.ownerId)
          _     <- app match {
                     case Left(err)        =>
                       logger.warn(s"could not wake $appId up right away, the job will: $err")
                       Future.unit
                     // the request that asks for it is the freshest access there is
                     case Right(cleverApp) => process(m, Some(cleverApp), Some(now), wakeRequested = true, now)
                   }
          state <- store.state(appId)
        } yield state
    }
  }

  /** Puts an app to sleep now, whatever its traffic. */
  def reap(appId: String, by: String): Future[Either[String, AppState]] = {
    val now = System.currentTimeMillis()
    store
      .withLock(appId) {
        store.state(appId).flatMap {
          case None                                              => Left(s"the app $appId is not managed by the reaper").vfuture
          case Some(state) if state.status != ReaperStatus.Up    => Left(s"the app is ${state.status}, not Up").vfuture
          case Some(state)                                       =>
            fetchApp(appId, state.ownerId).flatMap {
              case Left(err)                                           => Left(err.toString).vfuture
              case Right(app) if app.state != ReaperRules.ShouldBeUp   => Left(s"the app is ${app.state} on clever cloud").vfuture
              case Right(app)                                          =>
                api.stop(app.ownerId, app.id).flatMap {
                  case Left(err) => Left(err.toString).vfuture
                  case Right(_)  =>
                    transition(
                      state.copy(cleverState = Some(app.state)),
                      Decision(ReaperStatus.WaitingForShutdown, s"put to sleep by $by"),
                      now,
                      Some(now)
                    ).map(Right(_))
                }
            }
        }
      }
      .map(_.getOrElse(Left("the app is busy, try again in a moment")))
  }

  /** Leaves the error state: the app is evaluated again from scratch at the next tick. */
  def reset(appId: String, by: String): Future[Either[String, AppState]] = {
    val now = System.currentTimeMillis()
    store
      .withLock(appId) {
        store.state(appId).flatMap {
          case None        => Left(s"the app $appId is not managed by the reaper").vfuture
          case Some(state) =>
            transition(state, Decision(ReaperStatus.WaitingForInit, s"reset by $by"), now, None).map(Right(_))
        }
      }
      .map(_.getOrElse(Left("the app is busy, try again in a moment")))
  }

  /**
   * The reaper stops managing an app: it is started if it sleeps, so nobody is left with an app that
   * nothing will ever wake up, then forgotten. `ignoring` is a route about to stop managing it, that
   * this node may not know about yet.
   */
  def release(appId: String, cause: String, ignoring: Option[String] = None): Future[Either[String, Unit]] = {
    val stillManaged = managedApps(env.proxyState.allRoutes().filterNot(r => ignoring.contains(r.id))).contains(appId)
    val marked       = ignoring.map(routeId => store.markDisabled(routeId, disabledTtl.toMillis).map(_ => ())).getOrElse(Future.unit)
    if (stillManaged) marked.map(_ => Right(()))
    else
      marked.flatMap(_ => store
        .withLock(appId) {
          store.state(appId).flatMap {
            case None                                                                                     => Right(()).vfuture
            case Some(state) if state.status == ReaperStatus.Down || state.status == ReaperStatus.WaitingForShutdown =>
              fetchApp(appId, state.ownerId).flatMap {
                case Left(err) => Left(err.toString).vfuture
                case Right(app) =>
                  val started =
                    if (app.state == ReaperRules.ShouldBeDown) api.start(app.ownerId, app.id).map(_.map(_ => ()))
                    else Right(()).vfuture
                  started.flatMap {
                    case Left(err) => Left(err.toString).vfuture
                    case Right(_)  =>
                      logger.info(s"${state.name.getOrElse(appId)} ($appId) is started and no longer managed: $cause")
                      forget(appId).map(_ => Right(()))
                  }
              }
            case Some(state)                                                                              =>
              logger.info(s"${state.name.getOrElse(appId)} ($appId) is no longer managed: $cause")
              forget(appId).map(_ => Right(()))
          }
        }
        .map(_.getOrElse(Left("the app is busy, try again in a moment"))))
  }

  private def forget(appId: String): Future[Unit] = {
    memory.removeState(appId)
    pendingWakes.remove(appId)
    store.deleteState(appId).map(_ => ())
  }
}
