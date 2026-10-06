package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import otoroshi.utils.syntax.implicits.*
import play.api.libs.json.*

import java.time.{Duration, Instant, LocalDate, ZoneId}
import scala.util.Try

/** The size of a Clever Cloud app: what it runs on when it runs. */
final case class CleverSizing(
    minFlavor: String,
    minPriceId: Option[String],
    maxFlavor: String,
    maxPriceId: Option[String],
    minInstances: Int,
    maxInstances: Int
)

object CleverSizing {

  /** From the `instance` object of an application of the v2 api. */
  def read(app: JsValue): Option[CleverSizing] = {
    val instance = app.select("instance")
    for {
      minFlavor <- instance.select("minFlavor").select("name").asOpt[String]
      maxFlavor <- instance.select("maxFlavor").select("name").asOpt[String].orElse(Some(minFlavor))
    } yield CleverSizing(
      minFlavor = minFlavor,
      minPriceId = instance.select("minFlavor").select("price_id").asOpt[String],
      maxFlavor = maxFlavor,
      maxPriceId = instance.select("maxFlavor").select("price_id").asOpt[String],
      minInstances = instance.select("minInstances").asOpt[Int].getOrElse(1),
      maxInstances = instance.select("maxInstances").asOpt[Int].getOrElse(1)
    )
  }
}

/** The price of each runtime flavor of a zone, per hour and per instance. */
final case class PriceSystem(zone: String, currency: String, hourly: Map[String, BigDecimal], fetchedAt: Long) {

  /** `apps.XS` for an app on XS, unless the flavor names its own price id. */
  def flavor(name: String, priceId: Option[String]): Option[BigDecimal] =
    priceId.flatMap(hourly.get).orElse(hourly.get(s"apps.$name"))

  def json: JsValue = Json.obj(
    "zone"       -> zone,
    "currency"   -> currency,
    "hourly"     -> JsObject(hourly.map { case (k, v) => k -> JsNumber(v) }),
    "fetched_at" -> fetchedAt
  )
}

object PriceSystem {

  /** The price system of the v4 billing api: `runtime` entries, each with a price per `time_unit`. */
  def parse(zone: String, currency: String, json: JsValue, now: Long): PriceSystem = {
    val hourly = json.select("runtime").asOpt[Seq[JsValue]].getOrElse(Seq.empty).flatMap { entry =>
      for {
        slug  <- entry.select("slug_id").asOpt[String]
        price <- entry.select("price").asOpt[BigDecimal]
        unit  <- Try(Duration.parse(entry.select("time_unit").asOpt[String].getOrElse("PT1H"))).toOption.filter(!_.isZero)
      } yield slug -> price * BigDecimal(3600) / BigDecimal(unit.getSeconds)
    }
    PriceSystem(zone, currency, hourly.toMap, now)
  }

  def read(raw: String): Option[PriceSystem] = Try(Json.parse(raw)).toOption.flatMap { json =>
    for {
      zone     <- json.select("zone").asOpt[String]
      currency <- json.select("currency").asOpt[String]
    } yield PriceSystem(
      zone,
      currency,
      json.select("hourly").asOpt[Map[String, BigDecimal]].getOrElse(Map.empty),
      json.select("fetched_at").asOpt[Long].getOrElse(0L)
    )
  }
}

/**
 * What an app costs per hour when it runs: at least its minimum instances on its minimum flavor, at
 * most its maximum instances on its maximum flavor. Savings are counted on the minimum: what sleeping
 * saved for sure.
 */
final case class AppCost(
    appId: String,
    zone: String,
    currency: String,
    sizing: CleverSizing,
    hourlyMin: BigDecimal,
    hourlyMax: BigDecimal,
    refreshedAt: Long
) {

  def hourlyMinMicros: Long = Savings.toMicros(hourlyMin)

  def json: JsValue = Json.obj(
    "app_id"        -> appId,
    "zone"          -> zone,
    "currency"      -> currency,
    "min_flavor"    -> sizing.minFlavor,
    "min_price_id"  -> sizing.minPriceId,
    "max_flavor"    -> sizing.maxFlavor,
    "max_price_id"  -> sizing.maxPriceId,
    "min_instances" -> sizing.minInstances,
    "max_instances" -> sizing.maxInstances,
    "hourly_min"    -> hourlyMin,
    "hourly_max"    -> hourlyMax,
    "refreshed_at"  -> refreshedAt
  )
}

object AppCost {

  def compute(appId: String, sizing: CleverSizing, prices: PriceSystem, now: Long): Option[AppCost] = for {
    min <- prices.flavor(sizing.minFlavor, sizing.minPriceId)
    max <- prices.flavor(sizing.maxFlavor, sizing.maxPriceId).orElse(Some(min))
  } yield AppCost(appId, prices.zone, prices.currency, sizing, min * sizing.minInstances, max * sizing.maxInstances, now)

  def read(raw: String): Option[AppCost] = Try(Json.parse(raw)).toOption.flatMap { json =>
    for {
      appId     <- json.select("app_id").asOpt[String]
      minFlavor <- json.select("min_flavor").asOpt[String]
      hourlyMin <- json.select("hourly_min").asOpt[BigDecimal]
    } yield AppCost(
      appId = appId,
      zone = json.select("zone").asOpt[String].getOrElse("par"),
      currency = json.select("currency").asOpt[String].getOrElse("EUR"),
      sizing = CleverSizing(
        minFlavor = minFlavor,
        minPriceId = json.select("min_price_id").asOpt[String],
        maxFlavor = json.select("max_flavor").asOpt[String].getOrElse(minFlavor),
        maxPriceId = json.select("max_price_id").asOpt[String],
        minInstances = json.select("min_instances").asOpt[Int].getOrElse(1),
        maxInstances = json.select("max_instances").asOpt[Int].getOrElse(1)
      ),
      hourlyMin = hourlyMin,
      hourlyMax = json.select("hourly_max").asOpt[BigDecimal].getOrElse(hourlyMin),
      refreshedAt = json.select("refreshed_at").asOpt[Long].getOrElse(0L)
    )
  }
}

/** One sleep the reaper caused, closed: from when the app was down to when it was needed again. */
final case class SleepPeriod(from: Long, to: Long, hourlyMicros: Long, savedMicros: Long) {
  def json: JsValue = Json.obj(
    "from"   -> from,
    "to"     -> to,
    "hours"  -> Savings.round((to - from).toDouble / 3600000d),
    "hourly" -> Savings.fromMicros(hourlyMicros),
    "saved"  -> Savings.fromMicros(savedMicros)
  )
}

object SleepPeriod {
  def read(json: JsValue): Option[SleepPeriod] = for {
    from <- json.select("from").asOpt[Long]
    to   <- json.select("to").asOpt[Long]
  } yield SleepPeriod(
    from,
    to,
    json.select("hourly_micros").asOpt[Long].getOrElse(0L),
    json.select("saved_micros").asOpt[Long].getOrElse(0L)
  )
}

/**
 * What one app saved, kept up to date at the end of each of its sleeps rather than computed from its
 * history: amounts are in millionths of the currency, per day of the reaper's timezone.
 */
final case class AppSavings(
    appId: String,
    currency: String,
    totalMicros: Long = 0L,
    sleptMillis: Long = 0L,
    sleeps: Long = 0L,
    days: Map[String, Long] = Map.empty,
    lastSleep: Option[SleepPeriod] = None,
    updatedAt: Long = 0L
) {

  /** Adds a closed sleep, and forgets the days older than `keepDays`. */
  def add(period: SleepPeriod, byDay: Map[String, Long], today: LocalDate, keepDays: Int): AppSavings = {
    val oldest = today.minusDays(keepDays.toLong).toString
    val merged = byDay.foldLeft(days) { case (acc, (day, micros)) => acc.updated(day, acc.getOrElse(day, 0L) + micros) }
    copy(
      totalMicros = totalMicros + period.savedMicros,
      sleptMillis = sleptMillis + (period.to - period.from),
      sleeps = sleeps + 1,
      days = merged.filter { case (day, _) => day >= oldest },
      lastSleep = Some(period),
      updatedAt = period.to
    )
  }

  def json: JsValue = Json.obj(
    "app_id"       -> appId,
    "currency"     -> currency,
    "total_micros" -> totalMicros,
    "slept_millis" -> sleptMillis,
    "sleeps"       -> sleeps,
    "days"         -> JsObject(days.map { case (k, v) => k -> JsNumber(v) }),
    "last_sleep"   -> lastSleep.map(p =>
      Json.obj("from" -> p.from, "to" -> p.to, "hourly_micros" -> p.hourlyMicros, "saved_micros" -> p.savedMicros)
    ),
    "updated_at"   -> updatedAt
  )
}

object AppSavings {
  def read(raw: String): Option[AppSavings] = Try(Json.parse(raw)).toOption.flatMap { json =>
    json.select("app_id").asOpt[String].map { appId =>
      AppSavings(
        appId = appId,
        currency = json.select("currency").asOpt[String].getOrElse("EUR"),
        totalMicros = json.select("total_micros").asOpt[Long].getOrElse(0L),
        sleptMillis = json.select("slept_millis").asOpt[Long].getOrElse(0L),
        sleeps = json.select("sleeps").asOpt[Long].getOrElse(0L),
        days = json.select("days").asOpt[Map[String, Long]].getOrElse(Map.empty),
        lastSleep = json.select("last_sleep").asOpt[JsValue].flatMap(SleepPeriod.read),
        updatedAt = json.select("updated_at").asOpt[Long].getOrElse(0L)
      )
    }
  }
}

object Savings {

  private val hour = 3600000L

  def toMicros(amount: BigDecimal): Long  = (amount * BigDecimal(1000000)).setScale(0, BigDecimal.RoundingMode.HALF_UP).toLong
  def fromMicros(micros: Long): BigDecimal = (BigDecimal(micros) / BigDecimal(1000000)).setScale(4, BigDecimal.RoundingMode.HALF_UP)
  def round(value: Double): Double         = Math.round(value * 100d) / 100d

  def saved(fromMillis: Long, toMillis: Long, hourlyMicros: Long): Long =
    if (toMillis <= fromMillis || hourlyMicros <= 0L) 0L else (toMillis - fromMillis) * hourlyMicros / hour

  /** A sleep, split between the days of `zone` it covers, as `yyyy-mm-dd` -> millionths. */
  def byDay(fromMillis: Long, toMillis: Long, hourlyMicros: Long, zone: ZoneId): Map[String, Long] = {
    if (toMillis <= fromMillis) Map.empty
    else {
      val days = Iterator
        .iterate(Instant.ofEpochMilli(fromMillis).atZone(zone).toLocalDate)(_.plusDays(1))
        .takeWhile(day => day.atStartOfDay(zone).toInstant.toEpochMilli < toMillis)
      days.map { day =>
        val start = Math.max(fromMillis, day.atStartOfDay(zone).toInstant.toEpochMilli)
        val end   = Math.min(toMillis, day.plusDays(1).atStartOfDay(zone).toInstant.toEpochMilli)
        day.toString -> saved(start, end, hourlyMicros)
      }.toMap
    }
  }

  def today(now: Long, zone: ZoneId): LocalDate = Instant.ofEpochMilli(now).atZone(zone).toLocalDate

  def sumWhere(days: Map[String, Long])(keep: String => Boolean): Long =
    days.collect { case (day, micros) if keep(day) => micros }.sum

  /** The amounts the console and the api show for a set of days: closed sleeps plus the ones running. */
  def summary(days: Map[String, Long], today: LocalDate): JsObject = {
    val month = today.toString.take(7)
    val year  = today.toString.take(4)
    Json.obj(
      "today"        -> fromMicros(days.getOrElse(today.toString, 0L)),
      "this_month"   -> fromMicros(sumWhere(days)(_.startsWith(month))),
      "this_year"    -> fromMicros(sumWhere(days)(_.startsWith(year))),
      "last_30_days" -> JsArray((29 to 0 by -1).map { n =>
        val day = today.minusDays(n.toLong).toString
        Json.obj("date" -> day, "saved" -> fromMicros(days.getOrElse(day, 0L)))
      })
    )
  }

  def merge(a: Map[String, Long], b: Map[String, Long]): Map[String, Long] =
    b.foldLeft(a) { case (acc, (k, v)) => acc.updated(k, acc.getOrElse(k, 0L) + v) }
}
