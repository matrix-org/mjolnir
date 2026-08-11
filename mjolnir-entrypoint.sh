#!/bin/sh

# This is used as the entrypoint in the mjolnir Dockerfile.
# If it looks like someone is providing an executable to `docker run` instead of `bot`, then we
# will execute that instead. This aids configuration and debugging of the image, for example if
# node needed to be started via another method.
case "$1" in
  bot) shift; set -- node /mjolnir/index.js "$@";;
  appservice)
    echo "appservice mode has been removed from Mjolnir. Use \`bot\` instead." >&2
    exit 1
    ;;
esac

exec "$@";
