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

import {
    extractRequestError,
    LogLevel,
    LogService,
    MatrixClient,
    MatrixGlob,
    MessageType,
    Permalinks,
    TextualMessageEventContent,
    UserID
} from "matrix-bot-sdk";
import { logMessage } from "./LogProxy";
import config from "./config";
import * as htmlEscape from "escape-html";

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

export async function redactUserMessagesIn(client: MatrixClient, userIdOrGlob: string, targetRoomIds: string[], limit = 1000) {
    for (const targetRoomId of targetRoomIds) {
        await logMessage(LogLevel.DEBUG, "utils#redactUserMessagesIn", `Fetching sent messages for ${userIdOrGlob} in ${targetRoomId} to redact...`, targetRoomId);

        await getMessagesByUserIn(client, userIdOrGlob, targetRoomId, limit, async (eventsToRedact) => {
            for (const victimEvent of eventsToRedact) {
                await logMessage(LogLevel.DEBUG, "utils#redactUserMessagesIn", `Redacting ${victimEvent['event_id']} in ${targetRoomId}`, targetRoomId);
                if (!config.noop) {
                    await client.redactEvent(targetRoomId, victimEvent['event_id']);
                } else {
                    await logMessage(LogLevel.WARN, "utils#redactUserMessagesIn", `Tried to redact ${victimEvent['event_id']} in ${targetRoomId} but Mjolnir is running in no-op mode`, targetRoomId);
                }
            }
        });
    }
}

/**
 * Gets all the events sent by a user (or users if using wildcards) in a given room ID, since
 * the time they joined.
 * @param {MatrixClient} client The client to use.
 * @param {string} sender The sender. A matrix user id or a wildcard to match multiple senders e.g. *.example.com.
 * Can also be used to generically search the sender field e.g. *bob* for all events from senders with "bob" in them.
 * See `MatrixGlob` in matrix-bot-sdk.
 * @param {string} roomId The room ID to search in.
 * @param {number} limit The maximum number of messages to search. Defaults to 1000. This will be a greater or equal
 * number of events that are provided to the callback if a wildcard is used, as not all events paginated
 * will match the glob. The reason the limit is calculated this way is so that a caller cannot accidentally
 * traverse the entire room history.
 * @param {function} cb Callback function to handle the events as they are received.
 * The callback will only be called if there are any relevant events.
 * @returns {Promise<void>} Resolves when either: the limit has been reached, no relevant events could be found or there is no more timeline to paginate.
 */
export async function getMessagesByUserIn(client: MatrixClient, sender: string, roomId: string, limit: number, cb: (events: any[]) => void): Promise<void> {
    const isGlob = sender.includes("*");
    const roomEventFilter = {
        rooms: [roomId],
        ... isGlob ? {} : {senders: [sender]}
    };

    const matcher = new MatrixGlob(sender);

    function testUser(userId: string): boolean {
        if (isGlob) {
            return matcher.test(userId);
        } else {
            return userId === sender;
        }
    }

    /**
     * Note: `rooms/initialSync` is deprecated. However, there is no replacement for this API for the time being.
     * While previous versions of this function used `/sync`, experience shows that it can grow extremely
     * slow (4-5 minutes long) when we need to sync many large rooms, which leads to timeouts and
     * breakage in Mjolnir, see https://github.com/matrix-org/synapse/issues/10842.
     */
    function roomInitialSync() {
        return client.doRequest("GET", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/initialSync`);
    }

    function backfill(from: string) {
        const qs = {
            filter: JSON.stringify(roomEventFilter),
            from: from,
            dir: "b",
        };
        LogService.info("utils", "Backfilling with token: " + from);
        return client.doRequest("GET", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/messages`, qs);
    }

    // Do an initial sync first to get the batch token
    const response = await roomInitialSync();

    let processed = 0;
    /**
     * Filter events from the timeline to events that are from a matching sender and under the limit that can be processed by the callback.
     * @param events Events from the room timeline.
     * @returns Events that can safely be processed by the callback.
     */
    function filterEvents(events: any[]) {
        const messages: any[] = [];
        for (const event of events) {
            if (processed >= limit) return messages; // we have provided enough events.
            processed++;

            if (testUser(event['sender'])) messages.push(event);
        }
        return messages;
    }

    // The recommended APIs for fetching events from a room is to use both rooms/initialSync then /messages.
    // Unfortunately, this results in code that is rather hard to read, as these two APIs employ very different data structures.
    // We prefer discarding the results from rooms/initialSync and reading only from /messages,
    // even if it's a little slower, for the sake of code maintenance.
    const timeline = response['messages']
    if (timeline) {
        // The end of the PaginationChunk has the most recent events from rooms/initialSync.
        // This token is required be present in the PagintionChunk from rooms/initialSync.
        let token = timeline['end']!;
        // We check that we have the token because rooms/messages is not required to provide one
        // and will not provide one when there is no more history to paginate.
        while (token && processed < limit) {
            const bfMessages = await backfill(token);
            let lastToken = token;
            token = bfMessages['end'];
            if (lastToken === token) {
                LogService.debug("utils", "Backfill returned same end token - returning early.");
                return;
            }
            const events = filterEvents(bfMessages['chunk'] || []);
            // If we are using a glob, there may be no relevant events in this chunk.
            if (events.length > 0) {
                await cb(events);
            }
        }
    } else {
        throw new Error(`Internal Error: rooms/initialSync did not return a pagination chunk for ${roomId}, this is not normal and if it is we need to stop using it. See roomInitialSync() for why we are using it.`);
    }
}

export async function replaceRoomIdsWithPills(client: MatrixClient, text: string, roomIds: string[] | string, msgtype: MessageType = "m.text"): Promise<TextualMessageEventContent> {
    if (!Array.isArray(roomIds)) roomIds = [roomIds];

    const content: TextualMessageEventContent = {
        body: text,
        formatted_body: htmlEscape(text),
        msgtype: msgtype,
        format: "org.matrix.custom.html",
    };

    const escapeRegex = (v: string): string => {
        return v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    };

    const viaServers = [(new UserID(await client.getUserId())).domain];
    for (const roomId of roomIds) {
        let alias = roomId;
        try {
            alias = (await client.getPublishedAlias(roomId)) || roomId;
        } catch (e) {
            // This is a recursive call, so tell the function not to try and call us
            await logMessage(LogLevel.WARN, "utils", `Failed to resolve room alias for ${roomId} - see console for details`, null, true);
            LogService.warn("utils", extractRequestError(e));
        }
        const regexRoomId = new RegExp(escapeRegex(roomId), "g");
        content.body = content.body.replace(regexRoomId, alias);
        if (content.formatted_body) {
            content.formatted_body = content.formatted_body.replace(regexRoomId, `<a href="${Permalinks.forRoom(alias, viaServers)}">${alias}</a>`);
        }
    }

    return content;
}
