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

import { MatrixClient } from "matrix-bot-sdk";
import BanList, { ALL_RULE_TYPES } from "./models/BanList";
import { applyServerAcls } from "./actions/ApplyAcl";
import { RoomUpdateError } from "./models/RoomUpdateError";
import { COMMAND_PREFIX, handleCommand } from "./commands/CommandHandler";

export class Mjolnir {
    constructor(
        public readonly client: MatrixClient,
        public readonly managementRoomId: string,
        public readonly publishedBanListRoomId: string,
        public readonly protectedRooms: { [roomId: string]: string },
        public readonly banLists: BanList[],
    ) {
        client.on("room.event", this.handleEvent.bind(this));

        client.on("room.message", async (roomId, event) => {
            if (roomId !== managementRoomId) return;
            if (!event['content']) return;

            const content = event['content'];
            if (content['msgtype'] === "m.text" && content['body'] && content['body'].startsWith(COMMAND_PREFIX)) {
                await client.sendReadReceipt(roomId, event['event_id']);
                return handleCommand(roomId, event, this);
            }
        });
    }

    public start() {
        return this.client.start();
    }

    private async handleEvent(roomId: string, event: any) {
        if (!event['state_key']) return; // we also don't do anything with state events that have no state key

        if (ALL_RULE_TYPES.includes(event['type'])) {
            let updated = false;
            for (const list of this.banLists) {
                if (list.roomId !== roomId) continue;
                await list.updateList();
                updated = true;
            }
            if (!updated) return;

            const errors = await applyServerAcls(this.banLists, Object.keys(this.protectedRooms), this.client);
            return this.printActionResult(errors);
        } else if (event['type'] === "m.room.member") {
            // TODO: Check membership against ban banLists
        }
    }

    private async printActionResult(errors: RoomUpdateError[]) {
        let html = "";
        let text = "";

        if (errors.length > 0) {
            html += `<font color="#ff0000"><b>${errors.length} errors updating protected rooms!</b></font><br /><ul>`;
            text += `${errors.length} errors updating protected rooms!\n`;
            for (const error of errors) {
                const url = this.protectedRooms[error.roomId] ? this.protectedRooms[error.roomId] : `https://matrix.to/#/${error.roomId}`;
                html += `<li><a href="${url}">${error.roomId}</a> - ${error.errorMessage}</li>`;
                text += `${url} - ${error.errorMessage}\n`;
            }
            html += "</ul>";
        } else {
            html += `<font color="#00cc00"><b>Updated all protected rooms with new rules successfully.</b></font>`;
            text += "Updated all protected rooms with new rules successfully";
        }

        const message = {
            msgtype: "m.notice",
            body: text,
            format: "org.matrix.custom.html",
            formatted_body: html,
        };
        return this.client.sendMessage(this.managementRoomId, message);
    }
}
