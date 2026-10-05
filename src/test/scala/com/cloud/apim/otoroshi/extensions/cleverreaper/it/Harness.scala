package com.cloud.apim.otoroshi.extensions.cleverreaper.it

import com.typesafe.config.ConfigFactory
import org.apache.pekko.actor.ActorSystem
import org.apache.pekko.http.scaladsl.Http
import org.apache.pekko.http.scaladsl.model.*
import org.apache.pekko.stream.Materializer
import otoroshi.api.Otoroshi
import otoroshi.models.{EntityLocation, RoundRobin}
import otoroshi.next.models.*
import play.api.libs.json.{JsArray, JsValue, Json}
import play.api.libs.ws.DefaultBodyWritables.writeableOf_String
import play.api.libs.ws.{WSAuthScheme, WSClient, WSResponse}
import play.core.server.ServerConfig

import java.net.ServerSocket
import java.nio.file.Files
import java.util.concurrent.atomic.{AtomicBoolean, AtomicInteger, AtomicReference}
import scala.concurrent.duration.*
import scala.concurrent.{Await, ExecutionContext, Future}
import scala.util.Try

object Ports {
  def free: Int = {
    val socket = new ServerSocket(0)
    val port   = socket.getLocalPort
    socket.close()
    port
  }
}

/**
 * Just enough of the clever cloud api: one app, which stops at once and takes `startDelay` to start,
 * like a real deployment. Its backend answers only while the app is up.
 */
class FakeClever(val appId: String, val ownerId: String = "orga_test", startDelay: FiniteDuration = 3.seconds)(using
    system: ActorSystem,
    ec: ExecutionContext
) {

  val token                                       = "test-token"
  val state                                       = new AtomicReference[String]("SHOULD_BE_UP")
  val up                                          = new AtomicBoolean(true)
  val starts                                      = new AtomicInteger(0)
  val stops                                       = new AtomicInteger(0)
  private val deployments                         = new AtomicReference[List[JsValue]](
    List(Json.obj("uuid" -> "deploy-0", "state" -> "OK", "action" -> "DEPLOY", "date" -> (System.currentTimeMillis() - 86400000L)))
  )

  private def appJson: JsValue = Json.obj(
    "id"      -> appId,
    "name"    -> "my-test-app",
    "ownerId" -> ownerId,
    "state"   -> state.get(),
    "vhosts"  -> Json.arr(Json.obj("fqdn" -> "my-test-app.example.com"))
  )

  private def json(value: JsValue, status: StatusCode = StatusCodes.OK): HttpResponse =
    HttpResponse(status = status, entity = HttpEntity(ContentTypes.`application/json`, Json.stringify(value)))

  private def deploy(id: String, deployState: String, action: String): Unit =
    deployments.updateAndGet(list => Json.obj("uuid" -> id, "state" -> deployState, "action" -> action, "date" -> System.currentTimeMillis()) :: list)

  private val app = s"/v2/organisations/$ownerId/applications/$appId"

  private val apiBinding = Await.result(
    Http()
      .newServerAt("127.0.0.1", 0)
      .bind { request =>
        val authorized = request.headers.exists(h => h.lowercaseName == "authorization" && h.value == s"Bearer $token")
        val path       = request.uri.path.toString
        Future.successful {
          if (!authorized) json(Json.obj("message" -> "unauthorized"), StatusCodes.Unauthorized)
          else
            (request.method, path) match {
              case (HttpMethods.GET, "/v2/summary")                                       =>
                json(
                  Json.obj(
                    "user"          -> Json.obj("id" -> "user_test", "name" -> "me", "applications" -> Json.arr()),
                    "organisations" -> Json.arr(
                      Json.obj(
                        "id"           -> ownerId,
                        "name"         -> "Test orga",
                        "applications" -> Json.arr(Json.obj("id" -> appId, "name" -> "my-test-app", "state" -> state.get()))
                      )
                    )
                  )
                )
              case (HttpMethods.GET, p) if p == s"/v2/organisations/$ownerId/applications" => json(Json.arr(appJson))
              case (HttpMethods.GET, p) if p == app                                       => json(appJson)
              case (HttpMethods.GET, p) if p == s"$app/deployments"                       => json(JsArray(deployments.get().take(1)))
              case (HttpMethods.DELETE, p) if p == s"$app/instances"                      =>
                stops.incrementAndGet()
                state.set("SHOULD_BE_DOWN")
                up.set(false)
                deploy(s"undeploy-${stops.get()}", "OK", "UNDEPLOY")
                json(Json.obj("id" -> 200, "message" -> "The application has been stopped", "type" -> "success"))
              case (HttpMethods.POST, p) if p == s"$app/instances"                        =>
                val n = starts.incrementAndGet()
                state.set("WANTS_TO_BE_UP")
                deploy(s"deploy-$n", "WIP", "DEPLOY")
                system.scheduler.scheduleOnce(startDelay) {
                  deployments.updateAndGet {
                    case head :: tail if (head \ "uuid").as[String] == s"deploy-$n" =>
                      (head.as[play.api.libs.json.JsObject] ++ Json.obj("state" -> "OK")) :: tail
                    case other                                                     => other
                  }
                  state.set("SHOULD_BE_UP")
                  up.set(true)
                }
                json(Json.obj("deploymentId" -> s"deploy-$n"))
              case _                                                                      =>
                json(Json.obj("message" -> s"not found: ${request.method.value} $path"), StatusCodes.NotFound)
            }
        }
      },
    30.seconds
  )

  private val backendBinding = Await.result(
    Http()
      .newServerAt("127.0.0.1", 0)
      .bind { request =>
        request.discardEntityBytes()
        Future.successful {
          // what clever answers for an app that is not running
          if (!up.get()) HttpResponse(status = StatusCodes.NotFound, entity = HttpEntity("no app here"))
          else json(Json.obj("from" -> "backend", "path" -> request.uri.path.toString))
        }
      },
    30.seconds
  )

  def apiUrl: String     = s"http://127.0.0.1:${apiBinding.localAddress.getPort}"
  def backendPort: Int   = backendBinding.localAddress.getPort

  def stop(): Unit = {
    Await.result(apiBinding.unbind(), 10.seconds)
    Await.result(backendBinding.unbind(), 10.seconds)
    ()
  }
}

/** A real otoroshi, in this process, with the extension on the classpath and a fake clever cloud. */
class Gateway(apiUrl: String) {

  val port: Int = Ports.free

  val instance: Otoroshi = {
    val config = ConfigFactory
      .parseString(s"""
        |otoroshi.storage = "inmemory"
        |otoroshi.next.state-sync-interval = 500
        |otoroshi.admin-extensions.configurations.cloud-apim_extensions_cleverreaper {
        |  enabled = true
        |  clever.api-url = "$apiUrl"
        |  clever.api-token = "test-token"
        |  job.interval = 1000
        |  job.fast-interval = 500
        |  access-flush-interval = 500
        |}
        |""".stripMargin)
      .resolve()
    val oto    = Otoroshi(
      ServerConfig(address = "0.0.0.0", port = Some(port), rootDir = Files.createTempDirectory("clever-reaper-it").toFile),
      config
    )
    oto.startAndStopOnShutdown()
    oto
  }

  given ec: ExecutionContext = instance.executionContext
  def ws: WSClient           = instance.ws

  def waitUntilHealthy(): Unit = {
    val deadline = System.currentTimeMillis() + 120000L
    var healthy  = false
    while (!healthy && System.currentTimeMillis() < deadline) {
      healthy = Try(await(ws.url(s"http://127.0.0.1:$port/health").withRequestTimeout(2.seconds).get()).status).toOption.contains(200)
      if (!healthy) Thread.sleep(500L)
    }
    if (!healthy) throw new RuntimeException(s"otoroshi did not become healthy on port $port")
    Thread.sleep(2000L)
  }

  def admin(path: String): play.api.libs.ws.WSRequest =
    ws.url(s"http://127.0.0.1:$port$path")
      .withHttpHeaders("Host" -> "otoroshi-api.oto.tools", "Content-Type" -> "application/json")
      .withAuth("admin-api-apikey-id", "admin-api-apikey-secret", WSAuthScheme.BASIC)

  def createRoute(id: String, backendPort: Int, plugins: Seq[NgPluginInstance]): NgRoute = {
    val route = NgRoute(
      location = EntityLocation.default,
      id = s"route_$id",
      name = id,
      description = id,
      enabled = true,
      debugFlow = false,
      capture = false,
      exportReporting = false,
      frontend = NgFrontend(
        domains = Seq(NgDomainAndPath(s"$id.oto.tools")),
        headers = Map.empty,
        cookies = Map.empty,
        query = Map.empty,
        methods = Seq.empty,
        stripPath = true,
        exact = false
      ),
      backend = NgBackend(
        targets = Seq(NgTarget(hostname = "127.0.0.1", port = backendPort, id = "local.target", tls = false)),
        root = "/",
        rewrite = false,
        loadBalancing = RoundRobin,
        client = NgClientConfig.default
      ),
      plugins = NgPlugins(plugins),
      groups = Seq("default"),
      tags = Seq.empty,
      metadata = Map.empty
    )
    val res   = await(admin("/api/routes").post(Json.stringify(route.json)))
    if (res.status > 299) throw new RuntimeException(s"could not create the route: ${res.status} ${res.body}")
    Thread.sleep(1500L)
    route
  }

  def call(route: NgRoute, path: String = "/", headers: Seq[(String, String)] = Seq.empty): WSResponse =
    await(
      ws.url(s"http://127.0.0.1:$port$path")
        .withHttpHeaders(("Host" -> route.frontend.domains.head.domain) +: headers*)
        .withRequestTimeout(120.seconds)
        .get()
    )

  def head(route: NgRoute, path: String = "/", headers: Seq[(String, String)] = Seq.empty): WSResponse =
    await(
      ws.url(s"http://127.0.0.1:$port$path")
        .withHttpHeaders(("Host" -> route.frontend.domains.head.domain) +: headers*)
        .withRequestTimeout(30.seconds)
        .withMethod("HEAD")
        .execute()
    )

  def callAsync(route: NgRoute, path: String = "/", headers: Seq[(String, String)] = Seq.empty): Future[WSResponse] =
    ws.url(s"http://127.0.0.1:$port$path")
      .withHttpHeaders(("Host" -> route.frontend.domains.head.domain) +: headers*)
      .withRequestTimeout(120.seconds)
      .get()

  def await[A](f: Future[A]): A = Await.result(f, 120.seconds)

  def stop(): Unit = instance.stop()
}
