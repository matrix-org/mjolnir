/*
Copyright 2025 The Matrix.org Foundation C.I.C.

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

import expect from "expect";
import { newTestUser } from "./clientHelper";
import { DoHttpRequestOpts } from "@vector-im/matrix-bot-sdk/src/http";

//TODO: get rid of the mocking once v12 is available to test against
describe("Test: Testing RoomV12 Permissions", function () {
    it("verifyPermissionsIn should correctly determine permissions in v12 room where bot is creator", async function () {
        const roomId = await this.mjolnir.client.createRoom({});
        // mock out the power level event for v12 room, ensuring the creator of the room is not in "users"
        this.mjolnir.client.getRoomStateEvent = (roomId: string, type: any, stateKey: any): Promise<any> => {
            let plEvent = {
                ban: 50,
                events: {
                    "m.room.name": 100,
                    "m.room.power_levels": 100,
                },
                events_default: 0,
                invite: 50,
                kick: 50,
                notifications: {
                    room: 20,
                },
                redact: 50,
                state_default: 50,
                users: {
                    "@definitelynotthebot:localhost": 100,
                },
                users_default: 0,
            };
            return Promise.resolve(plEvent);
        };
        const errors = await this.mjolnir.protectionManager.verifyPermissionsIn(roomId);
        expect(errors).toEqual([]);
    });

    it("verifyPermissionsIn should correctly determine permissions in v12 room where bot is not creator but has been given permissions", async function () {
        const mjolnirId = await this.mjolnir.client.getUserId();
        const notBot = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer" } });
        let roomID = await notBot.createRoom({ preset: "public_chat" });
        await this.mjolnir.client.joinRoom(roomID);
        await notBot.setUserPowerLevel(mjolnirId, roomID, 100);

        const errors = await this.mjolnir.protectionManager.verifyPermissionsIn(roomID);
        expect(errors).toEqual([]);
    });

    it("verifyPermissionsIn should correctly determine permissions in v12 room where bot is additional creator", async function () {
        const mjolnirId = await this.mjolnir.client.getUserId();

        // mock out the create event for v12 room, adding bot to "additional_creators"
        this.mjolnir.client.doRequest = (
            method: any,
            endpoint: any,
            qs: any,
            body: any,
            timeout: number,
            raw: boolean,
            contentType: string,
            noEncoding: boolean,
            opts: DoHttpRequestOpts,
        ): Promise<any> => {
            let createEvent = {
                type: "m.room.create",
                room_id: "!roomID",
                sender: "@somedude:localhost",
                content: {
                    room_version: "12",
                    creator: "@somedude:localhost",
                    additional_creators: [mjolnirId],
                },
                state_key: "",
                origin_server_ts: 1752704623219,
                unsigned: { age_ts: 1752704623219 },
            };
            return Promise.resolve(createEvent);
        };
        const errors = await this.mjolnir.protectionManager.verifyPermissionsIn("!roomID");
        expect(errors).toEqual([]);
    });

    it("verifyPermissionsIn should correctly determine permissions in v12 room where bot has no permissions", async function () {
        const notBot = await newTestUser(this.config.homeserverUrl, { name: { contains: "spammer" } });
        let roomID = await notBot.createRoom({ preset: "public_chat" });
        await this.mjolnir.client.joinRoom(roomID);

        const errors = await this.mjolnir.protectionManager.verifyPermissionsIn(roomID);
        expect(errors).toEqual([
            {
                errorKind: "permission",
                errorMessage: "Missing power level for bans: 0 < 50",
                roomId: roomID,
            },
            {
                errorKind: "permission",
                errorMessage: "Missing power level for kicks: 0 < 50",
                roomId: roomID,
            },
            {
                errorKind: "permission",
                errorMessage: "Missing power level for redactions: 0 < 50",
                roomId: roomID,
            },
            {
                errorKind: "permission",
                errorMessage: "Missing power level for server ACLs: 0 < 100",
                roomId: roomID,
            },
        ]);
    });
});
