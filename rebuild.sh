#!/usr/bin/env bash
# Packages the extension jar, links it into the dev otoroshi and nudges otoroshi into reloading it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OTOROSHI="${OTOROSHI_HOME:-$HERE/../otoroshi/otoroshi}"
JAR="$HERE/target/scala-3.8.4/otoroshi-clevercloud-reaper_3-dev.jar"
LINK="$OTOROSHI/lib/vendor-clevercloud-reaper.jar"

(cd "$HERE" && sbt package)

if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  echo "$LINK exists and is not a symlink, leaving it alone" >&2
  exit 1
fi
if [ "$(readlink "$LINK" 2>/dev/null)" != "$JAR" ]; then
  ln -sfn "$JAR" "$LINK"
  echo "linked $LINK -> $JAR"
fi

date > "$OTOROSHI/app/reload.diff"
