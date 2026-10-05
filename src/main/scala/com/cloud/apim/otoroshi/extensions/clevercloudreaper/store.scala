package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import org.apache.pekko.util.ByteString
import otoroshi.env.Env
import otoroshi.security.IdGenerator
import otoroshi.utils.syntax.implicits.*

import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

/**
 * Everything the reaper persists, under `<storageRoot>:extensions:<extension>`. Only the leaders write
 * here: a worker's datastore is replaced by the leader's at each cluster sync, so the keys below are
 * also how the workers learn the state of the apps.
 */
class ReaperStore(env: Env, prefix: String) {

  private def redis = env.datastores.redis

  private def stateKey(appId: String): String   = s"$prefix:states:$appId"
  private def accessKey(appId: String): String  = s"$prefix:access:$appId"
  private def historyKey(appId: String): String = s"$prefix:history:$appId"
  private def wakeKey(appId: String): String    = s"$prefix:wakes:$appId"
  private def lockKey(appId: String): String    = s"$prefix:locks:$appId"
  private val settingsKey: String               = s"$prefix:settings"

  private def idOf(key: String): String = key.drop(key.lastIndexOf(":") + 1)

  private def readAll[A](pattern: String)(read: ByteString => Option[A])(using ec: ExecutionContext): Future[Map[String, A]] =
    redis.keys(pattern).flatMap {
      case keys if keys.isEmpty => Map.empty[String, A].vfuture
      case keys                 =>
        redis.mget(keys*).map { values =>
          keys.zip(values).flatMap { case (key, value) => value.flatMap(read).map(idOf(key) -> _) }.toMap
        }
    }

  // states

  def allStates()(using ec: ExecutionContext): Future[Map[String, AppState]] =
    readAll(s"$prefix:states:*")(bs => AppState.read(bs.utf8String))

  def state(appId: String)(using ec: ExecutionContext): Future[Option[AppState]] =
    redis.get(stateKey(appId)).map(_.flatMap(bs => AppState.read(bs.utf8String)))

  def saveState(state: AppState): Future[Boolean] = redis.set(stateKey(state.appId), state.json.stringify)

  def deleteState(appId: String): Future[Long] = redis.del(stateKey(appId), wakeKey(appId))

  // last accesses: one key per app, holding the latest access any node reported

  def allAccess()(using ec: ExecutionContext): Future[Map[String, Long]] =
    readAll(s"$prefix:access:*")(bs => bs.utf8String.toLongOption)

  /** Keeps the latest of what is stored and what is reported, per app. */
  def recordAccess(accesses: Map[String, Long])(using ec: ExecutionContext): Future[Map[String, Long]] =
    if (accesses.isEmpty) Map.empty[String, Long].vfuture
    else {
      val appIds = accesses.keys.toSeq
      redis.mget(appIds.map(accessKey)*).flatMap { stored =>
        val merged = appIds.zip(stored).map { case (appId, current) =>
          appId -> Math.max(accesses(appId), current.flatMap(_.utf8String.toLongOption).getOrElse(0L))
        }
        val changed = merged.filter { case (appId, value) => value == accesses(appId) }
        Future.sequence(changed.map { case (appId, value) => redis.set(accessKey(appId), value.toString) }).map(_ => merged.toMap)
      }
    }

  // history

  def pushHistory(transition: Transition, size: Int)(using ec: ExecutionContext): Future[Unit] =
    for {
      _ <- redis.lpush(historyKey(transition.appId), transition.json.stringify)
      _ <- redis.ltrim(historyKey(transition.appId), 0L, Math.max(0, size - 1).toLong)
    } yield ()

  def history(appId: String, from: Int, count: Int)(using ec: ExecutionContext): Future[Seq[Transition]] =
    redis.lrange(historyKey(appId), from.toLong, (from + count - 1).toLong).map(_.flatMap(bs => Transition.read(bs.utf8String)))

  // wake requests: kept until a start succeeds, so a wake asked while the app was locked is not lost

  def requestWake(appId: String, ttlMillis: Long): Future[Boolean] =
    redis.set(wakeKey(appId), System.currentTimeMillis().toString, pxMilliseconds = Some(ttlMillis))

  def clearWake(appId: String): Future[Long] = redis.del(wakeKey(appId))

  def wakesRequested(appIds: Seq[String])(using ec: ExecutionContext): Future[Set[String]] =
    if (appIds.isEmpty) Set.empty[String].vfuture
    else redis.mget(appIds.map(wakeKey)*).map(values => appIds.zip(values).collect { case (id, Some(_)) => id }.toSet)

  // settings

  def settings()(using ec: ExecutionContext): Future[ReaperSettings] =
    redis.get(settingsKey).map(_.flatMap(bs => ReaperSettings.read(bs.utf8String)).getOrElse(ReaperSettings()))

  def saveSettings(settings: ReaperSettings): Future[Boolean] = redis.set(settingsKey, settings.json.stringify)

  // one leader at a time works on an app: the job, a wake up and a manual action can all race for it

  def withLock[A](appId: String, ttlMillis: Long = 60000L)(f: => Future[A])(using ec: ExecutionContext): Future[Option[A]] = {
    val token = IdGenerator.uuid
    val key   = lockKey(appId)
    env.datastores.rawDataStore
      .setnx(key, ByteString(token), Some(ttlMillis))(using ec, env)
      .flatMap {
        case false => None.vfuture
        case true  =>
          env.datastores.rawDataStore.get(key)(using ec, env).flatMap {
            case Some(value) if value.utf8String == token =>
              Try(f).fold(Future.failed, identity).map(Some(_)).andThen { case _ =>
                env.datastores.rawDataStore.get(key)(using ec, env).map {
                  case Some(v) if v.utf8String == token => env.datastores.rawDataStore.del(Seq(key))(using ec, env)
                  case _                                => ()
                }
              }
            case _                                        => None.vfuture
          }
      }
  }
}
