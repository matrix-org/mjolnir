#!/bin/sh

# This is used as the entrypoint in the mjolnir Dockerfile.
# We want to transition away form people running the image without specifying `bot` or `appservice`.
# So if eventually cli arguments are provided for the bot version, we want this to be the opportunity to move to `bot`.
# Therefore using arguments without specifying `bot` (or appservice) is unsupported.
# We maintain the behaviour where if it looks like someone is providing an executable to `docker run`, then we will execute that instead.
# This aids configuration and debugging of the image if for example node needed to be started via another method.
case "$1" in
  bot) shift; set -- node /mjolnir/index.js "$@";;
  appservice) shift; set -- node /mjolnir/appservice/cli.js "$@";;
esac

exec "$@";
