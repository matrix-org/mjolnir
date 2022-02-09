# -*- coding: utf-8 -*-
# Copyright 2019-2022 The Matrix.org Foundation C.I.C.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
from typing import Dict, Union
from .list_rule import ALL_RULE_TYPES, RECOMMENDATION_BAN
from .ban_list import BanList
from synapse.types import UserID

logger = logging.getLogger("synapse.contrib." + __name__)


class AntiSpam(object):
    """
    Implements the old synapse spam-checker API, for compatibility with older configurations.

    See https://github.com/matrix-org/synapse/blob/master/docs/spam_checker.md
    """

    def __init__(self, config, api):
        self.block_invites = config.get("block_invites", True)
        self.block_messages = config.get("block_messages", False)
        self.block_usernames = config.get("block_usernames", False)
        self.list_room_ids = config.get("ban_lists", [])
        self.rooms_to_lists = {}  # type: Dict[str, BanList]
        self.api = api

        # Now we build the ban lists so we can match them
        self.build_lists()

    def build_lists(self):
        for room_id in self.list_room_ids:
            self.build_list(room_id)

    def build_list(self, room_id):
        logger.info("Rebuilding ban list for %s" % (room_id))
        self.get_list_for_room(room_id).build()

    def get_list_for_room(self, room_id):
        if room_id not in self.rooms_to_lists:
            self.rooms_to_lists[room_id] = BanList(api=self.api, room_id=room_id)
        return self.rooms_to_lists[room_id]

    def is_user_banned(self, user_id):
        for room_id in self.rooms_to_lists:
            ban_list = self.rooms_to_lists[room_id]
            for rule in ban_list.user_rules:
                if rule.matches(user_id):
                    return rule.action == RECOMMENDATION_BAN
        return False

    def is_room_banned(self, invite_room_id):
        for room_id in self.rooms_to_lists:
            ban_list = self.rooms_to_lists[room_id]
            for rule in ban_list.room_rules:
                if rule.matches(invite_room_id):
                    return rule.action == RECOMMENDATION_BAN
        return False

    def is_server_banned(self, server_name):
        for room_id in self.rooms_to_lists:
            ban_list = self.rooms_to_lists[room_id]
            for rule in ban_list.server_rules:
                if rule.matches(server_name):
                    return rule.action == RECOMMENDATION_BAN
        return False

    # --- spam checker interface below here ---

    def check_event_for_spam(self, event):
        room_id = event.get("room_id", "")
        event_type = event.get("type", "")
        state_key = event.get("state_key", None)

        # Rebuild the rules if there's an event for our ban lists
        if (
            state_key is not None
            and event_type in ALL_RULE_TYPES
            and room_id in self.list_room_ids
        ):
            logger.info("Received ban list event - updating list")
            self.get_list_for_room(room_id).build(with_event=event)
            return False  # Ban list updates aren't spam

        if not self.block_messages:
            return False  # not spam (we aren't blocking messages)

        sender = UserID.from_string(event.get("sender", ""))
        if self.is_user_banned(sender.to_string()):
            return True
        if self.is_server_banned(sender.domain):
            return True

        return False  # not spam (as far as we're concerned)

    def user_may_invite(self, inviter_user_id, invitee_user_id, room_id):
        if not self.block_invites:
            return True  # allowed (we aren't blocking invites)

        sender = UserID.from_string(inviter_user_id)
        if self.is_user_banned(sender.to_string()):
            return False
        if self.is_room_banned(room_id):
            return False
        if self.is_server_banned(sender.domain):
            return False

        return True  # allowed (as far as we're concerned)

    def check_username_for_spam(self, user_profile):
        if not self.block_usernames:
            return True  # allowed (we aren't blocking based on usernames)

        # Check whether the user ID or display name matches any of the banned
        # patterns.
        return self.is_user_banned(user_profile["user_id"]) or self.is_user_banned(
            user_profile["display_name"]
        )

    def user_may_create_room(self, user_id):
        return True  # allowed

    def user_may_create_room_alias(self, user_id, room_alias):
        return True  # allowed

    def user_may_publish_room(self, user_id, room_id):
        return True  # allowed

    @staticmethod
    def parse_config(config):
        return config  # no parsing needed


# New module API
class Module:
    """
    Our main entry point. Implements the Synapse Module API.
    """

    def __init__(self, config, api):
        self.antispam = AntiSpam(config, api)
        self.antispam.api.register_spam_checker_callbacks(
            check_event_for_spam=self.check_event_for_spam,
            user_may_invite=self.user_may_invite,
            check_username_for_spam=self.check_username_for_spam,
        )

    # Callbacks for `register_spam_checker_callbacks`
    # Note that these are `async`, by opposition to the APIs in `AntiSpam`.
    async def check_event_for_spam(
        self, event: "synapse.events.EventBase"
    ) -> Union[bool, str]:
        return self.antispam.check_event_for_spam(event)

    async def user_may_invite(
        self, inviter_user_id: str, invitee_user_id: str, room_id: str
    ) -> bool:
        return self.antispam.user_may_invite(inviter_user_id, invitee_user_id, room_id)

    async def check_username_for_spam(self, user_profile: Dict[str, str]) -> bool:
        return self.antispam.check_username_for_spam(user_profile)
