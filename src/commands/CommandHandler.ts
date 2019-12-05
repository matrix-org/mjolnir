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

import { Mjolnir } from "../Mjolnir";
import { execStatusCommand } from "./StatusCommand";
import { execBanCommand, execUnbanCommand } from "./UnbanBanCommand";
import { execDumpRulesCommand } from "./DumpRulesCommand";
import { LogService, RichReply } from "matrix-bot-sdk";
import * as htmlEscape from "escape-html";
import { execSyncCommand } from "./SyncCommand";
import { execPermissionCheckCommand } from "./PermissionCheckCommand";
import { execCreateListCommand } from "./CreateBanListCommand";
import { execUnwatchCommand, execWatchCommand } from "./WatchUnwatchCommand";
import { execRedactCommand } from "./RedactCommand";
import { execImportCommand } from "./ImportCommand";
import { execSetDefaultListCommand } from "./SetDefaultBanListCommand";
import { execDeactivateCommand } from "./DeactivateCommand";
import { execDisableProtection, execEnableProtection, execListProtections } from "./ProtectionsCommands";

export const COMMAND_PREFIX = "!mjolnir";

export async function handleCommand(roomId: string, event: any, mjolnir: Mjolnir) {
    const cmd = event['content']['body'];
    const parts = cmd.trim().split(' ');

    try {
        if (parts.length === 1 || parts[1] === 'status') {
            return await execStatusCommand(roomId, event, mjolnir);
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
        } else {
            // Help menu
            const menu = "" +
                "!mjolnir                                                            - Print status information\n" +
                "!mjolnir status                                                     - Print status information\n" +
                "!mjolnir ban <list shortcode> <user|room|server> <glob> [reason]    - Adds an entity to the ban list\n" +
                "!mjolnir unban <list shortcode> <user|room|server> <glob> [apply]   - Removes an entity from the ban list. If apply is 'true', the users matching the glob will actually be unbanned\n" +
                "!mjolnir redact <user ID> [room alias/ID]                           - Redacts messages by the sender in the target room (or all rooms)\n" +
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
                "!mjolnir help                                                       - This menu\n";
            const html = `<b>Mjolnir help:</b><br><pre><code>${htmlEscape(menu)}</code></pre>`;
            const text = `Mjolnir help:\n${menu}`;
            const reply = RichReply.createFor(roomId, event, text, html);
            reply["msgtype"] = "m.notice";
            return await mjolnir.client.sendMessage(roomId, reply);
        }
    } catch (e) {
        LogService.error("CommandHandler", e);
        const text = "There was an error processing your command - see console/log for details";
        const reply = RichReply.createFor(roomId, event, text, text);
        reply["msgtype"] = "m.notice";
        return await mjolnir.client.sendMessage(roomId, reply);
    }
}
