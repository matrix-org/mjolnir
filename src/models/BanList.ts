/*
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { LogService, MatrixClient } from "matrix-bot-sdk";
import { ListRule } from "./ListRule";

export const RULE_USER = "m.room.rule.user";
export const RULE_ROOM = "m.room.rule.room";
export const RULE_SERVER = "m.room.rule.server";
export const RULE_REGISTRATION_EMAIL = "m.room.rule.registration.email";
export const RULE_REGISTRATION_IP = "m.room.rule.registration.ip";

export const USER_RULE_TYPES = [RULE_USER, "org.matrix.mjolnir.rule.user"];
export const ROOM_RULE_TYPES = [RULE_ROOM, "org.matrix.mjolnir.rule.room"];
export const SERVER_RULE_TYPES = [RULE_SERVER, "org.matrix.mjolnir.rule.server"];
export const REGISTRATION_EMAIL_RULE_TYPES = [RULE_REGISTRATION_EMAIL, "org.matrix.mjolnir.rule.registration.email"];
export const REGISTRATION_IP_RULE_TYPES = [RULE_REGISTRATION_IP, "org.matrix.mjolnir.rule.registration.ip"];

export const ALL_RULE_TYPES = [...USER_RULE_TYPES, ...ROOM_RULE_TYPES, ...SERVER_RULE_TYPES, ...REGISTRATION_EMAIL_RULE_TYPES, ...REGISTRATION_IP_RULE_TYPES];
const LABELED_RULE_TYPES = Object.freeze([
    {types: USER_RULE_TYPES, key: RULE_USER},
    {types: ROOM_RULE_TYPES, key: RULE_ROOM},
    {types: SERVER_RULE_TYPES, key: RULE_SERVER},
    {types: REGISTRATION_EMAIL_RULE_TYPES, key: RULE_REGISTRATION_EMAIL},
    {types: REGISTRATION_IP_RULE_TYPES, key: RULE_REGISTRATION_IP},
]);

export const SHORTCODE_EVENT_TYPE = "org.matrix.mjolnir.shortcode";


export function ruleTypeToStable(rule: string, unstable = true): string {
    for (let {types, key} of LABELED_RULE_TYPES) {
        if (types.includes(rule)) {
            if (unstable) {
                return types[types.length - 1];
            } else {
                return key;
            }
        }
    }
    return null;
}

export default class BanList {
    private rules: ListRule[] = [];
    private shortcode: string = null;

    constructor(public readonly roomId: string, public readonly roomRef, private client: MatrixClient) {
    }

    public get listShortcode(): string {
        return this.shortcode || '';
    }

    public set listShortcode(newShortcode: string) {
        const currentShortcode = this.shortcode;
        this.shortcode = newShortcode;
        this.client.sendStateEvent(this.roomId, SHORTCODE_EVENT_TYPE, '', {shortcode: this.shortcode}).catch(err => {
            LogService.error("BanList", err);
            if (this.shortcode === newShortcode) this.shortcode = currentShortcode;
        });
    }

    public get serverRules(): ListRule[] {
        return this.rules.filter(r => r.kind === RULE_SERVER);
    }

    public get userRules(): ListRule[] {
        return this.rules.filter(r => r.kind === RULE_USER);
    }

    public get roomRules(): ListRule[] {
        return this.rules.filter(r => r.kind === RULE_ROOM);
    }

    public get allRules(): ListRule[] {
        return [...this.serverRules, ...this.userRules, ...this.roomRules];
    }

    public async updateList() {
        this.rules = [];

        const state = await this.client.getRoomState(this.roomId);
        for (const event of state) {
            if (event['state_key'] === '' && event['type'] === SHORTCODE_EVENT_TYPE) {
                this.shortcode = (event['content'] || {})['shortcode'] || null;
                continue;
            }

            if (event['state_key'] === '' || !ALL_RULE_TYPES.includes(event['type'])) {
                continue;
            }

            let kind: string = null;
            for (let {types, key} of LABELED_RULE_TYPES) {
                if (types.includes(event['type'])) {
                    kind = key;
                    break;
                }
            }
            if (kind == null) {
                continue; // invalid/unknown
            }

            // It's a rule - parse it
            const content = event['content'];
            if (!content) continue;

            const entity = content['entity'];
            const recommendation = content['recommendation'];
            const reason = content['reason'] || '<no reason>';

            if (!entity || !recommendation) {
                continue;
            }

            this.rules.push(new ListRule(entity, recommendation, reason, kind));
        }
    }
}
