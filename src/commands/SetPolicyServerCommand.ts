/*
Copyright 2026 The Matrix.org Foundation C.I.C.

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
import { RichReply } from "@vector-im/matrix-bot-sdk";
import { PolicyServer } from "../PolicyServer";

// !mjolnir policy_server <name or "unset">
export async function execSetPolicyServerCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    if (parts.length !== 3) {
        await mjolnir.client.replyNotice(roomId, event, "Usage: !mjolnir policy_server <name or 'unset'>");
        return;
    }

    const name = parts[2].toLowerCase();
    const server = name === "unset" ? undefined : new PolicyServer(name);

    if (server) {
        const key = await server.getEd25519Key();
        if (!key) {
            const replyText = "Could not find a valid key for the policy server.";
            const reply = RichReply.createFor(roomId, event, replyText, replyText);
            reply["msgtype"] = "m.notice";
            await mjolnir.client.sendMessage(roomId, reply);
            return;
        }
    }

    await mjolnir.setPolicyServer(server);
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event["event_id"], "✅");
}
