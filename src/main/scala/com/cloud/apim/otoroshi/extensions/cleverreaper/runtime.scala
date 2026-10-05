package com.cloud.apim.otoroshi.extensions.cleverreaper

import otoroshi.env.Env
import otoroshi.utils.http.Implicits.*
import otoroshi.utils.syntax.implicits.*
import play.api.libs.json.*
import play.api.libs.ws.WSAuthScheme
import play.api.libs.ws.WSBodyWritables.given
import play.api.{Configuration, Logger}

import java.time.ZoneId
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.{AtomicInteger, AtomicLong}
import scala.collection.concurrent.TrieMap
import scala.concurrent.duration.*
import scala.concurrent.{ExecutionContext, Future, Promise}
import scala.util.{Success, Try}

/** The extension settings, from `otoroshi.admin-extensions.configurations.cloud-apim_extensions_cleverreaper`. */
final case class ReaperConfiguration(
    apiUrl: String,
    apiToken: Option[String],
    ownerId: Option[String],
    apiTimeout: FiniteDuration,
    dryRun: Boolean,
    timezone: ZoneId,
    interval: FiniteDuration,
    fastInterval: FiniteDuration,
    accessFlushInterval: FiniteDuration,
    historySize: Int
)

object ReaperConfiguration {
  def from(configuration: Configuration): ReaperConfiguration = ReaperConfiguration(
    apiUrl = configuration.getOptional[String]("clever.api-url").getOrElse("https://api-bridge.clever-cloud.com"),
    apiToken = configuration.getOptional[String]("clever.api-token").map(_.trim).filter(_.nonEmpty),
    ownerId = configuration.getOptional[String]("clever.owner-id").map(_.trim).filter(_.nonEmpty),
    apiTimeout = configuration.getOptional[Long]("clever.timeout").getOrElse(30000L).millis,
    dryRun = configuration.getOptional[Boolean]("dry-run").getOrElse(false),
    timezone = configuration
      .getOptional[String]("timezone")
      .flatMap(z => Try(ZoneId.of(z)).toOption)
      .getOrElse(ZoneId.of("Europe/Paris")),
    interval = configuration.getOptional[Long]("job.interval").getOrElse(30000L).millis,
    fastInterval = configuration.getOptional[Long]("job.fast-interval").getOrElse(5000L).millis,
    accessFlushInterval = configuration.getOptional[Long]("access-flush-interval").getOrElse(10000L).millis,
    historySize = configuration.getOptional[Int]("history-size").getOrElse(100)
  )
}

/**
 * What this node knows, kept in memory so the plugin never waits on the datastore. Reloaded from the
 * datastore at each state sync, on every node, and updated right away by the engine on the leader.
 */
class ReaperMemory {

  private val _states = new TrieMap[String, AppState]()
  private val _access = new TrieMap[String, Long]()
  @volatile private var _settings = ReaperSettings()

  def state(appId: String): Option[AppState] = _states.get(appId)
  def status(appId: String): Option[ReaperStatus] = _states.get(appId).map(_.status)
  def allStates(): Seq[AppState] = _states.values.toSeq

  def putState(state: AppState): Unit = _states.put(state.appId, state)
  def removeState(appId: String): Unit = _states.remove(appId)

  def replaceStates(states: Map[String, AppState]): Unit = {
    _states.addAll(states)
    _states.keySet.diff(states.keySet).foreach(_states.remove)
  }

  def lastAccess(appId: String): Option[Long] = _access.get(appId)
  def allAccess(): Map[String, Long] = _access.toMap

  def mergeAccess(accesses: Map[String, Long]): Unit = accesses.foreach { case (appId, at) =>
    _access.updateWith(appId)(current => Some(Math.max(current.getOrElse(0L), at)))
  }

  def settings: ReaperSettings = _settings
  def settings_=(value: ReaperSettings): Unit = _settings = value
}

/**
 * The last access to each app seen by this node and not pushed yet. A request costs a map lookup and
 * an atomic max: no I/O on the request path.
 */
class AccessTracker {

  // entries are never removed: there is one per app, and removing one would race with a request
  private val pending = new TrieMap[String, AtomicLong]()

  def touch(appId: String, at: Long = System.currentTimeMillis()): Unit =
    pending.getOrElseUpdate(appId, new AtomicLong(0L)).accumulateAndGet(at, (a, b) => Math.max(a, b))

  def drain(): Map[String, Long] =
    pending.toSeq.flatMap { case (appId, value) =>
      val at = value.getAndSet(0L)
      if (at > 0L) Some(appId -> at) else None
    }.toMap

  /** Puts back what could not be pushed, so it is pushed with the next batch. */
  def restore(accesses: Map[String, Long]): Unit = accesses.foreach { case (appId, at) => touch(appId, at) }
}

/** Calls an admin api route of the extension on a leader, from a worker, with the cluster credentials. */
object LeaderClient {

  private val counter = new AtomicInteger(0)

  def call(env: Env, method: String, path: String, body: Option[JsValue] = None)(using
      ec: ExecutionContext
  ): Future[Either[String, JsValue]] = {
    val config = env.clusterConfig
    val urls   = config.leader.urls
    if (urls.isEmpty) Left("no leader url configured").vfuture
    else {
      val url     = urls(Math.abs(counter.incrementAndGet() % urls.size))
      val request = env.MtlsWs
        .url(url + path, config.mtlsConfig)
        .withHttpHeaders("Host" -> config.leader.host, "Accept" -> "application/json")
        .withAuth(config.leader.clientId, config.leader.clientSecret, WSAuthScheme.BASIC)
        .withRequestTimeout(Duration(config.worker.timeout, TimeUnit.MILLISECONDS))
        .withMaybeProxyServer(config.proxy)
        .withMethod(method)
      body
        .map(b => request.withBody(b))
        .getOrElse(request)
        .execute()
        .map { response =>
          val raw: String = response.body
          if (response.status >= 200 && response.status < 300) Right(Try(Json.parse(raw)).getOrElse(JsNull))
          else Left(s"leader answered ${response.status}: ${raw.take(300)}")
        }
        .recover { case e: Throwable => Left(Option(e.getMessage).getOrElse(e.getClass.getSimpleName)) }
    }
  }
}

/**
 * Holds requests until their app is up. However many requests wait for an app, this node follows it
 * with a single poll loop, and asks for a wake up again now and then in case the first ask was lost.
 */
class ReaperWaiters(
    env: Env,
    currentStatus: String => Future[Option[ReaperStatus]],
    requestWake: String => Unit,
    pollEvery: FiniteDuration = 2.seconds,
    wakeAgainEvery: FiniteDuration = 10.seconds
) {

  private val logger   = Logger("cloud-apim-clever-reaper-waiters")
  private val watchers = new TrieMap[String, Promise[ReaperStatus]]()

  def watching: Int = watchers.size

  /** The status the app settled on, `Up` or `Error`, or `None` when it did not within `timeout`. */
  def await(appId: String, timeout: FiniteDuration): Future[Option[ReaperStatus]] = {
    given ExecutionContext = env.otoroshiExecutionContext
    val fresh   = Promise[ReaperStatus]()
    val promise = watchers.putIfAbsent(appId, fresh) match {
      case Some(existing) => existing
      case None           =>
        val now = System.currentTimeMillis()
        poll(appId, fresh, now + Math.max(timeout.toMillis, 60000L) + 60000L, now)
        fresh
    }
    val timer = Promise[Option[ReaperStatus]]()
    val task  = env.otoroshiScheduler.scheduleOnce(timeout)(timer.trySuccess(None))
    promise.future.foreach { status =>
      task.cancel()
      timer.trySuccess(Some(status))
    }
    timer.future
  }

  private def poll(appId: String, promise: Promise[ReaperStatus], deadline: Long, lastWake: Long): Unit = {
    given ExecutionContext = env.otoroshiExecutionContext
    env.otoroshiScheduler.scheduleOnce(pollEvery) {
      currentStatus(appId)
        .recover { case e: Throwable =>
          logger.warn(s"could not read the status of $appId: ${e.getMessage}")
          None
        }
        .onComplete { result =>
          val now = System.currentTimeMillis()
          result match {
            case Success(Some(status @ (ReaperStatus.Up | ReaperStatus.Error))) =>
              watchers.remove(appId, promise)
              promise.trySuccess(status)
            case _ if now > deadline                                            =>
              // nobody can still be waiting: their own timeout is shorter than this
              watchers.remove(appId, promise)
              promise.trySuccess(ReaperStatus.Down)
            case Success(Some(ReaperStatus.Down)) if now - lastWake > wakeAgainEvery.toMillis =>
              requestWake(appId)
              poll(appId, promise, deadline, now)
            case _                                                              =>
              poll(appId, promise, deadline, lastWake)
          }
        }
    }
  }
}

/** Logs a message at most once per period, for what would otherwise be said at every tick. */
class ThrottledLogger(logger: Logger, period: FiniteDuration = 10.minutes) {
  private val last = new TrieMap[String, Long]()
  private def due(key: String): Boolean = {
    val now = System.currentTimeMillis()
    val ok  = last.get(key).forall(at => now - at > period.toMillis)
    if (ok) last.put(key, now)
    ok
  }
  def warn(key: String, message: => String): Unit = if (due(key)) logger.warn(message)
  def info(key: String, message: => String): Unit = if (due(key)) logger.info(message)
  def reset(key: String): Unit = last.remove(key)
}
