package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import com.cloud.apim.otoroshi.extensions.clevercloudreaper.ReaperStatus.*

enum ReaperAction {
  case Stop, Start
}

/** Everything the rules look at for one app, gathered by the engine before deciding. */
final case class Observation(
    now: Long,
    cleverState: String,
    deployment: Option[CleverDeployment],
    lastAccess: Option[Long],
    inUpRange: Boolean,
    wakeRequested: Boolean,
    gracePeriod: Long,
    failTimeout: Long
)

/**
 * A transition to make. `keepActionAt` restarts an app without giving it a fresh fail timeout, so a
 * start that keeps getting cancelled still ends up in error.
 */
final case class Decision(status: ReaperStatus, cause: String, action: Option[ReaperAction] = None, keepActionAt: Boolean = false)

/**
 * The state machine of the reaper, as pure functions: the engine fetches, these decide.
 *
 * `decide` returns `None` when nothing has to change.
 */
object ReaperRules {

  val ShouldBeUp   = "SHOULD_BE_UP"
  val ShouldBeDown = "SHOULD_BE_DOWN"
  val WantsToBeUp  = "WANTS_TO_BE_UP"

  private val deploying = Set("WIP", "TASK_RUNNING")

  // a start whose deployment does not show up after this long is triggered again
  val restartAfter: Long = 60000L

  /** The last moment the app was needed: a real request, or it coming up (it is not reaped as it wakes). */
  def lastActivity(state: AppState, lastAccess: Option[Long]): Long =
    Seq(lastAccess.getOrElse(0L), state.lastUpAt.getOrElse(state.lastStatusUpdate)).max

  def idleFor(state: AppState, obs: Observation): Long = obs.now - lastActivity(state, obs.lastAccess)

  def reapCandidate(state: AppState, obs: Observation): Boolean =
    state.status == Up && obs.cleverState == ShouldBeUp && !obs.inUpRange && idleFor(state, obs) >= obs.gracePeriod

  /** Whether `decide` needs the last deployment of the app: it costs one more call to clever cloud. */
  def needsDeployment(state: AppState, obs: Observation): Boolean = state.status match {
    case WaitingForInit => obs.cleverState == WantsToBeUp
    case Up             => reapCandidate(state, obs)
    case WaitingForUp   => true
    case _              => false
  }

  private def timedOut(state: AppState, obs: Observation): Boolean =
    obs.now - state.actionAt.getOrElse(state.lastStatusUpdate) > obs.failTimeout

  // the deployment a start triggered, rather than one that happened before it
  private def triggered(state: AppState, obs: Observation): Option[CleverDeployment] =
    obs.deployment.filter(d => state.actionAt.forall(at => d.date >= at - 10000L))

  private def minutes(millis: Long): String = {
    val m = millis / 60000L
    if (m >= 1L) s"$m minute${if (m > 1) "s" else ""}" else s"${millis / 1000L} seconds"
  }

  def decide(state: AppState, obs: Observation): Option[Decision] = {
    def error(cause: String)     = Some(Decision(Error, cause))
    def unexpected               = error(s"unexpected clever cloud state '${obs.cleverState}'")
    lazy val deployment          = triggered(state, obs)
    lazy val deploymentState     = deployment.map(_.state)
    state.status match {
      case Error => None

      case WaitingForInit =>
        obs.cleverState match {
          case ShouldBeUp   => Some(Decision(Up, "the app is up on clever cloud"))
          case ShouldBeDown => Some(Decision(Down, "the app is down on clever cloud"))
          case WantsToBeUp  =>
            deploymentState match {
              case Some("FAIL")                   => error("the app failed to start on clever cloud")
              case Some("CANCELLED") | Some("OK") => Some(Decision(Down, "the start of the app was cancelled on clever cloud"))
              case _                              => Some(Decision(WaitingForUp, "the app is starting on clever cloud"))
            }
          case _            => unexpected
        }

      case Up =>
        obs.cleverState match {
          case ShouldBeDown                           => Some(Decision(Down, "the app was stopped on clever cloud"))
          case WantsToBeUp                            => Some(Decision(WaitingForUp, "the app is starting on clever cloud"))
          case ShouldBeUp if reapCandidate(state, obs) =>
            // the last deployment, whoever triggered it: a stop is only safe when the app can come back
            obs.deployment.map(_.state) match {
              case Some(s) if deploying.contains(s) => None
              case Some("OK") | None                =>
                Some(Decision(WaitingForShutdown, s"no traffic for ${minutes(idleFor(state, obs))}", Some(ReaperAction.Stop)))
              case Some(other)                      =>
                error(s"the last deployment of the app is '$other', it cannot be put to sleep safely")
            }
          case ShouldBeUp                             => None
          case _                                      => unexpected
        }

      case WaitingForShutdown =>
        obs.cleverState match {
          case ShouldBeDown                                         => Some(Decision(Down, "the app is stopped"))
          case ShouldBeUp | WantsToBeUp if timedOut(state, obs)     => error("the app did not stop within the fail timeout")
          case ShouldBeUp | WantsToBeUp                             => None
          case _                                                    => unexpected
        }

      case Down =>
        obs.cleverState match {
          case ShouldBeUp                         => Some(Decision(Up, "the app was started on clever cloud"))
          case WantsToBeUp                        => Some(Decision(WaitingForUp, "the app is starting on clever cloud"))
          case ShouldBeDown if obs.inUpRange      =>
            Some(Decision(WaitingForUp, "the app must be up at this time", Some(ReaperAction.Start)))
          case ShouldBeDown if obs.wakeRequested  =>
            Some(Decision(WaitingForUp, "a request needs the app", Some(ReaperAction.Start)))
          case ShouldBeDown                       => None
          case _                                  => unexpected
        }

      case WaitingForUp =>
        if (timedOut(state, obs)) error("the app did not start within the fail timeout")
        else
          obs.cleverState match {
            case ShouldBeUp   =>
              deploymentState match {
                case Some(s) if deploying.contains(s) => None
                case Some("FAIL")                     => error("the app failed to start on clever cloud")
                case Some(_)                          => Some(Decision(Up, "the app is up"))
                // started by someone else: there is no deployment of ours to wait for
                case None if state.actionAt.isEmpty   => Some(Decision(Up, "the app is up"))
                case None                             => None
              }
            case WantsToBeUp  =>
              deploymentState match {
                case Some("FAIL")      => error("the app failed to start on clever cloud")
                case Some("CANCELLED") => Some(Decision(Down, "the start of the app was cancelled on clever cloud"))
                case _                 => None
              }
            case ShouldBeDown =>
              deploymentState match {
                case Some("FAIL")                                                       => error("the app failed to start on clever cloud")
                case Some("CANCELLED")                                                  =>
                  Some(Decision(Down, "the start of the app was cancelled on clever cloud"))
                case _ if obs.now - state.actionAt.getOrElse(state.lastStatusUpdate) > restartAfter =>
                  Some(Decision(WaitingForUp, "the app is still down, starting it again", Some(ReaperAction.Start), keepActionAt = true))
                case _                                                                  => None
              }
            case _            => unexpected
          }
    }
  }
}
