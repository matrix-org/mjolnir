# Moderator's guide to Mjolnir (bot edition)

Moderating a community shouldn't be difficult - Mjolnir gives you the tools to make moderation simple and
impersonal.

**Note**: This guide does not apply to the Synapse module, which applies rules at the homeserver level. More
information about the Synapse module can be found in the README.

## Quick usage

If you're actively dealing with an incident, here's what you need to know:

* Always talk to Mjolnir in your coordination room.
* `!mjolnir rooms add <room>` will add a room to your "protected rooms", rooms where mjolnir will propagate bans.
* `!mjolnir ban <shortcode> user @spammer:example.org` will ban someone.
* `!mjolnir ban <shortcode> server example.org` will ban a whole server.
* `!mjolnir rules` will tell you what the shortcodes are for your ban lists (needed above).
* `!mjolnir redact @spammer:example.org #room:example.org` will redact someone's posts in a specific room.
* `!mjolnir redact @spammer:example.org` will redact someone's posts in all rooms Mjolnir protects.
* `!mjolnir protections` will show you your available protections - green circles mean enabled.
* `!mjolnir enable <protection>` to turn on a protection.
* `!mjolnir move <room alias> <room alias/ID>` Moves a room alias to a new room ID
* `!mjolnir verify` makes sure the bot has all required permissions to enact moderation (in all the protected rooms).

## How Mjolnir works

Mjolnir uses rules to define its behaviours, with rules defined in ban lists. The rules Mjolnir gets from
ban lists are additive, meaning they cannot be cancelled out. The first rule that matches will be the one
that bans an entity.

Entities are rooms, users, and servers. The Mjolnir bot only handles users and servers, representing them
as membership bans and server ACLs. ACLs are automatically applied because the rules transfer directly into
the ACL format while membership bans are applied on sight. Within Matrix it is not currently possible to
ban a set of users by glob/regex, so Mjolnir monitors the rooms it protects for membership changes and
bans people who match rules when they join/are invited.

Mjolnir can run through Pantalaimon if your coordination room is encrypted (this is recommended). Your
coordination/management room is where you and all of your moderators can speak to Mjolnir and update the
rules it uses. Be sure to keep this room private to avoid unauthorized access to the bot.

Note that Mjolnir performs all its moderation actions as itself rather than encouraging you to use your
own personal account. Banning someone with a personal account can feel like a targeted attack, leading to
further abuse sent to you - using a bot can sometimes diminish the effect. You're welcome to ban someone
without using Mjolnir - the bot won't interfere.

## List management

Mjolnir can manage ban lists created through commands. These ban lists can be shared with the general
public or kept private for internal reference. Lists that can be managed are referenced by shortcode - a
string that identifies the room without spaces. For example, a terms of service list might have the shortcode
`tos`.

To create a new list, run `!mjolnir list create tos terms-of-service-bans`. This creates a new list with
the shortcode `tos` and the alias `#terms-of-service-bans:yourserver.org`. Bans can then be added with
`!mjolnir ban tos user @spammer:example.org` (see `!mjolnir help` for full command reference).

Mjolnir can also watch other people's ban lists through `!mjolnir watch #matrix-org-bans:example.org`.
To unsubscribe, use `!mjolnir unwatch #list:example.org`.

## Bans

Bans are appended to ban lists and enforced immediately. There are three kinds of bans that can be issued:
user, server, and room. Currently the bot won't act upon room bans, but other parts of Mjolnir might. As
mentioned earlier, user and server bans are enforced at the room level through existing support in Matrix.

Bans support wildcards (`*`) as well, allowing you to ban entire subdomains where required. If you wanted
to ban all of example.org for instance, you'd ban `example.org` and `*.example.org`.

To issue a ban, use `!mjolnir ban <shortcode> <entity> <glob> [reason]`. Reasons are optional. For example:
`!mjolnir ban tos server *.example.org Known for spam` to ban the `*.example.org` server for spam.

If you've banned someone from mistake, you can remove the rule from the ban list using the unban command:
`!mjolnir unban <shortcode> <entity> <glob> [apply]`. Note that this just removes the rule and might not
cause an unban because another list may still ban the entity. The `[apply]` argument can be specified as `true`
or `false` (default `false`) then the unban is applied immediately regardless of rules, though the unban
might be reversed immediately afterwards due to another rule banning the entity.

Rules (bans) can be imported with `!mjolnir import <room alias/ID> <shortcode>` - this will inspect the
room's state and generate rules for `<shortcode>` to populate.

## Redactions

Often it is desirable to remove some content without having to do it yourself. Mjolnir can look up past
events sent by a user and redact them with `!mjolnir redact @spammer:example.org #room:example.org`. If
you want to redact events by that person from all protected rooms, don't specify a room at the end.

## Management

Sometimes you might want to see what Mjolnir is up to. There's some commands in `!mjolnir help` that could
be of use to you, such as `!mjolnir rules` to see what rules it is actually enforcing and `!mjolnir status`
to see if Mjolnir is even running where you expect it to.

Adding protected rooms on the fly is as easy as `!mjolnir rooms add <room alias>`. You can see all the rooms
which are protected with `!mjolnir rooms`, and remove a room with `!mjolnir rooms remove <room alias>`. Note
that rooms which are listed in the config may be protected again when the bot restarts - to remove these rooms
permanently from protection, remove them from the config.

## Trusted Reporters

Mjolnir has an (optional) system in which it will poll Synapse for new reports, and when it sees sufficient
amounts of reports from trusted users on an given message, it will take an action, such as redacting the message.

The users to trust, the actions to take, and the thresholds needed for those actions are configurable.

Prerequisites:
* `pollReport: true` in Mjolnir config file
* restart Mjolnir
* `!mjolnir enable TrustedReporters`
* `!mjolnir config add TrustedReporters.mxids @trusteduser:example.com`
* `!mjolnir config set TrustedReporters.alertThreshold 3`

TrustedReporters supports 3 different thresholds; `alertThreshold`, `redactThreshold`, and `banThreshold`.
By default, only `alertThreshold` is enabled, and is set to `3`. Mjolnir will only consider reports that
take place in rooms Mjolnir is protecting. `alertThreshold` is separate from Mjolnir's ability to log
each report, which is `displayReports` in Mjolnir's config file.

Make sure that anything you have sat in front of Synapse (e.g. nginx) is correctly configured to forward
`/_synapse/admin/v1/event_reports` and `/_synapse/admin/v1/rooms/${room_id}/context/${revent_id}` to
Synapse, or Mjolnir will not be able to poll for new reports. Mjolnir polls for new reports every 30 seconds.
