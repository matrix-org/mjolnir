# mjolnir

A moderation tool for Matrix.

## Features

TODO: Describe what all this means.

Phase 1:
* [ ] Ban users
* [x] ACL servers
* [x] Update lists with new bans/ACLs
* [ ] "Ban on sight" mode (rather than proactive)

Phase 2:
* [ ] Synapse antispam module
* [ ] Riot hooks (independent of mjolnir?)
* [ ] Support community-defined scopes? (ie: no hardcoded config)
* [ ] Vet rooms on startup option
* [ ] Room upgrade handling (both protected+list rooms)

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
