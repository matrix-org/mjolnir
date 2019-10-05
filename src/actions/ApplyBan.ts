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
import { RoomUpdateError } from "../models/RoomUpdateError";
import { Mjolnir } from "../Mjolnir";
import config from "../config";

/**
 * Applies the member bans represented by the ban lists to the provided rooms, returning the
 * room IDs that could not be updated and their error.
 * @param {BanList[]} lists The lists to determine bans from.
 * @param {string[]} roomIds The room IDs to apply the bans in.
 * @param {Mjolnir} mjolnir The Mjolnir client to apply the bans with.
 */
export async function applyUserBans(lists: BanList[], roomIds: string[], mjolnir: Mjolnir): Promise<RoomUpdateError[]> {
    // We can only ban people who are not already banned, and who match the rules.
    const errors: RoomUpdateError[] = [];
    for (const roomId of roomIds) {
        try {
            if (config.verboseLogging) {
                // We specifically use sendNotice to avoid having to escape HTML
                await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Updating member bans in ${roomId}`);
            }

            const state = await mjolnir.client.getRoomState(roomId);
            const members = state.filter(s => s['type'] === 'm.room.member' && !!s['state_key']);

            for (const member of members) {
                const content = member['content'];
                if (!content) continue; // Invalid, but whatever.

                if (content['membership'] === 'ban') {
                    continue; // user already banned
                }

                let banned = false;
                for (const list of lists) {
                    for (const userRule of list.userRules) {
                        if (userRule.isMatch(member['state_key'])) {
                            // User needs to be banned

                            if (config.verboseLogging) {
                                // We specifically use sendNotice to avoid having to escape HTML
                                await mjolnir.client.sendNotice(mjolnir.managementRoomId, `Banning ${member['state_key']} in ${roomId} for: ${userRule.reason}`);
                            }

                            await mjolnir.client.banUser(member['state_key'], roomId, userRule.reason);
                            banned = true;
                            break;
                        }
                    }
                    if (banned) break;
                }
            }
        } catch (e) {
            errors.push({roomId, errorMessage: e.message || (e.body ? e.body.error : '<no message>')});
        }
    }
    return errors;
}
