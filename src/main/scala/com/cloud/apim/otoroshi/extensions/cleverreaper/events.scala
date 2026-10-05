package com.cloud.apim.otoroshi.extensions.cleverreaper

import org.joda.time.DateTime
import otoroshi.env.Env
import otoroshi.events.{AlertEvent, AnalyticEvent}
import play.api.libs.json.*

/** Sent at every transition of an app, so data exporters can follow what the reaper does. */
final case class CleverReaperEvent(transition: Transition, state: AppState, env: Env) extends AnalyticEvent {

  val `@id`: String                          = env.snowflakeGenerator.nextIdStr()
  val `@timestamp`: DateTime                 = DateTime.now()
  override def `@type`: String               = "CleverReaperEvent"
  override def `@service`: String            = state.name.getOrElse(state.appId)
  override def `@serviceId`: String          = state.appId
  override def fromOrigin: Option[String]    = None
  override def fromUserAgent: Option[String] = None

  override def toJson(using _env: Env): JsValue = Json.obj(
    "@id"        -> `@id`,
    "@timestamp" -> play.api.libs.json.JodaWrites.JodaDateTimeNumberWrites.writes(`@timestamp`),
    "@type"      -> `@type`,
    "@product"   -> _env.eventsName,
    "@serviceId" -> `@serviceId`,
    "@service"   -> `@service`,
    "@env"       -> _env.env,
    "transition" -> transition.json,
    "app"        -> state.json
  )
}

/** Sent when an app falls into error: the reaper leaves it alone until someone resets it. */
final case class CleverReaperAppInErrorAlert(transition: Transition, state: AppState, env: Env) extends AlertEvent {

  val `@id`: String                          = env.snowflakeGenerator.nextIdStr()
  val `@timestamp`: DateTime                 = DateTime.now()
  override def `@service`: String            = state.name.getOrElse(state.appId)
  override def `@serviceId`: String          = state.appId
  override def fromOrigin: Option[String]    = None
  override def fromUserAgent: Option[String] = None

  override def toJson(using _env: Env): JsValue = Json.obj(
    "@id"        -> `@id`,
    "@timestamp" -> play.api.libs.json.JodaWrites.JodaDateTimeNumberWrites.writes(`@timestamp`),
    "@type"      -> `@type`,
    "@product"   -> _env.eventsName,
    "@serviceId" -> `@serviceId`,
    "@service"   -> `@service`,
    "@env"       -> _env.env,
    "alert"      -> "CleverReaperAppInError",
    "app_id"     -> state.appId,
    "app_name"   -> state.name,
    "from"       -> transition.from,
    "cause"      -> transition.cause,
    "routes"     -> state.routes,
    "app"        -> state.json
  )
}
