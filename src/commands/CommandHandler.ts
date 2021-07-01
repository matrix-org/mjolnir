/*
Copyright 2019, 2020 The Matrix.org Foundation C.I.C.

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
import { execListProtectedRooms } from "./ListProtectedRoomsCommand";
import { execAddProtectedRoom, execRemoveProtectedRoom } from "./AddRemoveProtectedRoomsCommand";
import { execAddRoomToDirectoryCommand, execRemoveRoomFromDirectoryCommand } from "./AddRemoveRoomFromDirectoryCommand";
import { execSetPowerLevelCommand } from "./SetPowerLevelCommand";
import { execShutdownRoomCommand } from "./ShutdownRoomCommand";
import { execAddAliasCommand, execMoveAliasCommand, execRemoveAliasCommand, execResolveCommand } from "./AliasCommands";
import { execKickCommand } from "./KickCommand";
import { execSimpleHelpCommand, execFullHelpCommand } from "./HelpCommand";

export const COMMAND_PREFIX = "!mjolnir";

export async function handleCommand(roomId: string, event: any, mjolnir: Mjolnir) {
    const cmd = event['content']['body'];
    const parts = cmd.trim().split(' ').filter(p => p.trim().length > 0);

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
        } else if (parts[1] === 'help' && parts[2] === 'all') {
            return await execFullHelpCommand(roomId, event, mjolnir);
        } else {
            return await execSimpleHelpCommand(roomId, event, mjolnir);
        }
    } catch (e) {
        LogService.error("CommandHandler", e);
        const text = "There was an error processing your command - see console/log for details";
        const reply = RichReply.createFor(roomId, event, text, text);
        reply["msgtype"] = "m.notice";
        return await mjolnir.client.sendMessage(roomId, reply);
    }
}
