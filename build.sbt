import Dependencies._

ThisBuild / scalaVersion     := "3.8.4"
ThisBuild / version          := "1.0.0-dev"
ThisBuild / organization     := "com.cloud-apim"
ThisBuild / organizationName := "Cloud-APIM"

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
      "fr.maif" %% "otoroshi" % "18.0.0-rc1" % "provided",
      munit % Test,
    ),
    // otoroshi discovers extensions, plugins and jobs by scanning the classpath reflectively, which the
    // layered test class loader defeats: the extension's own classes live in a layer the scan cannot see
    Test / classLoaderLayeringStrategy := ClassLoaderLayeringStrategy.Flat,
    Test / parallelExecution := false,
  )
