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
    it("Mjolnir correctly retreives a report from synapse", async function() {
        this.timeout(20000);

        const reportPromise = new Promise();

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "jYvufI";
            description = "A test protection";
            settings = { };
            handleReport = async (mjolnir: Mjolnir, roomId: string, reporterId: string, event: any, reason?: string) => {
                reportPromise.resolve(null);
            };
        });
        await this.mjolnir.enableProtection("jYvufI");

        const roomId = this.mjolnir.managementRoomId;
        await this.mjolnir.client.inviteUser(await client.getUserId(), roomId);
        await client.joinRoom(roomId);

        let reply = new Promise(async (resolve, reject) => {
            const messageId = await badUser.sendMesosage(roomId, {msgtype: "m.text", body: "uwNd3q"});
            badUser.on('room.event', (eventRoomId, event) => {
                if (
                    eventRoomId === roomId
                    && event?.event_id === messageId
                ) {
                    resolve(messageId);
                }
            });
        });
        const eventId = await reply;

        await client.doRequest(
            "POST",
            `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(eventId)}`, "", {
                reason: "dont like it :("
            }
        );

        await reportPromise;
    });
});

