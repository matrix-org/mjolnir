# mjolnir

A moderation tool for Matrix. Visit [#mjolnir:matrix.org](https://matrix.to/#/#mjolnir:matrix.org)
for more information.

## Features

TODO: Describe what all this means.

Phase 1:
* [x] Ban users
* [x] ACL servers
* [x] Update lists with new bans/ACLs

Phase 2:
* [x] Pantalaimon support
* [x] No-op mode (for verifying behaviour)
* [x] Redact messages on ban (optionally)
* [x] More useful spam in management room
* [x] Command to import ACLs, etc from rooms
* [x] Vet rooms on startup option
* [ ] Command to actually unban users (instead of leaving them stuck)
* [x] Support multiple lists

Phase 3:
* [ ] Synapse antispam module
* [ ] Room upgrade handling (both protected+list rooms)
* [ ] Support community-defined scopes? (ie: no hardcoded config)
* [ ] Riot hooks (independent of mjolnir?)

## Docker (preferred)

Mjolnir is on Docker Hub as [matrixdotorg/mjolnir](https://hub.docker.com/r/matrixdotorg/mjolnir)
but can be built yourself with `docker build -t mjolnir .`.

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

# Copy and edit the config. It is not recommended to change the data path.
mkdir -p /etc/mjolnir
cp config/default.yaml /etc/mjolnir/production.yaml
nano /etc/mjolnir/production.yaml

docker run --rm -it -v /etc/mjolnir:/data matrixdotorg/mjolnir:latest
```

## Build it

This bot requires `yarn` and Node 10.

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

yarn install
yarn build

# Copy and edit the config. It *is* recommended to change the data path.
cp config/default.yaml config/development.yaml
nano config/development.yaml

node lib/index.js
```

## Development

TODO. It's a TypeScript project with a linter.
