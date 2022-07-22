/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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
import { redactUserMessagesIn } from "../utils";
import { Permalinks } from "matrix-bot-sdk";
import { Command, Lexer, Token } from "./Command";

// !mjolnir redact <user ID> [room alias] [limit]
export class RedactUserCommand implements Command {
    public readonly command: 'redact';
    public readonly helpDescription: 'Redacts messages by the sender in the target room (or all rooms), up to a maximum number of events in the backlog (default 1000)';
    public readonly helpArgs: '<user ID> [room alias/ID] [limit]';

    // This variant of `redact` accepts a user id.
    accept(lexer: Lexer): boolean {
        return lexer.alternatives(
            () => { lexer.token(Token.USER_ID); return true; },
            () => false
        )
    }
    async exec(mjolnir: Mjolnir, commandRoomId: string, lexer: Lexer, event: any): Promise<void> {
        const userID = lexer.token(Token.USER_ID).text;
        const maybeRoomAliasOrID = lexer.alternatives(
            () => lexer.token(Token.ROOM_ALIAS_OR_ID).text,
            () => null
        );
        const limit = lexer.alternatives(
            () => lexer.token(Token.INT).value,
            () => 1000
        );


        const processingReactionId = await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], 'In Progress');
        const targetRoomIds = maybeRoomAliasOrID ? [await mjolnir.client.resolveRoom(maybeRoomAliasOrID)] : Object.keys(mjolnir.protectedRooms);

        await redactUserMessagesIn(mjolnir, userID, targetRoomIds, limit);

        await mjolnir.client.unstableApis.addReactionToEvent(commandRoomId, event['event_id'], '✅');
        await mjolnir.client.redactEvent(commandRoomId, processingReactionId, 'done processing');
    }
}

// !mjolnir redact <event permalink>
export class RedactPermalinkCommand implements Command {
    public readonly command: 'redact';
    public readonly helpDescription: 'Redacts a message by permalink';
    public readonly helpArgs: '<event permalink>';
    // This variant of `redact` accepts a permalink.
    accept(lexer: Lexer): boolean {
        return lexer.alternatives(
            () => { lexer.token(Token.PERMALINK); return true; },
            () => false
        )
    }
    async exec(mjolnir: Mjolnir, roomId: string, lexer: Lexer, event: any): Promise<void> {
        const processingReactionId = await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], 'In Progress');
        const parsed = Permalinks.parseUrl(lexer.token(Token.PERMALINK).text);
        const targetRoomId = await mjolnir.client.resolveRoom(parsed.roomIdOrAlias);
        await mjolnir.client.redactEvent(targetRoomId, parsed.eventId);
        await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
        await mjolnir.client.redactEvent(roomId, processingReactionId, 'done processing command');
        return;
    }
}
