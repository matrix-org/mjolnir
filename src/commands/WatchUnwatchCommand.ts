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
import { Permalinks, RichReply } from "matrix-bot-sdk";
import { Command, Lexer, Token } from "./Command";

// !mjolnir watch <room alias or ID>
export class WatchCommand implements Command {
    public readonly command: 'watch';
    public readonly helpDescription: 'Watches a ban list';
    public readonly helpArgs: '<room alias/ID>';
    async exec(mjolnir: Mjolnir, roomID: string, lexer: Lexer, event: any): Promise<void> {
        const roomAliasOrID = lexer.token(Token.ROOM_ALIAS_OR_ID).text;
        const list = await mjolnir.watchList(Permalinks.forRoom(roomAliasOrID));
        if (!list) {
            const replyText = "Cannot watch list due to error - is that a valid room alias?";
            const reply = RichReply.createFor(roomID, event, replyText, replyText);
            reply["msgtype"] = "m.notice";
            mjolnir.client.sendMessage(roomID, reply);
            return;
        }
        await mjolnir.client.unstableApis.addReactionToEvent(roomID, event['event_id'], '✅');
    }
}

// !mjolnir unwatch <room alias or ID>
export class UnwatchCommand implements Command {
    public readonly command: 'unwatch';
    public readonly helpDescription: 'Unwatches a ban list';
    public readonly helpArgs: '<room alias/ID>';
    async exec(mjolnir: Mjolnir, roomID: string, lexer: Lexer, event: any): Promise<void> {
        const roomAliasOrID = lexer.token(Token.ROOM_ALIAS_OR_ID).text;
        const list = await mjolnir.unwatchList(Permalinks.forRoom(roomAliasOrID));
        if (!list) {
            const replyText = "Cannot unwatch list due to error - is that a valid room alias?";
            const reply = RichReply.createFor(roomID, event, replyText, replyText);
            reply["msgtype"] = "m.notice";
            mjolnir.client.sendMessage(roomID, reply);
            return;
        }
        await mjolnir.client.unstableApis.addReactionToEvent(roomID, event['event_id'], '✅');
    }
}
