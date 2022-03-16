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

/**
 * Attempt to parse a `ParseEntry`, as provided by the shell-style parser, using a parsing function.
 *
 * @param name The name of the object being parsed. Used for error messages.
 * @param token The `ParseEntry` provided by the shell-style parser. It will be converted
 *   to string if possible. Otherwise, this returns an error.
 * @param parser A function that attempts to parse `token` (converted to string) into
 *   its final result. It should provide an error fit for the end-user if it fails.
 * @returns An error fit for the end-user if `token` could not be converted to string or
 *   if `parser` failed.
 */
function parseToken<T>(name: string, token: ParseEntry, parser: (source: string) => Result<T>): Result<T> {
    if (!token) {
        return { error: `Missing ${name}`};
    }
    if (typeof token === "object") {
        if ("pattern" in token) {
            // In future versions, we *might* be smarter about patterns, but not yet.
            token = token.pattern;
        }
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

/**
 * Attempt to convert a token into a string.
 * @param name The name of the object being parsed. Used for error messages.
 * @param token The `ParseEntry` provided by the shell-style parser. It will be converted
 *   to string if possible. Otherwise, this returns an error.
 * @returns An error fit for the end-user if `token` could not be converted to string, otherwise
 *   `{ok: string}`.
 */
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

// !mjolnir since <date>/<duration> <action> <number> [...rooms] [...reason]
export async function execSinceCommand(destinationRoomId: string, event: any, mjolnir: Mjolnir, tokens: ParseEntry[]) {
    let result = await execSinceCommandAux(destinationRoomId, event, mjolnir, tokens);
    if ("error" in result) {
        mjolnir.client.unstableApis.addReactionToEvent(destinationRoomId, event['event_id'], '❌');
        mjolnir.logMessage(LogLevel.WARN, "SinceCommand", result.error);
        const reply = RichReply.createFor(destinationRoomId, event, result.error, htmlEscape(result.error));
        reply["msgtype"] = "m.notice";
        /* no need to await */ mjolnir.client.sendMessage(destinationRoomId, reply);
    } else {
        // Details have already been printed.
        mjolnir.client.unstableApis.addReactionToEvent(destinationRoomId, event['event_id'], '✅');
    }
}

// Implementation of `execSinceCommand`, counts on caller to print errors.
//
// This method:
// - decodes all the arguments;
// - resolves any room alias into a room id;
// - attempts to execute action;
// - in case of success, returns `{ok: undefined}`, in case of error, returns `{error: string}`.
async function execSinceCommandAux(destinationRoomId: string, event: any, mjolnir: Mjolnir, tokens: ParseEntry[]): Promise<Result<undefined>> {
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
        return minDateResult;
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
        return maxEntriesResult;
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
        return actionResult;
    }
    const action: Action = actionResult.ok!;

    // Now list affected rooms.
    const rooms: Set</* room id */string> = new Set();
    let reasonParts: string[] | undefined;
    for (let token of optionalTokens) {
        const maybeArg = getTokenAsString(reasonParts ? "[reason]" : "[room]", token);
        if ("error" in maybeArg) {
            return maybeArg;
        }
        const maybeRoom = maybeArg.ok;
        if (!reasonParts) {
            // If we haven't reached the reason yet, attempt to use `maybeRoom` as a room.
            if (maybeRoom === "*") {
                for (let roomId of Object.keys(mjolnir.protectedRooms)) {
                    rooms.add(roomId);
                }
                continue;
            } else if (maybeRoom.startsWith("#") || maybeRoom.startsWith("!")) {
                const roomId = await mjolnir.client.resolveRoom(maybeRoom);
                if (!(roomId in mjolnir.protectedRooms)) {
                    return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", `This room is not protected: ${htmlEscape(roomId)}.`);
                }
                rooms.add(roomId);
                continue;
            }
            // If we reach this step, it's not a room, so it must be a reason.
            // All further arguments are now part of `reason`.
            reasonParts = [];
        }
        reasonParts.push(maybeRoom);
    }

    if (rooms.size === 0) {
        return {
            error: "Missing rooms. Use `*` if you wish to apply to every protected room.",
        };
    }

    const progressEventId = await mjolnir.client.unstableApis.addReactionToEvent(destinationRoomId, event['event_id'], '⏳');
    const reason: string | undefined = reasonParts?.join(" ");

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
    return {ok: undefined};
}

function makeJoinStatus(mjolnir: Mjolnir, targetRoomId: string, maxEntries: number, minDate: Date, maxAgeMS: number): {html: string, text: string} {
    const HUMANIZER_OPTIONS = {
        // Reduce "1 day" => "1day" to simplify working with CSV.
        spacer: "",
        // Reduce "1 day, 2 hours" => "1.XXX day" to simplify working with CSV.
        largest: 1,
    };
    const maxAgeHumanReadable = HUMANIZER.humanize(maxAgeMS);
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
