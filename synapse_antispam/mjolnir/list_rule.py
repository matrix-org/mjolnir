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

from synapse.util import glob_to_regex

RECOMMENDATION_BAN = "m.ban"
RECOMMENDATION_BAN_TYPES = [RECOMMENDATION_BAN, "org.matrix.mjolnir.ban"]

# Block a group of user ids.
RULE_USER = "m.room.rule.user"
USER_RULE_TYPES = [RULE_USER, "org.matrix.mjolnir.rule.user"]

# Block a group of rooms.
RULE_ROOM = "m.room.rule.room"
ROOM_RULE_TYPES = [RULE_ROOM, "org.matrix.mjolnir.rule.room"]

# Block a group of servers.
RULE_SERVER = "m.room.rule.server"
SERVER_RULE_TYPES = [RULE_SERVER, "org.matrix.mjolnir.rule.server"]

# Block from registration a group of emails.
RULE_REGISTRATION_EMAIL = "m.room.rule.registration.email"
REGISTRATION_EMAIL_RULE_TYPES = [RULE_REGISTRATION_EMAIL, "org.matrix.mjolnir.rule.registration.email"]

# Block from registration a group of IPs.
RULE_REGISTRATION_IP = "m.room.rule.registration.ip"
REGISTRATION_IP_RULE_TYPES = [RULE_REGISTRATION_IP, "org.matrix.mjolnir.rule.registration.ip"]

ALL_RULE_TYPES = [*USER_RULE_TYPES, *ROOM_RULE_TYPES, *SERVER_RULE_TYPES, *REGISTRATION_EMAIL_RULE_TYPES, *REGISTRATION_IP_RULE_TYPES]

def recommendation_to_stable(recommendation):
    if recommendation in RECOMMENDATION_BAN_TYPES:
        return RECOMMENDATION_BAN
    return None

def rule_type_to_stable(rule):
    if rule in USER_RULE_TYPES:
        return RULE_USER
    if rule in ROOM_RULE_TYPES:
        return RULE_ROOM
    if rule in SERVER_RULE_TYPES:
        return RULE_SERVER
    if rule in REGISTRATION_EMAIL_RULE_TYPES:
        return RULE_REGISTRATION_EMAIL
    if rule in REGISTRATION_IP_RULE_TYPES:
        return RULE_REGISTRATION_IP
    return None

class ListRule(object):
    def __init__(self, entity, action, reason, kind):
        self.entity = entity
        self.regex = glob_to_regex(entity)
        self.action = recommendation_to_stable(action)
        self.reason = reason
        self.kind = rule_type_to_stable(kind)

    def matches(self, victim):
        return self.regex.match(victim)
