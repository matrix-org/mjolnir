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

import BanList from "../models/BanList";
import { ServerAcl } from "../models/ServerAcl";
import { RoomUpdateError } from "../models/RoomUpdateError";
import { Mjolnir } from "../Mjolnir";
import config from "../config";

/**
 * Applies the server ACLs represented by the ban lists to the provided rooms, returning the
 * room IDs that could not be updated and their error.
 * @param {BanList[]} lists The lists to construct ACLs from.
 * @param {string[]} roomIds The room IDs to apply the ACLs in.
 * @param {Mjolnir} mjolnir The Mjolnir client to apply the ACLs with.
 */
export async function applyServerAcls(lists: BanList[], roomIds: string[], mjolnir: Mjolnir): Promise<RoomUpdateError[]> {
    // Construct a server ACL first
    const acl = new ServerAcl().denyIpAddresses().allowServer("*");
    for (const list of lists) {
        for (const rule of list.serverRules) {
            acl.denyServer(rule.entity);
        }
    }

    const finalAcl = acl.safeAclContent();

    if (config.verboseLogging) {
        // We specifically use sendNotice to avoid having to escape HTML
        await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Constructed server ACL:\n${JSON.stringify(finalAcl, null, 2)}`);
    }

    const errors: RoomUpdateError[] = [];
    for (const roomId of roomIds) {
        try {
            if (config.verboseLogging) {
                // We specifically use sendNotice to avoid having to escape HTML
                await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Applying ACL in ${roomId}`);
            }

            await mjolnir.client.sendStateEvent(roomId, "m.room.server_acl", "", finalAcl);
        } catch (e) {
            errors.push({roomId, errorMessage: e.message || (e.body ? e.body.error : '<no message>')});
        }
    }

    return errors;
}
