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

import { MatrixClient } from "matrix-bot-sdk";

export function setToArray<T>(set: Set<T>): T[] {
    const arr: T[] = [];
    for (const v of set) {
        arr.push(v);
    }
    return arr;
}

export async function getMessagesByUserSinceLastJoin(client: MatrixClient, sender: string, roomId: string): Promise<any[]> {
    const filter = {
        room: {
            rooms: [roomId],
            state: {
                types: ["m.room.member"],
                rooms: [roomId],
            },
            timeline: {
                senders: [sender],
                rooms: [roomId],
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
        return client.doRequest("GET", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/messages`, qs);
    }

    // Do an initial sync first to get the batch token
    const response = await initialSync();
    if (!response) return [];

    let token = response['next_batch'];

    const messages = [];

    const timeline = (((response['rooms'] || {})['join'] || {})[roomId] || {})['timeline'] || {};
    const syncedMessages = timeline['events'] || [];
    token = timeline['prev_batch'] || token;
    for (const event of syncedMessages) {
        if (event['sender'] === sender) messages.push(event);
        if (event['type'] === 'm.room.member' && event['state_key'] === sender) {
            if (event['content'] && event['content']['membership'] === 'join') {
                return messages; // we're done!
            }
        }
    }

    while (token) {
        const bfMessages = await backfill(token);
        token = bfMessages['end'];

        for (const event of (bfMessages['chunk'] || [])) {
            if (event['sender'] === sender) messages.push(event);
            if (event['type'] === 'm.room.member' && event['state_key'] === sender) {
                if (event['content'] && event['content']['membership'] === 'join') {
                    return messages; // we're done!
                }
            }
        }
    }

    return messages;
}
