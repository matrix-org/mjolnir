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
      #message_max_length:
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