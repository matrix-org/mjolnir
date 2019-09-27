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
import { RichReply } from "matrix-bot-sdk";
import * as htmlEscape from "escape-html";

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
        // Help menu
        const menu = "" +
            "!mjolnir                                          - Print status information\n" +
            "!mjolnir status                                   - Print status information\n" +
            "!mjolnir ban <user|room|server> <glob> [reason]   - Adds an entity to the ban list\n" +
            "!mjolnir unban <user|room|server> <glob>          - Removes an entity from the ban list\n" +
            "!mjolnir rules                                    - Lists the rules currently in use by Mjolnir\n" +
            "!mjolnir help                                     - This menu\n";
        const html = `<b>Mjolnir help:</b><br><pre><code>${htmlEscape(menu)}</code></pre>`;
        const text = `Mjolnir help:\n${menu}`;
        const reply = RichReply.createFor(roomId, event, text, html);
        reply["msgtype"] = "m.notice";
        return mjolnir.client.sendMessage(roomId, reply);
    }
}
