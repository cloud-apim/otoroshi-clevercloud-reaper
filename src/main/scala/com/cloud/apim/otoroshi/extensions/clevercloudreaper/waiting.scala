package com.cloud.apim.otoroshi.extensions.clevercloudreaper

import play.api.libs.json.*

/**
 * The page a client gets while its app wakes up. A custom page is the operator's own html: only the
 * placeholders are replaced, and the polling script is added before `</body>`.
 *
 * Placeholders: `{{route_name}}`, `{{app_name}}`, `{{app_id}}`, `{{status}}`.
 *
 * The script polls the very path of the page, so the page reloads once the app really answers it,
 * rather than once clever cloud says the app is up:
 *  - while the app sleeps, the reaper answers the poll itself, and says so with `CleverCloud-Reaper-Status`;
 *  - once it is up, the poll goes through to the app: anything but a 5xx, or the 404 clever answers
 *    for an app that does not run, means the app is there.
 */
object WaitingPage {

  val Header: String       = "CleverCloud-Reaper"
  // `CleverCloud-Reaper: status` asks for the status as json, whatever the state of the app
  val StatusValue: String  = "status"
  // `CleverCloud-Reaper: poll` is the waiting page checking whether the app answers
  val PollValue: String    = "poll"
  val MarkerHeader: String = "CleverCloud-Reaper-Status"

  val pollIntervalMillis: Long = 5000L

  private def escape(value: String): String =
    value
      .replace("&", "&amp;")
      .replace("<", "&lt;")
      .replace(">", "&gt;")
      .replace("\"", "&quot;")
      .replace("'", "&#39;")

  /** What a poll reads: the app is either still waking up, ready, or beyond help. */
  def publicStatus(status: Option[ReaperStatus]): String = status match {
    case Some(s) if s.asleep      => s.toString
    case Some(ReaperStatus.Error) => ReaperStatus.Error.toString
    case _                        => ReaperStatus.Up.toString
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
       |  var labels = { WaitingForShutdown: 'Finishing going to sleep', Down: 'Asleep, wake up requested', WaitingForUp: 'Starting', Up: 'Almost ready', Error: 'Error' };
       |  function show(status) {
       |    var el = document.getElementById('clevercloud-reaper-status');
       |    if (el) { el.textContent = labels[status] || status; }
       |    if (status === 'Error') { document.body.classList.add('clevercloud-reaper-error'); }
       |    else { document.body.classList.remove('clevercloud-reaper-error'); }
       |  }
       |  function check() {
       |    fetch(window.location.href, { method: 'HEAD', headers: { '$Header': '$PollValue', 'Accept': 'application/json' }, credentials: 'include', cache: 'no-store' })
       |      .then(function(r) {
       |        var status = r.headers.get('$MarkerHeader');
       |        if (status) {
       |          show(status);
       |          setTimeout(check, status === 'Error' ? interval * 6 : interval);
       |        } else if (r.status >= 500 || (r.status === 404 && r.headers.get('X-CleverCloudUpgrade') === 'true')) {
       |          // the reaper lets requests through, the app does not answer them yet
       |          show('Up');
       |          setTimeout(check, interval);
       |        } else {
       |          window.location.reload();
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
