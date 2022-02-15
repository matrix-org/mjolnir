/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import { Mjolnir } from "../Mjolnir";
import { LogLevel, LogService, RichReply } from "matrix-bot-sdk";
import { htmlEscape, parseDuration } from "../utils";
import { ParseEntry } from "shell-quote";
import { HumanizeDurationLanguage, HumanizeDuration } from "humanize-duration-ts";

const HUMANIZE_LAG_SERVICE: HumanizeDurationLanguage = new HumanizeDurationLanguage();
const HUMANIZER: HumanizeDuration = new HumanizeDuration(HUMANIZE_LAG_SERVICE);

enum Action {
    Kick = "kick",
    Ban = "ban",
    Show = "show"
}

type Result<T> = {ok: T} | {error: string};

function parseToken<T>(name: string, token: ParseEntry, parser: (source: string) => Result<T>): Result<T> {
    if (!token) {
        return { error: `Missing ${name}`};
    }
    if (typeof token === "object" && "pattern" in token) {
        // In future versions, we *might* be smarter patterns, but not yet.
        token = token.pattern;
    }

    if (typeof token !== "string") {
        return { error: `Invalid ${name}` };
    }
    const result = parser(token);
    if ("error" in result) {
        if (result.error) {
            return { error: `Invalid ${name} ${htmlEscape(token)}: ${result.error}`};
        } else {
            return { error: `Invalid ${name} ${htmlEscape(token)}`};
        }
    }
    return result;
}

function getTokenAsString(name: string, token: ParseEntry): {error: string}|{ok: string} {
    if (!token) {
        return { error: `Missing ${name}`};
    }
    if (typeof token === "object" && "pattern" in token) {
        // In future versions, we *might* be smarter patterns, but not yet.
        token = token.pattern;
    }
    if (typeof token === "string") {
        return {ok: token};
    }
    return { error: `Invalid ${name}` };
}

// !mjolnir since <date>/<duration> <action> <number> [reason] [...rooms]
export async function execSinceCommand(destinationRoomId: string, event: any, mjolnir: Mjolnir, tokens: ParseEntry[]) {
    const [dateOrDurationToken, actionToken, maxEntriesToken, ...optionalTokens] = tokens;

    // Parse origin date or duration.
    const minDateResult = parseToken("<date>/<duration>", dateOrDurationToken, source => {
        // Attempt to parse `<date>/<duration>` as a date.
        let maybeMinDate = new Date(source);
        let maybeMaxAgeMS = Date.now() - maybeMinDate.getTime() as number;
        if (!Number.isNaN(maybeMaxAgeMS)) {
            return { ok: { minDate: maybeMinDate, maxAgeMS: maybeMaxAgeMS} };
        }

        //...or as a duration
        maybeMaxAgeMS = parseDuration(source);
        if (maybeMaxAgeMS && !Number.isNaN(maybeMaxAgeMS)) {
            maybeMaxAgeMS = Math.abs(maybeMaxAgeMS);
            return { ok: { minDate: new Date(Date.now() - maybeMaxAgeMS), maxAgeMS: maybeMaxAgeMS } }
        }
        return { error: "" };
    });
    if ("error" in minDateResult) {
        return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", minDateResult.error);
    }
    const { minDate, maxAgeMS } = minDateResult.ok!;

    // Parse max entries.
    const maxEntriesResult = parseToken("<maxEntries>", maxEntriesToken, source => {
        const maybeMaxEntries = Number.parseInt(source, 10);
        if (Number.isNaN(maybeMaxEntries)) {
            return { error: "Not a number" };
        } else {
            return { ok: maybeMaxEntries };
        }
    });
    if ("error" in maxEntriesResult) {
        return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", maxEntriesResult.error);
    }
    const maxEntries = maxEntriesResult.ok!;

    // Attempt to parse `<action>` as Action.
    const actionResult = parseToken("<action>", actionToken, source => {
        for (let key in Action) {
            const maybeAction = Action[key as keyof typeof Action];
            if (key === source) {
                return { ok: maybeAction }
            } else if (maybeAction === source) {
                return { ok: maybeAction }
            }
        }
        return {error: `Expected one of ${JSON.stringify(Action)}`};
    })
    if ("error" in actionResult) {
        return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", actionResult.error);
    }
    const action: Action = actionResult.ok!;

    // Now list affected rooms.
    const rooms: Set<string> = new Set();
    let reason: string | undefined;
    for (let i = 0; i < optionalTokens.length; ++i) {
        const token = optionalTokens[i];
        const maybeRoomResult = getTokenAsString("[room]", token);
        if ("error" in maybeRoomResult) {
            return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", maybeRoomResult.error);
        }

        const maybeRoom = maybeRoomResult.ok!;

        if (maybeRoom === "*") {
            for (let roomId of Object.keys(mjolnir.protectedRooms)) {
                rooms.add(roomId);
            }
        } else if (maybeRoom.startsWith("#") || maybeRoom.startsWith("!")) {
            const roomId = await mjolnir.client.resolveRoom(maybeRoom);
            if (!(roomId in mjolnir.protectedRooms)) {
                return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", `This room is not protected: ${htmlEscape(roomId)}.`);
            }
            rooms.add(roomId);
        } else {
            if (i === 0) {
                // First argument may not be a room.
                reason = maybeRoom;
            } else {
                return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", `Invalid room ${htmlEscape(maybeRoom)}.`);
            }
        }
    }
    if (rooms.size === 0) {
        return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", `Missing rooms. Use "*" if you wish to apply to every protected room.`);
    }

    const progressEventId = await mjolnir.client.unstableApis.addReactionToEvent(destinationRoomId, event['event_id'], '⏳');

    for (let targetRoomId of rooms) {
        let {html, text} = await (async () => {
            switch (action) {
                case Action.Show: {
                    return makeJoinStatus(mjolnir, targetRoomId, maxEntries, minDate, maxAgeMS);
                }
                case Action.Kick: {
                    const joins = mjolnir.roomJoins.getUsersInRoom(targetRoomId, minDate, maxEntries);
                    let results = { good: 0, bad: 0};
                    for (let join of joins) {
                        try {
                            await mjolnir.client.kickUser(join.userId, targetRoomId, reason);
                            results.good += 1;
                        } catch (ex) {
                            LogService.warn("SinceCommand", "Error while attempting to kick user", ex);
                            results.bad += 1;
                        }
                    }
                    const text_ = `Attempted to kick ${joins.length} users from room ${targetRoomId}, ${results.good} kicked, ${results.bad} failures`;
                    return {
                        html: text_,
                        text: text_,
                    }
                }
                case Action.Ban: {
                    const joins = mjolnir.roomJoins.getUsersInRoom(targetRoomId, minDate, maxEntries);

                    let results = { good: 0, bad: 0};
                    for (let join of joins) {
                        try {
                            await mjolnir.client.banUser(join.userId, targetRoomId, reason);
                            results.good += 1;
                        } catch (ex) {
                            LogService.warn("SinceCommand", "Error while attempting to ban user", ex);
                            results.bad += 1;
                        }
                    }
                    const text_ = `Attempted to ban ${joins.length} users from room ${targetRoomId}, ${results.good} kicked, ${results.bad} failures`;
                    return {
                        html: text_,
                        text: text_
                    }
                }
            }
        })();

        const reply = RichReply.createFor(destinationRoomId, event, text, html);
        reply["msgtype"] = "m.notice";
        /* no need to await */ mjolnir.client.sendMessage(destinationRoomId, reply);
    }

    await mjolnir.client.redactEvent(destinationRoomId, progressEventId);
    mjolnir.client.unstableApis.addReactionToEvent(destinationRoomId, event['event_id'], '✅');
}

function makeJoinStatus(mjolnir: Mjolnir, targetRoomId: string, maxEntries: number, minDate: Date, maxAgeMS: number): {html: string, text: string} {
    const HUMANIZER_OPTIONS = {
        // Reduce "1 day" => "1day" to simplify working with CSV.
        spacer: "",
        // Reduce "1 day, 2 hours" => "1.XXX day" to simplify working with CSV.
        largest: 1,
    };
    const maxAgeHumanReadable = HUMANIZER.humanize(maxAgeMS, HUMANIZER_OPTIONS);
    const joins = mjolnir.roomJoins.getUsersInRoom(targetRoomId, minDate, maxEntries);
    const htmlFragments = [];
    const textFragments = [];
    for (let join of joins) {
        const durationHumanReadable = HUMANIZER.humanize(Date.now() - join.timestamp, HUMANIZER_OPTIONS);
        htmlFragments.push(`<li>${htmlEscape(join.userId)}: ${durationHumanReadable}</li>`);
        textFragments.push(`- ${join.userId}: ${durationHumanReadable}`);
    }
    return {
        html: `${joins.length} recent joins (cut at ${maxAgeHumanReadable} ago / ${maxEntries} entries): <ul> ${htmlFragments.join()} </ul>`,
        text: `${joins.length} recent joins (cut at ${maxAgeHumanReadable} ago / ${maxEntries} entries):\n${textFragments.join("\n")}`
    }
}