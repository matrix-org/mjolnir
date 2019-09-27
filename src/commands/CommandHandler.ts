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

export const COMMAND_PREFIX = "!mjolnir";

export function handleCommand(roomId: string, event: any, mjolnir: Mjolnir) {
    const cmd = event['content']['body'];
    const parts = cmd.trim().split(' ');

    if (parts.length === 1 || parts[1] === 'status') {
        return execStatusCommand(roomId, event, mjolnir);
    } else if (parts[1] === 'ban' && parts.length > 3) {
        return execBanCommand(roomId, event, mjolnir, parts);
    } else if (parts[1] === 'unban' && parts.length > 3) {
        return execUnbanCommand(roomId, event, mjolnir, parts);
    } else if (parts[1] === 'rules') {
        return execDumpRulesCommand(roomId, event, mjolnir);
    } else {
        // TODO: Help menu
    }
}
