import { strict as assert } from "assert";

import { newTestUser } from "../clientHelper";
import { getFirstReaction } from "./commandUtils";
import { MatrixClient } from "@vector-im/matrix-bot-sdk";

describe("Test: lockdown command", function () {
    let client: MatrixClient;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "lockdown-command" } });
        await client.start();
    });
    this.afterEach(async function () {
        await client.stop();
    });
    it("should lockdown a room", async function () {
        this.timeout(20000);
        const badRoom = await client.createRoom({ preset: "public_chat" });
        await client.joinRoom(this.mjolnir.managementRoomId);

        const reply1 = new Promise(async (resolve, reject) => {
            const msgid = await client.sendMessage(this.mjolnir.managementRoomId, {
                msgtype: "m.text",
                body: `!mjolnir lockdown lock ${badRoom}`,
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

        await reply1;

        const newJoinRules = await client.getRoomStateEvent(badRoom, "m.room.join_rules", "");
        console.log(newJoinRules);
    });
});
