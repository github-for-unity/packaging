#!/bin/sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
pushd $DIR
node ./yarn-1.7.0.js install --offline
./package-octorun.ts $@
popd