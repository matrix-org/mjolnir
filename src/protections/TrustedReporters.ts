/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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
import { MXIDListProtectionSetting, NumberProtectionSetting } from "./ProtectionSettings";
import { Mjolnir } from "../Mjolnir";

const MAX_REPORTED_EVENT_BACKLOG = 20;

/*
 * Hold a list of users trusted to make reports, and enact consequences on
 * events that surpass configured report count thresholds
 */
export class TrustedReporters extends Protection {
    private recentReported = new Map<string /* eventId */, Set<string /* reporterId */>>();

    settings = {
        mxids: new MXIDListProtectionSetting(),
        alertThreshold: new NumberProtectionSetting(3),
        // -1 means 'disabled'
        redactThreshold: new NumberProtectionSetting(-1),
        banThreshold: new NumberProtectionSetting(-1)
    };

    constructor() {
        super();
    }

    public get name(): string {
        return 'TrustedReporters';
    }
    public get description(): string {
        return "Count reports from trusted reporters and take a configured action";
    }

    public async handleReport(mjolnir: Mjolnir, roomId: string, reporterId: string, event: any, reason?: string): Promise<any> {
        if (!this.settings.mxids.value.includes(reporterId)) {
            // not a trusted user, we're not interested
            return
        }

        let reporters = this.recentReported.get(event.id);
        if (reporters === undefined) {
            // first report we've seen recently for this event
            reporters = new Set<string>();
            this.recentReported.set(event.id, reporters);
            if (this.recentReported.size > MAX_REPORTED_EVENT_BACKLOG) {
                // queue too big. push the oldest reported event off the queue
                const oldest = Array.from(this.recentReported.keys())[0];
                this.recentReported.delete(oldest);
            }
        }

        reporters.add(reporterId);

        let met: string[] = [];
        if (reporters.size === this.settings.alertThreshold.value) {
            met.push("alert");
            // do nothing. let the `sendMessage` call further down be the alert
        }
        if (reporters.size === this.settings.redactThreshold.value) {
            met.push("redact");
            await mjolnir.client.redactEvent(roomId, event.id, "abuse detected");
        }
        if (reporters.size === this.settings.banThreshold.value) {
            met.push("ban");
            await mjolnir.client.banUser(event.userId, roomId, "abuse detected");
        }


        if (met.length > 0) {
            await mjolnir.client.sendMessage(mjolnir.config.managementRoom, {
                msgtype: "m.notice",
                body: `message ${event.id} reported by ${[...reporters].join(', ')}. `
                    + `actions: ${met.join(', ')}`
            });
        }
    }
}
