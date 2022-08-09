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

import PolicyList from "../models/PolicyList";
import { ServerAcl } from "../models/ServerAcl";
import { RoomUpdateError } from "../models/RoomUpdateError";
import { Mjolnir } from "../Mjolnir";
import { LogLevel, UserID } from "matrix-bot-sdk";
import { ERROR_KIND_FATAL, ERROR_KIND_PERMISSION } from "../ErrorCache";

/**
 * Applies the server ACLs represented by the ban lists to the provided rooms, returning the
 * room IDs that could not be updated and their error.
 * Does not update the banLists before taking their rules to build the server ACL.
 * @param {PolicyList[]} lists The lists to construct ACLs from.
 * @param {string[]} roomIds The room IDs to apply the ACLs in.
 * @param {Mjolnir} mjolnir The Mjolnir client to apply the ACLs with.
 */
export async function applyServerAcls(lists: PolicyList[], roomIds: string[], mjolnir: Mjolnir): Promise<RoomUpdateError[]> {
    // we need to provide mutual exclusion so that we do not have requests updating the m.room.server_acl event
    // finish out of order and therefore leave the room out of sync with the policy lists.
    return new Promise((resolve, reject) => {
        mjolnir.aclChain = mjolnir.aclChain
            .then(() => _applyServerAcls(lists, roomIds, mjolnir))
            .then(resolve, reject);
    });
}

async function _applyServerAcls(lists: PolicyList[], roomIds: string[], mjolnir: Mjolnir): Promise<RoomUpdateError[]> {
    const serverName: string = new UserID(await mjolnir.client.getUserId()).domain;

    // Construct a server ACL first
    const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*");
    for (const list of lists) {
        for (const rule of list.serverRules) {
            acl.denyServer(rule.entity);
        }
    }

    const finalAcl = acl.safeAclContent();

    if (finalAcl.deny.length !== acl.literalAclContent().deny.length) {
        mjolnir.logMessage(LogLevel.WARN, "ApplyAcl", `Mjölnir has detected and removed an ACL that would exclude itself. Please check the ACL lists.`);
    }

    if (mjolnir.config.verboseLogging) {
        // We specifically use sendNotice to avoid having to escape HTML
        await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Constructed server ACL:\n${JSON.stringify(finalAcl, null, 2)}`);
    }

    const errors: RoomUpdateError[] = [];
    for (const roomId of roomIds) {
        try {
            await mjolnir.logMessage(LogLevel.DEBUG, "ApplyAcl", `Checking ACLs for ${roomId}`, roomId);

            try {
                const currentAcl = await mjolnir.client.getRoomStateEvent(roomId, "m.room.server_acl", "");
                if (acl.matches(currentAcl)) {
                    await mjolnir.logMessage(LogLevel.DEBUG, "ApplyAcl", `Skipping ACLs for ${roomId} because they are already the right ones`, roomId);
                    continue;
                }
            } catch (e) {
                // ignore - assume no ACL
            }

            // We specifically use sendNotice to avoid having to escape HTML
            await mjolnir.logMessage(LogLevel.DEBUG, "ApplyAcl", `Applying ACL in ${roomId}`, roomId);

            if (!mjolnir.config.noop) {
                await mjolnir.client.sendStateEvent(roomId, "m.room.server_acl", "", finalAcl);
            } else {
                await mjolnir.logMessage(LogLevel.WARN, "ApplyAcl", `Tried to apply ACL in ${roomId} but Mjolnir is running in no-op mode`, roomId);
            }
        } catch (e) {
            const message = e.message || (e.body ? e.body.error : '<no message>');
            const kind = message && message.includes("You don't have permission to post that to the room") ? ERROR_KIND_PERMISSION : ERROR_KIND_FATAL;
            errors.push({ roomId, errorMessage: message, errorKind: kind });
        }
    }

    return errors;
}
