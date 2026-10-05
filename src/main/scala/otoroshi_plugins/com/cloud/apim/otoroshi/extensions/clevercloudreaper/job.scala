package otoroshi_plugins.com.cloud.apim.otoroshi.extensions.clevercloudreaper

import otoroshi.env.Env
import otoroshi.next.plugins.api.{NgPluginCategory, NgStep}
import otoroshi.script.*
import otoroshi.utils.syntax.implicits.*

import scala.concurrent.duration.*
import scala.concurrent.{ExecutionContext, Future}

/**
 * Ticks the reaper engine, on one leader of the cluster at a time (a datastore lock elects it). Each
 * tick at the fast pace follows the apps waking up or going to sleep; every `job.interval` all the
 * apps are evaluated.
 */
class CleverCloudReaperJob extends Job {

  override def uniqueId: JobId                    = JobId("cloud-apim.extensions.CleverCloudReaper.job")
  override def name: String                       = "Cloud APIM - Clever Cloud Reaper"
  override def description: Option[String]        =
    "Puts the Clever Cloud apps without traffic to sleep, and follows the ones waking up".some
  override def categories: Seq[NgPluginCategory]  = Seq.empty
  override def steps: Seq[NgStep]                 = Seq(NgStep.Job)
  override def jobVisibility: JobVisibility       = JobVisibility.Internal
  override def kind: JobKind                      = JobKind.ScheduledEvery
  override def starting: JobStarting              = JobStarting.Automatically

  override def instantiation(ctx: JobContext, env: Env): JobInstantiation =
    JobInstantiation.OneInstancePerOtoroshiCluster

  override def predicate(ctx: JobContext, env: Env): Option[Boolean] =
    env.adminExtensions.extension[CleverCloudReaperExtension].isDefined.some

  override def initialDelay(ctx: JobContext, env: Env): Option[FiniteDuration] = 10.seconds.some

  override def interval(ctx: JobContext, env: Env): Option[FiniteDuration] =
    env.adminExtensions.extension[CleverCloudReaperExtension].map(_.conf.fastInterval).getOrElse(5.seconds).some

  override def jobRun(ctx: JobContext)(using env: Env, ec: ExecutionContext): Future[Unit] =
    env.adminExtensions.extension[CleverCloudReaperExtension] match {
      case None      => Future.unit
      case Some(ext) => ext.engine.tick()
    }
}
