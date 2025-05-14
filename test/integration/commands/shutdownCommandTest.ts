import { strict as assert } from "assert";

import { newTestUser } from "../clientHelper";
import { getFirstReaction } from "./commandUtils";
import { MatrixClient } from "@vector-im/matrix-bot-sdk";

describe("Test: shutdown command", function () {
    let client: MatrixClient;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "shutdown-command" } });
        await client.start();
    });
    this.afterEach(async function () {
        await client.stop();
    });
    it("Mjolnir asks synapse to shut down a channel", async function () {
        this.timeout(20000);
        const badRoom = await client.createRoom();
        await client.joinRoom(this.mjolnir.managementRoomId);

        let reply1 = new Promise(async (resolve, reject) => {
            const msgid = await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir shutdown room ${badRoom} closure test`,
            });
            client.on("room.event", (roomId, event) => {
                if (
                    roomId === this.mjolnir.managementRoomId &&
                    event?.type === "m.reaction" &&
                    event.sender === this.mjolnir.client.userId &&
                    event.content?.["m.relates_to"]?.event_id === msgid
                ) {
                    resolve(event);
                }
            });
        });

        const reply2 = new Promise((resolve, reject) => {
            this.mjolnir.client.on("room.event", (roomId: string, event: any) => {
                if (
                    roomId !== this.mjolnir.managementRoomId &&
                    roomId !== badRoom &&
                    event?.type === "m.room.message" &&
                    event.sender === this.mjolnir.client.userId &&
                    event.content?.body === "closure test"
                ) {
                    resolve(event);
                }
            });
        });

        await reply1;
        await reply2;

        await assert.rejects(client.joinRoom(badRoom), (e: Error) => {
            return e.message.endsWith('{"errcode":"M_UNKNOWN","error":"This room has been blocked on this server"}');
        });
    });
    it("Mjolnir will not shutdown a room it is protecting.", async function () {
        this.timeout(20000);
        const targetRoom = await client.createRoom({ preset: "public_chat" });
        await client.joinRoom(this.mjolnir.managementRoomId);
        const otherUser = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "shutdown-command-extra" },
        });

        await getFirstReaction(client, this.mjolnir.managementRoomId, "✅", async () => {
            return await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir rooms add ${targetRoom}`,
            });
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir shutdown room ${targetRoom}`,
        });

        let reply = new Promise((resolve, reject) => {
            client.on("room.message", (roomId: string, event: any) => {
                console.log(JSON.stringify(event));
                if (
                    roomId === this.mjolnir.managementRoomId &&
                    event.content?.body.includes(
                        "You are attempting to shutdown a room that mjolnir currently protects, aborting",
                    )
                ) {
                    resolve(event);
                }
            });
        });
        await reply;
        // room should not be shutdown and available to join
        const joined = await otherUser.joinRoom(targetRoom);
        await otherUser.sendMessage(joined, { msgtype: "m.text", body: "it's fine to interact with this room" });
    });
});
