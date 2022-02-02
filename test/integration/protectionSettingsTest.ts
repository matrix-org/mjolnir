import { strict as assert } from "assert";

import config from "../../src/config";
import { Mjolnir } from "../../src/Mjolnir";
import { IProtection } from "../../src/protections/IProtection";
import { PROTECTIONS } from "../../src/protections/protections";
import { ProtectionSettingValidationError } from "../../src/protections/ProtectionSettings";
import { NumberProtectionSetting, StringProtectionSetting, StringListProtectionSetting } from "../../src/protections/ProtectionSettings";
import { newTestUser, noticeListener } from "./clientHelper";
import { matrixClient, mjolnir } from "./mjolnirSetupUtils";

describe("Test: Protection settings", function() {
    let client;
    this.beforeEach(async function () {
        client = await newTestUser({ name: { contains: "protection-settings" }});
        await client.start();
    })
    this.afterEach(async function () {
        await client.stop();
    })
    it("Mjolnir refuses to save invalid protection setting values", async function() {
        this.timeout(20000);
        await assert.rejects(
            async () => await this.mjolnir.setProtectionSettings("BasicFloodingProtection", {"maxPerMinute": "soup"}),
            ProtectionSettingValidationError
        );
    });
    it("Mjolnir successfully saves valid protection setting values", async function() {
        this.timeout(20000);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "05OVMS";
            description = "A test protection";
            settings = { test: new NumberProtectionSetting(3) };
        });

        await this.mjolnir.setProtectionSettings("05OVMS", { test: 123 });
        assert.equal(
            (await this.mjolnir.getProtectionSettings("05OVMS"))["test"],
            123
        );
    });
    it("Mjolnir should accumulate changed settings", async function() {
        this.timeout(20000);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "HPUjKN";
            settings = {
                test1: new NumberProtectionSetting(3),
                test2: new NumberProtectionSetting(4)
            };
        });

        await this.mjolnir.setProtectionSettings("HPUjKN", { test1: 1 });
        await this.mjolnir.setProtectionSettings("HPUjKN", { test2: 2 });
        const settings = await this.mjolnir.getProtectionSettings("HPUjKN");
        assert.equal(settings["test1"], 1);
        assert.equal(settings["test2"], 2);
    });
    it("Mjolnir responds to !set correctly", async function() {
        this.timeout(20000);
        await client.joinRoom(config.managementRoom);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "JY2TPN";
            description = "A test protection";
            settings = { test: new StringProtectionSetting() };
        });


        let reply = new Promise((resolve, reject) => {
            client.on('room.message', noticeListener(this.mjolnir.managementRoomId, (event) => {
                if (event.content.body.includes("Changed JY2TPN.test ")) {
                    resolve(event);
                }
            }))
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {msgtype: "m.text", body: "!mjolnir config set JY2TPN.test asd"})
        await reply

        const settings = await this.mjolnir.getProtectionSettings("JY2TPN");
        assert.equal(settings["test"], "asd");
    });
    it("Mjolnir adds a value to a list setting", async function() {
        this.timeout(20000);
        await client.joinRoom(config.managementRoom);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "r33XyT";
            description = "A test protection";
            settings = { test: new StringListProtectionSetting() };
        });


        let reply = new Promise((resolve, reject) => {
            client.on('room.message', noticeListener(this.mjolnir.managementRoomId, (event) => {
                if (event.content.body.includes("Changed r33XyT.test ")) {
                    resolve(event);
                }
            }))
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {msgtype: "m.text", body: "!mjolnir config add r33XyT.test asd"})
        await reply

        assert.deepEqual(await this.mjolnir.getProtectionSettings("r33XyT"), { "test": ["asd"] });
    });
    it("Mjolnir removes a value from a list setting", async function() {
        this.timeout(20000);
        await client.joinRoom(config.managementRoom);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "oXzT0E";
            description = "A test protection";
            settings = { test: new StringListProtectionSetting() };
        });

        let reply = () => new Promise((resolve, reject) => {
            client.on('room.message', noticeListener(this.mjolnir.managementRoomId, (event) => {
                if (event.content.body.includes("Changed oXzT0E.test ")) {
                    resolve(event);
                }
            }))
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {msgtype: "m.text", body: "!mjolnir config add oXzT0E.test asd"})
        await reply();
        await client.sendMessage(this.mjolnir.managementRoomId, {msgtype: "m.text", body: "!mjolnir config remove oXzT0E.test asd"})
        await reply();

        assert.deepEqual(await this.mjolnir.getProtectionSettings("oXzT0E"), { "test": [] });
    });
    it("Mjolnir will change a protection setting in-place", async function() {
        this.timeout(20000);
        await client.joinRoom(config.managementRoom);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "d0sNrt";
            description = "A test protection";
            settings = { test: new StringProtectionSetting() };
        });

        let replyPromise = new Promise((resolve, reject) => {
            let i = 0;
            client.on('room.message', noticeListener(this.mjolnir.managementRoomId, (event) => {
                if (event.content.body.includes("Changed d0sNrt.test ")) {
                    if (++i == 2) {
                        resolve(event);
                    }
                }
            }))
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {msgtype: "m.text", body: "!mjolnir config set d0sNrt.test asd1"})
        await client.sendMessage(this.mjolnir.managementRoomId, {msgtype: "m.text", body: "!mjolnir config set d0sNrt.test asd2"})
        assert.equal(
            (await replyPromise).content.body.split("\n", 3)[2],
            "Changed d0sNrt.test to asd2 (was asd1)"
        )
    });
});

