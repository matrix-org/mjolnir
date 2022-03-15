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
from synapse.module_api import UserID

logger = logging.getLogger("synapse.contrib." + __name__)


class MessageMaxLength(object):
    """
    Limits the number of characters that can be in the body of an event.
    """

    def __init__(self, config, api):
        self.threshold: Option[int] = config.get("threshold", None)
        self.rooms: Set[str] = set(config.get("rooms", []))
        self.remote_servers: bool = config.get("remote_servers", False)
        self.api = api

    def check_event_for_spam(self, event: "synapse.events.EventBase") -> bool:
        if self.threshold is None:
            return False # not spam, MessageMaxLength hasn't been configured to do anything.

        sender = UserID.from_string(event.get("sender", ""))
        # check if the event is from us or we if we are limiting message length from remote servers too.
        if sender.domain == self.api.server_name or self.remote_servers:
            body = event.get("content", {}).get("body", "")
            if len(body) > self.threshold:
                room_id = event.get("room_id", "")
                if len(self.rooms) == 0 or room_id in self.rooms:
                    return True  # above the limit, spam

        return False  # not spam (as far as we're concerned)
