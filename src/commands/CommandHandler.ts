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
import { StatusCommand } from "./StatusCommand";
import { BanCommand, UnbanCommand } from "./UnbanBanCommand";
import { DumpRulesCommand, RulesMatchingCommand } from "./DumpRulesCommand";
import { extractRequestError, LogService, RichReply } from "matrix-bot-sdk";
import { htmlEscape } from "../utils";
import { SyncCommand } from "./SyncCommand";
import { PermissionCheckCommand } from "./PermissionCheckCommand";
import { CreateListCommand } from "./CreateBanListCommand";
import { UnwatchCommand, WatchCommand } from "./WatchUnwatchCommand";
import { RedactPermalinkCommand, RedactUserCommand } from "./RedactCommand";
import { ImportCommand } from "./ImportCommand";
import { SetDefaultListCommand } from "./SetDefaultBanListCommand";
import { execDeactivateCommand } from "./DeactivateCommand";
import {
    execDisableProtection, execEnableProtection, execListProtections, execConfigGetProtection,
    execConfigSetProtection, execConfigAddProtection, execConfigRemoveProtection
} from "./ProtectionsCommands";
import { execListProtectedRooms } from "./ListProtectedRoomsCommand";
import { execAddProtectedRoom, execRemoveProtectedRoom } from "./AddRemoveProtectedRoomsCommand";
import { execAddRoomToDirectoryCommand, execRemoveRoomFromDirectoryCommand } from "./AddRemoveRoomFromDirectoryCommand";
import { execSetPowerLevelCommand } from "./SetPowerLevelCommand";
import { execShutdownRoomCommand } from "./ShutdownRoomCommand";
import { execAddAliasCommand, execMoveAliasCommand, execRemoveAliasCommand, execResolveCommand } from "./AliasCommands";
import { execMakeRoomAdminCommand } from "./MakeRoomAdminCommand";
import { execSinceCommand } from "./SinceCommand";
import { KickCommand } from "./KickCommand";

export function init(mjolnir: Mjolnir) {
    for (let command of [
        new StatusCommand(),
        new KickCommand(),
        new BanCommand(),
        new UnbanCommand(),
        new RulesMatchingCommand(),
        new DumpRulesCommand(),
        new SyncCommand(),
        new PermissionCheckCommand(),
        new CreateListCommand(),
        new WatchCommand(),
        new UnwatchCommand(),
        new RedactUserCommand(),
        new RedactPermalinkCommand(),
        new ImportCommand(),
        new SetDefaultListCommand(),
    ])
        mjolnir.commandManager.add(command);
}


export async function handleCommand(roomId: string, event: { content: { body: string } }, mjolnir: Mjolnir) {
    const line = event['content']['body'];
    const parts = line.trim().split(' ').filter(p => p.trim().length > 0);

    const lexer = new Lexer(line);
    lexer.token("command"); // Consume `!mjolnir`.
    // Extract command.
    const cmd = lexer.alternatives(
        () => lexer.token("id").text,
        () => null
    );

    try {
        if (cmd === 'deactivate' && parts.length > 2) {
            return await execDeactivateCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'protections') {
            return await execListProtections(roomId, event, mjolnir, parts);
        } else if (cmd === 'enable' && parts.length > 1) {
            return await execEnableProtection(roomId, event, mjolnir, parts);
        } else if (cmd === 'disable' && parts.length > 1) {
            return await execDisableProtection(roomId, event, mjolnir, parts);
        } else if (cmd === 'config' && parts[2] === 'set' && parts.length > 3) {
            return await execConfigSetProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (cmd === 'config' && parts[2] === 'add' && parts.length > 3) {
            return await execConfigAddProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (cmd === 'config' && parts[2] === 'remove' && parts.length > 3) {
            return await execConfigRemoveProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (cmd === 'config' && parts[2] === 'get') {
            return await execConfigGetProtection(roomId, event, mjolnir, parts.slice(3))
        } else if (cmd === 'rooms' && parts.length > 3 && parts[2] === 'add') {
            return await execAddProtectedRoom(roomId, event, mjolnir, parts);
        } else if (cmd === 'rooms' && parts.length > 3 && parts[2] === 'remove') {
            return await execRemoveProtectedRoom(roomId, event, mjolnir, parts);
        } else if (cmd === 'rooms' && parts.length === 2) {
            return await execListProtectedRooms(roomId, event, mjolnir);
        } else if (cmd === 'move' && parts.length > 3) {
            return await execMoveAliasCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'directory' && parts.length > 3 && parts[2] === 'add') {
            return await execAddRoomToDirectoryCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'directory' && parts.length > 3 && parts[2] === 'remove') {
            return await execRemoveRoomFromDirectoryCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'alias' && parts.length > 4 && parts[2] === 'add') {
            return await execAddAliasCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'alias' && parts.length > 3 && parts[2] === 'remove') {
            return await execRemoveAliasCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'resolve' && parts.length > 2) {
            return await execResolveCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'powerlevel' && parts.length > 3) {
            return await execSetPowerLevelCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'shutdown' && parts[2] === 'room' && parts.length > 3) {
            return await execShutdownRoomCommand(roomId, event, mjolnir, parts);
        } else if (cmd === 'since') {
            return await execSinceCommand(roomId, event, mjolnir, lexer);
        } else if (cmd === 'make' && parts[2] === 'admin' && parts.length > 3) {
            return await execMakeRoomAdminCommand(roomId, event, mjolnir, parts);
        } else {
            // Help menu
            const menu = "" +
                "!mjolnir kick <glob> [room alias/ID] [reason]                    - Kicks a user or all of those matching a glob in a particular room or all protected rooms\n" +
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
                "!mjolnir since <date>/<duration> <action> <limit> [rooms...] [reason] - Apply an action ('kick', 'ban', 'mute', 'unmute' or 'show') to all users who joined a room since <date>/<duration> (up to <limit> users)\n" +
                "!mjolnir shutdown room <room alias/ID> [message]                    - Uses the bot's account to shut down a room, preventing access to the room on this server\n" +
                "!mjolnir powerlevel <user ID> <power level> [room alias/ID]         - Sets the power level of the user in the specified room (or all protected rooms)\n" +
                "!mjolnir make admin <room alias> [user alias/ID]                    - Make the specified user or the bot itself admin of the room\n"
                ;
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
