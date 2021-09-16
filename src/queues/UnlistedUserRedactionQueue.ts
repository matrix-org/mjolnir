/*
Copyright 2019-2021 The Matrix.org Foundation C.I.C.

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
import { extractRequestError, LogLevel, LogService, MatrixClient, Permalinks } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";
import config from "../config";

/**
 * A queue of users who have been flagged for redaction typically by the flooding or image protection.
 * Specifically any new events sent by a queued user will be redacted.
 * This does not handle previously sent events, for that see the `EventRedactionQueue`.
 * These users are not listed as banned in any watch list and so may continue
 * to view a room until a moderator can investigate.
 */
export class UnlistedUserRedactionQueue {
    private usersToRedact: Set<string> = new Set<string>();

    constructor() {
    }

    public addUser(userId: string) {
        this.usersToRedact.add(userId);
    }

    public isUserQueued(userId: string): boolean {
        return this.usersToRedact.has(userId);
    }

    public async handleEvent(roomId: string, event: any, mjolnirClient: MatrixClient) {
        if (this.isUserQueued(event['sender'])) {
            const permalink = Permalinks.forEvent(roomId, event['event_id']);
            try {
                LogService.info("AutomaticRedactionQueue", `Redacting event because the user is listed as bad: ${permalink}`)
                if (!config.noop) {
                    await mjolnirClient.redactEvent(roomId, event['event_id']);
                } else {
                    await logMessage(LogLevel.WARN, "AutomaticRedactionQueue", `Tried to redact ${permalink} but Mjolnir is running in no-op mode`);
                }
            } catch (e) {
                logMessage(LogLevel.WARN, "AutomaticRedactionQueue", `Unable to redact message: ${permalink}`);
                LogService.warn("AutomaticRedactionQueue", extractRequestError(e));
            }
        }
    }
}
