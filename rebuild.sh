#!/usr/bin/env bash
# Assembles the extension jar, links it into the dev otoroshi (once) and nudges otoroshi into
# reloading it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OTOROSHI="${OTOROSHI_HOME:-$HERE/../otoroshi/otoroshi}"
JAR="$HERE/target/scala-3.8.4/otoroshi-clevercloud-reaper-assembly_3-dev.jar"
LINK="$OTOROSHI/lib/vendor-clevercloud-reaper.jar"

(cd "$HERE" && sbt assembly)

if [ ! -L "$LINK" ]; then
  if [ -e "$LINK" ]; then
    echo "$LINK exists and is not a symlink, leaving it alone" >&2
    exit 1
  fi
  ln -s "$JAR" "$LINK"
  echo "linked $LINK -> $JAR"
fi

date > "$OTOROSHI/app/reload.diff"
