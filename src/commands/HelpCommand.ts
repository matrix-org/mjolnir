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

import { Mjolnir, STATE_CHECKING_PERMISSIONS, STATE_NOT_STARTED, STATE_RUNNING, STATE_SYNCING } from "../Mjolnir";
import { RichReply } from "matrix-bot-sdk";
import * as htmlEscape from "escape-html";

export async function execSimpleHelpCommand(roomId: string, event: any, mjolnir: Mjolnir) {
    const menu = "" +
                "!mjolnir ban <list shortcode> <user|room|server> <glob> [reason]    - Adds an entity to the ban list\n" +
                "!mjolnir redact <user ID> [room alias/ID] [limit]                   - Redacts messages by the sender in the target room (or all rooms), up to a maximum number of events in the backlog (default 1000)\n" +
                "!mjolnir redact <event permalink>                                   - Redacts a message by permalink\n" +
                "!mjolnir rules                                                      - Lists the rules currently in use by Mjolnir\n" +
                "!mjolnir protections                                                - List all available protections\n" +
                "!mjolnir enable <protection>                                        - Enables a particular protection\n" +
                "!mjolnir move <room alias> <room alias/ID>                          - Moves a <room alias> to a new <room ID>\n" +
                "!mjolnir help all                                                   - List a full set of available commands\n";
            const html = `<b>Mjolnir help:</b><br><pre><code>${htmlEscape(menu)}</code></pre>`;
            const text = `Mjolnir help:\n${menu}`;
            const reply = RichReply.createFor(roomId, event, text, html);
            reply["msgtype"] = "m.notice";
            return await mjolnir.client.sendMessage(roomId, reply);
}

export async function execFullHelpCommand(roomId: string, event: any, mjolnir: Mjolnir) {
    const menu = "" +
                "!mjolnir                                                            - Print status information\n" +
                "!mjolnir status                                                     - Print status information\n" +
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
                "!mjolnir rooms                                                      - Lists all the protected rooms\n" +
                "!mjolnir rooms add <room alias/ID>                                  - Adds a protected room (may cause high server load)\n" +
                "!mjolnir rooms remove <room alias/ID>                               - Removes a protected room\n" +
                "!mjolnir move <room alias> <room alias/ID>                          - Moves a <room alias> to a new <room ID>\n" +
                "!mjolnir directory add <room alias/ID>                              - Publishes a room in the server's room directory\n" +
                "!mjolnir directory remove <room alias/ID>                           - Removes a room from the server's room directory\n" +
                "!mjolnir alias add <room alias> <target room alias/ID>              - Adds <room alias> to <target room>\n" +
                "!mjolnir alias remove <room alias>                                  - Deletes the room alias from whatever room it is attached to\n" +
                "!mjolnir resolve <room alias>                                       - Resolves a room alias to a room ID\n" +
                "!mjolnir shutdown room <room alias/ID>                              - Uses the bot's account to shut down a room, preventing access to the room on this server\n" +
                "!mjolnir powerlevel <user ID> <power level> [room alias/ID]         - Sets the power level of the user in the specified room (or all protected rooms)\n" +
                "!mjolnir help                                                       - Get a simple list of common commands\n";
                "!mjolnir help all                                                   - List a full set of available commands\n";
            const html = `<b>Mjolnir help:</b><br><pre><code>${htmlEscape(menu)}</code></pre>`;
            const text = `Mjolnir help:\n${menu}`;
            const reply = RichReply.createFor(roomId, event, text, html);
            reply["msgtype"] = "m.notice";
            return await mjolnir.client.sendMessage(roomId, reply);
}