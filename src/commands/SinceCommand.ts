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
import { htmlEscape } from "../utils";
import { HumanizeDurationLanguage, HumanizeDuration } from "humanize-duration-ts";
import { Join } from "../RoomMembers";
import { Lexer } from "./Lexer";

const HUMANIZE_LAG_SERVICE: HumanizeDurationLanguage = new HumanizeDurationLanguage();
const HUMANIZER: HumanizeDuration = new HumanizeDuration(HUMANIZE_LAG_SERVICE);

enum Action {
    Kick = "kick",
    Ban = "ban",
    Mute = "mute",
    Unmute = "unmute",
    Show = "show"
}

type Result<T> = {ok: T} | {error: string};

type userId = string;
type Summary = { succeeded: userId[], failed: userId[] };

// !mjolnir since <date>/<duration> <action> <number> [...rooms] [...reason]
export async function execSinceCommand(destinationRoomId: string, event: any, mjolnir: Mjolnir, lexer: Lexer) {
    let result;
    try {
        result = await execSinceCommandAux(destinationRoomId, event, mjolnir, lexer);
    } catch (ex) {
        result = { error: ex.message };
        console.error("Error executing `since` command", ex);
    }
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

function formatResult(action: string, targetRoomId: string, recentJoins: Join[], summary: Summary): {html: string, text: string} {
    const html = `Attempted to ${action} ${recentJoins.length} users from room ${targetRoomId}.<br/>Succeeded ${summary.succeeded.length}: <ul>${summary.succeeded.map(x => `<li>${htmlEscape(x)}</li>`).join("\n")}</ul>.<br/> Failed ${summary.failed.length}: <ul>${summary.succeeded.map(x => `<li>${htmlEscape(x)}</li>`).join("\n")}</ul>`;
    const text = `Attempted to ${action} ${recentJoins.length} users from room ${targetRoomId}.\nSucceeded ${summary.succeeded.length}: ${summary.succeeded.map(x => `*${htmlEscape(x)}`).join("\n")}\n Failed ${summary.failed.length}:\n${summary.succeeded.map(x => ` * ${htmlEscape(x)}`).join("\n")}`;
    return {
        html,
        text
    };
}

// Implementation of `execSinceCommand`, counts on caller to print errors.
//
// This method:
// - decodes all the arguments;
// - resolves any room alias into a room id;
// - attempts to execute action;
// - in case of success, returns `{ok: undefined}`, in case of error, returns `{error: string}`.
async function execSinceCommandAux(destinationRoomId: string, event: any, mjolnir: Mjolnir, lexer: Lexer): Promise<Result<undefined>> {
    // Attempt to parse `<date/duration>` as a date or duration.
    let dateOrDuration: Date |number = lexer.token("dateOrDuration").value;
    let minDate;
    let maxAgeMS;
    if (dateOrDuration instanceof Date) {
        minDate = dateOrDuration;
        maxAgeMS = Date.now() - dateOrDuration.getTime() as number;
    } else {
        minDate = new Date(Date.now() - dateOrDuration);
        maxAgeMS = dateOrDuration;
    }

    // Attempt to parse `<action>` as Action.
    let actionToken = lexer.token("id").text;
    let action: Action | null = null;
    for (let key in Action) {
        const maybeAction = Action[key as keyof typeof Action];
        if (key === actionToken || maybeAction === actionToken) {
            action = maybeAction;
            break;
        }
    }
    if (!action) {
        return {error: `Invalid <action>. Expected one of ${JSON.stringify(Action)}`};
    }

    // Attempt to parse `<limit>` as a number.
    const maxEntries = lexer.token("int").value as number;

    // Parse rooms.
    // Parse everything else as `<reason>`, stripping quotes if any have been added.
    const rooms: Set</* room id */string> = new Set();
    let reason = "";
    do {

        let token = lexer.alternatives(
            // Room
            () => lexer.token("STAR"),
            () => lexer.token("roomAliasOrID"),
            // Reason
            () => lexer.token("string"),
            () => lexer.token("ETC")
        );
        if (!token || token.type === "EOF") {
            // We have reached the end of rooms, no reason.
            break;
        } else if (token.type === "STAR") {
            for (let roomId of Object.keys(mjolnir.protectedRooms)) {
                rooms.add(roomId);
            }
            continue;
        } else if (token.type === "roomAliasOrID") {
            const roomId = await mjolnir.client.resolveRoom(token.text);
            if (!(roomId in mjolnir.protectedRooms)) {
                return mjolnir.logMessage(LogLevel.WARN, "SinceCommand", `This room is not protected: ${htmlEscape(roomId)}.`);
            }
            rooms.add(roomId);
            continue;
        } else if (token.type === "string" || token.type === "ETC") {
            // We have reached the end of rooms with a reason.
            reason = token.text;
            break;
        }
    } while(true);
    if (rooms.size === 0) {
        return {
            error: "Missing rooms. Use `*` if you wish to apply to every protected room.",
        };
    }

    const progressEventId = await mjolnir.client.unstableApis.addReactionToEvent(destinationRoomId, event['event_id'], '⏳');

    for (let targetRoomId of rooms) {
        let {html, text} = await (async () => {
            let results: Summary = { succeeded: [], failed: []};
            const recentJoins = mjolnir.roomJoins.getUsersInRoom(targetRoomId, minDate, maxEntries);

            switch (action) {
                case Action.Show: {
                    return makeJoinStatus(mjolnir, targetRoomId, maxEntries, minDate, maxAgeMS, recentJoins);
                }
                case Action.Kick: {
                    for (let join of recentJoins) {
                        try {
                            await mjolnir.client.kickUser(join.userId, targetRoomId, reason);
                            results.succeeded.push(join.userId);
                        } catch (ex) {
                            LogService.warn("SinceCommand", "Error while attempting to kick user", ex);
                            results.failed.push(join.userId);
                        }
                    }

                    return formatResult("kick", targetRoomId, recentJoins, results);
                }
                case Action.Ban: {
                    for (let join of recentJoins) {
                        try {
                            await mjolnir.client.banUser(join.userId, targetRoomId, reason);
                            results.succeeded.push(join.userId);
                        } catch (ex) {
                            LogService.warn("SinceCommand", "Error while attempting to ban user", ex);
                            results.failed.push(join.userId);
                        }
                    }

                    return formatResult("ban", targetRoomId, recentJoins, results);
                }
                case Action.Mute: {
                    const powerLevels = await mjolnir.client.getRoomStateEvent(targetRoomId, "m.room.power_levels", "") as {users: Record</* userId */ string, number>};

                    for (let join of recentJoins) {
                        powerLevels.users[join.userId] = -1;
                    }
                    try {
                        await mjolnir.client.sendStateEvent(targetRoomId, "m.room.power_levels", "", powerLevels);
                        for (let join of recentJoins) {
                            results.succeeded.push(join.userId);
                        }
                    } catch (ex) {
                        LogService.warn("SinceCommand", "Error while attempting to mute users", ex);
                        for (let join of recentJoins) {
                            results.failed.push(join.userId);
                        }
                    }

                    return formatResult("mute", targetRoomId, recentJoins, results);
                }
                case Action.Unmute: {
                    const powerLevels = await mjolnir.client.getRoomStateEvent(targetRoomId, "m.room.power_levels", "") as {users: Record</* userId */ string, number>, users_default?: number};
                    for (let join of recentJoins) {
                        // Restore default powerlevel.
                        delete powerLevels.users[join.userId];
                    }
                    try {
                        await mjolnir.client.sendStateEvent(targetRoomId, "m.room.power_levels", "", powerLevels);
                        for (let join of recentJoins) {
                            results.succeeded.push(join.userId);
                        }
                    } catch (ex) {
                        LogService.warn("SinceCommand", "Error while attempting to unmute users", ex);
                        for (let join of recentJoins) {
                            results.failed.push(join.userId);
                        }
                    }

                    return formatResult("unmute", targetRoomId, recentJoins, results);
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

function makeJoinStatus(mjolnir: Mjolnir, targetRoomId: string, maxEntries: number, minDate: Date, maxAgeMS: number, recentJoins: Join[]): {html: string, text: string} {
    const HUMANIZER_OPTIONS = {
        // Reduce "1 day" => "1day" to simplify working with CSV.
        spacer: "",
        // Reduce "1 day, 2 hours" => "1.XXX day" to simplify working with CSV.
        largest: 1,
    };
    const maxAgeHumanReadable = HUMANIZER.humanize(maxAgeMS);
    const htmlFragments = [];
    const textFragments = [];
    for (let join of recentJoins) {
        const durationHumanReadable = HUMANIZER.humanize(Date.now() - join.timestamp, HUMANIZER_OPTIONS);
        htmlFragments.push(`<li>${htmlEscape(join.userId)}: ${durationHumanReadable}</li>`);
        textFragments.push(`- ${join.userId}: ${durationHumanReadable}`);
    }
    return {
        html: `${recentJoins.length} recent joins (cut at ${maxAgeHumanReadable} ago / ${maxEntries} entries): <ul> ${htmlFragments.join()} </ul>`,
        text: `${recentJoins.length} recent joins (cut at ${maxAgeHumanReadable} ago / ${maxEntries} entries):\n${textFragments.join("\n")}`
    }
}
