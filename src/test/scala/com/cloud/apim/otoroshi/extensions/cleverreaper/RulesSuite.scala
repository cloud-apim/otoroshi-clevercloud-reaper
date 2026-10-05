package com.cloud.apim.otoroshi.extensions.cleverreaper

import com.cloud.apim.otoroshi.extensions.cleverreaper.ReaperRules.*
import com.cloud.apim.otoroshi.extensions.cleverreaper.ReaperStatus.*

class RulesSuite extends munit.FunSuite {

  private val now    = 10_000_000_000L
  private val minute = 60_000L
  private val grace  = 60 * minute
  private val fail   = 15 * minute

  private def state(status: ReaperStatus, lastStatusUpdate: Long = now - 2 * grace, lastUpAt: Option[Long] = None, actionAt: Option[Long] = None) =
    AppState(appId = "app_1", status = status, lastStatusUpdate = lastStatusUpdate, lastUpAt = lastUpAt, actionAt = actionAt)

  private def obs(
      cleverState: String,
      deployment: Option[String] = None,
      deployedAt: Long = now - 3 * grace,
      lastAccess: Option[Long] = None,
      inUpRange: Boolean = false,
      wake: Boolean = false
  ) = Observation(
    now = now,
    cleverState = cleverState,
    deployment = deployment.map(s => CleverDeployment("d1", s, Some("DEPLOY"), deployedAt, None)),
    lastAccess = lastAccess,
    inUpRange = inUpRange,
    wakeRequested = wake,
    gracePeriod = grace,
    failTimeout = fail
  )

  private def statusOf(d: Option[Decision]): Option[ReaperStatus] = d.map(_.status)

  test("an app in error is left alone") {
    assertEquals(decide(state(Error), obs(ShouldBeUp)), None)
    assertEquals(decide(state(Error), obs(ShouldBeDown, wake = true)), None)
  }

  test("init follows clever cloud") {
    assertEquals(statusOf(decide(state(WaitingForInit), obs(ShouldBeUp))), Some(Up))
    assertEquals(statusOf(decide(state(WaitingForInit), obs(ShouldBeDown))), Some(Down))
    assertEquals(statusOf(decide(state(WaitingForInit), obs(WantsToBeUp, Some("WIP")))), Some(WaitingForUp))
    assertEquals(statusOf(decide(state(WaitingForInit), obs(WantsToBeUp, Some("FAIL")))), Some(Error))
    assertEquals(statusOf(decide(state(WaitingForInit), obs(WantsToBeUp, Some("CANCELLED")))), Some(Down))
    assertEquals(statusOf(decide(state(WaitingForInit), obs("MODERATED"))), Some(Error))
  }

  test("an up app with recent traffic stays up") {
    val s = state(Up, lastUpAt = Some(now - 3 * grace))
    assertEquals(decide(s, obs(ShouldBeUp, Some("OK"), lastAccess = Some(now - minute))), None)
  }

  test("an up app without traffic for the grace period is put to sleep") {
    val s = state(Up, lastUpAt = Some(now - 3 * grace))
    val o = obs(ShouldBeUp, Some("OK"), lastAccess = Some(now - grace - minute))
    assert(needsDeployment(s, o))
    val d = decide(s, o)
    assertEquals(statusOf(d), Some(WaitingForShutdown))
    assertEquals(d.flatMap(_.action), Some(ReaperAction.Stop))
  }

  test("an app that never got traffic is put to sleep a grace period after it came up") {
    assertEquals(decide(state(Up, lastUpAt = Some(now - grace + minute)), obs(ShouldBeUp, Some("OK"))), None)
    assertEquals(statusOf(decide(state(Up, lastUpAt = Some(now - grace - minute)), obs(ShouldBeUp, Some("OK")))), Some(WaitingForShutdown))
  }

  test("an app that just woke up is not put back to sleep, whatever its last access") {
    val s = state(Up, lastUpAt = Some(now - 5 * minute))
    assertEquals(decide(s, obs(ShouldBeUp, Some("OK"), lastAccess = Some(now - 10 * grace))), None)
  }

  test("an app stays up within a must be up range") {
    val s = state(Up, lastUpAt = Some(now - 3 * grace))
    val o = obs(ShouldBeUp, Some("OK"), inUpRange = true)
    assert(!needsDeployment(s, o))
    assertEquals(decide(s, o), None)
  }

  test("an app is only put to sleep when its last deployment is fine") {
    val s = state(Up, lastUpAt = Some(now - 3 * grace))
    assertEquals(decide(s, obs(ShouldBeUp, Some("WIP"))), None)
    assertEquals(statusOf(decide(s, obs(ShouldBeUp, Some("FAIL")))), Some(Error))
  }

  test("an up app stopped or restarted on clever cloud is followed") {
    assertEquals(statusOf(decide(state(Up), obs(ShouldBeDown))), Some(Down))
    assertEquals(statusOf(decide(state(Up), obs(WantsToBeUp))), Some(WaitingForUp))
    assertEquals(statusOf(decide(state(Up), obs("DEFAULT_OF_PAYMENT"))), Some(Error))
  }

  test("an app going to sleep is down once clever says so, or in error after the fail timeout") {
    assertEquals(statusOf(decide(state(WaitingForShutdown, actionAt = Some(now - minute)), obs(ShouldBeDown))), Some(Down))
    assertEquals(decide(state(WaitingForShutdown, actionAt = Some(now - minute)), obs(ShouldBeUp)), None)
    assertEquals(statusOf(decide(state(WaitingForShutdown, actionAt = Some(now - fail - minute)), obs(ShouldBeUp))), Some(Error))
  }

  test("a sleeping app is woken up by a request, or by a must be up range") {
    assertEquals(decide(state(Down), obs(ShouldBeDown)), None)
    val woken = decide(state(Down), obs(ShouldBeDown, wake = true))
    assertEquals(statusOf(woken), Some(WaitingForUp))
    assertEquals(woken.flatMap(_.action), Some(ReaperAction.Start))
    assertEquals(decide(state(Down), obs(ShouldBeDown, inUpRange = true)).flatMap(_.action), Some(ReaperAction.Start))
  }

  test("a sleeping app started on clever cloud is followed") {
    assertEquals(statusOf(decide(state(Down), obs(ShouldBeUp))), Some(Up))
    assertEquals(statusOf(decide(state(Down), obs(WantsToBeUp))), Some(WaitingForUp))
  }

  test("a waking app is up once its deployment is done") {
    val s = state(WaitingForUp, actionAt = Some(now - 2 * minute))
    assertEquals(decide(s, obs(WantsToBeUp, Some("WIP"), deployedAt = now - minute)), None)
    assertEquals(decide(s, obs(ShouldBeUp, Some("WIP"), deployedAt = now - minute)), None)
    assertEquals(statusOf(decide(s, obs(ShouldBeUp, Some("OK"), deployedAt = now - minute))), Some(Up))
  }

  test("a waking app does not trust a deployment older than its start") {
    val s = state(WaitingForUp, actionAt = Some(now - 2 * minute))
    assertEquals(decide(s, obs(ShouldBeUp, Some("OK"), deployedAt = now - grace)), None)
    // started by someone else: no deployment of ours to wait for
    assertEquals(statusOf(decide(state(WaitingForUp, lastStatusUpdate = now - minute), obs(ShouldBeUp))), Some(Up))
  }

  test("a waking app whose start fails or is cancelled") {
    val s = state(WaitingForUp, actionAt = Some(now - 2 * minute))
    assertEquals(statusOf(decide(s, obs(WantsToBeUp, Some("FAIL"), deployedAt = now - minute))), Some(Error))
    assertEquals(statusOf(decide(s, obs(WantsToBeUp, Some("CANCELLED"), deployedAt = now - minute))), Some(Down))
    assertEquals(statusOf(decide(s, obs(ShouldBeDown, Some("CANCELLED"), deployedAt = now - minute))), Some(Down))
  }

  test("a waking app still down is started again, within the same fail timeout") {
    assertEquals(decide(state(WaitingForUp, actionAt = Some(now - 30000L)), obs(ShouldBeDown)), None)
    val again = decide(state(WaitingForUp, actionAt = Some(now - 2 * minute)), obs(ShouldBeDown))
    assertEquals(again.flatMap(_.action), Some(ReaperAction.Start))
    assert(again.exists(_.keepActionAt))
  }

  test("a waking app that takes too long goes into error") {
    assertEquals(statusOf(decide(state(WaitingForUp, actionAt = Some(now - fail - minute)), obs(WantsToBeUp, Some("WIP")))), Some(Error))
  }
}
