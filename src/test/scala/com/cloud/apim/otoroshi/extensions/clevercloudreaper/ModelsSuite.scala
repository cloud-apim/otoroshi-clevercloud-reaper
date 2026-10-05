package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import play.api.libs.json.Json
import play.api.libs.typedmap.TypedMap
import play.api.mvc.request.{RemoteConnection, RequestFactory, RequestTarget}
import play.api.mvc.{Headers, RequestHeader}

import java.time.{DayOfWeek, LocalTime, ZoneId, ZonedDateTime}

class ModelsSuite extends munit.FunSuite {

  private def request(uri: String, headers: (String, String)*): RequestHeader = {
    val path  = uri.takeWhile(_ != '?')
    val query = uri.dropWhile(_ != '?').drop(1).split("&").toSeq.filter(_.nonEmpty).map { kv =>
      val parts = kv.split("=", 2)
      parts(0) -> parts.lift(1).getOrElse("")
    }.groupMap(_._1)(_._2)
    RequestFactory.plain.createRequestHeader(
      RemoteConnection("127.0.0.1", secure = false, clientCertificateChain = None),
      "GET",
      RequestTarget(uri, path, query),
      "HTTP/1.1",
      Headers(headers*),
      TypedMap.empty
    )
  }

  private val paris = ZoneId.of("Europe/Paris")
  // a monday
  private def at(day: Int, hour: Int, minute: Int = 0) = ZonedDateTime.of(2026, 10, 5 + day, hour, minute, 0, 0, paris)

  test("a time range applies on its days, between its bounds") {
    val range = UpRange(Seq(DayOfWeek.MONDAY, DayOfWeek.TUESDAY), LocalTime.of(8, 0), LocalTime.of(19, 0))
    assert(range.contains(at(0, 8)))
    assert(range.contains(at(1, 18, 59)))
    assert(!range.contains(at(0, 19)))
    assert(!range.contains(at(0, 7, 59)))
    assert(!range.contains(at(2, 12)))
  }

  test("a time range without days applies every day, and one ending before it starts runs overnight") {
    assert(UpRange(Seq.empty, LocalTime.of(8, 0), LocalTime.of(19, 0)).contains(at(6, 12)))
    val night = UpRange(Seq(DayOfWeek.FRIDAY), LocalTime.of(22, 0), LocalTime.of(2, 0))
    assert(night.contains(at(4, 23)))
    assert(night.contains(at(5, 1)))
    assert(!night.contains(at(5, 23)))
    assert(!night.contains(at(4, 21)))
  }

  test("time ranges are read leniently") {
    val range = UpRange.read(Json.obj("days" -> Json.arr("mon", "Tuesday"), "start" -> "09:30", "end" -> "18:00")).get
    assertEquals(range.days, Seq(DayOfWeek.MONDAY, DayOfWeek.TUESDAY))
    assertEquals(range.start, LocalTime.of(9, 30))
    assertEquals(UpRange.read(Json.obj("days" -> Json.arr("*"))).map(_.days), Some(Seq.empty))
    assertEquals(UpRange.read(Json.obj("start" -> "not a time")), None)
  }

  test("monitoring filters match their source, and any of them is enough") {
    val config = CleverCloudReaperConfig(monitoringFilters =
      Seq(
        MonitoringFilter("path", None, "^/health$"),
        MonitoringFilter("user_agent", None, "(?i)statuscake"),
        MonitoringFilter("header", Some("X-Probe"), "^yes$"),
        MonitoringFilter("query", Some("probe"), "^1$")
      )
    )
    assert(config.isMonitoring(request("/health")))
    assert(!config.isMonitoring(request("/health/deep")))
    assert(config.isMonitoring(request("/", "User-Agent" -> "Mozilla/5.0 (StatusCake)")))
    assert(config.isMonitoring(request("/", "X-Probe" -> "yes")))
    assert(!config.isMonitoring(request("/", "X-Probe" -> "no")))
    assert(config.isMonitoring(request("/api?probe=1")))
    assert(!config.isMonitoring(request("/api", "User-Agent" -> "curl/8")))
  }

  test("a monitoring filter whose regex does not compile matches nothing") {
    assert(!MonitoringFilter("path", None, "([").matches(request("/(")))
  }

  test("the plugin config has sensible defaults and survives a round trip") {
    val config = CleverCloudReaperConfig.format.reads(Json.obj()).get
    assertEquals(config, CleverCloudReaperConfig.default)
    assertEquals(config.gracePeriod, 3600L)
    assert(config.holdsRequests)
    val custom = CleverCloudReaperConfig(
      appId = Some("app_1"),
      gracePeriod = 120L,
      apiBehavior = CleverCloudReaperConfig.Unavailable,
      mustBeUpAt = Seq(UpRange(Seq(DayOfWeek.MONDAY), LocalTime.of(8, 0), LocalTime.of(19, 0))),
      monitoringFilters = Seq(MonitoringFilter("path", None, "^/health$"))
    )
    assertEquals(CleverCloudReaperConfig.format.reads(custom.json).get, custom)
    assert(!custom.holdsRequests)
    // an unknown mode, like the client_poll of the first versions, holds
    assert(CleverCloudReaperConfig.format.reads(Json.obj("api_behavior" -> "client_poll")).get.holdsRequests)
    assertEquals(CleverCloudReaperConfig.format.reads(Json.obj("grace_period" -> -5, "api_behavior" -> "what")).get.gracePeriod, 3600L)
  }

  test("must be up ranges use the route timezone, or the default one") {
    // 11:30 in paris (summer time), 09:30 in utc
    val monday10Utc = ZonedDateTime.of(2026, 10, 5, 9, 30, 0, 0, ZoneId.of("UTC")).toInstant
    val ranges      = Seq(UpRange(Seq.empty, LocalTime.of(11, 0), LocalTime.of(12, 0)))
    assert(CleverCloudReaperConfig(mustBeUpAt = ranges).inUpRange(monday10Utc, paris))
    assert(!CleverCloudReaperConfig(mustBeUpAt = ranges, timezone = Some("UTC")).inUpRange(monday10Utc, paris))
    assert(!CleverCloudReaperConfig().inUpRange(monday10Utc, paris))
  }

  test("the default clever cloud domain gives the app id") {
    assertEquals(CleverAppIds.fromHostname("app-0f4c2b0e-1a2b-4c3d-8e9f-0123456789ab.cleverapps.io"), Some("app_0f4c2b0e-1a2b-4c3d-8e9f-0123456789ab"))
    assertEquals(CleverAppIds.fromHostname("myapp.cleverapps.io"), None)
    assertEquals(CleverAppIds.fromHostname("app-0f4c2b0e-1a2b-4c3d-8e9f-0123456789ab.example.com"), None)
  }

  test("app states survive a round trip") {
    val state = AppState(appId = "app_1", status = ReaperStatus.WaitingForUp, lastStatusUpdate = 42L, actionAt = Some(40L), routes = Seq("r1"))
    assertEquals(AppState.read(state.json.toString), Some(state))
    assertEquals(AppState.read("{}"), None)
  }

  test("the waiting page escapes what it inserts and carries the polling script") {
    val html = WaitingPage.render("<html><body><h1>{{route_name}}</h1></body></html>", "<script>x</script>", "app_1", None, Some(ReaperStatus.Down))
    assert(html.contains("&lt;script&gt;x&lt;/script&gt;"))
    assert(html.indexOf("fetch(window.location.href") < html.indexOf("</body>"))
    assert(WaitingPage.render("no body here", "r", "app_1", None, None).contains("CleverCloud-Reaper"))
    // the page polls its own path, and tells the reaper's answers from the app's by their marker
    assert(html.contains("method: 'HEAD'"))
    assert(html.contains("'CleverCloud-Reaper': 'poll'"))
    assert(html.contains("r.headers.get('CleverCloud-Reaper-Status')"))
    assertEquals(WaitingPage.publicStatus(Some(ReaperStatus.WaitingForUp)), "WaitingForUp")
    assertEquals(WaitingPage.publicStatus(Some(ReaperStatus.WaitingForInit)), "Up")
    assertEquals(WaitingPage.publicStatus(None), "Up")
  }

  test("the access tracker keeps the latest access, and gives back what could not be pushed") {
    val tracker = new AccessTracker()
    tracker.touch("a", 10L)
    tracker.touch("a", 5L)
    tracker.touch("b", 7L)
    assertEquals(tracker.drain(), Map("a" -> 10L, "b" -> 7L))
    assertEquals(tracker.drain(), Map.empty[String, Long])
    tracker.restore(Map("a" -> 10L))
    tracker.touch("a", 12L)
    assertEquals(tracker.drain(), Map("a" -> 12L))
  }
}
