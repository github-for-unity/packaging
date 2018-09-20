#!/bin/sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
pushd $DIR
node ./yarn.js install --prefer-offline
./package-octorun.ts $@
popd