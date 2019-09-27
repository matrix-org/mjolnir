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
import { MatrixClient } from "matrix-bot-sdk";
import { ServerAcl } from "../models/ServerAcl";
import { RoomUpdateError } from "../models/RoomUpdateError";

/**
 * Applies the server ACLs represented by the ban lists to the provided rooms, returning the
 * room IDs that could not be updated and their error.
 * @param {BanList[]} lists The lists to construct ACLs from.
 * @param {string[]} roomIds The room IDs to apply the ACLs in.
 * @param {MatrixClient} client The Matrix client to apply the ACLs with.
 */
export async function applyServerAcls(lists: BanList[], roomIds: string[], client: MatrixClient): Promise<RoomUpdateError[]> {
    // Construct a server ACL first
    const acl = new ServerAcl().denyIpAddresses().allowServer("*");
    for (const list of lists) {
        for (const rule of list.serverRules) {
            acl.denyServer(rule.entity);
        }
    }

    const errors: RoomUpdateError[] = [];
    for (const roomId of roomIds) {
        try {
            await client.sendStateEvent(roomId, "m.room.server_acl", "", acl.safeAclContent());
        } catch (e) {
            errors.push({roomId, errorMessage: e.message || (e.body ? e.body.error : '<no message>')});
        }
    }

    return errors;
}
