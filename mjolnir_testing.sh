#!/bin/bash
# This script only exists so that the persitent state in volumes
# is removed. Eventually this should be moved to a module
# managing the integration tests.
cleanup () {
    set +e
    rm -f docker/synapse-data/homeserver.db
    set -e
}

case "$1" in
    up)
        cleanup
        exec docker-compose up
        ;;
    down)
        exec docker-compose down
        ;;
    *)
        echo "Usage: $SCRIPTNAME {up|down}" >&2
        exit 3
        ;;
esac
