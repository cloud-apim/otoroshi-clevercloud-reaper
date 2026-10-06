package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import otoroshi.env.Env
import otoroshi.utils.http.Implicits.*
import otoroshi.utils.syntax.implicits.*
import play.api.Logger
import play.api.libs.json.*
import play.api.libs.ws.WSResponse

import scala.concurrent.duration.FiniteDuration
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

final case class CleverApp(
    id: String,
    name: String,
    ownerId: String,
    ownerName: Option[String],
    state: String,
    vhosts: Seq[String] = Seq.empty,
    // only in the answers of the application endpoints, not in the summary
    zone: Option[String] = None,
    sizing: Option[CleverSizing] = None
) {
  def json: JsValue = Json.obj(
    "id"         -> id,
    "name"       -> name,
    "owner_id"   -> ownerId,
    "owner_name" -> ownerName,
    "state"      -> state,
    "vhosts"     -> vhosts,
    "zone"       -> zone
  )
}

final case class CleverDeployment(id: String, state: String, action: Option[String], date: Long, cause: Option[String]) {
  def json: JsValue = Json.obj("id" -> id, "state" -> state, "action" -> action, "date" -> date, "cause" -> cause)
}

/** `code` is the `id` clever puts in its error bodies, e.g. 4014 for an app that was never deployed. */
final case class CleverError(status: Int, message: String, code: Option[Int] = None) {
  def json: JsValue = Json.obj("status" -> status, "message" -> message, "code" -> code)
  override def toString: String = s"clever cloud api error ($status${code.map(c => s"/$c").getOrElse("")}): $message"
}

object CleverError {
  val NeverDeployed = 4014
}

/**
 * Just what the reaper needs from the clever cloud api, authenticated with an api token. API tokens
 * are only accepted by the api bridge (`https://api-bridge.clever-cloud.com`).
 */
class CleverCloudApi(env: Env, baseUrl: String, token: Option[String], timeout: FiniteDuration) {

  private val logger = Logger("cloud-apim-clevercloud-reaper-api")
  private val base   = baseUrl.stripSuffix("/")

  def configured: Boolean = token.exists(_.trim.nonEmpty)

  // apps owned by a user live under /self, the others under their organisation
  private def ownerPath(ownerId: String): String =
    if (ownerId.startsWith("user_")) "/v2/self" else s"/v2/organisations/$ownerId"

  private def call(method: String, path: String, query: Seq[(String, String)] = Seq.empty)(using
      ec: ExecutionContext
  ): Future[Either[CleverError, JsValue]] = {
    token.filter(_.trim.nonEmpty) match {
      case None        => Left(CleverError(0, "no clever cloud api token configured (CLEVER_CLOUD_API_TOKEN)")).vfuture
      case Some(value) =>
        val globalConfig = env.datastores.globalConfigDataStore.latest()(using ec, env)
        env.Ws
          .url(s"$base$path")
          .withHttpHeaders("Authorization" -> s"Bearer ${value.trim}", "Accept" -> "application/json")
          .withQueryStringParameters(query*)
          .withRequestTimeout(timeout)
          .withMaybeProxyServer(globalConfig.proxies.clevercloud)
          .withMethod(method)
          .execute()
          .map(handle(method, path, _))
          .recover { case e: Throwable =>
            logger.error(s"clever cloud api call failed: $method $path", e)
            Left(CleverError(0, Option(e.getMessage).getOrElse(e.getClass.getSimpleName)))
          }
    }
  }

  private def handle(method: String, path: String, response: WSResponse): Either[CleverError, JsValue] = {
    val raw: String = response.body
    val body        = Try(Json.parse(raw)).getOrElse(JsString(raw))
    if (response.status >= 200 && response.status < 300) Right(body)
    else {
      val message = body.select("message").asOpt[String].getOrElse(raw.take(500))
      if (logger.isDebugEnabled) logger.debug(s"clever cloud api answered ${response.status} to $method $path: $message")
      // the v2 api says it is rate limited with a 403 whose body id is 403, the v4 one with a 429
      Left(CleverError(response.status, message, body.select("id").asOpt[Int]))
    }
  }

  private def readApp(json: JsValue, ownerId: String, ownerName: Option[String]): Option[CleverApp] = for {
    id    <- json.select("id").asOpt[String]
    state <- json.select("state").asOpt[String]
  } yield CleverApp(
    id = id,
    name = json.select("name").asOpt[String].getOrElse(id),
    ownerId = json.select("ownerId").asOpt[String].getOrElse(ownerId),
    ownerName = ownerName,
    state = state,
    vhosts = json.select("vhosts").asOpt[Seq[JsValue]].getOrElse(Seq.empty).flatMap(_.select("fqdn").asOpt[String]),
    zone = json.select("zone").asOpt[String],
    sizing = CleverSizing.read(json)
  )

  /** Every app the token can see, with its owner and state, in a single call. No vhosts in there. */
  def summary()(using ec: ExecutionContext): Future[Either[CleverError, Seq[CleverApp]]] =
    call("GET", "/v2/summary").map(_.map { json =>
      val user     = json.select("user").asOpt[JsObject].toSeq
      val orgs     = json.select("organisations").asOpt[Seq[JsObject]].getOrElse(Seq.empty)
      val owners   = user ++ orgs
      owners
        .flatMap { owner =>
          val ownerId   = owner.select("id").asOpt[String].getOrElse("")
          val ownerName = owner.select("name").asOpt[String]
          owner.select("applications").asOpt[Seq[JsValue]].getOrElse(Seq.empty).flatMap(readApp(_, ownerId, ownerName))
        }
        .groupBy(_.id)
        .values
        .map(_.head)
        .toSeq
    })

  /** The apps of one owner, with their vhosts. */
  def applications(ownerId: String, ownerName: Option[String] = None)(using
      ec: ExecutionContext
  ): Future[Either[CleverError, Seq[CleverApp]]] =
    call("GET", s"${ownerPath(ownerId)}/applications").map(_.map { json =>
      json.asOpt[Seq[JsValue]].getOrElse(Seq.empty).flatMap(readApp(_, ownerId, ownerName))
    })

  def application(ownerId: String, appId: String)(using ec: ExecutionContext): Future[Either[CleverError, CleverApp]] =
    call("GET", s"${ownerPath(ownerId)}/applications/$appId").map(_.flatMap { json =>
      readApp(json, ownerId, None).toRight(CleverError(0, s"unreadable app $appId"))
    })

  def lastDeployment(ownerId: String, appId: String)(using
      ec: ExecutionContext
  ): Future[Either[CleverError, Option[CleverDeployment]]] =
    call("GET", s"${ownerPath(ownerId)}/applications/$appId/deployments", Seq("limit" -> "1")).map(_.map { json =>
      json.asOpt[Seq[JsValue]].getOrElse(Seq.empty).headOption.flatMap { d =>
        d.select("state").asOpt[String].map { state =>
          CleverDeployment(
            id = d.select("uuid").asOpt[String].orElse(d.select("id").asOpt[Long].map(_.toString)).getOrElse(""),
            state = state,
            action = d.select("action").asOpt[String],
            date = d.select("date").asOpt[Long].getOrElse(0L),
            cause = d.select("cause").asOpt[String]
          )
        }
      }
    })

  /** The prices of a zone, per runtime flavor. A public endpoint of the v4 api, served by the bridge too. */
  def priceSystem(zone: String, currency: String)(using ec: ExecutionContext): Future[Either[CleverError, PriceSystem]] =
    call("GET", "/v4/billing/price-system", Seq("zone_id" -> zone, "currency" -> currency)).map(
      _.map(json => PriceSystem.parse(zone, currency, json, System.currentTimeMillis()))
    )

  def stop(ownerId: String, appId: String)(using ec: ExecutionContext): Future[Either[CleverError, Unit]] =
    call("DELETE", s"${ownerPath(ownerId)}/applications/$appId/instances").map(_.map(_ => ()))

  /** Starts the app on its current commit. Returns the deployment it triggered, when clever says it. */
  def start(ownerId: String, appId: String)(using ec: ExecutionContext): Future[Either[CleverError, Option[String]]] =
    call("POST", s"${ownerPath(ownerId)}/applications/$appId/instances").map(_.map { json =>
      json.select("deploymentId").asOpt[String]
    })
}
