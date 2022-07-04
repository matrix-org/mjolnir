import { strict as assert } from "assert";

import config from "../../src/config";
import { Mjolnir } from "../../src/Mjolnir";
import { IProtection } from "../../src/protections/IProtection";
import { PROTECTIONS } from "../../src/protections/protections";
import { ProtectionSettingValidationError } from "../../src/protections/ProtectionSettings";
import { NumberProtectionSetting, StringProtectionSetting, StringListProtectionSetting } from "../../src/protections/ProtectionSettings";
import { newTestUser, noticeListener } from "./clientHelper";
import { matrixClient, mjolnir } from "./mjolnirSetupUtils";

describe("Test: Report polling", function() {
    let client;
    this.beforeEach(async function () {
        client = await newTestUser({ name: { contains: "protection-settings" }});
        await client.start();
    })
    this.afterEach(async function () {
        await client.stop();
    })
    it("Mjolnir correctly retrieves a report from synapse", async function() {
        this.timeout(40000);

        const reportPromise = new Promise(async (resolve, reject) => {
            await this.mjolnir.registerProtection(new class implements IProtection {
                name = "jYvufI";
                description = "A test protection";
                settings = { };
                handleEvent = async (mjolnir: Mjolnir, roomId: string, event: any) => { };
                handleReport = (mjolnir: Mjolnir, roomId: string, reporterId: string, event: any, reason?: string) => {
                    if (reason === "x5h1Je") {
                        resolve(null);
                    }
                };
            });
        });
        await this.mjolnir.enableProtection("jYvufI");

        let protectedRoomId = await this.mjolnir.client.createRoom({ invite: [await client.getUserId()] });
        await client.joinRoom(protectedRoomId);
        await this.mjolnir.addProtectedRoom(protectedRoomId);

        const eventId = await client.sendMessage(protectedRoomId, {msgtype: "m.text", body: "uwNd3q"});
        await client.doRequest(
            "POST",
            `/_matrix/client/r0/rooms/${encodeURIComponent(protectedRoomId)}/report/${encodeURIComponent(eventId)}`, "", {
                reason: "x5h1Je"
            }
        );

        await reportPromise;
    });
});

