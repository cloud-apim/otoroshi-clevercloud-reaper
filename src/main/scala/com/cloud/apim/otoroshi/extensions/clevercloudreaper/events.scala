package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import org.joda.time.DateTime
import otoroshi.env.Env
import otoroshi.events.{AlertEvent, AnalyticEvent}
import play.api.libs.json.*

/** Sent at every transition of an app, so data exporters can follow what the reaper does. */
final case class CleverCloudReaperEvent(transition: Transition, state: AppState, slept: Option[SleepPeriod], env: Env)
    extends AnalyticEvent {

  val `@id`: String                          = env.snowflakeGenerator.nextIdStr()
  val `@timestamp`: DateTime                 = DateTime.now()
  override def `@type`: String               = "CleverCloudReaperEvent"
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
    "app"        -> state.json,
    // when the transition ends a sleep the reaper caused: how long, and what it saved
    "sleep"      -> slept.map(_.json).getOrElse(JsNull).as[JsValue]
  )
}

/** Sent when an app falls into error: the reaper leaves it alone until someone resets it. */
final case class CleverCloudReaperAppInErrorAlert(transition: Transition, state: AppState, env: Env) extends AlertEvent {

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
    "alert"      -> "CleverCloudReaperAppInError",
    "app_id"     -> state.appId,
    "app_name"   -> state.name,
    "from"       -> transition.from,
    "cause"      -> transition.cause,
    "routes"     -> state.routes,
    "app"        -> state.json
  )
}
