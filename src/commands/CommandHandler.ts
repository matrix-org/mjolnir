/*
Copyright 2019-2022 The Matrix.org Foundation C.I.C.

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
import { execStatusCommand } from "./StatusCommand";
import { execBanCommand, execUnbanCommand } from "./UnbanBanCommand";
import { execDumpRulesCommand } from "./DumpRulesCommand";
import { extractRequestError, LogService, RichReply } from "matrix-bot-sdk";
import { htmlEscape } from "../utils";
import { execSyncCommand } from "./SyncCommand";
import { execPermissionCheckCommand } from "./PermissionCheckCommand";
import { execCreateListCommand } from "./CreateBanListCommand";
import { execUnwatchCommand, execWatchCommand } from "./WatchUnwatchCommand";
import { execRedactCommand } from "./RedactCommand";
import { execImportCommand } from "./ImportCommand";
import { execSetDefaultListCommand } from "./SetDefaultBanListCommand";
import { execDeactivateCommand } from "./DeactivateCommand";
import { execDisableProtection, execEnableProtection, execListProtections, execConfigGetProtection,
    execConfigSetProtection, execConfigAddProtection, execConfigRemoveProtection } from "./ProtectionsCommands";
import { execListProtectedRooms } from "./ListProtectedRoomsCommand";
import { execAddProtectedRoom, execRemoveProtectedRoom } from "./AddRemoveProtectedRoomsCommand";
import { execAddRoomToDirectoryCommand, execRemoveRoomFromDirectoryCommand } from "./AddRemoveRoomFromDirectoryCommand";
import { execSetPowerLevelCommand } from "./SetPowerLevelCommand";
import { execShutdownRoomCommand } from "./ShutdownRoomCommand";
import { execAddAliasCommand, execMoveAliasCommand, execRemoveAliasCommand, execResolveCommand } from "./AliasCommands";
import { execKickCommand } from "./KickCommand";


export const COMMAND_PREFIX = "!mjolnir";

export async function handleCommand(roomId: string, event: { content: { body: string } }, mjolnir: Mjolnir) {
    const cmd = event['content']['body'];
    const parts = cmd.trim().split(' ').filter(p => p.trim().length > 0);

    try {
        if (parts.length === 1 || parts[1] === 'status') {
            return await execStatusCommand(roomId, event, mjolnir, parts.slice(2));
        } else if (parts[1] === 'ban' && parts.length > 2) {
            return await execBanCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'unban' && parts.length > 2) {
            return await execUnbanCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'rules') {
            return await execDumpRulesCommand(roomId, event, mjolnir);
        } else if (parts[1] === 'sync') {
            return await execSyncCommand(roomId, event, mjolnir);
        } else if (parts[1] === 'verify') {
            return await execPermissionCheckCommand(roomId, event, mjolnir);
        } else if (parts.length >= 5 && parts[1] === 'list' && parts[2] === 'create') {
            return await execCreateListCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'watch' && parts.length > 1) {
            return await execWatchCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'unwatch' && parts.length > 1) {
            return await execUnwatchCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'redact' && parts.length > 1) {
            return await execRedactCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'import' && parts.length > 2) {
            return await execImportCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'default' && parts.length > 2) {
            return await execSetDefaultListCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'deactivate' && parts.length > 2) {
            return await execDeactivateCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'protections') {
            return await execListProtections(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'enable' && parts.length > 1) {
            return await execEnableProtection(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'disable' && parts.length > 1) {
            return await execDisableProtection(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'config' && parts[2] === 'set' && parts.length > 3) {
            return await execConfigSetProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (parts[1] === 'config' && parts[2] === 'add' && parts.length > 3) {
            return await execConfigAddProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (parts[1] === 'config' && parts[2] === 'remove' && parts.length > 3) {
            return await execConfigRemoveProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (parts[1] === 'config' && parts[2] === 'get') {
            return await execConfigGetProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (parts[1] === 'rooms' && parts.length > 3 && parts[2] === 'add') {
            return await execAddProtectedRoom(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'rooms' && parts.length > 3 && parts[2] === 'remove') {
            return await execRemoveProtectedRoom(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'rooms' && parts.length === 2) {
            return await execListProtectedRooms(roomId, event, mjolnir);
        } else if (parts[1] === 'move' && parts.length > 3) {
            return await execMoveAliasCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'directory' && parts.length > 3 && parts[2] === 'add') {
            return await execAddRoomToDirectoryCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'directory' && parts.length > 3 && parts[2] === 'remove') {
            return await execRemoveRoomFromDirectoryCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'alias' && parts.length > 4 && parts[2] === 'add') {
            return await execAddAliasCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'alias' && parts.length > 3 && parts[2] === 'remove') {
            return await execRemoveAliasCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'resolve' && parts.length > 2) {
            return await execResolveCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'powerlevel' && parts.length > 3) {
            return await execSetPowerLevelCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'shutdown' && parts[2] === 'room' && parts.length > 3) {
            return await execShutdownRoomCommand(roomId, event, mjolnir, parts);
        } else if (parts[1] === 'kick' && parts.length > 2) {
            return await execKickCommand(roomId, event, mjolnir, parts);
        } else {
            // Help menu
            const menu = "" +
                "!mjolnir                                                            - Print status information\n" +
                "!mjolnir status                                                     - Print status information\n" +
                "!mjolnir status protection <protection> [subcommand]                - Print status information for a protection\n" +
                "!mjolnir ban <list shortcode> <user|room|server> <glob> [reason]    - Adds an entity to the ban list\n" +
                "!mjolnir unban <list shortcode> <user|room|server> <glob> [apply]   - Removes an entity from the ban list. If apply is 'true', the users matching the glob will actually be unbanned\n" +
                "!mjolnir redact <user ID> [room alias/ID] [limit]                   - Redacts messages by the sender in the target room (or all rooms), up to a maximum number of events in the backlog (default 1000)\n" +
                "!mjolnir redact <event permalink>                                   - Redacts a message by permalink\n" +
                "!mjolnir kick <user ID> [room alias/ID] [reason]                    - Kicks a user in a particular room or all protected rooms\n" +
                "!mjolnir rules                                                      - Lists the rules currently in use by Mjolnir\n" +
                "!mjolnir sync                                                       - Force updates of all lists and re-apply rules\n" +
                "!mjolnir verify                                                     - Ensures Mjolnir can moderate all your rooms\n" +
                "!mjolnir list create <shortcode> <alias localpart>                  - Creates a new ban list with the given shortcode and alias\n" +
                "!mjolnir watch <room alias/ID>                                      - Watches a ban list\n" +
                "!mjolnir unwatch <room alias/ID>                                    - Unwatches a ban list\n" +
                "!mjolnir import <room alias/ID> <list shortcode>                    - Imports bans and ACLs into the given list\n" +
                "!mjolnir default <shortcode>                                        - Sets the default list for commands\n" +
                "!mjolnir deactivate <user ID>                                       - Deactivates a user ID\n" +
                "!mjolnir protections                                                - List all available protections\n" +
                "!mjolnir enable <protection>                                        - Enables a particular protection\n" +
                "!mjolnir disable <protection>                                       - Disables a particular protection\n" +
                "!mjolnir config set <protection>.<setting> [value]                  - Change a projection setting\n" +
                "!mjolnir config add <protection>.<setting> [value]                  - Add a value to a list protection setting\n" +
                "!mjolnir config remove <protection>.<setting> [value]               - Remove a value from a list protection setting\n" +
                "!mjolnir config get [protection]                                    - List protection settings\n" +
                "!mjolnir rooms                                                      - Lists all the protected rooms\n" +
                "!mjolnir rooms add <room alias/ID>                                  - Adds a protected room (may cause high server load)\n" +
                "!mjolnir rooms remove <room alias/ID>                               - Removes a protected room\n" +
                "!mjolnir move <room alias> <room alias/ID>                          - Moves a <room alias> to a new <room ID>\n" +
                "!mjolnir directory add <room alias/ID>                              - Publishes a room in the server's room directory\n" +
                "!mjolnir directory remove <room alias/ID>                           - Removes a room from the server's room directory\n" +
                "!mjolnir alias add <room alias> <target room alias/ID>              - Adds <room alias> to <target room>\n" +
                "!mjolnir alias remove <room alias>                                  - Deletes the room alias from whatever room it is attached to\n" +
                "!mjolnir resolve <room alias>                                       - Resolves a room alias to a room ID\n" +
                "!mjolnir shutdown room <room alias/ID> [message]                    - Uses the bot's account to shut down a room, preventing access to the room on this server\n" +
                "!mjolnir powerlevel <user ID> <power level> [room alias/ID]         - Sets the power level of the user in the specified room (or all protected rooms)\n" +
                "!mjolnir help                                                       - This menu\n";
            const html = `<b>Mjolnir help:</b><br><pre><code>${htmlEscape(menu)}</code></pre>`;
            const text = `Mjolnir help:\n${menu}`;
            const reply = RichReply.createFor(roomId, event, text, html);
            reply["msgtype"] = "m.notice";
            return await mjolnir.client.sendMessage(roomId, reply);
        }
    } catch (e) {
        LogService.error("CommandHandler", extractRequestError(e));
        const text = "There was an error processing your command - see console/log for details";
        const reply = RichReply.createFor(roomId, event, text, text);
        reply["msgtype"] = "m.notice";
        return await mjolnir.client.sendMessage(roomId, reply);
    }
}
