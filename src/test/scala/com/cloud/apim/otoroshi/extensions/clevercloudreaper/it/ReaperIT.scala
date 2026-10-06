package com.cloud.apim.otoroshi.extensions.clevercloudreaper.it

import org.apache.pekko.actor.ActorSystem
import otoroshi.next.models.{NgPluginInstance, NgPluginInstanceConfig}
import otoroshi_plugins.com.cloud.apim.otoroshi.extensions.clevercloudreaper.{CleverCloudReaper, CleverCloudReaperExtension}
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
        plugin = s"cp:${classOf[CleverCloudReaper].getName}",
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
    val res = gateway.await(gateway.admin(s"/api/extensions/cloud-apim/extensions/clevercloud-reaper/apps/$appId").get())
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
    assert(page.body.contains("'CleverCloud-Reaper': 'poll'"), "the polling script is missing")
    // the state when the request came in: the wake up it asked for runs on its own
    assert(page.header("CleverCloud-Reaper-Status").exists(Set("Down", "WaitingForUp").contains), page.header("CleverCloud-Reaper-Status").toString)
    eventually("the status poll to say up") {
      val poll = gateway.call(route, "/", Seq("CleverCloud-Reaper" -> "status"))
      (poll.json \ "status").asOpt[String].contains("Up")
    }
    assertEquals(gateway.call(route, "/", Seq("Accept" -> "text/html")).status, 200)
  }

  test("a custom waiting page gets its placeholders and the reload script") {
    // the complete example of the documentation
    val template = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("documentation/static/examples/waiting-page.html")), "UTF-8")
    val custom   = gateway.createRoute(
      "custompage",
      clever.backendPort,
      Seq(
        NgPluginInstance(
          plugin = s"cp:${classOf[CleverCloudReaper].getName}",
          config = NgPluginInstanceConfig(
            Json.obj("app_id" -> appId, "grace_period" -> 3, "fail_timeout" -> 30, "ready_delay" -> 0, "waiting_page" -> template)
          )
        )
      )
    )
    eventually("the app to sleep again")(status().contains("Down"))
    val page     = gateway.call(custom, "/", Seq("Accept" -> "text/html"))
    assertEquals(page.status, 503)
    assert(page.body.contains("<title>my-test-app is starting</title>"), page.body)
    assert(!page.body.contains("{{"), "a placeholder was left")
    // the reaper's script, once, right before the end of the body
    assertEquals("'CleverCloud-Reaper': 'poll'".r.findAllMatchIn(page.body).size, 1)
    assert(page.body.indexOf("'CleverCloud-Reaper': 'poll'") < page.body.lastIndexOf("</body>"))
    // kept for a look in a browser
    java.nio.file.Files.write(java.nio.file.Paths.get("target/custom-waiting-page.html"), page.body.getBytes("UTF-8"))
    eventually("the app to be up")(status().contains("Up"))
    // the next tests expect the app on its own routes
    assertEquals(gateway.await(gateway.admin("/api/routes/route_custompage").delete()).status, 200)
    Thread.sleep(1500L)
  }

  test("an app can be put to sleep by hand, and its transitions are kept") {
    eventually("the app to be up")(status().contains("Up"))
    // traffic keeps it awake while the manual reap is asked
    gateway.call(route)
    val reaped = gateway.await(gateway.admin(s"/api/extensions/cloud-apim/extensions/clevercloud-reaper/apps/$appId/_reap").post(""))
    assertEquals(reaped.status, 200, reaped.body)
    eventually("the app to sleep")(status().contains("Down"))
    val history = gateway.await(gateway.admin(s"/api/extensions/cloud-apim/extensions/clevercloud-reaper/apps/$appId/history?page_size=100").get())
    assertEquals(history.status, 200)
    val items   = history.json.as[JsArray].value
    assert(items.exists(t => (t \ "cause").asOpt[String].exists(_.contains("put to sleep by"))), history.body)
    assert(items.exists(t => (t \ "to").asOpt[String].contains("WaitingForUp")))
    assert(items.exists(t => (t \ "cause").asOpt[String].exists(_.startsWith("no traffic for"))))
  }

  test("a sleep the reaper caused is counted as saved when the app wakes up, for the app and the install") {
    eventually("the app to sleep again")(status().contains("Down"))
    Thread.sleep(2000L)
    assertEquals(gateway.call(route, "/api/things", Seq("Accept" -> "application/json")).status, 200)
    val savings = gateway.await(gateway.admin(s"/api/extensions/cloud-apim/extensions/clevercloud-reaper/apps/$appId/savings").get())
    assertEquals(savings.status, 200, savings.body)
    // two XS at 3600 an hour each: 2 a second, for a sleep of more than two seconds
    assertEquals((savings.json \ "cost" \ "hourly_min").as[BigDecimal], BigDecimal(7200))
    assert((savings.json \ "total").as[BigDecimal] >= BigDecimal(4), savings.body)
    assert((savings.json \ "sleeps").as[Long] >= 1L, savings.body)
    assert((savings.json \ "today").as[BigDecimal] > BigDecimal(0), savings.body)
    val global  = gateway.await(gateway.admin("/api/extensions/cloud-apim/extensions/clevercloud-reaper/savings").get())
    assertEquals(global.status, 200, global.body)
    assert((global.json \ "total").as[BigDecimal] >= (savings.json \ "total").as[BigDecimal], global.body)
    assertEquals((global.json \ "currency").as[String], "EUR")
  }

  test("in unavailable mode an api call gets a 503 at once, a browser the page, whose poll goes through once the app answers") {
    val unavailable = gateway.createRoute(
      "unavailable",
      clever.backendPort,
      Seq(
        NgPluginInstance(
          plugin = s"cp:${classOf[CleverCloudReaper].getName}",
          config = NgPluginInstanceConfig(
            Json.obj("app_id" -> appId, "grace_period" -> 3, "fail_timeout" -> 30, "ready_delay" -> 0, "api_behavior" -> "unavailable")
          )
        )
      )
    )
    eventually("the app to sleep again")(status().contains("Down"))
    // an api call is refused at once, and told when to come back
    val started = System.currentTimeMillis()
    val refused = gateway.call(unavailable, "/api/things", Seq("Accept" -> "application/json"))
    assertEquals(refused.status, 503, refused.body)
    assert(System.currentTimeMillis() - started < 2000L, "the api call was held")
    assert(refused.header("Content-Type").exists(_.startsWith("application/json")), refused.header("Content-Type").toString)
    assertEquals(refused.header("Retry-After"), Some("30"))
    assert(refused.header("CleverCloud-Reaper-Status").isDefined)
    // a browser still gets the waiting page: it is on by default
    val page = gateway.call(unavailable, "/", Seq("Accept" -> "text/html"))
    assertEquals(page.status, 503)
    assert(page.body.contains("unavailable is waking up"), page.body)
    // while the app wakes up, the poll of the page is answered by the reaper, and says so
    val asleep = gateway.head(unavailable, "/", Seq("CleverCloud-Reaper" -> "poll"))
    assertEquals(asleep.status, 503)
    assert(asleep.header("CleverCloud-Reaper-Status").isDefined)
    // once the app is up, the poll reaches it: that is when the page reloads
    eventually("the poll to reach the app") {
      val poll = gateway.head(unavailable, "/", Seq("CleverCloud-Reaper" -> "poll"))
      poll.header("CleverCloud-Reaper-Status").isEmpty && poll.status == 200
    }
    assertEquals(status(), Some("Up"))
  }

  test("an app released from a route is not taken back by a stale proxy state of that route") {
    eventually("the app to be up")(status().contains("Up"))
    // only the main route manages the app now
    val deleted = gateway.await(gateway.admin("/api/routes/route_unavailable").delete())
    assertEquals(deleted.status, 200, deleted.body)
    Thread.sleep(1500L)
    // what disabling the reaper from the console does, before this node's proxy state shows the change:
    // the route is still there, with the plugin enabled
    val ext      = gateway.instance.env.adminExtensions.extension[CleverCloudReaperExtension].get
    val released = gateway.await(ext.engine.release(appId, "the reaper was disabled on route 'reaped'", ignoring = Some(route.id)))
    assertEquals(released, Right(()))
    assertEquals(status(), None)
    // several runs of the job later, the app is still not managed
    Thread.sleep(3000L)
    assertEquals(status(), None)
  }
}
