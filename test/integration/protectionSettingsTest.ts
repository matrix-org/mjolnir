import { strict as assert } from "assert";

import { Mjolnir } from "../../src/Mjolnir";
import { Protection } from "../../src/protections/IProtection";
import { ProtectionSettingValidationError } from "../../src/protections/ProtectionSettings";
import {
    NumberProtectionSetting,
    StringProtectionSetting,
    StringListProtectionSetting,
} from "../../src/protections/ProtectionSettings";
import { newTestUser, noticeListener } from "./clientHelper";
import { matrixClient, mjolnir } from "./mjolnirSetupUtils";
import { MessageIsMedia } from "../../src/protections/MessageIsMedia";

describe("Test: Protection settings", function () {
    let client;
    let room;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "protection-settings" } });
        await client.start();
        room = await client.createRoom();
        await client.joinRoom(room);
    });
    this.afterEach(async function () {
        await client.stop();
    });
    it("Mjolnir refuses to save invalid protection setting values", async function () {
        this.timeout(20000);
        await assert.rejects(
            async () =>
                await this.mjolnir.protectionManager.setProtectionSettings("BasicFloodingProtection", {
                    maxPerMinute: "soup",
                }),
            ProtectionSettingValidationError,
        );
    });
    it("Mjolnir successfully saves valid protection setting values", async function () {
        this.timeout(20000);

        await this.mjolnir.protectionManager.registerProtection(
            new (class extends Protection {
                name = "05OVMS";
                description = "A test protection";
                settings = { test: new NumberProtectionSetting(3) };
            })(),
        );

        await this.mjolnir.protectionManager.setProtectionSettings("05OVMS", { test: 123 });
        assert.equal((await this.mjolnir.protectionManager.getProtectionSettings("05OVMS"))["test"], 123);
    });
    it("Mjolnir should accumulate changed settings", async function () {
        this.timeout(20000);

        await this.mjolnir.protectionManager.registerProtection(
            new (class extends Protection {
                name = "HPUjKN";
                description = "A test protection";
                settings = {
                    test1: new NumberProtectionSetting(3),
                    test2: new NumberProtectionSetting(4),
                };
            })(),
        );

        await this.mjolnir.protectionManager.setProtectionSettings("HPUjKN", { test1: 1 });
        await this.mjolnir.protectionManager.setProtectionSettings("HPUjKN", { test2: 2 });
        const settings = await this.mjolnir.protectionManager.getProtectionSettings("HPUjKN");
        assert.equal(settings["test1"], 1);
        assert.equal(settings["test2"], 2);
    });
    it("Mjolnir responds to !set correctly", async function () {
        this.timeout(20000);
        await client.joinRoom(this.config.managementRoom);

        await this.mjolnir.protectionManager.registerProtection(
            new (class extends Protection {
                name = "JY2TPN";
                description = "A test protection";
                settings = { test: new StringProtectionSetting() };
            })(),
        );

        let reply = new Promise((resolve, reject) => {
            client.on(
                "room.message",
                noticeListener(this.mjolnir.managementRoomId, (event) => {
                    if (event.content.body.includes("Changed JY2TPN.test ")) {
                        resolve(event);
                    }
                }),
            );
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: "!mjolnir config set JY2TPN.test asd",
        });
        await reply;

        const settings = await this.mjolnir.protectionManager.getProtectionSettings("JY2TPN");
        assert.equal(settings["test"], "asd");
    });
    it("Mjolnir adds a value to a list setting", async function () {
        this.timeout(20000);
        await client.joinRoom(this.config.managementRoom);

        await this.mjolnir.protectionManager.registerProtection(
            new (class extends Protection {
                name = "r33XyT";
                description = "A test protection";
                settings = { test: new StringListProtectionSetting() };
            })(),
        );

        let reply = new Promise((resolve, reject) => {
            client.on(
                "room.message",
                noticeListener(this.mjolnir.managementRoomId, (event) => {
                    if (event.content.body.includes("Changed r33XyT.test ")) {
                        resolve(event);
                    }
                }),
            );
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: "!mjolnir config add r33XyT.test asd",
        });
        await reply;

        assert.deepEqual(await this.mjolnir.protectionManager.getProtectionSettings("r33XyT"), { test: ["asd"] });
    });
    it("Mjolnir removes a value from a list setting", async function () {
        this.timeout(20000);
        await client.joinRoom(this.config.managementRoom);

        await this.mjolnir.protectionManager.registerProtection(
            new (class extends Protection {
                name = "oXzT0E";
                description = "A test protection";
                settings = { test: new StringListProtectionSetting() };
            })(),
        );

        let reply = () =>
            new Promise((resolve, reject) => {
                client.on(
                    "room.message",
                    noticeListener(this.mjolnir.managementRoomId, (event) => {
                        if (event.content.body.includes("Changed oXzT0E.test ")) {
                            resolve(event);
                        }
                    }),
                );
            });

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: "!mjolnir config add oXzT0E.test asd",
        });
        await reply();
        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: "!mjolnir config remove oXzT0E.test asd",
        });
        await reply();

        assert.deepEqual(await this.mjolnir.protectionManager.getProtectionSettings("oXzT0E"), { test: [] });
    });
    it("Mjolnir will change a protection setting in-place", async function () {
        this.timeout(20000);
        await client.joinRoom(this.config.managementRoom);

        await this.mjolnir.protectionManager.registerProtection(
            new (class extends Protection {
                name = "d0sNrt";
                description = "A test protection";
                settings = { test: new StringProtectionSetting() };
            })(),
        );

        await new Promise((resolve) => setTimeout(resolve, 5000));
        let replyPromise: Promise<any> = new Promise((resolve, reject) => {
            let i = 0;
            client.on(
                "room.message",
                noticeListener(this.mjolnir.managementRoomId, (event) => {
                    if (event.content.body.includes("Changed d0sNrt.test ")) {
                        if (++i == 2) {
                            resolve(event);
                        }
                    }
                }),
            );
        });

        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: "!mjolnir config set d0sNrt.test asd1",
        });
        await client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: "!mjolnir config set d0sNrt.test asd2",
        });
        assert.equal((await replyPromise).content.body.split("\n", 3)[2], "Changed d0sNrt.test to asd2 (was asd1)");
    });
    it("Events are checked for new content under media protections", async function () {
        this.timeout(20000);
        await client.joinRoom(this.config.managementRoom);

        await this.mjolnir.protectionManager.registerProtection(new MessageIsMedia());

        // send a regular media message to make sure protections are running
        await client.sendMessage(room, { msgtype: "m.image", body: "" });
        let reply = () =>
            new Promise((resolve, reject) => {
                client.on(
                    "room.message",
                    noticeListener(this.mjolnir.managementRoomId, (event) => {
                        if (event.content.body.includes("Redacting event")) {
                            resolve(event);
                        }
                    }),
                );
            });
        await reply;

        await client.sendMessage(room, {
            "body": "",
            "msgtype": "m.text",
            "m.new_content": { msgtype: "m.image", body: "" },
            "m.relates_to": { rel_type: "m.replace" },
        });
        let reply2 = () =>
            new Promise((resolve, reject) => {
                client.on(
                    "room.message",
                    noticeListener(this.mjolnir.managementRoomId, (event) => {
                        if (event.content.body.includes("Redacting event")) {
                            resolve(event);
                        }
                    }),
                );
            });
        await reply2;
    });
});
