# -*- coding: utf-8 -*-
# Copyright 2019 The Matrix.org Foundation C.I.C.
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
from .list_rule import (
    ListRule,
    ALL_RULE_TYPES,
    USER_RULE_TYPES,
    SERVER_RULE_TYPES,
    ROOM_RULE_TYPES,
)
from twisted.internet import defer
from synapse.metrics.background_process_metrics import run_as_background_process

logger = logging.getLogger("synapse.contrib." + __name__)


class BanList(object):
    def __init__(self, api, room_id):
        self.api = api
        self.room_id = room_id
        self.server_rules = []
        self.user_rules = []
        self.room_rules = []
        self.build()

    def build(self, with_event=None):
        @defer.inlineCallbacks
        def run(with_event):
            events = yield self.get_relevant_state_events()
            if with_event is not None:
                events = [*events, with_event]
            self.server_rules = []
            self.user_rules = []
            self.room_rules = []
            for event in events:
                event_type = event.get("type", "")
                state_key = event.get("state_key", "")
                content = event.get("content", {})
                if state_key is None:
                    continue  # Some message event got in here?

                # Skip over events which are replaced by with_event. We do this
                # to ensure that when we rebuild the list we're using updated rules.
                if with_event is not None:
                    w_event_type = with_event.get("type", "")
                    w_state_key = with_event.get("state_key", "")
                    w_event_id = with_event.event_id
                    event_id = event.event_id
                    if (
                        w_event_type == event_type
                        and w_state_key == state_key
                        and w_event_id != event_id
                    ):
                        continue

                entity = content.get("entity", None)
                recommendation = content.get("recommendation", None)
                reason = content.get("reason", None)
                if entity is None or recommendation is None or reason is None:
                    continue  # invalid event

                logger.info(
                    "Adding rule %s/%s with action %s"
                    % (event_type, entity, recommendation)
                )
                rule = ListRule(
                    entity=entity, action=recommendation, reason=reason, kind=event_type
                )
                if event_type in USER_RULE_TYPES:
                    self.user_rules.append(rule)
                elif event_type in ROOM_RULE_TYPES:
                    self.room_rules.append(rule)
                elif event_type in SERVER_RULE_TYPES:
                    self.server_rules.append(rule)

        run_as_background_process("mjolnir_build_ban_list", run, with_event)

    def get_relevant_state_events(self):
        return self.api.get_state_events_in_room(
            self.room_id, [(t, None) for t in ALL_RULE_TYPES]
        )
