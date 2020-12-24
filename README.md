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

## Quickstart guide

After your bot is up and running, you'll want to run a couple commands to get everything
set up:

1. `!mjolnir list create COC code-of-conduct-ban-list` - This will create a new ban list
   with the shortcode `COC` and an alias of `#code-of-conduct-ban-list:example.org`. You
   will be invited to the room it creates automatically where you can change settings such
   as the visibility of the room.
2. `!mjolnir default COC` - This sets the default ban list to the list we just created to
   help with the ban commands later on.
3. Review the [Moderator's Guide](https://github.com/matrix-org/mjolnir/blob/master/docs/moderators.md).
4. Review `!mjolnir help` to see what else the bot can do.

## Synapse Module

Using the bot to manage your rooms is great, however if you want to use your ban lists
(or someone else's) on your server to affect all of your users then a Synapse module
is needed. Primarily meant to block invites from undesired homeservers/users, Mjolnir's
Synapse module is a way to interpret ban lists and apply them to your entire homeserver.

**Warning**: This module works by running generated Python code in your homeserver. The code
is generated based off the rules provided in the ban lists, which may include crafted rules
which may allow unrestricted access to your server. Only use lists you trust and do not
use anyone else's infrastructure to get the ruleset from - only use infrastructure that
you control.

If this is acceptable, the following steps may be performed.

First, run the Docker image for the rule server. This is what will be serving the generated
Python for the Synapse antispam module to read from. This rule server will serve the Python
off a webserver at `/api/v1/py_rules` which must be accessible by wherever Synapse is installed.
It is not recommended to expose this webserver to the outside world.

```
docker run --rm -d -v /etc/mjolnir/ruleserver.yaml:/data/config/production.yaml -p 127.0.0.0:8080:8080 matrixdotorg/mjolnir
```

**Note**: the exact same Mjolnir image is used to run the rule server. To configure using the rule
server instead of the bot function, see the `ruleServer` options in the config.

After that is running, install the module to your Synapse python environment:
```
pip install -e "git+https://github.com/matrix-org/mjolnir.git#egg=mjolnir&subdirectory=synapse_antispam"
```

*Note*: Where your python environment is depends on your installation method. Visit
[#synapse:matrix.org](https://matrix.to/#/#synapse:matrix.org) if you're not sure.

Then add the following to your `homeserver.yaml`:
```yaml
spam_checker:
  - module: mjolnir.AntiSpam
    config:
      # Where the antispam module should periodically retrieve updated rules from. This
      # should be pointed at the Mjolnir rule server.
      rules_url: 'http://localhost:8080/api/v1/py_rules'
```

*Note*: Although this is described as a "spam checker", it does much more than fight
spam.

Be sure to change the configuration to match your setup. If you change the configuration, 
you will need to restart Synapse. You'll also need to restart Synapse to install the plugin.

## Development

TODO. It's a TypeScript project with a linter.
