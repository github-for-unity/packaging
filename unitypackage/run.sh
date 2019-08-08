#!/bin/sh
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
pushd $DIR
if [ ! -d 'node_modules' ]; then node ../yarn.js install --prefer-offline; fi
src/index.ts $@
popd