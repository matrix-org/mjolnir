# -*- coding: utf-8 -*-
# Copyright 2019, 2020 The Matrix.org Foundation C.I.C.
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
import re
from synapse.types import UserID
from twisted.internet import task, reactor, defer

logger = logging.getLogger("synapse.contrib." + __name__)

class AntiSpam(object):
    def __init__(self, config, api):
        self._api = api
        self._config = config

        # Start a timer to rip the new rules off the server. We hit the rule server
        # often to avoid missing rules - the response should be tens of milliseconds
        # in duration, though network issues are possible - Twisted should automatically
        # stack the calls for us.
        # HACK: Private member access (_hs)
        api._hs.get_clock().looping_call(self._update_rules, 5 * 1000)

        # These are all arrays of compile()'d code from the ban list server.
        # First match wins. See _update_rules() for more info.
        self._code_spam_checks = []
        self._code_invite_checks = []
        self._code_profile_checks = []
        self._code_create_room_checks = []
        self._code_create_alias_checks = []
        self._code_publish_room_checks = []

    def _update_rules(self):
        async def run():
            try:
                logger.info("Updating mjolnir rules...")

                # HACK: Private member access (_hs)
                resp = await self._api._hs.get_proxied_http_client().get_json(self._config['rules_url'])

                # *** !! DANGER !! ***
                # We're about to trust that the admin has secured their network appropriately and
                # that the values returned by the configurable URL are safe to execute as real
                # python code. We're using eval(), which should mean that it can only be expressions,
                # however there is still risk of damages. We are knowingly processing the strings
                # returned and assuming they won't try to take control of the homeserver, or worse.
                # *** !! DANGER !! ***

                self._code_spam_checks = self._compile_rules(resp['checks']['spam'])
                self._code_invite_checks = self._compile_rules(resp['checks']['invites'])
                self._code_profile_checks = self._compile_rules(resp['checks']['profiles'])
                self._code_create_room_checks = self._compile_rules(resp['checks']['createRoom'])
                self._code_create_alias_checks = self._compile_rules(resp['checks']['createAlias'])
                self._code_publish_room_checks = self._compile_rules(resp['checks']['publishRoom'])

                logger.info("Updated mjolnir rules")
            except Exception as e:
                logger.warning("Error updating mjolnir rules: %s", e)

        return defer.ensureDeferred(run())

    def _compile_rules(self, rules):
        return [{
            "search": compile(rule["search"], '<string>', 'eval'),
            "pattern": rule["pattern"],
        } for rule in rules]

    # --- spam checker interface below here ---

    def check_event_for_spam(self, event):
        for check in self._code_spam_checks:
            params = {
                "event": event,
                "UserID": UserID,
            }
            search = eval(check["search"], {}, params)
            if re.search(check["pattern"], search):
                return True  # is spam

        return False  # not spam (as far as we're concerned)

    def user_may_invite(self, inviter_user_id, invitee_user_id, room_id):
        for check in self._code_invite_checks:
            params = {
                "inviter_user_id": inviter_user_id,
                "invitee_user_id": invitee_user_id,
                "room_id": room_id,
                "UserID": UserID,
            }
            search = eval(check["search"], {}, params)
            if re.search(check["pattern"], search):
                return False  # is spam

        return True  # allowed (as far as we're concerned)

    def check_username_for_spam(self, user_profile):
        for check in self._code_profile_checks:
            params = {
                "user_profile": user_profile,
                "UserID": UserID,
            }
            search = eval(check["search"], {}, params)
            if re.search(check["pattern"], search):
                return False  # is spam

        return True  # allowed (as far as we're concerned)

    def user_may_create_room(self, user_id):
        for check in self._code_create_room_checks:
            params = {
                "user_id": user_id,
                "UserID": UserID,
            }
            search = eval(check["search"], {}, params)
            if re.search(check["pattern"], search):
                return False  # is spam

        return True  # allowed (as far as we're concerned)

    def user_may_create_room_alias(self, user_id, room_alias):
        for check in self._code_create_alias_checks:
            params = {
                "user_id": user_id,
                "room_alias": room_alias,
                "UserID": UserID,
            }
            search = eval(check["search"], {}, params)
            if re.search(check["pattern"], search):
                return False  # is spam

        return True  # allowed (as far as we're concerned)

    def user_may_publish_room(self, user_id, room_id):
        for check in self._code_publish_room_checks:
            params = {
                "user_id": user_id,
                "room_id": room_id,
                "UserID": UserID,
            }
            search = eval(check["search"], {}, params)
            if re.search(check["pattern"], search):
                return False  # is spam

        return True  # allowed (as far as we're concerned)

    @staticmethod
    def parse_config(config):
        return config  # no parsing needed
