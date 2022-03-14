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

## Bot configuration

It is recommended to use [Pantalaimon](https://github.com/matrix-org/pantalaimon) so your
management room can be encrypted. This also applies if you are looking to moderate an encrypted
room. 

If you aren't using encrypted rooms anywhere, get an access token by opening Riot in an
incognito/private window and log in as the bot. From the Help & Support tab in settings there
is an access token field - copy and paste that into your config. Most importantly: do not log
out and instead just close the window. Logging out will make the token you just copied useless.

**Note**: Mjolnir expects to be free of rate limiting - see [Synapse #6286](https://github.com/matrix-org/synapse/issues/6286)
for information on how to achieve this.

**Note**: To deactivate users, move aliases, shutdown rooms, etc Mjolnir will need to be a server
admin.

## Docker installation (preferred)

Mjolnir is on Docker Hub as [matrixdotorg/mjolnir](https://hub.docker.com/r/matrixdotorg/mjolnir)
but can be built yourself with `docker build -t mjolnir .`.

```bash
git clone https://github.com/matrix-org/mjolnir.git
cd mjolnir

# Copy and edit the config. It is not recommended to change the data path.
mkdir -p /etc/mjolnir/config
cp config/default.yaml /etc/mjolnir/config/production.yaml
nano /etc/mjolnir/config/production.yaml

docker run --rm -it -v /etc/mjolnir:/data matrixdotorg/mjolnir:latest
```

## Build it (alternative installation)

This bot requires `yarn` and Node 14.

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

## Synapse Module

**This requires Synapse 1.53.0 or higher**

Using the bot to manage your rooms is great, however if you want to use your ban lists
(or someone else's) on your server to affect all of your users then a Synapse module
is needed. Primarily meant to block invites from undesired homeservers/users, Mjolnir's
Synapse module is a way to interpret ban lists and apply them to your entire homeserver.

First, install the module to your Synapse python environment:
```
pip install -e "git+https://github.com/matrix-org/mjolnir.git#egg=mjolnir&subdirectory=synapse_antispam"
```

*Note*: Where your python environment is depends on your installation method. Visit
[#synapse:matrix.org](https://matrix.to/#/#synapse:matrix.org) if you're not sure.

Then add the following to your `homeserver.yaml`:
```yaml
modules:
  - module: mjolnir.Module
    config:
      # Prevent servers/users in the ban lists from inviting users on this
      # server to rooms. Default true.
      block_invites: true
      # Flag messages sent by servers/users in the ban lists as spam. Currently
      # this means that spammy messages will appear as empty to users. Default
      # false.
      block_messages: false
      # Remove users from the user directory search by filtering matrix IDs and
      # display names by the entries in the user ban list. Default false.
      block_usernames: false
      # The room IDs of the ban lists to honour. Unlike other parts of Mjolnir,
      # this list cannot be room aliases or permalinks. This server is expected
      # to already be joined to the room - Mjolnir will not automatically join
      # these rooms.
      ban_lists:
         - "!roomid:example.org"
      message_max_length:
         # Limit the characters in a message (event body) that a client can send in an event on this server.
         # By default there is no limit (beyond the the limit the spec enforces on event size).
         # Uncomment if you want messages to be limited to 510 characters.
         #threshold: 510

         # Limit messages only in certain rooms rooms.
         # By default all rooms will enforce the limit.
         # Uncomment if you want messages to only be subject to character limits in certain rooms.
         #rooms:
         #  - "!vMvyOCeCxHsggkmALd:localhost:9999"

         # Also hide messages from remote servers that are over the `message_limit`.
         # By default only events from this server will be limited.
         # WARNING: Remote users on other servers will still be able to messages over the limit.
         # Uncomment to enforce the `message_limit` on events from remote servers.
         #remote_servers: true
```

*Note*: Although this is described as a "spam checker", it does much more than fight
spam.

Be sure to change the configuration to match your setup. Your server is expected to
already be participating in the ban lists - if it is not, you will need to have a user
on your homeserver join. The antispam module will not join the rooms for you.

If you change the configuration, you will need to restart Synapse. You'll also need
to restart Synapse to install the plugin.

## Enabling readable abuse reports

Since version 1.2, Mjölnir offers the ability to replace the Matrix endpoint used
to report abuse and display it into a room, instead of requiring you to request
this data from an admin API.

This requires two configuration steps:

1. In your Mjölnir configuration file, typically `/etc/mjolnir/config/production.yaml`, copy and paste the `web` section from `default.yaml`, if you don't have it yet (it appears with version 1.20) and set `enabled: true` for both `web` and
`abuseReporting`.
2. Setup a reverse proxy that will redirect requests from `^/_matrix/client/r0/rooms/([^/]*)/report/(.*)$` to `http://host:port/api/1/report/$1/$2`, where `host` is the host where you run Mjölnir, and `port` is the port you configured in `production.yaml`. For an example nginx configuration, see `test/nginx.conf`. It's the confirmation we use during runtime testing.

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

TODO. It's a TypeScript project with a linter.

### Development and testing with mx-tester

WARNING: mx-tester is currently work in progress, but it can still save you some time and is better than struggling with nothing.

If you have docker installed you can quickly get setup with a development environment by using
[mx-tester](https://github.com/matrix-org/mx-tester).

To use mx-tester you will need to have rust installed. You can do that at [rustup](https://rustup.rs/) or [here](https://rust-lang.github.io/rustup/installation/other.html), you should probably also check your distro's documentation first to see if they have specific instructions for installing rust.

Once rust is installed you can install mx-tester like so.

```
$ cargo install mx-tester
```

Once you have mx-tester installed you we will want to build a synapse image with synapse_antispam from the mjolnir project root.

```
$ mx-tester build
```

Then we can start a container that uses that image and the config in `mx-tester.yml`.

```
$ mx-tester up
```

Once you have called `mx-tester up` you can run the integration tests.
```
$ yarn test:integration
```

After calling `mx-tester up`, if we want to play with mojlnir locally we can run the following and then point a matrix client to http://localhost:9999.
You should then be able to join the management room at `#moderators:localhost:9999`.

```
yarn test:manual
```

Once we are finished developing we can stop the synapse container.

```
mx-tester down
```

### Running integration tests

The integration tests can be run with `yarn test:integration`.
The config that the tests use is in `config/harness.yaml`
and by default this is configured to work with the server specified in `mx-tester.yml`,
but you can configure it however you like to run against your own setup. 
