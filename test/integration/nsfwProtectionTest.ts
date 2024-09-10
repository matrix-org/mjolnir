import {newTestUser} from "./clientHelper";

import {MatrixClient} from "matrix-bot-sdk";
import {getFirstReaction} from "./commands/commandUtils";
import {strict as assert} from "assert";
import { readFileSync } from 'fs';

describe("Test: NSFW protection", function () {
    let client: MatrixClient;
    let room: string;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, {name: {contains: "nsfw-protection"}});
        await client.start();
        const mjolnirId = await this.mjolnir.client.getUserId();
        room = await client.createRoom({ invite: [mjolnirId] });
        await client.joinRoom(room);
        await client.joinRoom(this.config.managementRoom);
        await client.setUserPowerLevel(mjolnirId, room, 100)
    })
    this.afterEach(async function () {
        await client.stop();
    })

    function delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    it("Nsfw protection doesn't redact sfw images", async function() {
        this.timeout(20000);

        await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${room}` });
        await getFirstReaction(client, this.mjolnir.managementRoomId, '✅', async () => {
                return await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir enable NsfwProtection` });
        });

        const data = readFileSync('test_tree.jpg')
        const mxc = await client.uploadContent(data, 'image/png')
        let content = {"msgtype": "m.image", "body": "test.jpeg", "url": mxc}
        let imageMessage = await client.sendMessage(room, content)

        await delay(500)
        let processedImage = await client.getEvent(room, imageMessage);
        assert.equal(Object.keys(processedImage.content).length, 3, "This event should not have been redacted");
    });

    it("Nsfw protection redacts nsfw images", async function() {
        this.timeout(20000);
        // dial the sensitivity on the protection way up so that all images are flagged as NSFW
        this.mjolnir.config.nsfwSensitivity = 0.0

        await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${room}` });
        await getFirstReaction(client, this.mjolnir.managementRoomId, '✅', async () => {
                return await client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir enable NsfwProtection` });
        });

        const data = readFileSync('test_tree.jpg')
        const mxc = await client.uploadContent(data, 'image/png')
        let content = {"msgtype": "m.image", "body": "test.jpeg", "url": mxc}
        let imageMessage = await client.sendMessage(room, content)

        await delay(500)
        let processedImage = await client.getEvent(room, imageMessage);
        assert.equal(Object.keys(processedImage.content).length, 0, "This event should have been redacted");
    });
});