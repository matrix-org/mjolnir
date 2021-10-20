import config from "../../src/config";
import { newTestUser, noticeListener } from "./clientHelper"

describe("Test: !help command", function() {
    let client;
    this.beforeEach(async function () {
        client = await newTestUser(true);
        await client.start();
    })
    this.afterEach(async function () {
        await client.stop();
    })
    it('Mjolnir responded to !mjolnir help', async function() {
        this.timeout(30000);
        console.log(`management room ${config.managementRoom}`);
        // send a messgage
        await client.joinRoom(config.managementRoom);
        // listener for getting the event reply
        let reply = new Promise((resolve, reject) => {
            client.on('room.message', noticeListener(config.managementRoom, (event) => {
                if (event.content.body.includes("Print status information")) {
                    resolve(event);
                }
            }))});
        // check we get one back
        console.log(config);
        await client.sendMessage(config.managementRoom, {msgtype: "m.text", body: "!mjolnir help"})
        await reply
    })
}) 
