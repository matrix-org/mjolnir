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
import { RichReply } from "matrix-bot-sdk";
import { Command, Lexer, Token } from "./Command";

// !mjolnir deactivate <user ID>
export class SetDefaultListCommand implements Command {
    public readonly command: 'deactivate';
    public readonly helpDescription: 'Deactivates a user ID';
    public readonly helpArgs: '<user ID>';
    async exec(mjolnir: Mjolnir, roomId: string, lexer: Lexer, event: any): Promise<void> {
        const victim = lexer.token(Token.USER_ID).text;
        const isAdmin = await mjolnir.isSynapseAdmin();
        if (!isAdmin) {
            const message = "I am not a Synapse administrator, or the endpoint is blocked";
            const reply = RichReply.createFor(roomId, event, message, message);
            reply['msgtype'] = "m.notice";
            mjolnir.client.sendMessage(roomId, reply);
            return;
        }

        await mjolnir.deactivateSynapseUser(victim);
        await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
    }
}
