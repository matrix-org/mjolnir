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

import { LogService, MatrixClient, MatrixGlob } from "matrix-bot-sdk";

export function setToArray<T>(set: Set<T>): T[] {
    const arr: T[] = [];
    for (const v of set) {
        arr.push(v);
    }
    return arr;
}

export function isTrueJoinEvent(event: any): boolean {
    const membership = event['content']['membership'] || 'join';
    let prevMembership = "leave";
    if (event['unsigned'] && event['unsigned']['prev_content']) {
        prevMembership = event['unsigned']['prev_content']['membership'] || 'leave';
    }

    // We look at the previous membership to filter out profile changes
    return membership === 'join' && prevMembership !== "join";
}

/**
 * Gets all the events sent by a user (or users if using wildcards) in a given room ID, since
 * the time they joined.
 * @param {MatrixClient} client The client to use.
 * @param {string} sender The sender. Can include wildcards to match multiple people.
 * @param {string} roomId The room ID to search in.
 * @returns {Promise<any>} Resolves to the events sent by the user(s) prior to join.
 */
export async function getMessagesByUserSinceLastJoin(client: MatrixClient, sender: string, roomId: string): Promise<any[]> {
    const limit = 1000; // maximum number of events to process, regardless of outcome
    const filter = {
        room: {
            rooms: [roomId],
            state: {
                types: ["m.room.member"],
                rooms: [roomId],
            },
            timeline: {
                rooms: [roomId],
                types: ["m.room.message"],
            },
            ephemeral: {
                limit: 0,
                types: [],
            },
            account_data: {
                limit: 0,
                types: [],
            },
        },
        presence: {
            limit: 0,
            types: [],
        },
        account_data: {
            limit: 0,
            types: [],
        },
    };

    let isGlob = true;
    if (!sender.includes("*")) {
        isGlob = false;
        filter.room.timeline['senders'] = [sender];
    }

    const matcher = new MatrixGlob(sender);

    function testUser(userId: string): boolean {
        if (isGlob) {
            return matcher.test(userId);
        } else {
            return userId === sender;
        }
    }

    function initialSync() {
        const qs = {
            filter: JSON.stringify(filter),
        };
        return client.doRequest("GET", "/_matrix/client/r0/sync", qs);
    }

    function backfill(from: string) {
        const qs = {
            filter: JSON.stringify(filter),
            from: from,
            dir: "b",
        };
        LogService.info("utils", "Backfilling with token: " + token);
        return client.doRequest("GET", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/messages`, qs);
    }

    // Do an initial sync first to get the batch token
    const response = await initialSync();
    if (!response) return [];

    const messages = [];
    const stopProcessingMembers = [];
    let processed = 0;

    const timeline = (((response['rooms'] || {})['join'] || {})[roomId] || {})['timeline'] || {};
    const syncedMessages = timeline['events'] || [];
    let token = timeline['prev_batch'] || response['next_batch'];
    let bfMessages = {chunk: syncedMessages, end: token};
    do {
        for (const event of (bfMessages['chunk'] || [])) {
            if (processed >= limit) return messages; // we're done even if we don't want to be
            processed++;

            if (stopProcessingMembers.includes(event['sender'])) continue;
            if (testUser(event['sender'])) messages.push(event);
            if (event['type'] === 'm.room.member' && testUser(event['state_key']) && isTrueJoinEvent(event)) {
                stopProcessingMembers.push(event['sender']);
                if (!isGlob) return messages; // done!
            }
        }

        if (token) {
            bfMessages = await backfill(token);
            let lastToken = token;
            token = bfMessages['end'];
            if (lastToken === token) {
                LogService.warn("utils", "Backfill returned same end token - returning");
                return messages;
            }
        }
    } while (token);

    return messages;
}
