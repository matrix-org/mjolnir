# mjolnir

A moderation tool for Matrix. Visit [#mjolnir:matrix.org](https://matrix.to/#/#mjolnir:matrix.org)
for more information.

## Features

As an all-in-one moderation tool, it can protect your server from malicious invites, spam
messages, and whatever else you don't want. In addition to server-level protection, Mjolnir
is great for communities wanting to protect their rooms without having to use their personal
accounts for moderation.

The bot by default includes support for bans, redactions, anti-spam, server ACLs, room
directory changes, room alias transfers, account deactivation, room shutdown, and more.

A Synapse module is also available to apply the same rulesets the bot uses across an entire
homeserver.

## Setting up

See the [setup documentation](docs/setup.md) for first-time setup documentation.

See the [configuration sample with documentation](config/default.yaml) for detailed information about Mjolnir's configuration.

See the [synapse module documentation](docs/synapse_module.md) for information on how to setup Mjolnir's accompanying Synapse Module.

## Quickstart guide

After your bot is up and running, you'll want to run a couple commands to get everything
set up:

1. `!mjolnir list create COC code-of-conduct-ban-list` - This will create a new ban list
   with the shortcode `COC` and an alias of `#code-of-conduct-ban-list:example.org`. You
   will be invited to the room it creates automatically where you can change settings such
   as the visibility of the room.
2. `!mjolnir default COC` - This sets the default ban list to the list we just created to
   help with the ban commands later on.
3. Review the [Moderator's Guide](https://github.com/matrix-org/mjolnir/blob/main/docs/moderators.md).
4. Review `!mjolnir help` to see what else the bot can do.

## Enabling readable abuse reports

Since version 1.2, Mjölnir offers the ability to replace the Matrix endpoint used
to report abuse and display it into a room, instead of requiring you to request
this data from an admin API.

This requires two configuration steps:

1. In your Mjölnir configuration file, typically `/etc/mjolnir/config/production.yaml`, copy and paste the `web` section from `default.yaml`, if you don't have it yet (it appears with version 1.20) and set `enabled: true` for both `web` and
`abuseReporting`.
2. Setup a reverse proxy that will redirect requests from `^/_matrix/client/(r0|v3)/rooms/([^/]*)/report/(.*)$` to `http://host:port/api/1/report/$2/$3`, where `host` is the host where you run Mjölnir, and `port` is the port you configured in `production.yaml`. For an example nginx configuration, see `test/nginx.conf`. It's the confirmation we use during runtime testing.

### Security note

This mechanism can extract some information from **unencrypted** rooms. We have
taken precautions to ensure that this cannot be abused: the only case in which
this feature will publish information from room *foo* is:

1. If it is used by a member of room *foo*; AND
2. If said member did witness the event; AND
3. If the event was unencrypted; AND
4. If the event was not redacted/removed/...

Essentially, this is a more restricted variant of the Admin APIs available on
homeservers.

However, if you are uncomfortable with this, please do not activate this feature.
Also, you should probably setup your `production.yaml` to ensure that the web
server can only receive requests from your reverse proxy (e.g. `localhost`).

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md).
