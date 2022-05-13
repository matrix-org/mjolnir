import { strict as assert } from "assert";

import config from "../../src/config";
import { Mjolnir } from "../../src/Mjolnir";
import { IProtection } from "../../src/protections/IProtection";
import { newTestUser, noticeListener } from "./clientHelper";
import { matrixClient, mjolnir } from "./mjolnirSetupUtils";
import { ConsequenceType, Consequence } from "../../src/protections/consequence";

describe("Test: standard consequences", function() {
    let badUser;
    let goodUser;
    this.beforeEach(async function () {
        badUser = await newTestUser({ name: { contains: "standard-consequences" }});
        goodUser = await newTestUser({ name: { contains: "standard-consequences" }});
        await badUser.start();
        await goodUser.start();
    })
    this.afterEach(async function () {
        await badUser.stop();
        await goodUser.stop();
    })
    it("Mjolnir applies a standard consequence redaction", async function() {
        this.timeout(20000);

        let protectedRoomId = await this.mjolnir.client.createRoom({ invite: [await badUser.getUserId()] });
        await badUser.joinRoom(this.mjolnir.managementRoomId);
        await badUser.joinRoom(protectedRoomId);
        await this.mjolnir.addProtectedRoom(protectedRoomId);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "JY2TPN";
            description = "A test protection";
            settings = { };
            handleEvent = async (mjolnir: Mjolnir, roomId: string, event: any) => {
                if (event.content.body === "ngmWkF") {
                    return new Consequence(ConsequenceType.redact, "asd");
                }
            };
        });
        await this.mjolnir.enableProtection("JY2TPN");

        let reply = new Promise(async (resolve, reject) => {
            const messageId = await badUser.sendMessage(protectedRoomId, {msgtype: "m.text", body: "ngmWkF"});
            let redaction;
            badUser.on('room.event', (roomId, event) => {
                if (
                    roomId === protectedRoomId
                    && event?.type === "m.room.redaction"
                    && event.redacts === messageId
                ) {
                    redaction = event
                }
                if (
                    roomId === this.mjolnir.managementRoomId
                    && event?.type === "m.room.message"
                    && event?.content?.body?.startsWith("protection JY2TPN enacting redact against ")
                    && redaction !== undefined
                ) {
                    resolve([redaction, event])
                }
            });
        });

        const [eventRedact, eventMessage] = await reply
    });
    it("Mjolnir applies a standard consequence ban", async function() {
        this.timeout(20000);

        let protectedRoomId = await this.mjolnir.client.createRoom({ invite: [await badUser.getUserId()] });
        await badUser.joinRoom(this.mjolnir.managementRoomId);
        await badUser.joinRoom(protectedRoomId);
        await this.mjolnir.addProtectedRoom(protectedRoomId);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "0LxMTy";
            description = "A test protection";
            settings = { };
            handleEvent = async (mjolnir: Mjolnir, roomId: string, event: any) => {
                if (event.content.body === "7Uga3d") {
                    return new Consequence(ConsequenceType.ban, "asd");
                }
            };
        });
        await this.mjolnir.enableProtection("0LxMTy");

        let reply = new Promise(async (resolve, reject) => {
            const messageId = await badUser.sendMessage(protectedRoomId, {msgtype: "m.text", body: "7Uga3d"});
            let ban;
            badUser.on('room.leave', (roomId, event) => {
                if (
                    roomId === protectedRoomId
                    && event?.type === "m.room.member"
                    && event.content?.membership === "ban"
                    && event.state_key === badUser.userId
                ) {
                    ban = event;
                }
            });
            badUser.on('room.event', (roomId, event) => {
                if (
                    roomId === this.mjolnir.managementRoomId
                    && event?.type === "m.room.message"
                    && event?.content?.body?.startsWith("protection 0LxMTy enacting ban against ")
                    && ban !== undefined
                ) {
                    resolve([ban, event])
                }
            });
        });

        const [eventBan, eventMessage] = await reply
    });
    it("Mjolnir doesn't ban a good user", async function() {
        this.timeout(20000);

        let protectedRoomId = await this.mjolnir.client.createRoom({ invite: [await goodUser.getUserId(), await badUser.getUserId()] });
        await badUser.joinRoom(protectedRoomId);
        await goodUser.joinRoom(protectedRoomId);
        await this.mjolnir.addProtectedRoom(protectedRoomId);

        await this.mjolnir.registerProtection(new class implements IProtection {
            name = "95B1Cr";
            description = "A test protection";
            settings = { };
            handleEvent = async (mjolnir: Mjolnir, roomId: string, event: any) => {
                if (event.content.body === "8HUnwb") {
                    return new Consequence(ConsequenceType.ban, "asd");
                }
            };
        });
        await this.mjolnir.enableProtection("95B1Cr");

        let reply = new Promise(async (resolve, reject) => {
            this.mjolnir.client.on('room.message', async (roomId, event) => {
                if (event?.content?.body === "SUwvFT") {
                    await badUser.sendMessage(protectedRoomId, {msgtype: "m.text", body: "8HUnwb"});
                }
            });

            this.mjolnir.client.on('room.event', (roomId, event) => {
                if (
                    roomId === protectedRoomId
                    && event?.type === "m.room.member"
                    && event.content?.membership === "ban"
                ) {
                    if (event.state_key === goodUser.userId) {
                        reject("good user has been banned");
                    } else if (event.state_key === badUser.userId) {
                        resolve(null);
                    }
                }
            });
        });
        await goodUser.sendMessage(protectedRoomId, {msgtype: "m.text", body: "SUwvFT"});

        await reply
    });
});

