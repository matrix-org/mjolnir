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

import { Mjolnir } from "../Mjolnir";
import PolicyList from "../models/PolicyList";
import { extractRequestError, LogLevel, LogService, MatrixGlob } from "matrix-bot-sdk";
import { RULE_ROOM, RULE_SERVER, RULE_USER, USER_RULE_TYPES } from "../models/ListRule";
import { DEFAULT_LIST_EVENT_TYPE } from "./SetDefaultBanListCommand";
import { defineApplicationCommand } from "./ApplicationCommand";
import { defineMatrixInterfaceCommand } from "./MatrixInterfaceCommand";
import { ValidationError, ValidationResult } from "./Validation";

type Arguments = Parameters<(mjolnir: Mjolnir, list: PolicyList, ruleType: string, entity: string, reason: string) => void>;

// Exported for tests
export async function parseArguments(mjolnir: Mjolnir, roomId: string, event: any, parts: string[]): Promise<ValidationResult<Arguments, ValidationError>> {
    let defaultShortcode: string | null = null;
    try {
        const data: { shortcode: string } = await mjolnir.client.getAccountData(DEFAULT_LIST_EVENT_TYPE);
        defaultShortcode = data['shortcode'];
    } catch (e) {
        LogService.warn("UnbanBanCommand", "Non-fatal error getting default ban list");
        LogService.warn("UnbanBanCommand", extractRequestError(e));

        // Assume no default.
    }

    const findList = (mjolnir: Mjolnir, shortcode: string): ValidationResult<PolicyList, ValidationError> => {
        const foundList = mjolnir.lists.find(b => b.listShortcode.toLowerCase() === shortcode.toLowerCase());
        if (foundList !== undefined) {
            return ValidationResult.Ok(foundList);
        } else {
            return ValidationResult.Err(ValidationError.makeValidationError('shortcode not found', `A list with the shourtcode ${shortcode} could not be found.`));
        }
    }

    let argumentIndex = 2;
    let ruleType: string | null = null;
    let entity: string | null = null;
    let list: ValidationResult<PolicyList, ValidationError>|null = null;
    let force = false;
    while (argumentIndex < 7 && argumentIndex < parts.length) {
        const arg = parts[argumentIndex++];
        if (!arg) break;
        if (["user", "room", "server"].includes(arg.toLowerCase())) {
            if (arg.toLowerCase() === 'user') ruleType = RULE_USER;
            if (arg.toLowerCase() === 'room') ruleType = RULE_ROOM;
            if (arg.toLowerCase() === 'server') ruleType = RULE_SERVER;
        } else if (!entity && (arg[0] === '@' || arg[0] === '!' || arg[0] === '#' || arg.includes("*"))) {
            entity = arg;
            if (arg.startsWith("@") && !ruleType) ruleType = RULE_USER;
            else if (arg.startsWith("#") && !ruleType) ruleType = RULE_ROOM;
            else if (arg.startsWith("!") && !ruleType) ruleType = RULE_ROOM;
            else if (!ruleType) ruleType = RULE_SERVER;
        } else if (!list) {
            list = findList(mjolnir, arg.toLocaleLowerCase());
        }

        if (entity) break;
    }

    if (parts[parts.length - 1] === "--force") {
        force = true;
        // Remove from parts to ease reason handling
        parts.pop();
    }

    if (!entity) {
        // It'll be a server at this point - figure out which positional argument is the server
        // name and where the reason starts.
        let serverIndex = 2;
        if (ruleType) serverIndex++;
        if (list) serverIndex++;
        entity = parts[serverIndex];
        if (!ruleType) ruleType = RULE_SERVER;
        argumentIndex = serverIndex + 1;
    }

    if (!list) {
        if (defaultShortcode) {
            list = await findList(mjolnir, defaultShortcode);
            if (list.isErr()) {
                return ValidationResult.Err(ValidationError.makeValidationError(
                    "shortcode not found",
                    `A shortcode was not provided for this command, and a list couldn't be found with the default shortcode ${defaultShortcode}`))
            }
        } else {
            // FIXME: should be turned into a utility function to find the default list.
            //        and in general, why is there a default shortcode instead of a default list?
            return ValidationResult.Err(ValidationError.makeValidationError(
                "no default shortcode",
                `A shortcode was not provided for this command, and a default shortcode was not set either.`
            ))
        }
    }

    if (list.isErr()) {
        return ValidationResult.Err(list.err);
    } else if (!ruleType) {
        return ValidationResult.Err(
            ValidationError.makeValidationError('uknown rule type', "Please specify the type as either 'user', 'room', or 'server'")
        );
    } else if (!entity) {
        return ValidationResult.Err(
            ValidationError.makeValidationError('no entity', "No entity was able to be parsed from this command")
        );
    } else if (mjolnir.config.commands.confirmWildcardBan && /[*?]/.test(entity) && !force) {
        return ValidationResult.Err(
            ValidationError.makeValidationError("wildcard required", "Wildcard bans require an additional `--force` argument to confirm")
        );
    }

    return ValidationResult.Ok([
        mjolnir,
        list.ok,
        ruleType,
        entity,
        parts.splice(argumentIndex).join(" ").trim(),
    ]);
}

const BAN_COMMAND = defineApplicationCommand([], async (mjonlir: Mjolnir, list: PolicyList, ruleType: string, entity: string, reason: string): Promise<void> => {
    await list.banEntity(ruleType, entity, reason);
});

// !mjolnir ban <shortcode> <user|server|room> <glob> [reason] [--force]
defineMatrixInterfaceCommand(["ban"],
    parseArguments,
    BAN_COMMAND,
    async function (mjolnir: Mjolnir, commandRoomId: string, event: any, result: void) {
        await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '✅');
    }
);

const UNBAN_COMMAND = defineApplicationCommand([], async (mjolnir: Mjolnir, list: PolicyList, ruleType: string, entity: string, reason: string): Promise<void> => {
    await list.unbanEntity(ruleType, entity);

    const unbanUserFromRooms = async () => {
        const rule = new MatrixGlob(entity);
        await mjolnir.managementRoomOutput.logMessage(LogLevel.INFO, "UnbanBanCommand", "Unbanning users that match glob: " + entity);
        let unbannedSomeone = false;
        for (const protectedRoomId of mjolnir.protectedRoomsTracker.getProtectedRooms()) {
            const members = await mjolnir.client.getRoomMembers(protectedRoomId, undefined, ['ban'], undefined);
            await mjolnir.managementRoomOutput.logMessage(LogLevel.DEBUG, "UnbanBanCommand", `Found ${members.length} banned user(s)`);
            for (const member of members) {
                const victim = member.membershipFor;
                if (member.membership !== 'ban') continue;
                if (rule.test(victim)) {
                    await mjolnir.managementRoomOutput.logMessage(LogLevel.DEBUG, "UnbanBanCommand", `Unbanning ${victim} in ${protectedRoomId}`, protectedRoomId);

                    if (!mjolnir.config.noop) {
                        await mjolnir.client.unbanUser(victim, protectedRoomId);
                    } else {
                        await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "UnbanBanCommand", `Attempted to unban ${victim} in ${protectedRoomId} but Mjolnir is running in no-op mode`, protectedRoomId);
                    }

                    unbannedSomeone = true;
                }
            }
        }

        if (unbannedSomeone) {
            await mjolnir.managementRoomOutput.logMessage(LogLevel.DEBUG, "UnbanBanCommand", `Syncing lists to ensure no users were accidentally unbanned`);
            await mjolnir.protectedRoomsTracker.syncLists(mjolnir.config.verboseLogging);
        }
    };

    if (USER_RULE_TYPES.includes(ruleType)) {
        mjolnir.unlistedUserRedactionHandler.removeUser(entity);
        if (reason === 'true') {
            await unbanUserFromRooms();
        } else {
            await mjolnir.managementRoomOutput.logMessage(LogLevel.WARN, "UnbanBanCommand", "Running unban without `unban <list> <user> true` will not override existing room level bans");
        }
    }
})

// !mjolnir unban <shortcode> <user|server|room> <glob> [apply:t/f]
defineMatrixInterfaceCommand(["unban"],
    parseArguments,
    UNBAN_COMMAND,
    async function (mjolnir: Mjolnir, commandRoomId: string, event: any, result: void) {
        await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '✅');
    }
);
