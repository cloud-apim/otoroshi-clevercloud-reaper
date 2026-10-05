package com.cloud.apim.otoroshi.extensions.cleverreaper.it

import org.apache.pekko.actor.ActorSystem
import otoroshi.next.models.{NgPluginInstance, NgPluginInstanceConfig}
import otoroshi_plugins.com.cloud.apim.otoroshi.extensions.cleverreaper.CleverReaper
import play.api.libs.json.{JsArray, JsObject, Json}
import play.api.libs.ws.DefaultBodyWritables.writeableOf_String

import scala.concurrent.ExecutionContext
import scala.concurrent.duration.*

/**
 * The whole loop against a real gateway: an app without traffic is put to sleep, a request wakes it
 * up and is held until it can be served, a browser gets the waiting page, monitoring never wakes it.
 */
class ReaperIT extends munit.FunSuite {

  override val munitTimeout: Duration = 5.minutes

  private val appId = "app_0f4c2b0e-1a2b-4c3d-8e9f-0123456789ab"

  private given system: ActorSystem = ActorSystem("fake-clever")
  private given ExecutionContext    = system.dispatcher

  private lazy val clever  = new FakeClever(appId)
  private lazy val gateway = new Gateway(clever.apiUrl)

  private lazy val route = gateway.createRoute(
    "reaped",
    clever.backendPort,
    Seq(
      NgPluginInstance(
        plugin = s"cp:${classOf[CleverReaper].getName}",
        config = NgPluginInstanceConfig(
          Json.obj(
            "app_id"             -> appId,
            "grace_period"       -> 3,
            "fail_timeout"       -> 30,
            "ready_delay"        -> 0,
            "monitoring_filters" -> Json.arr(Json.obj("source" -> "path", "regex" -> "^/health$"))
          )
        )
      )
    )
  )

  override def beforeAll(): Unit = {
    gateway.waitUntilHealthy()
    route
    ()
  }

  override def afterAll(): Unit = {
    gateway.stop()
    clever.stop()
    system.terminate()
    ()
  }

  private def appState(): Option[JsObject] = {
    val res = gateway.await(gateway.admin(s"/api/extensions/cloud-apim/extensions/clever-reaper/apps/$appId").get())
    if (res.status == 200) Some(res.json.as[JsObject]) else None
  }

  private def status(): Option[String] = appState().flatMap(s => (s \ "status").asOpt[String])

  private def eventually(what: String, timeout: FiniteDuration = 30.seconds)(check: => Boolean): Unit = {
    val deadline = System.currentTimeMillis() + timeout.toMillis
    while (!check) {
      if (System.currentTimeMillis() > deadline) fail(s"timed out waiting for: $what (status: ${status()})")
      Thread.sleep(250L)
    }
  }

  test("the app is found up, then put to sleep once it gets no traffic") {
    eventually("the app to be up")(status().contains("Up"))
    assertEquals(gateway.call(route).status, 200)
    eventually("the app to sleep")(status().contains("Down"))
    assertEquals(clever.stops.get(), 1)
    assertEquals(clever.state.get(), "SHOULD_BE_DOWN")
  }

  test("a monitoring request does not wake the app up") {
    val res = gateway.call(route, "/health")
    assertEquals(res.status, 200)
    assertEquals((res.json \ "monitoring").asOpt[Boolean], Some(true))
    Thread.sleep(2000L)
    assertEquals(clever.starts.get(), 0)
    assertEquals(status(), Some("Down"))
  }

  test("an api call wakes the app up and is held until it can be served") {
    val started = System.currentTimeMillis()
    val res     = gateway.call(route, "/api/things", Seq("Accept" -> "application/json"))
    val took    = System.currentTimeMillis() - started
    assertEquals(res.status, 200, res.body)
    assertEquals((res.json \ "from").asOpt[String], Some("backend"))
    assert(took >= 3000L, s"the request was answered in ${took}ms, before the app could start")
    assertEquals(clever.starts.get(), 1)
    assertEquals(status(), Some("Up"))
  }

  test("concurrent requests to a sleeping app start it only once") {
    eventually("the app to sleep again")(status().contains("Down"))
    val before    = clever.starts.get()
    val responses = gateway.await(scala.concurrent.Future.sequence((1 to 5).map(i => gateway.callAsync(route, s"/burst/$i"))))
    assert(responses.forall(_.status == 200), responses.map(r => s"${r.status} ${r.body}").mkString("\n"))
    assertEquals(clever.starts.get(), before + 1)
  }

  test("a browser gets the waiting page, which follows the status until the app is up") {
    eventually("the app to sleep again")(status().contains("Down"))
    val page = gateway.call(route, "/", Seq("Accept" -> "text/html,application/xhtml+xml"))
    assertEquals(page.status, 503)
    assert(page.body.contains("reaped is waking up"), page.body)
    assert(page.body.contains("Clever-Reaper"), "the polling script is missing")
    eventually("the status poll to say up") {
      val poll = gateway.call(route, "/", Seq("Clever-Reaper" -> "status"))
      (poll.json \ "status").asOpt[String].contains("Up")
    }
    assertEquals(gateway.call(route, "/", Seq("Accept" -> "text/html")).status, 200)
  }

  test("an app can be put to sleep by hand, and its transitions are kept") {
    eventually("the app to be up")(status().contains("Up"))
    // traffic keeps it awake while the manual reap is asked
    gateway.call(route)
    val reaped = gateway.await(gateway.admin(s"/api/extensions/cloud-apim/extensions/clever-reaper/apps/$appId/_reap").post(""))
    assertEquals(reaped.status, 200, reaped.body)
    eventually("the app to sleep")(status().contains("Down"))
    val history = gateway.await(gateway.admin(s"/api/extensions/cloud-apim/extensions/clever-reaper/apps/$appId/history?page_size=100").get())
    assertEquals(history.status, 200)
    val items   = history.json.as[JsArray].value
    assert(items.exists(t => (t \ "cause").asOpt[String].exists(_.contains("put to sleep by"))), history.body)
    assert(items.exists(t => (t \ "to").asOpt[String].contains("WaitingForUp")))
    assert(items.exists(t => (t \ "cause").asOpt[String].exists(_.startsWith("no traffic for"))))
  }
}
