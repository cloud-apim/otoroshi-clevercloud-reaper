package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import play.api.libs.json.Json

import java.time.{LocalDate, ZoneId, ZonedDateTime}

class SavingsSuite extends munit.FunSuite {

  private val paris = ZoneId.of("Europe/Paris")
  private val hour  = 3600000L

  private def at(y: Int, m: Int, d: Int, h: Int, min: Int = 0): Long =
    ZonedDateTime.of(y, m, d, h, min, 0, 0, paris).toInstant.toEpochMilli

  test("the price system gives a price per hour, whatever the time unit of each entry") {
    val json   = Json.obj(
      "zone_id"  -> "par",
      "currency" -> "EUR",
      "runtime"  -> Json.arr(
        Json.obj("slug_id" -> "apps.XS", "price" -> 0.022222222222222223, "time_unit" -> "PT1H"),
        Json.obj("slug_id" -> "apps.M", "price" -> 0.01, "time_unit" -> "PT10M"),
        Json.obj("slug_id" -> "apps.broken", "price" -> 1, "time_unit" -> "not a duration"),
        Json.obj("slug_id" -> "apps.free", "price" -> "0E-20".toDouble, "time_unit" -> "PT1H")
      )
    )
    val prices = PriceSystem.parse("par", "EUR", json, 0L)
    assertEqualsDouble(prices.hourly("apps.XS").toDouble, 0.0222222, 0.0000001)
    assertEqualsDouble(prices.hourly("apps.M").toDouble, 0.06, 0.0000001)
    assert(!prices.hourly.contains("apps.broken"))
    assertEquals(prices.flavor("XS", None).map(_.toDouble), prices.hourly.get("apps.XS").map(_.toDouble))
    // a flavor names its own price id first
    assertEquals(prices.flavor("whatever", Some("apps.M")).map(_.toDouble), Some(0.06))
    assertEquals(PriceSystem.read(prices.json.toString).map(_.hourly.keySet), Some(prices.hourly.keySet))
  }

  test("the size of an app is read from the application, and its cost from the prices of its zone") {
    val app    = Json.obj(
      "id"       -> "app_1",
      "zone"     -> "par",
      "instance" -> Json.obj(
        "minInstances" -> 2,
        "maxInstances" -> 4,
        "minFlavor"    -> Json.obj("name" -> "XS", "price_id" -> "apps.XS"),
        "maxFlavor"    -> Json.obj("name" -> "M", "price_id" -> "apps.M")
      )
    )
    val sizing = CleverSizing.read(app).get
    assertEquals(sizing, CleverSizing("XS", Some("apps.XS"), "M", Some("apps.M"), 2, 4))
    val prices = PriceSystem("par", "EUR", Map("apps.XS" -> BigDecimal("0.02"), "apps.M" -> BigDecimal("0.1")), 0L)
    val cost   = AppCost.compute("app_1", sizing, prices, 42L).get
    assertEquals(cost.hourlyMin, BigDecimal("0.04"))
    assertEquals(cost.hourlyMax, BigDecimal("0.4"))
    assertEquals(cost.hourlyMinMicros, 40000L)
    assertEquals(AppCost.read(cost.json.toString), Some(cost))
    // no price for the flavor, no cost: better nothing than a wrong number
    assertEquals(AppCost.compute("app_1", sizing.copy(minFlavor = "XL", minPriceId = None), prices.copy(hourly = Map.empty), 0L), None)
    assertEquals(CleverSizing.read(Json.obj("id" -> "app_1")), None)
  }

  test("a sleep is split between the days it covers, in the timezone of the reaper") {
    // 10 hours, from 20:00 to 06:00 the next day, at 1.0 per hour
    val days = Savings.byDay(at(2026, 10, 5, 20), at(2026, 10, 6, 6), 1000000L, paris)
    assertEquals(days, Map("2026-10-05" -> 4000000L, "2026-10-06" -> 6000000L))
    assertEquals(days.values.sum, Savings.saved(at(2026, 10, 5, 20), at(2026, 10, 6, 6), 1000000L))
    // three days and a bit
    val long = Savings.byDay(at(2026, 10, 1, 12), at(2026, 10, 4, 1), 1000000L, paris)
    assertEquals(long.keySet, Set("2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"))
    assertEquals(long("2026-10-02"), 24000000L)
    // the night the clocks go back has 25 hours
    assertEquals(Savings.byDay(at(2026, 10, 25, 0), at(2026, 10, 26, 0), 1000000L, paris)("2026-10-25"), 25000000L)
    assertEquals(Savings.byDay(10L, 10L, 1000000L, paris), Map.empty[String, Long])
    assertEquals(Savings.saved(0L, hour / 2, 40000L), 20000L)
  }

  test("an app keeps its total, and the days of the last months") {
    val today   = LocalDate.of(2026, 10, 6)
    val first   = AppSavings("app_1", "EUR").add(SleepPeriod(0L, 10 * hour, 1000000L, 10000000L), Map("2025-01-01" -> 10000000L), today, 400)
    // a day older than 400 days is forgotten, the total is not
    assertEquals(first.days, Map.empty[String, Long])
    val second  = first.add(SleepPeriod(0L, 2 * hour, 1000000L, 2000000L), Map("2026-10-05" -> 1000000L, "2026-10-06" -> 1000000L), today, 400)
    assertEquals(second.totalMicros, 12000000L)
    assertEquals(second.sleeps, 2L)
    assertEquals(second.sleptMillis, 12 * hour)
    assertEquals(second.days, Map("2026-10-05" -> 1000000L, "2026-10-06" -> 1000000L))
    assertEquals(AppSavings.read(second.json.toString), Some(second))
    val summary = Savings.summary(second.days, today)
    assertEquals((summary \ "today").as[BigDecimal], BigDecimal("1.0000"))
    assertEquals((summary \ "this_month").as[BigDecimal], BigDecimal("2.0000"))
    assertEquals((summary \ "last_30_days").as[Seq[play.api.libs.json.JsValue]].size, 30)
  }
}
