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
* [x] Command to actually unban users (instead of leaving them stuck)
* [x] Support multiple lists

Phase 3:
* [x] Synapse antispam module
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

## Synapse Antispam Module

First, install the module to your Synapse python environment:
```
pip install -e git+https://github.com/matrix-org/mjolnir.git#egg=mjolnir&subdirectory=synapse_antispam
```

*Note*: Where your python environment is depends on your installation method. Visit
[#synapse:matrix.org](https://matrix.to/#/#synapse:matrix.org) if you're not sure.

Then add the following to your `homeserver.yaml`:
```yaml
spam_checker:
  module: mjolnir.AntiSpam
  config:
    # Prevent servers/users in the ban lists from inviting users on this
    # server to rooms. Default true.
    block_invites: true
    # Flag messages sent by servers/users in the ban lists as spam. Currently
    # this means that spammy messages will appear as empty to users. Default
    # false.
    block_messages: false
    # The room IDs of the ban lists to honour. Unlike other parts of Mjolnir,
    # this list cannot be room aliases or permalinks. This server is expected
    # to already be joined to the room - Mjolnir will not automatically join
    # these rooms.
    ban_lists:
      - "!roomid:example.org"
```

Be sure to change the configuration to match your setup. Your server is expected to
already be participating in the ban lists - if it is not, you will need to have a user
on your homeserver join. The antispam module will not join the rooms for you.

If you change the configuration, you will need to restart Synapse. You'll also need
to restart Synapse to install the plugin.

## Development

TODO. It's a TypeScript project with a linter.
