/*
Copyright 2019, 2020 The Matrix.org Foundation C.I.C.

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

import BanList from "../models/BanList";
import { ServerAcl } from "../models/ServerAcl";
import { RoomUpdateError } from "../models/RoomUpdateError";
import { Mjolnir } from "../Mjolnir";
import config from "../config";
import { LogLevel, UserID } from "matrix-bot-sdk";
import { logMessage } from "../LogProxy";
import { ERROR_KIND_FATAL, ERROR_KIND_PERMISSION } from "../ErrorCache";

/**
 * Applies the server ACLs represented by the ban lists to the provided rooms, returning the
 * room IDs that could not be updated and their error.
 * @param {BanList[]} lists The lists to construct ACLs from.
 * @param {string[]} roomIds The room IDs to apply the ACLs in.
 * @param {Mjolnir} mjolnir The Mjolnir client to apply the ACLs with.
 */
export async function applyServerAcls(lists: BanList[], roomIds: string[], mjolnir: Mjolnir): Promise<RoomUpdateError[]> {
    const serverName: string = new UserID(await config.RUNTIME.client!.getUserId()).domain;

    // Construct a server ACL first
    const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*");
    for (const list of lists) {
        for (const rule of list.serverRules) {
            acl.denyServer(rule.entity);
        }
    }

    const finalAcl = acl.safeAclContent();

    if (finalAcl.deny.length !== acl.literalAclContent().deny.length) {
        logMessage(LogLevel.WARN, "ApplyAcl", `Mjölnir has detected and removed an ACL that would exclude itself. Please check the ACL lists.`);
    }

    if (config.verboseLogging) {
        // We specifically use sendNotice to avoid having to escape HTML
        await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Constructed server ACL:\n${JSON.stringify(finalAcl, null, 2)}`);
    }

    const errors: RoomUpdateError[] = [];
    for (const roomId of roomIds) {
        try {
            await logMessage(LogLevel.DEBUG, "ApplyAcl", `Checking ACLs for ${roomId}`, roomId);

            try {
                const currentAcl = await mjolnir.client.getRoomStateEvent(roomId, "m.room.server_acl", "");
                if (acl.matches(currentAcl)) {
                    await logMessage(LogLevel.DEBUG, "ApplyAcl", `Skipping ACLs for ${roomId} because they are already the right ones`, roomId);
                    continue;
                }
            } catch (e) {
                // ignore - assume no ACL
            }

            // We specifically use sendNotice to avoid having to escape HTML
            await logMessage(LogLevel.DEBUG, "ApplyAcl", `Applying ACL in ${roomId}`, roomId);

            if (!config.noop) {
                await mjolnir.client.sendStateEvent(roomId, "m.room.server_acl", "", finalAcl);
            } else {
                await logMessage(LogLevel.WARN, "ApplyAcl", `Tried to apply ACL in ${roomId} but Mjolnir is running in no-op mode`, roomId);
            }
        } catch (e) {
            const message = e.message || (e.body ? e.body.error : '<no message>');
            const kind = message && message.includes("You don't have permission to post that to the room") ? ERROR_KIND_PERMISSION : ERROR_KIND_FATAL;
            errors.push({roomId, errorMessage: message, errorKind: kind});
        }
    }

    return errors;
}
