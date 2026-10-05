package com.cloud.apim.otoroshi.extensions.cleverreaper

import play.api.libs.json.*

/**
 * The page a browser gets while its app wakes up. A custom page is the operator's own html: only the
 * placeholders are replaced, and the polling script is added before `</body>`.
 *
 * Placeholders: `{{route_name}}`, `{{app_name}}`, `{{app_id}}`, `{{status}}`.
 */
object WaitingPage {

  val StatusHeader = "Clever-Reaper"
  val pollIntervalMillis: Long = 5000L

  private def escape(value: String): String =
    value
      .replace("&", "&amp;")
      .replace("<", "&lt;")
      .replace(">", "&gt;")
      .replace("\"", "&quot;")
      .replace("'", "&#39;")

  /** What the polling script reads: the app is either still waking up, ready, or beyond help. */
  def publicStatus(status: Option[ReaperStatus]): String = status match {
    case Some(s) if s.asleep           => s.toString
    case Some(ReaperStatus.Error)      => ReaperStatus.Error.toString
    case _                             => ReaperStatus.Up.toString
  }

  def statusJson(status: Option[ReaperStatus], readyDelaySeconds: Long): JsValue =
    Json.obj("status" -> publicStatus(status), "ready_delay_ms" -> readyDelaySeconds * 1000L)

  def label(status: Option[ReaperStatus]): String = status match {
    case Some(ReaperStatus.WaitingForShutdown) => "Finishing going to sleep"
    case Some(ReaperStatus.Down)               => "Asleep, wake up requested"
    case Some(ReaperStatus.WaitingForUp)       => "Starting"
    case Some(ReaperStatus.Error)              => "Error"
    case _                                     => "Ready"
  }

  private val script: String =
    s"""<script>
       |(function() {
       |  var interval = $pollIntervalMillis;
       |  var labels = { WaitingForShutdown: 'Finishing going to sleep', Down: 'Asleep, wake up requested', WaitingForUp: 'Starting', Up: 'Ready', Error: 'Error' };
       |  function check() {
       |    fetch(window.location.href, { method: 'GET', headers: { '$StatusHeader': 'status', 'Accept': 'application/json' }, credentials: 'include', cache: 'no-store' })
       |      .then(function(r) { return r.json(); })
       |      .then(function(data) {
       |        var el = document.getElementById('clever-reaper-status');
       |        if (el && data.status) { el.textContent = labels[data.status] || data.status; }
       |        if (data.status === 'Up') {
       |          setTimeout(function() { window.location.reload(); }, data.ready_delay_ms || 0);
       |        } else if (data.status === 'Error') {
       |          document.body.classList.add('clever-reaper-error');
       |          setTimeout(check, interval * 6);
       |        } else {
       |          document.body.classList.remove('clever-reaper-error');
       |          setTimeout(check, interval);
       |        }
       |      })
       |      .catch(function() { setTimeout(check, interval); });
       |  }
       |  setTimeout(check, interval);
       |})();
       |</script>""".stripMargin

  def render(template: String, routeName: String, appId: String, appName: Option[String], status: Option[ReaperStatus]): String = {
    val html = template
      .replace("{{route_name}}", escape(routeName))
      .replace("{{app_name}}", escape(appName.getOrElse(routeName)))
      .replace("{{app_id}}", escape(appId))
      .replace("{{status}}", escape(label(status)))
    val at   = html.toLowerCase.lastIndexOf("</body>")
    if (at < 0) html + script else html.substring(0, at) + script + html.substring(at)
  }
}
