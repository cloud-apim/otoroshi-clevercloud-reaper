package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import otoroshi.next.models.NgRoute
import otoroshi.next.plugins.api.NgPluginConfig
import otoroshi.utils.syntax.implicits.*
import play.api.libs.json.*
import play.api.mvc.RequestHeader

import java.time.{DayOfWeek, Instant, LocalTime, ZoneId, ZonedDateTime}
import java.util.regex.Pattern
import scala.util.{Failure, Success, Try}

/**
 * Where an app stands, from the reaper's point of view. The clever cloud state alone is not enough:
 * an app the reaper just asked to stop is still `SHOULD_BE_UP` for a while.
 */
enum ReaperStatus {
  case WaitingForInit, Up, WaitingForShutdown, Down, WaitingForUp, Error

  /** The app cannot serve a request right now, but it will after a wake up. */
  def asleep: Boolean = this == Down || this == WaitingForShutdown || this == WaitingForUp

  /** Followed at the fast pace of the job rather than the regular one. */
  def transitional: Boolean = this == WaitingForInit || this == WaitingForShutdown || this == WaitingForUp
}

object ReaperStatus {
  def parse(value: String): Option[ReaperStatus] = ReaperStatus.values.find(_.toString.equalsIgnoreCase(value))
  given Format[ReaperStatus] = Format(
    Reads {
      case JsString(s) => parse(s).map(JsSuccess(_)).getOrElse(JsError(s"unknown status '$s'"))
      case _           => JsError("status should be a string")
    },
    Writes(s => JsString(s.toString))
  )
}

/**
 * A request that only checks whether the app is alive. It is not traffic: it does not keep the app
 * awake, and it does not wake it up. Filters combine with a OR: one match is enough.
 */
final case class MonitoringFilter(source: String, name: Option[String], regex: String) {

  // a regex that does not compile matches nothing, rather than failing every request of the route
  private lazy val pattern: Option[Pattern] = Try(Pattern.compile(regex)).toOption

  def matches(request: RequestHeader): Boolean = pattern.exists { p =>
    val values: Seq[String] = source match {
      case "path"       => Seq(request.path)
      case "uri"        => Seq(request.uri)
      case "header"     => name.toSeq.flatMap(n => request.headers.getAll(n))
      case "user_agent" => request.headers.get("User-Agent").toSeq
      case "query"      => name.toSeq.flatMap(n => request.queryString.getOrElse(n, Seq.empty))
      case _            => Seq.empty
    }
    values.exists(v => p.matcher(v).find())
  }

  def json: JsValue = Json.obj("source" -> source, "name" -> name, "regex" -> regex)
}

object MonitoringFilter {
  val sources: Seq[String] = Seq("path", "uri", "header", "user_agent", "query")

  def read(json: JsValue): Option[MonitoringFilter] = for {
    source <- json.select("source").asOpt[String].map(_.trim.toLowerCase).filter(sources.contains)
    regex  <- json.select("regex").asOpt[String].filter(_.nonEmpty)
  } yield MonitoringFilter(source, json.select("name").asOpt[String].map(_.trim).filter(_.nonEmpty), regex)
}

/**
 * A time range where the app must stay up, whatever its traffic. An empty `days` means every day. A
 * range ending before it starts runs overnight: its days are the days it starts.
 */
final case class UpRange(days: Seq[DayOfWeek], start: LocalTime, end: LocalTime) {

  private def onDay(day: DayOfWeek): Boolean = days.isEmpty || days.contains(day)

  def contains(now: ZonedDateTime): Boolean = {
    val time = now.toLocalTime
    if (!start.isAfter(end)) {
      onDay(now.getDayOfWeek) && !time.isBefore(start) && time.isBefore(end)
    } else {
      (onDay(now.getDayOfWeek) && !time.isBefore(start)) || (onDay(now.getDayOfWeek.minus(1)) && time.isBefore(end))
    }
  }

  def json: JsValue = Json.obj(
    "days"  -> days.map(_.toString.toLowerCase),
    "start" -> start.toString,
    "end"   -> end.toString
  )
}

object UpRange {

  private val everyDay = Set("*", "all", "every_day", "everyday")

  def parseDay(value: String): Option[DayOfWeek] = {
    val v = value.trim.toUpperCase
    DayOfWeek.values().find(d => d.toString == v || d.toString.take(3) == v)
  }

  def read(json: JsValue): Option[UpRange] = Try {
    val rawDays = json.select("days").asOpt[Seq[String]].getOrElse(Seq.empty)
    val days    = if (rawDays.exists(d => everyDay.contains(d.trim.toLowerCase))) Seq.empty else rawDays.flatMap(parseDay).distinct
    UpRange(
      days = days,
      start = LocalTime.parse(json.select("start").asOpt[String].getOrElse("08:00")),
      end = LocalTime.parse(json.select("end").asOpt[String].getOrElse("19:00"))
    )
  }.toOption
}

/** The reaper settings of one route, held by the plugin instance itself. Durations are in seconds. */
final case class CleverCloudReaperConfig(
    appId: Option[String] = None,
    ownerId: Option[String] = None,
    gracePeriod: Long = 3600L,
    failTimeout: Long = 900L,
    allowWaitingPage: Boolean = true,
    apiBehavior: String = CleverCloudReaperConfig.Hold,
    readyDelay: Long = 3L,
    mustBeUpAt: Seq[UpRange] = Seq.empty,
    timezone: Option[String] = None,
    monitoringFilters: Seq[MonitoringFilter] = Seq.empty,
    waitingPage: Option[String] = None
) extends NgPluginConfig {

  def json: JsValue = CleverCloudReaperConfig.format.writes(this)

  def holdsRequests: Boolean = apiBehavior == CleverCloudReaperConfig.Hold

  def zone(default: ZoneId): ZoneId = timezone.flatMap(z => Try(ZoneId.of(z)).toOption).getOrElse(default)

  def inUpRange(now: Instant, defaultZone: ZoneId): Boolean =
    mustBeUpAt.nonEmpty && {
      val local = now.atZone(zone(defaultZone))
      mustBeUpAt.exists(_.contains(local))
    }

  def isMonitoring(request: RequestHeader): Boolean = monitoringFilters.exists(_.matches(request))
}

object CleverCloudReaperConfig {

  // the request waits, held open, until the app is up
  val Hold        = "hold"
  // a 503 with a Retry-After header, at once
  val Unavailable = "unavailable"
  // a small html page that polls the requested path and reloads once the app answers it
  val ClientPoll  = "client_poll"

  val default: CleverCloudReaperConfig = CleverCloudReaperConfig()

  private def positive(json: JsValue, key: String, default: Long): Long =
    json.select(key).asOpt[Long].filter(_ >= 0L).getOrElse(default)

  val format: Format[CleverCloudReaperConfig] = new Format[CleverCloudReaperConfig] {
    override def writes(o: CleverCloudReaperConfig): JsValue = Json.obj(
      "app_id"             -> o.appId,
      "owner_id"           -> o.ownerId,
      "grace_period"       -> o.gracePeriod,
      "fail_timeout"       -> o.failTimeout,
      "allow_waiting_page" -> o.allowWaitingPage,
      "api_behavior"       -> o.apiBehavior,
      "ready_delay"        -> o.readyDelay,
      "must_be_up_at"      -> o.mustBeUpAt.map(_.json),
      "timezone"           -> o.timezone,
      "monitoring_filters" -> o.monitoringFilters.map(_.json),
      "waiting_page"       -> o.waitingPage
    )
    override def reads(json: JsValue): JsResult[CleverCloudReaperConfig] = Try {
      CleverCloudReaperConfig(
        appId = json.select("app_id").asOpt[String].map(_.trim).filter(_.nonEmpty),
        ownerId = json.select("owner_id").asOpt[String].map(_.trim).filter(_.nonEmpty),
        gracePeriod = positive(json, "grace_period", default.gracePeriod),
        failTimeout = positive(json, "fail_timeout", default.failTimeout),
        allowWaitingPage = json.select("allow_waiting_page").asOpt[Boolean].getOrElse(default.allowWaitingPage),
        apiBehavior = json.select("api_behavior").asOpt[String].map(_.trim.toLowerCase) match {
          case Some(Unavailable) => Unavailable
          case Some(ClientPoll)  => ClientPoll
          case _                 => Hold
        },
        readyDelay = positive(json, "ready_delay", default.readyDelay),
        mustBeUpAt = json.select("must_be_up_at").asOpt[Seq[JsValue]].getOrElse(Seq.empty).flatMap(UpRange.read),
        timezone = json.select("timezone").asOpt[String].map(_.trim).filter(_.nonEmpty),
        monitoringFilters =
          json.select("monitoring_filters").asOpt[Seq[JsValue]].getOrElse(Seq.empty).flatMap(MonitoringFilter.read),
        waitingPage = json.select("waiting_page").asOpt[String].filter(_.trim.nonEmpty)
      )
    } match {
      case Success(value) => JsSuccess(value)
      case Failure(err)   => JsError(err.getMessage)
    }
  }
}

/** Finds the clever cloud app behind a route when its config does not name it. */
object CleverAppIds {

  private val DefaultDomain = "^app-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.cleverapps\\.io$".r

  /** `app-<uuid>.cleverapps.io` is the default domain of `app_<uuid>`. A heuristic: it can be removed. */
  def fromHostname(hostname: String): Option[String] = hostname.trim.toLowerCase match {
    case DefaultDomain(uuid) => s"app_$uuid".some
    case _                   => None
  }

  def fromRoute(route: NgRoute): Option[String] =
    route.backend.targets.iterator.flatMap(t => fromHostname(t.hostname)).nextOption()

  def fromVhosts(route: NgRoute, vhosts: Map[String, String]): Option[String] =
    route.backend.targets.iterator.flatMap(t => vhosts.get(t.hostname.trim.toLowerCase)).nextOption()

  def resolve(route: NgRoute, config: CleverCloudReaperConfig): Option[String] = config.appId.orElse(fromRoute(route))
}

/** What the reaper knows of one clever cloud app. Written by the leader only, read by every node. */
final case class AppState(
    appId: String,
    status: ReaperStatus = ReaperStatus.WaitingForInit,
    ownerId: Option[String] = None,
    name: Option[String] = None,
    cleverState: Option[String] = None,
    cause: Option[String] = None,
    errorCause: Option[String] = None,
    lastStatusUpdate: Long,
    lastUpAt: Option[Long] = None,
    lastDownAt: Option[Long] = None,
    actionAt: Option[Long] = None,
    lastCheckAt: Option[Long] = None,
    routes: Seq[String] = Seq.empty,
    gracePeriod: Long = CleverCloudReaperConfig.default.gracePeriod * 1000L,
    failTimeout: Long = CleverCloudReaperConfig.default.failTimeout * 1000L
) {
  def json: JsValue = AppState.format.writes(this)
}

object AppState {

  def initial(appId: String, now: Long): AppState = AppState(appId = appId, lastStatusUpdate = now)

  val format: Format[AppState] = new Format[AppState] {
    override def writes(o: AppState): JsValue = Json.obj(
      "app_id"             -> o.appId,
      "status"             -> o.status,
      "owner_id"           -> o.ownerId,
      "name"               -> o.name,
      "clever_state"       -> o.cleverState,
      "cause"              -> o.cause,
      "error_cause"        -> o.errorCause,
      "last_status_update" -> o.lastStatusUpdate,
      "last_up_at"         -> o.lastUpAt,
      "last_down_at"       -> o.lastDownAt,
      "action_at"          -> o.actionAt,
      "last_check_at"      -> o.lastCheckAt,
      "routes"             -> o.routes,
      "grace_period"       -> o.gracePeriod,
      "fail_timeout"       -> o.failTimeout
    )
    override def reads(json: JsValue): JsResult[AppState] = Try {
      AppState(
        appId = json.select("app_id").as[String],
        status = json.select("status").asOpt[ReaperStatus].getOrElse(ReaperStatus.WaitingForInit),
        ownerId = json.select("owner_id").asOpt[String],
        name = json.select("name").asOpt[String],
        cleverState = json.select("clever_state").asOpt[String],
        cause = json.select("cause").asOpt[String],
        errorCause = json.select("error_cause").asOpt[String],
        lastStatusUpdate = json.select("last_status_update").asOpt[Long].getOrElse(0L),
        lastUpAt = json.select("last_up_at").asOpt[Long],
        lastDownAt = json.select("last_down_at").asOpt[Long],
        actionAt = json.select("action_at").asOpt[Long],
        lastCheckAt = json.select("last_check_at").asOpt[Long],
        routes = json.select("routes").asOpt[Seq[String]].getOrElse(Seq.empty),
        gracePeriod = json.select("grace_period").asOpt[Long].getOrElse(CleverCloudReaperConfig.default.gracePeriod * 1000L),
        failTimeout = json.select("fail_timeout").asOpt[Long].getOrElse(CleverCloudReaperConfig.default.failTimeout * 1000L)
      )
    } match {
      case Success(value) => JsSuccess(value)
      case Failure(err)   => JsError(err.getMessage)
    }
  }

  def read(raw: String): Option[AppState] = Try(Json.parse(raw)).toOption.flatMap(format.reads(_).asOpt)
}

/** One transition of an app, kept for the history and sent as an event. */
final case class Transition(appId: String, from: ReaperStatus, to: ReaperStatus, cause: String, at: Long) {
  def json: JsValue = Json.obj("app_id" -> appId, "from" -> from, "to" -> to, "cause" -> cause, "at" -> at)
}

object Transition {
  def read(raw: String): Option[Transition] = Try(Json.parse(raw)).toOption.flatMap { json =>
    for {
      appId <- json.select("app_id").asOpt[String]
      from  <- json.select("from").asOpt[ReaperStatus]
      to    <- json.select("to").asOpt[ReaperStatus]
    } yield Transition(appId, from, to, json.select("cause").asOpt[String].getOrElse(""), json.select("at").asOpt[Long].getOrElse(0L))
  }
}

/** Settings changed at runtime from the ui, shared by the whole cluster. */
final case class ReaperSettings(killSwitch: Boolean = false, updatedAt: Option[Long] = None, updatedBy: Option[String] = None) {
  def json: JsValue = Json.obj("kill_switch" -> killSwitch, "updated_at" -> updatedAt, "updated_by" -> updatedBy)
}

object ReaperSettings {
  def read(raw: String): Option[ReaperSettings] = Try(Json.parse(raw)).toOption.map { json =>
    ReaperSettings(
      killSwitch = json.select("kill_switch").asOpt[Boolean].getOrElse(false),
      updatedAt = json.select("updated_at").asOpt[Long],
      updatedBy = json.select("updated_by").asOpt[String]
    )
  }
}

/** One clever cloud app and every route the reaper manages it through, with their settings merged. */
final case class ManagedApp(appId: String, routes: Seq[(NgRoute, CleverCloudReaperConfig)]) {

  def routeIds: Seq[String] = routes.map(_._1.id).distinct.sorted

  def ownerId: Option[String] = routes.iterator.flatMap(_._2.ownerId).nextOption()

  // routes disagreeing on their settings: the app is kept awake by the most demanding one
  def gracePeriodMillis: Long = routes.map(_._2.gracePeriod).maxOption.getOrElse(CleverCloudReaperConfig.default.gracePeriod) * 1000L
  def failTimeoutMillis: Long = routes.map(_._2.failTimeout).maxOption.getOrElse(CleverCloudReaperConfig.default.failTimeout) * 1000L

  def inUpRange(now: Instant, defaultZone: ZoneId): Boolean = routes.exists(_._2.inUpRange(now, defaultZone))
}
