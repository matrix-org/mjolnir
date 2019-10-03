# mjolnir

A moderation tool for Matrix.

## Features

TODO: Describe what all this means.

Phase 1:
* [x] Ban users
* [x] ACL servers
* [x] Update lists with new bans/ACLs

Phase 2:
* [x] Pantalaimon support
* [ ] Redact messages on ban (optionally)
* [ ] Less spam in management room
* [ ] Vet rooms on startup option
* [ ] Room upgrade handling (both protected+list rooms)
* [ ] Command to actually unban users (instead of leaving them stuck)

Phase 3:
* [ ] Synapse antispam module
* [ ] Support community-defined scopes? (ie: no hardcoded config)
* [ ] Riot hooks (independent of mjolnir?)

## Docker (preferred)

Mjolnir does not yet have its own image published.

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

docker build -t mjolnir .

# Copy and edit the config. It is not recommended to change the data path.
mkdir -p /etc/mjolnir
cp config/default.yaml /etc/mjolnir/production.yaml
nano /etc/mjolnir/production.yaml

docker run --rm -it -v /etc/mjolnir:/data mjolnir
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
