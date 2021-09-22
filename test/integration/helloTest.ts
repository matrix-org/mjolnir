import { doesNotMatch } from "assert";
import { assert } from "console";
import config from "../../src/config";
import { newTestUser, noticeListener } from "./clientHelper"

// need the start and newTestUser and then the stop call to be in setup and tear down.
describe("help command", () => {
    let client;
    before(async function () {
        client = await newTestUser(true);
        await client.start();
    })
    it('Mjolnir responded to !mjolnir help', async function() {
        this.timeout(30000);
        // send a messgage
        await client.joinRoom(config.managementRoom);
        // listener for getting the event reply
        let reply = new Promise((resolve, reject) => {
            client.on('room.message', noticeListener(config.managementRoom, (event) => {
                console.log(event.event_id)
                if (event.content.body.includes("Print status information")) {
                    resolve(event);
                }
            }))});
        // check we get one back
        await client.sendMessage(config.managementRoom, {msgtype: "m.text", body: "!mjolnir help"})
        await reply
    })
    after(async function () {
        await client.stop();
    })
}) 
