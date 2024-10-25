/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { MatrixClient, UserID } from "@vector-im/matrix-bot-sdk";
import { Mjolnir } from "../../src/Mjolnir";
import { newTestUser, noticeListener } from "./clientHelper";
import { strict as assert } from "assert";
import expect from "expect";

describe("Test: config.forwardMentionsToManagementRoom behaves correctly.", function () {
    let moderator: MatrixClient;
    this.beforeEach(async function () {
        moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        await moderator.start();
    });

    this.afterEach(async function () {
        moderator.stop();
    });

    it("correctly forwards a mention.", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const botUserId = await mjolnir.client.getUserId();
        mjolnir.config.forwardMentionsToManagementRoom = true;

        const mentioninguser = await newTestUser(this.config.homeserverUrl, { name: { contains: "mentioninguser" } });
        const mentioningUserId = await mentioninguser.getUserId();
        await moderator.joinRoom(mjolnir.managementRoomId);
        const protectedRoom = await moderator.createRoom({ preset: "public_chat" });
        await mjolnir.client.joinRoom(protectedRoom);
        await mentioninguser.joinRoom(protectedRoom);
        await mjolnir.protectedRoomsTracker.addProtectedRoom(protectedRoom);

        await moderator.start();
        const noticeBody = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Timed out waiting for notice")), 8000);
            moderator.on(
                "room.message",
                noticeListener(this.mjolnir.managementRoomId, (event) => {
                    if (event.content.body.includes(`Bot mentioned`)) {
                        clearTimeout(timeout);
                        resolve(event.content.body);
                    }
                }),
            );
        });

        const mentionEventId = await mentioninguser.sendMessage(protectedRoom, {
            msgtype: "m.text",
            body: "Moderator: Testing this",
            ["m.mentions"]: {
                user_ids: [botUserId],
            },
        });
        const domain = new UserID(mentioningUserId).domain;

        assert.equal(
            await noticeBody,
            `Bot mentioned ${protectedRoom} by ${mentioningUserId} in https://matrix.to/#/${protectedRoom}/${mentionEventId}?via=${domain}`,
            "Forwarded mention format mismatch",
        );
    });

    it("only forwards the first mention from a user.", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const botUserId = await mjolnir.client.getUserId();
        mjolnir.config.forwardMentionsToManagementRoom = true;

        const mentioninguser = await newTestUser(this.config.homeserverUrl, { name: { contains: "mentioninguser" } });
        await moderator.joinRoom(mjolnir.managementRoomId);
        const protectedRoom = await moderator.createRoom({ preset: "public_chat" });
        await mjolnir.client.joinRoom(protectedRoom);
        await mentioninguser.joinRoom(protectedRoom);
        await mjolnir.protectedRoomsTracker.addProtectedRoom(protectedRoom);

        await moderator.start();
        let mentionCount = 0;
        moderator.on(
            "room.message",
            noticeListener(this.mjolnir.managementRoomId, (event) => {
                if (event.content.body.includes(`Bot mentioned`)) {
                    mentionCount++;
                }
            }),
        );

        function delay(ms: number) {
            return new Promise((resolve) => setTimeout(resolve, ms));
        }

        for (let index = 0; index < 5; index++) {
            await mentioninguser.sendMessage(protectedRoom, {
                msgtype: "m.text",
                body: `Moderator: Testing this ${index}`,
                ["m.mentions"]: {
                    user_ids: [botUserId],
                },
            });
            await delay(2000);
        }

        expect(mentionCount).toBe(1);
    });
});
