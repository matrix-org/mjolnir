/*
Copyright 2023 Element.

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

import { LogLevel } from "matrix-bot-sdk";
import { Mjolnir } from "../Mjolnir";
import { Protection } from "./IProtection";

/*
    An implementation of per decentralized abuse reports, as per
    https://github.com/Yoric/matrix-doc/blob/aristotle/proposals/3215-towards-decentralized-moderation.md
 */

const EVENT_MODERATED_BY = "org.matrix.msc3215.room.moderation.moderated_by";
const EVENT_MODERATOR_OF = "org.matrix.msc3215.room.moderation.moderator_of";

/**
 * Setup decentralized abuse reports in protected rooms.
 */
export class LocalAbuseReports extends Protection {
    settings: { };
    public readonly name = "LocalAbuseReports";
    public readonly description = "Enables MSC3215-compliant web clients to send abuse reports to the moderator instead of the homeserver admin";
    readonly requiredStatePermissions = [EVENT_MODERATED_BY];

    /**
     * A new room has been added to the list of rooms to protect with this protection.
     */
    async startProtectingRoom(mjolnir: Mjolnir, protectedRoomId: string) {
        try {
            const userId = await mjolnir.client.getUserId();

            // Fetch the previous state of the room, to avoid overwriting any existing setup.
            let previousState: /* previous content */ any | /* there was no previous content */ null;
            try {
                previousState = await mjolnir.client.getRoomStateEvent(protectedRoomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY);
            } catch (ex) {
                previousState = null;
            }
            if (previousState && previousState["room_id"] && previousState["user_id"]) {
                if (previousState["room_id"] === mjolnir.managementRoomId && previousState["user_id"] === userId) {
                    // The room is already setup, do nothing.
                    return;
                } else {
                    // There is a setup already, but it's not for us. Don't overwrite it.
                    let protectedRoomAliasOrId = await mjolnir.client.getPublishedAlias(protectedRoomId) || protectedRoomId;
                    mjolnir.managementRoomOutput.logMessage(LogLevel.INFO, "LocalAbuseReports", `Room ${protectedRoomAliasOrId} is already setup for decentralized abuse reports with bot ${previousState["user_id"]} and room ${previousState["room_id"]}, not overwriting automatically. To overwrite, use command \`!mjolnir rooms setup ${protectedRoomId} reporting\``);
                    return;
                }
            }

            // Setup protected room -> moderation room link.
            // We do this before the other one to be able to fail early if we do not have a sufficient
            // powerlevel.
            let eventId;
            try {
                eventId = await mjolnir.client.sendStateEvent(protectedRoomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY, {
                    room_id: mjolnir.managementRoomId,
                    user_id: userId,
                });
            } catch (ex) {
                mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, "LocalAbuseReports", `Could not autoset protected room -> moderation room link: ${ex.message}. To set it manually, use command \`!mjolnir rooms setup ${protectedRoomId} reporting\``);
                return;
            }

            try {
                // Setup moderation room -> protected room.
                await mjolnir.client.sendStateEvent(mjolnir.managementRoomId, EVENT_MODERATOR_OF, protectedRoomId, {
                    user_id: userId,
                });
            } catch (ex) {
                // If the second `sendStateEvent` fails, we could end up with a room half setup, which
                // is bad. Attempt to rollback.
                mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, "LocalAbuseReports", `Could not autoset moderation room -> protected room link: ${ex.message}. To set it manually, use command \`!mjolnir rooms setup ${protectedRoomId} reporting\``);
                try {
                    await mjolnir.client.redactEvent(protectedRoomId, eventId, "Rolling back incomplete MSC3215 setup");
                } finally {
                    // Ignore second exception, propagate first.
                    throw ex;
                }
            }
        } catch (ex) {
            mjolnir.managementRoomOutput.logMessage(LogLevel.ERROR, "LocalAbuseReports", ex.message);
        }
    }
}