import Dependencies._

ThisBuild / scalaVersion     := "3.8.4"
ThisBuild / version          := "1.0.0-dev"
ThisBuild / organization     := "com.cloud-apim"
ThisBuild / organizationName := "Cloud-APIM"

lazy val jackson = Seq(
  ExclusionRule("com.fasterxml.jackson"),
  ExclusionRule("com.fasterxml.jackson.core", "jackson-core"),
  ExclusionRule("com.fasterxml.jackson.core", "jackson-databind"),
  ExclusionRule("com.fasterxml.jackson.core", "jackson-datatypes"),
  ExclusionRule("com.fasterxml.jackson.core", "jackson-annotations"),
)

lazy val slf4j = Seq(
  ExclusionRule("org.slf4j"),
  ExclusionRule("ch.qos.logback")
)

// everything listed here is already on the otoroshi classpath at runtime, in the exact same version
lazy val other = Seq(
  ExclusionRule("org.scala-lang"),
  ExclusionRule("org.playframework"),
  ExclusionRule("io.opentelemetry"),
  ExclusionRule("com.github.blemale"),
  ExclusionRule("com.comcast"),
  ExclusionRule("org.typelevel"),
)

lazy val all = jackson ++ slf4j ++ other

lazy val root = (project in file("."))
  .settings(
    name := "otoroshi-clevercloud-reaper",
    scalacOptions ++= Seq(
      "-deprecation",
      "-feature",
      "-unchecked",
      "-Wunused:all",
      // the wasm4s "bundle" jar (transitive, provided) vendors an older scala 3 stdlib where `scala.caps`
      // is an object while scala-library 3.8.4 declares it as a package. otoroshi silences it too.
      "-Wconf:msg=package scala contains object and package with same name:s",
    ),
    libraryDependencies ++= Seq(
      "fr.maif" %% "otoroshi" % "18.0.0-preview9" % "provided",
      // otoroshi ships java-jq as an unmanaged jar in its lib/ directory, so it is absent from the
      // published pom: booting otoroshi in-process for the integration tests needs it explicitly
      "com.arakelian" % "java-jq" % "1.3.0" % Test excludeAll (all *),
      munit % Test,
    ),
    // otoroshi discovers extensions, plugins and jobs by scanning the classpath reflectively, which the
    // layered test class loader defeats: the extension's own classes live in a layer the scan cannot see
    Test / classLoaderLayeringStrategy := ClassLoaderLayeringStrategy.Flat,
    Test / parallelExecution := false,
    assembly / test  := {},
    assembly / assemblyJarName := "otoroshi-clevercloud-reaper-assembly_3-dev.jar",
    // otoroshi already provides the exact same scala3-library at runtime
    assembly / assemblyPackageScala / assembleArtifact := false,
    assembly / assemblyMergeStrategy := {
      case PathList(ps @ _*) if ps.contains("module-info.class") => MergeStrategy.first
      case x =>
        val oldStrategy = (assembly / assemblyMergeStrategy).value
        oldStrategy(x)
    }
  )
