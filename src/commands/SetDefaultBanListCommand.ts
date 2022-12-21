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

export const DEFAULT_LIST_EVENT_TYPE = "org.matrix.mjolnir.default_list";

// !mjolnir default <shortcode>
export async function execSetDefaultListCommand(roomId: string, event: any, mjolnir: Mjolnir, parts: string[]) {
    const shortcode = parts[2];
    const list = mjolnir.policyListManager.lists.find(b => b.listShortcode === shortcode);
    if (!list) {
        const replyText = "No ban list with that shortcode was found.";
        const reply = RichReply.createFor(roomId, event, replyText, replyText);
        reply["msgtype"] = "m.notice";
        mjolnir.client.sendMessage(roomId, reply);
        return;
    }

    await mjolnir.client.setAccountData(DEFAULT_LIST_EVENT_TYPE, { shortcode });
    await mjolnir.client.unstableApis.addReactionToEvent(roomId, event['event_id'], '✅');
}
