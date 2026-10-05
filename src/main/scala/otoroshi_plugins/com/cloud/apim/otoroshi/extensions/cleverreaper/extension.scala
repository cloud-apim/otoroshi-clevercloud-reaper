package otoroshi_plugins.com.cloud.apim.otoroshi.extensions.cleverreaper

import com.cloud.apim.otoroshi.extensions.cleverreaper.*
import org.apache.pekko.actor.Cancellable
import org.apache.pekko.stream.Materializer
import org.apache.pekko.stream.scaladsl.{Source, StreamConverters}
import org.apache.pekko.util.ByteString
import otoroshi.env.Env
import otoroshi.models.{BackOfficeUser, EntityLocationSupport}
import otoroshi.next.extensions.*
import otoroshi.next.models.{NgPluginInstance, NgPluginInstanceConfig, NgRoute}
import otoroshi.utils.syntax.implicits.*
import play.api.Logger
import play.api.libs.json.*
import play.api.mvc.{RequestHeader, Result, Results}

import java.util.concurrent.atomic.AtomicReference
import scala.concurrent.duration.*
import scala.concurrent.{ExecutionContext, Future}
import scala.util.Try

object CleverReaperExtension {
  val extensionId: AdminExtensionId = AdminExtensionId("cloud-apim.extensions.CleverReaper")
  val pluginId: String              = s"cp:${classOf[CleverReaper].getName}"
  val boPath: String                = "/extensions/cloud-apim/extensions/clever-reaper"
  val apiPath: String               = "/api/extensions/cloud-apim/extensions/clever-reaper"
  val assetsPath: String            = "/extensions/assets/cloud-apim/extensions/clever-reaper"
}

class CleverReaperExtension(val env: Env) extends AdminExtension {

  import CleverReaperExtension.*

  private val logger = Logger("cloud-apim-clever-reaper-extension")

  override def id: AdminExtensionId     = extensionId
  override def name: String             = "Cloud APIM - Clever Cloud Reaper"
  override def description: Option[String] =
    "Puts the Clever Cloud apps that get no traffic to sleep, and wakes them up on the next request".some
  override def enabled: Boolean         = env.isDev || configuration.getOptional[Boolean]("enabled").getOrElse(false)

  lazy val conf: ReaperConfiguration = ReaperConfiguration.from(configuration)
  lazy val api: CleverCloudApi       = new CleverCloudApi(env, conf.apiUrl, conf.apiToken, conf.apiTimeout)
  lazy val store: ReaperStore        = new ReaperStore(env, s"${env.storageRoot}:extensions:${id.cleanup}")
  lazy val memory: ReaperMemory      = new ReaperMemory()
  lazy val tracker: AccessTracker    = new AccessTracker()
  lazy val engine: ReaperEngine      = new ReaperEngine(env, conf, api, store, memory)
  lazy val waiters: ReaperWaiters    = new ReaperWaiters(env, currentStatus, requestWake)

  private val flushTask = new AtomicReference[Cancellable]()
  // the apps of each owner with their vhosts, to guess the app behind a route: slow to list, so cached
  private val cleverAppsCache = new AtomicReference[(Long, Seq[CleverApp])]((0L, Seq.empty))
  // wakes asked from this node, so a burst of requests asks only once
  private val lastWakes = new scala.collection.concurrent.TrieMap[String, (Long, Long)]()

  private given ec: ExecutionContext = env.otoroshiExecutionContext
  private given mat: Materializer    = env.otoroshiMaterializer
  private given Env                  = env

  private def isWorker: Boolean = env.clusterConfig.mode.isWorker

  override def start(): Unit = {
    logger.info("the 'Cloud APIM - Clever Cloud Reaper' extension is enabled !")
    if (!api.configured) logger.warn("no clever cloud api token configured (CLEVER_CLOUD_API_TOKEN): the reaper will not do anything")
    if (conf.dryRun) logger.warn("the clever reaper runs in dry-run mode: no app will be put to sleep")
    flushTask.set(env.otoroshiScheduler.scheduleWithFixedDelay(conf.accessFlushInterval, conf.accessFlushInterval)(() => flushAccess()))
  }

  override def stop(): Unit = {
    Option(flushTask.get()).foreach(_.cancel())
    Try(scala.concurrent.Await.result(flushAccess(), 5.seconds))
  }

  override def syncStates(): Future[Unit] =
    for {
      states   <- store.allStates()
      accesses <- store.allAccess()
      settings <- store.settings()
    } yield {
      memory.replaceStates(states)
      memory.mergeAccess(accesses)
      memory.settings = settings
    }

  // access tracking: each node pushes what it saw, the leaders keep the latest per app

  def flushAccess(): Future[Unit] = {
    val accesses = tracker.drain()
    if (accesses.isEmpty) Future.unit
    else if (isWorker) {
      LeaderClient.call(env, "PUT", s"$apiPath/cluster/access", Some(Json.toJson(accesses))).map {
        case Right(_)  => ()
        case Left(err) =>
          tracker.restore(accesses)
          logger.warn(s"could not push the last accesses to the leader: $err")
      }
    } else {
      store
        .recordAccess(accesses)
        .map(memory.mergeAccess)
        .recover { case e: Throwable =>
          tracker.restore(accesses)
          logger.error("could not record the last accesses", e)
        }
    }
  }

  // wake ups and statuses, from wherever the request lands

  def requestWake(appId: String): Unit = {
    val now     = System.currentTimeMillis()
    // once per sleep: an app put back to sleep right after a wake up is a new sleep, asked again at once
    val episode = memory.state(appId).map(_.lastStatusUpdate).getOrElse(0L)
    val due     = lastWakes.get(appId) match {
      case None                                                      => lastWakes.putIfAbsent(appId, (episode, now)).isEmpty
      case Some(last @ (lastEpisode, at)) if lastEpisode != episode || now - at > 10000L =>
        lastWakes.replace(appId, last, (episode, now))
      case Some(_)                                                   => false
    }
    if (due) {
      val asked =
        if (isWorker) LeaderClient.call(env, "POST", s"$apiPath/apps/$appId/_wake").map(_.left.map(e => new RuntimeException(e)))
        else engine.wake(appId).map(Right(_))
      asked
        .map {
          case Left(err) => logger.warn(s"could not ask for the wake up of $appId: ${err.getMessage}")
          case Right(_)  => ()
        }
        .recover { case e: Throwable => logger.error(s"could not wake $appId up", e) }
    }
  }

  def currentStatus(appId: String): Future[Option[ReaperStatus]] =
    if (isWorker) {
      LeaderClient.call(env, "GET", s"$apiPath/apps/$appId").map {
        case Right(json) => json.select("status").asOpt[ReaperStatus]
        case Left(_)     => memory.status(appId)
      }
    } else memory.status(appId).vfuture

  // the waiting page

  private def getResourceCode(path: String): String =
    env.environment
      .resourceAsStream(path)
      .map(stream => StreamConverters.fromInputStream(() => stream).runFold(ByteString.empty)(_ ++ _).awaitf(10.seconds).utf8String)
      .getOrElse(s"'resource $path not found !'")

  lazy val defaultWaitingPage: String = getResourceCode("cloudapim/extensions/cleverreaper/waiting.html")
  private lazy val pageCode: String   = getResourceCode("cloudapim/extensions/cleverreaper/ReaperPage.js")
  private lazy val iconCode: String   = getResourceCode("cloudapim/extensions/cleverreaper/icon.svg")

  def waitingPageTemplate(config: CleverReaperConfig): String = config.waitingPage.getOrElse(defaultWaitingPage)

  // clever cloud apps, for the selects of the ui and to guess the app behind a route

  def cleverApps(force: Boolean = false): Future[Either[CleverError, Seq[CleverApp]]] = {
    val (at, cached) = cleverAppsCache.get()
    if (!force && System.currentTimeMillis() - at < 60000L && cached.nonEmpty) Right(cached).vfuture
    else
      api.summary().flatMap {
        case Left(err)  => Left(err).vfuture
        case Right(all) =>
          val owners = all.groupBy(_.ownerId).toSeq
          Future
            .sequence(owners.map { case (ownerId, apps) =>
              api.applications(ownerId, apps.headOption.flatMap(_.ownerName)).map(_.getOrElse(apps))
            })
            .map { perOwner =>
              val apps = perOwner.flatten.sortBy(a => (a.ownerName.getOrElse(a.ownerId), a.name.toLowerCase))
              cleverAppsCache.set((System.currentTimeMillis(), apps))
              Right(apps)
            }
      }
  }

  private def cachedVhosts: Map[String, String] =
    cleverAppsCache.get()._2.flatMap(a => a.vhosts.map(_.toLowerCase -> a.id)).toMap

  def detectApp(route: NgRoute): Option[String] =
    CleverAppIds.fromRoute(route).orElse(CleverAppIds.fromVhosts(route, cachedVhosts))

  // admin api: the cluster plumbing, and the same actions as the ui for automation

  override def adminApiRoutes(): Seq[AdminExtensionAdminApiRoute] = Seq(
    AdminExtensionAdminApiRoute("PUT", s"$apiPath/cluster/access", wantsBody = true, (_, _, _, body) => handleAccessPush(body)),
    AdminExtensionAdminApiRoute("GET", s"$apiPath/apps", wantsBody = false, (_, _, _, _) => handleApps(_ => true)),
    AdminExtensionAdminApiRoute("GET", s"$apiPath/apps/:appId", wantsBody = false, (ctx, _, _, _) => handleApp(ctx.named("appId"))),
    AdminExtensionAdminApiRoute("GET", s"$apiPath/apps/:appId/history", wantsBody = false, (ctx, req, _, _) => handleHistory(ctx.named("appId"), req)),
    AdminExtensionAdminApiRoute("POST", s"$apiPath/apps/:appId/_wake", wantsBody = false, (ctx, _, _, _) => handleWake(ctx.named("appId"))),
    AdminExtensionAdminApiRoute("POST", s"$apiPath/apps/:appId/_reap", wantsBody = false, (ctx, _, key, _) => handleReap(ctx.named("appId"), s"apikey ${key.clientName}")),
    AdminExtensionAdminApiRoute("POST", s"$apiPath/apps/:appId/_reset", wantsBody = false, (ctx, _, key, _) => handleReset(ctx.named("appId"), s"apikey ${key.clientName}"))
  )

  // backoffice: what the ui page calls

  override def backofficeAuthRoutes(): Seq[AdminExtensionBackofficeAuthRoute] = Seq(
    AdminExtensionBackofficeAuthRoute("GET", s"$boPath/overview", wantsBody = false, (_, _, user, _) => withUser(user)(_ => handleOverview())),
    AdminExtensionBackofficeAuthRoute("GET", s"$boPath/routes", wantsBody = false, (_, req, user, _) => withUser(user)(u => handleRoutes(req, u))),
    AdminExtensionBackofficeAuthRoute("POST", s"$boPath/routes/:routeId/_enable", wantsBody = true, (ctx, _, user, body) => withUser(user)(u => handleEnable(ctx.named("routeId"), body, u))),
    AdminExtensionBackofficeAuthRoute("POST", s"$boPath/routes/:routeId/_disable", wantsBody = false, (ctx, _, user, _) => withUser(user)(u => handleDisable(ctx.named("routeId"), u))),
    AdminExtensionBackofficeAuthRoute("PUT", s"$boPath/routes/:routeId/config", wantsBody = true, (ctx, _, user, body) => withUser(user)(u => handleConfig(ctx.named("routeId"), body, u))),
    AdminExtensionBackofficeAuthRoute("GET", s"$boPath/apps/:appId/history", wantsBody = false, (ctx, req, user, _) => withAppRights(user, ctx.named("appId"), write = false)((_, _) => handleHistory(ctx.named("appId"), req))),
    AdminExtensionBackofficeAuthRoute("POST", s"$boPath/apps/:appId/_wake", wantsBody = false, (ctx, _, user, _) => withAppRights(user, ctx.named("appId"), write = true)((_, _) => handleWake(ctx.named("appId")))),
    AdminExtensionBackofficeAuthRoute("POST", s"$boPath/apps/:appId/_reap", wantsBody = false, (ctx, _, user, _) => withAppRights(user, ctx.named("appId"), write = true)((u, _) => handleReap(ctx.named("appId"), u.email))),
    AdminExtensionBackofficeAuthRoute("POST", s"$boPath/apps/:appId/_reset", wantsBody = false, (ctx, _, user, _) => withAppRights(user, ctx.named("appId"), write = true)((u, _) => handleReset(ctx.named("appId"), u.email))),
    AdminExtensionBackofficeAuthRoute("GET", s"$boPath/clever/apps", wantsBody = false, (_, req, user, _) => withUser(user)(_ => handleCleverApps(req))),
    AdminExtensionBackofficeAuthRoute("PUT", s"$boPath/settings", wantsBody = true, (_, _, user, body) => withUser(user)(u => handleSettings(body, u)))
  )

  override def frontendExtensions(): Seq[AdminExtensionFrontendExtension] =
    Seq(AdminExtensionFrontendExtension(path = s"$assetsPath/extension.js"))

  override def assets(): Seq[AdminExtensionAssetRoute] = Seq(
    AdminExtensionAssetRoute(s"$assetsPath/icon.svg", (_, _) => Results.Ok(iconCode).as("image/svg+xml").vfuture),
    AdminExtensionAssetRoute(s"$assetsPath/extension.js", (_, _) => Results.Ok(extensionJs).as("application/javascript").vfuture)
  )

  override def entities(): Seq[AdminExtensionEntity[EntityLocationSupport]] = Seq.empty

  private lazy val extensionJs: String =
    s"""(function() {
       |  const extensionId = "${id.value}";
       |  Otoroshi.registerExtension(extensionId, false, (ctx) => {
       |
       |    const dependencies = ctx.dependencies;
       |    const React = dependencies.react;
       |    const Component = React.Component;
       |    const BASE = "$boPath";
       |
       |    $pageCode
       |
       |    const feature = {
       |      title: 'Clever Cloud Reaper',
       |      description: 'Put the Clever Cloud apps without traffic to sleep, wake them up on demand',
       |      absoluteImg: '$assetsPath/icon.svg',
       |      link: '/extensions/cloud-apim/clever-reaper',
       |      display: () => true,
       |      icon: () => 'fa-moon',
       |    };
       |
       |    return {
       |      id: extensionId,
       |      categories: [{
       |        title: 'Clever Cloud',
       |        description: 'Clever Cloud integrations',
       |        features: [feature],
       |      }],
       |      features: [feature],
       |      searchItems: [{
       |        action: () => { window.location.href = '/bo/dashboard/extensions/cloud-apim/clever-reaper'; },
       |        env: React.createElement('span', { className: 'fas fa-moon' }, null),
       |        label: 'Clever Cloud Reaper',
       |        value: 'cleverreaper',
       |      }],
       |      routes: [{
       |        path: '/extensions/cloud-apim/clever-reaper',
       |        component: (props) => React.createElement(CleverReaperPage, props, null),
       |      }],
       |    };
       |  });
       |})();
       |""".stripMargin

  // helpers

  private def readBody(body: Option[Source[ByteString, ?]]): Future[JsValue] = body match {
    case None         => Json.obj().vfuture
    case Some(source) => source.runFold(ByteString.empty)(_ ++ _).map(bs => Try(Json.parse(bs.utf8String)).getOrElse(Json.obj()))
  }

  private def badRequest(message: String): Future[Result] = Results.BadRequest(Json.obj("error" -> message)).vfuture
  private def notFound(message: String): Future[Result]   = Results.NotFound(Json.obj("error" -> message)).vfuture
  private def forbidden: Future[Result]                    = Results.Forbidden(Json.obj("error" -> "you are not allowed to do that")).vfuture

  private def withUser(user: Option[BackOfficeUser])(f: BackOfficeUser => Future[Result]): Future[Result] = user match {
    case None    => Results.Unauthorized(Json.obj("error" -> "not logged in")).vfuture
    case Some(u) => f(u)
  }

  private def canRead(user: BackOfficeUser, route: NgRoute): Boolean =
    user.rights.canReadTenant(route.location.tenant) && user.rights.canReadTeams(route.location.tenant, route.location.teams)

  private def canWrite(user: BackOfficeUser, route: NgRoute): Boolean =
    user.rights.canWriteTenant(route.location.tenant) && user.rights.canWriteTeams(route.location.tenant, route.location.teams)

  // an app is shared by its routes: acting on it takes rights on one of them at least
  private def withAppRights(user: Option[BackOfficeUser], appId: Option[String], write: Boolean)(
      f: (BackOfficeUser, String) => Future[Result]
  ): Future[Result] = withUser(user) { u =>
    appId match {
      case None     => badRequest("no app id")
      case Some(id) =>
        val routeIds = memory.state(id).map(_.routes).getOrElse(Seq.empty) ++
          engine.managedApps().get(id).map(_.routeIds).getOrElse(Seq.empty)
        val routes   = env.proxyState.allRawRoutes().filter(r => routeIds.contains(r.id))
        val allowed  = u.rights.superAdmin || routes.exists(r => if (write) canWrite(u, r) else canRead(u, r))
        if (allowed) f(u, id) else forbidden
    }
  }

  private def stateJson(appId: String): JsValue = {
    val state = memory.state(appId)
    state.map(_.json.asObject).getOrElse(Json.obj("app_id" -> appId)) ++ Json.obj(
      "last_access" -> memory.lastAccess(appId),
      "reap_at"     -> state.filter(_.status == ReaperStatus.Up).map { s =>
        ReaperRules.lastActivity(s, memory.lastAccess(s.appId)) + s.gracePeriod
      }
    )
  }

  // handlers

  private def handleAccessPush(body: Option[Source[ByteString, ?]]): Future[Result] =
    readBody(body).flatMap { json =>
      val accesses = json.asOpt[Map[String, Long]].getOrElse(Map.empty)
      store.recordAccess(accesses).map { merged =>
        memory.mergeAccess(merged)
        Results.Ok(Json.obj("done" -> true))
      }
    }

  private def handleApps(filter: AppState => Boolean): Future[Result] =
    Results.Ok(JsArray(memory.allStates().filter(filter).sortBy(_.appId).map(s => stateJson(s.appId)))).vfuture

  private def handleApp(appId: Option[String]): Future[Result] = appId match {
    case None     => badRequest("no app id")
    case Some(id) =>
      memory.state(id) match {
        case None    => notFound(s"the app $id is not managed by the reaper")
        case Some(_) => Results.Ok(stateJson(id)).vfuture
      }
  }

  private def handleHistory(appId: Option[String], req: RequestHeader): Future[Result] = appId match {
    case None     => badRequest("no app id")
    case Some(id) =>
      val page     = req.getQueryString("page").flatMap(_.toIntOption).filter(_ > 0).getOrElse(1)
      val pageSize = req.getQueryString("page_size").flatMap(_.toIntOption).filter(_ > 0).map(Math.min(_, 500)).getOrElse(20)
      store.history(id, (page - 1) * pageSize, pageSize).map(items => Results.Ok(JsArray(items.map(_.json))))
  }

  private def handleWake(appId: Option[String]): Future[Result] = appId match {
    case None                => badRequest("no app id")
    case Some(_) if isWorker => badRequest("wake ups are handled by the leaders")
    case Some(id)            =>
      engine.wake(id).map {
        case None    => Results.NotFound(Json.obj("error" -> s"the app $id is not managed by the reaper"))
        case Some(s) => Results.Ok(stateJson(s.appId))
      }
  }

  private def handleReap(appId: Option[String], by: String): Future[Result] = appId match {
    case None                => badRequest("no app id")
    case Some(_) if isWorker => badRequest("only the leaders can do that")
    case Some(id)            =>
      engine.reap(id, by).map {
        case Left(err) => Results.Conflict(Json.obj("error" -> err))
        case Right(s)  => Results.Ok(stateJson(s.appId))
      }
  }

  private def handleReset(appId: Option[String], by: String): Future[Result] = appId match {
    case None                => badRequest("no app id")
    case Some(_) if isWorker => badRequest("only the leaders can do that")
    case Some(id)            =>
      engine.reset(id, by).map {
        case Left(err) => Results.Conflict(Json.obj("error" -> err))
        case Right(s)  => Results.Ok(stateJson(s.appId))
      }
  }

  private def handleOverview(): Future[Result] = {
    val states = memory.allStates()
    Results
      .Ok(
        Json.obj(
          "token_configured" -> api.configured,
          "api_url"          -> conf.apiUrl,
          "dry_run"          -> conf.dryRun,
          "settings"         -> memory.settings.json,
          "cluster_mode"     -> env.clusterConfig.mode.name,
          "timezone"         -> conf.timezone.getId,
          "interval"         -> conf.interval.toMillis,
          "fast_interval"    -> conf.fastInterval.toMillis,
          "last_tick"        -> engine.lastTickJson,
          "apps"             -> states.size,
          "by_status"        -> JsObject(ReaperStatus.values.toSeq.map(s => s.toString -> JsNumber(states.count(_.status == s))))
        )
      )
      .vfuture
  }

  /**
   * The routes of this node, from memory, with what the reaper knows of them. Filters:
   * `search` (name, id, domains, targets), `reaper` (all, enabled, disabled), `status`, `page`, `page_size`.
   */
  private def handleRoutes(req: RequestHeader, user: BackOfficeUser): Future[Result] = {
    val search   = req.getQueryString("search").map(_.trim.toLowerCase).filter(_.nonEmpty)
    val reaper   = req.getQueryString("reaper").map(_.trim.toLowerCase).getOrElse("all")
    val status   = req.getQueryString("status").flatMap(ReaperStatus.parse)
    val page     = req.getQueryString("page").flatMap(_.toIntOption).filter(_ > 0).getOrElse(1)
    val pageSize = req.getQueryString("page_size").flatMap(_.toIntOption).filter(_ > 0).map(Math.min(_, 500)).getOrElse(15)
    // refreshed in the background: the vhosts make the guesses better, the list does not wait for them
    if (api.configured && System.currentTimeMillis() - cleverAppsCache.get()._1 > 60000L) cleverApps()
    val rows     = env.proxyState
      .allRawRoutes()
      .filter(r => canRead(user, r))
      .map(routeRow)
      .filter { row =>
        val enabled = row.select("reaper").select("enabled").asOpt[Boolean].getOrElse(false)
        reaper match {
          case "enabled"  => enabled
          case "disabled" => !enabled
          case _          => true
        }
      }
      .filter(row => status.forall(s => row.select("state").select("status").asOpt[ReaperStatus].contains(s)))
      .filter(row => search.forall(s => row.select("search").asOpt[String].exists(_.contains(s))))
      .sortBy(_.select("name").asOpt[String].getOrElse("").toLowerCase)
    val total    = rows.size
    val items    = rows.slice((page - 1) * pageSize, page * pageSize).map(_.asObject - "search")
    Results
      .Ok(Json.obj("total" -> total, "page" -> page, "page_size" -> pageSize, "items" -> JsArray(items)))
      .withHeaders("X-Count" -> total.toString)
      .vfuture
  }

  private def routeRow(route: NgRoute): JsObject = {
    val instance = route.plugins.slots.find(_.plugin == pluginId)
    val config   = instance.flatMap(i => CleverReaperConfig.format.reads(i.config.raw).asOpt)
    val appId    = config.flatMap(_.appId).orElse(detectApp(route))
    val detected = config.flatMap(_.appId).isEmpty && appId.isDefined
    val domains  = route.frontend.domains.map(_.raw)
    val targets  = route.backend.targets.map(t => s"${if (t.tls) "https" else "http"}://${t.hostname}:${t.port}")
    Json.obj(
      "id"      -> route.id,
      "name"    -> route.name,
      "enabled" -> route.enabled,
      "domains" -> domains,
      "targets" -> targets,
      "reaper"  -> Json.obj(
        "installed" -> instance.isDefined,
        "enabled"   -> instance.exists(_.enabled),
        "config"    -> config.map(_.json).getOrElse(JsNull).asValue,
        "app_id"    -> appId,
        "detected"  -> detected
      ),
      "state"   -> appId.map(stateJson).getOrElse(JsNull).asValue,
      "search"  -> (Seq(route.name, route.id) ++ domains ++ targets ++ appId.toSeq ++ appId.flatMap(memory.state).flatMap(_.name).toSeq)
        .mkString(" ")
        .toLowerCase
    )
  }

  /** Re-reads the route from the datastore: the in memory one has its vault secrets resolved. */
  private def updateRoute(routeId: Option[String], user: BackOfficeUser)(f: NgRoute => Either[String, NgRoute]): Future[Either[Result, NgRoute]] =
    routeId match {
      case None     => Left(Results.BadRequest(Json.obj("error" -> "no route id"))).vfuture
      case Some(id) =>
        env.datastores.routeDataStore.findById(id).flatMap {
          case None                               => Left(Results.NotFound(Json.obj("error" -> s"route $id not found"))).vfuture
          case Some(route) if !canWrite(user, route) =>
            Left(Results.Forbidden(Json.obj("error" -> "you are not allowed to change this route"))).vfuture
          case Some(route)                        =>
            f(route) match {
              case Left(err)      => Left(Results.BadRequest(Json.obj("error" -> err))).vfuture
              case Right(updated) => env.datastores.routeDataStore.set(updated).map(_ => Right(updated))
            }
        }
    }

  private def withPlugin(route: NgRoute, enabled: Boolean, config: CleverReaperConfig): NgRoute = {
    val raw = config.json.asObject
    if (route.plugins.slots.exists(_.plugin == pluginId)) {
      route.copy(plugins = route.plugins.copy(slots = route.plugins.slots.map { slot =>
        if (slot.plugin == pluginId) slot.copy(enabled = enabled, config = NgPluginInstanceConfig(raw)) else slot
      }))
    } else {
      // last: access validators run in order, the authentication plugins come first
      route.copy(plugins = route.plugins.add(NgPluginInstance(plugin = pluginId, enabled = enabled, config = NgPluginInstanceConfig(raw))))
    }
  }

  private def currentConfig(route: NgRoute): CleverReaperConfig =
    route.plugins.slots
      .find(_.plugin == pluginId)
      .flatMap(i => CleverReaperConfig.format.reads(i.config.raw).asOpt)
      .getOrElse(CleverReaperConfig.default)

  private def mergeConfig(current: CleverReaperConfig, patch: JsValue): CleverReaperConfig =
    patch match {
      case obj: JsObject if obj.value.nonEmpty =>
        CleverReaperConfig.format.reads(current.json.asObject ++ obj).getOrElse(current)
      case _                                   => current
    }

  private def handleEnable(routeId: Option[String], body: Option[Source[ByteString, ?]], user: BackOfficeUser): Future[Result] =
    readBody(body).flatMap { patch =>
      updateRoute(routeId, user) { route =>
        val config = mergeConfig(currentConfig(route), patch)
        val withApp = if (config.appId.isDefined) config else config.copy(appId = detectApp(route))
        if (withApp.appId.isEmpty) Left("the clever cloud app behind this route could not be guessed, please choose one")
        else Right(withPlugin(route, enabled = true, withApp))
      }.map {
        case Left(result) => result
        case Right(route) => Results.Ok(routeRow(route) - "search")
      }
    }

  private def handleDisable(routeId: Option[String], user: BackOfficeUser): Future[Result] =
    updateRoute(routeId, user) { route =>
      if (!route.plugins.slots.exists(_.plugin == pluginId)) Left("the reaper is not installed on this route")
      else Right(withPlugin(route, enabled = false, currentConfig(route)))
    }.flatMap {
      case Left(result) => result.vfuture
      case Right(route) =>
        CleverAppIds.resolve(route, currentConfig(route)) match {
          // the app is started if no other route keeps it under the reaper, nothing would wake it up otherwise
          case Some(appId) if !isWorker =>
            engine.release(appId, s"the reaper was disabled on route '${route.name}' by ${user.email}", ignoring = Some(route.id)).map {
              case Left(err) => Results.Ok(routeRow(route) - "search" ++ Json.obj("warning" -> s"could not start the app: $err"))
              case Right(_)  => Results.Ok(routeRow(route) - "search")
            }
          case _                        => Results.Ok(routeRow(route) - "search").vfuture
        }
    }

  private def handleConfig(routeId: Option[String], body: Option[Source[ByteString, ?]], user: BackOfficeUser): Future[Result] =
    readBody(body).flatMap { patch =>
      updateRoute(routeId, user) { route =>
        route.plugins.slots.find(_.plugin == pluginId) match {
          case None       => Left("the reaper is not installed on this route")
          case Some(slot) => Right(withPlugin(route, enabled = slot.enabled, mergeConfig(currentConfig(route), patch)))
        }
      }.map {
        case Left(result) => result
        case Right(route) => Results.Ok(routeRow(route) - "search")
      }
    }

  private def handleCleverApps(req: RequestHeader): Future[Result] =
    if (!api.configured) Results.Ok(Json.arr()).vfuture
    else
      cleverApps(force = req.getQueryString("force").contains("true")).map {
        case Left(err)  => Results.BadGateway(Json.obj("error" -> err.toString))
        case Right(all) =>
          Results.Ok(JsArray(all.map { app =>
            app.json.asObject ++ Json.obj("label" -> s"${app.name} (${app.ownerName.getOrElse(app.ownerId)}) - ${app.id}")
          }))
      }

  private def handleSettings(body: Option[Source[ByteString, ?]], user: BackOfficeUser): Future[Result] =
    if (!user.rights.superAdmin) forbidden
    else
      readBody(body).flatMap { json =>
        val settings = memory.settings.copy(
          killSwitch = json.select("kill_switch").asOpt[Boolean].getOrElse(memory.settings.killSwitch),
          updatedAt = Some(System.currentTimeMillis()),
          updatedBy = Some(user.email)
        )
        store.saveSettings(settings).map { _ =>
          memory.settings = settings
          logger.info(s"clever reaper kill switch ${if (settings.killSwitch) "on" else "off"} by ${user.email}")
          Results.Ok(settings.json)
        }
      }
}
