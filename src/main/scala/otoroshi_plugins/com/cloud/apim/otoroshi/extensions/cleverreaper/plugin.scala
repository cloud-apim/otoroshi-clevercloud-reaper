package otoroshi_plugins.com.cloud.apim.otoroshi.extensions.cleverreaper

import com.cloud.apim.otoroshi.extensions.cleverreaper.*
import otoroshi.env.Env
import otoroshi.gateway.Errors
import otoroshi.next.plugins.api.*
import otoroshi.utils.syntax.implicits.*
import play.api.libs.json.*
import play.api.mvc.{RequestHeader, Result, Results}

import scala.concurrent.duration.*
import scala.concurrent.{ExecutionContext, Future, Promise}

object CleverReaperPluginSchema {

  val configFlow: Seq[String] = Seq(
    "app_id",
    "owner_id",
    "grace_period",
    "fail_timeout",
    "ready_delay",
    "allow_waiting_page",
    "api_behavior",
    "timezone",
    "must_be_up_at",
    "monitoring_filters",
    "waiting_page"
  )

  val configSchema: JsObject = Json.obj(
    "app_id"             -> Json.obj(
      "type"  -> "select",
      "label" -> "Clever Cloud app",
      "props" -> Json.obj(
        "help"               -> "The app behind this route. When empty, it is guessed from the default 'app-<uuid>.cleverapps.io' domain of the targets",
        "optionsFrom"        -> "/extensions/cloud-apim/extensions/clever-reaper/clever/apps",
        "optionsTransformer" -> Json.obj("label" -> "label", "value" -> "id")
      )
    ),
    "owner_id"           -> Json.obj(
      "type"  -> "string",
      "label" -> "Owner",
      "props" -> Json.obj(
        "placeholder" -> "orga_xxx",
        "help"        -> "The organisation that owns the app. Discovered from the api token when empty"
      )
    ),
    "grace_period"       -> Json.obj(
      "type"  -> "number",
      "label" -> "Grace period (seconds)",
      "props" -> Json.obj("help" -> "How long the app may go without traffic before it is put to sleep")
    ),
    "fail_timeout"       -> Json.obj(
      "type"  -> "number",
      "label" -> "Fail timeout (seconds)",
      "props" -> Json.obj("help" -> "How long a start or a stop may take before the app goes into error")
    ),
    "ready_delay"        -> Json.obj(
      "type"  -> "number",
      "label" -> "Ready delay (seconds)",
      "props" -> Json.obj("help" -> "How long to wait once clever cloud says the app is up, before sending it the held requests")
    ),
    "allow_waiting_page" -> Json.obj(
      "type"  -> "bool",
      "label" -> "Waiting page for browsers",
      "props" -> Json.obj("help" -> "Browsers get a page that reloads itself once the app is up")
    ),
    "api_behavior"       -> Json.obj(
      "type"  -> "select",
      "label" -> "Other requests",
      "props" -> Json.obj(
        "help"    -> "What api calls get while the app wakes up",
        "options" -> Json.arr(
          Json.obj("value" -> CleverReaperConfig.Hold, "label"        -> "Held until the app is up"),
          Json.obj("value" -> CleverReaperConfig.Unavailable, "label" -> "503 with a Retry-After header")
        )
      )
    ),
    "timezone"           -> Json.obj(
      "type"  -> "string",
      "label" -> "Timezone",
      "props" -> Json.obj("placeholder" -> "Europe/Paris", "help" -> "The timezone of the time ranges below")
    ),
    "must_be_up_at"      -> Json.obj(
      "type"   -> "object",
      "array"  -> true,
      "format" -> "form",
      "label"  -> "Must be up at",
      "help"   -> "Time ranges where the app stays up whatever its traffic",
      "schema" -> Json.obj(
        "days"  -> Json.obj(
          "type"  -> "string",
          "array" -> true,
          "label" -> "Days",
          "help"  -> "monday, tuesday, ... Empty or '*' for every day"
        ),
        "start" -> Json.obj("type" -> "string", "format" -> "time", "label" -> "Start", "placeholder" -> "08:00"),
        "end"   -> Json.obj("type" -> "string", "format" -> "time", "label" -> "End", "placeholder" -> "19:00")
      ),
      "flow"   -> Json.arr("days", "start", "end")
    ),
    "monitoring_filters" -> Json.obj(
      "type"   -> "object",
      "array"  -> true,
      "format" -> "form",
      "label"  -> "Monitoring filters",
      "help"   -> "Requests matching any of these are not traffic: they neither keep the app awake nor wake it up",
      "schema" -> Json.obj(
        "source" -> Json.obj(
          "type"  -> "select",
          "label" -> "Source",
          "props" -> Json.obj(
            "options" -> Json.arr(
              Json.obj("value" -> "path", "label"       -> "Path"),
              Json.obj("value" -> "uri", "label"        -> "Path and query"),
              Json.obj("value" -> "header", "label"     -> "Header"),
              Json.obj("value" -> "user_agent", "label" -> "User-Agent"),
              Json.obj("value" -> "query", "label"      -> "Query param")
            )
          )
        ),
        "name"   -> Json.obj("type" -> "string", "label" -> "Header or query param name"),
        "regex"  -> Json.obj("type" -> "string", "label" -> "Regex", "help" -> "Searched in the value, anchor it with ^ and $ for an exact match")
      ),
      "flow"   -> Json.arr("source", "name", "regex")
    ),
    "waiting_page"       -> Json.obj(
      "type"  -> "code",
      "label" -> "Custom waiting page",
      "help"  -> "Your own html. Placeholders: {{route_name}}, {{app_name}}, {{app_id}}, {{status}}. The reload script is added for you",
      "props" -> Json.obj("type" -> "html", "editorOnly" -> true)
    )
  )
}

/**
 * Puts the clever cloud app behind a route to sleep when it gets no traffic, and wakes it up on the
 * next request.
 *
 * Runs as an access validator, so a request is held before the backend call and its timeouts. Place it
 * after the authentication plugins: an anonymous request then never wakes an app up.
 */
class CleverReaper extends NgAccessValidator {

  override def steps: Seq[NgStep]                          = Seq(NgStep.ValidateAccess)
  override def categories: Seq[NgPluginCategory]           = Seq(NgPluginCategory.Custom("Clever Cloud"), NgPluginCategory.TrafficControl)
  override def visibility: NgPluginVisibility              = NgPluginVisibility.NgUserLand
  override def multiInstance: Boolean                      = false
  override def core: Boolean                               = true
  override def name: String                                = "Cloud APIM - Clever Cloud Reaper"
  override def description: Option[String]                 =
    "Puts the Clever Cloud app behind this route to sleep when it gets no traffic, and wakes it up on the next request. Place it after the authentication plugins".some
  override def defaultConfigObject: Option[NgPluginConfig] = CleverReaperConfig.default.some
  override def isAccessAsync: Boolean                      = true

  override def noJsForm: Boolean              = true
  override def configFlow: Seq[String]        = CleverReaperPluginSchema.configFlow
  override def configSchema: Option[JsObject] = CleverReaperPluginSchema.configSchema.some

  override def access(ctx: NgAccessContext)(using env: Env, ec: ExecutionContext): Future[NgAccess] =
    env.adminExtensions.extension[CleverReaperExtension] match {
      case None      => NgAccess.NgAllowed.vfuture
      case Some(ext) =>
        val config = ctx.cachedConfig(internalName)(CleverReaperConfig.format).getOrElse(CleverReaperConfig.default)
        CleverAppIds.resolve(ctx.route, config) match {
          case None        => NgAccess.NgAllowed.vfuture
          case Some(appId) => handle(ext, appId, config, ctx)
        }
    }

  private def handle(ext: CleverReaperExtension, appId: String, config: CleverReaperConfig, ctx: NgAccessContext)(using
      env: Env,
      ec: ExecutionContext
  ): Future[NgAccess] = {
    val request = ctx.request
    val state   = ext.memory.state(appId)
    val status  = state.map(_.status)
    if (request.headers.get(WaitingPage.StatusHeader).exists(_.equalsIgnoreCase("status"))) {
      // the polling of the waiting page: not traffic, it must not keep the app awake once it is up
      NgAccess
        .NgDenied(
          Results.Ok(WaitingPage.statusJson(status, config.readyDelay)).withHeaders("Cache-Control" -> "no-store")
        )
        .vfuture
    } else {
      val monitoring = config.isMonitoring(request)
      status match {
        case Some(s) if s.asleep && monitoring =>
          NgAccess.NgDenied(Results.Ok(Json.obj("monitoring" -> true, "status" -> s)).withHeaders("Cache-Control" -> "no-store")).vfuture
        case Some(s) if s.asleep               =>
          ext.tracker.touch(appId)
          ext.requestWake(appId)
          if (config.allowWaitingPage && wantsHtml(request)) {
            val html = WaitingPage.render(ext.waitingPageTemplate(config), ctx.route.name, appId, state.flatMap(_.name), status)
            NgAccess
              .NgDenied(
                Results
                  .ServiceUnavailable(html)
                  .as("text/html; charset=utf-8")
                  .withHeaders("Retry-After" -> "30", "Cache-Control" -> "no-store")
              )
              .vfuture
          } else if (!config.holdsRequests) {
            NgAccess
              .NgDenied(
                Results
                  .ServiceUnavailable(Json.obj("error" -> "the application is waking up, retry later", "status" -> s))
                  .withHeaders("Retry-After" -> "30", "Cache-Control" -> "no-store")
              )
              .vfuture
          } else {
            hold(ext, appId, config, ctx)
          }
        case _                                 =>
          // up, unknown, or in error: in error the reaper leaves the app alone, it may very well be running
          if (!monitoring) ext.tracker.touch(appId)
          NgAccess.NgAllowed.vfuture
      }
    }
  }

  private def wantsHtml(request: RequestHeader): Boolean =
    (request.method == "GET" || request.method == "HEAD") &&
    request.headers.get("Accept").exists(_.toLowerCase.contains("text/html"))

  private def hold(ext: CleverReaperExtension, appId: String, config: CleverReaperConfig, ctx: NgAccessContext)(using
      env: Env,
      ec: ExecutionContext
  ): Future[NgAccess] =
    ext.waiters.await(appId, config.failTimeout.seconds).flatMap {
      case Some(ReaperStatus.Up)    => delay(config.readyDelay.seconds).map(_ => NgAccess.NgAllowed)
      case Some(ReaperStatus.Error) =>
        error(ctx, Results.ServiceUnavailable, "the application could not be started", "errors.clever.reaper.start.failed")
      case _                        =>
        error(ctx, Results.GatewayTimeout, "the application did not wake up in time", "errors.clever.reaper.wakeup.timeout")
    }

  private def delay(duration: FiniteDuration)(using env: Env): Future[Unit] =
    if (duration.toMillis <= 0L) Future.unit
    else {
      val promise = Promise[Unit]()
      env.otoroshiScheduler.scheduleOnce(duration)(promise.trySuccess(()))(using env.otoroshiExecutionContext)
      promise.future
    }

  private def error(ctx: NgAccessContext, status: Results.Status, message: String, causeId: String)(using
      env: Env,
      ec: ExecutionContext
  ): Future[NgAccess] =
    Errors
      .craftResponseResult(
        message = message,
        status = status,
        req = ctx.request,
        maybeDescriptor = None,
        maybeCauseId = Some(causeId),
        duration = ctx.report.getDurationNow(),
        overhead = ctx.report.getOverheadInNow(),
        attrs = ctx.attrs,
        maybeRoute = ctx.route.some
      )
      .map((r: Result) => NgAccess.NgDenied(r))
}
