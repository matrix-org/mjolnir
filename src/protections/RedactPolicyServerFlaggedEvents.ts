/*
Copyright 2025 The Matrix.org Foundation C.I.C.

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

import { Protection } from "./IProtection";
import { Mjolnir } from "../Mjolnir";

export class RedactPolicyServerFlaggedEvents extends Protection {
    settings = {};

    public get name(): string {
        return "RedactPolicyServerFlaggedEvents";
    }

    public get description(): string {
        return "Redacts events that are flagged by the policy server as probable spam. Requires enabling the policy_server_spammy Synapse extension (see help command for info).";
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event["unsigned"]?.["io.element.synapse.policy_server_spammy"] === true) {
            console.log(`Redacting ${event["event_id"]} in ${roomId} due to policy server flagging it as spam.`);
            await mjolnir.client.redactEvent(roomId, event["event_id"], "Probable spam");
        }
    }
}
