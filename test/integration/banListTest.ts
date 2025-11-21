import { equal, fail, notEqual, rejects } from "node:assert/strict";
import { newTestUser } from "./clientHelper";
import { LogService, MatrixClient, Permalinks, UserID } from "@vector-im/matrix-bot-sdk";
import PolicyList, { ChangeType } from "../../src/models/PolicyList";
import { ServerAcl } from "../../src/models/ServerAcl";
import { getFirstReaction } from "./commands/commandUtils";
import { getMessagesByUserIn } from "../../src/utils";
import { Mjolnir } from "../../src/Mjolnir";
import { ALL_RULE_TYPES, Recommendation, RULE_SERVER, RULE_USER, SERVER_RULE_TYPES } from "../../src/models/ListRule";
import AccessControlUnit, { Access, EntityAccess } from "../../src/models/AccessControlUnit";
import { randomUUID } from "crypto";
import * as utils from "../../src/utils";

describe("Test: Updating the PolicyList", function () {
    it("Calculates what has changed correctly.", async function () {
        this.timeout(10000);
        const mjolnir: Mjolnir = this.mjolnir!;
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        const banListId = await mjolnir.client.createRoom({ invite: [await moderator.getUserId()] });
        const banList = new PolicyList(banListId, banListId, mjolnir.client);
        await mjolnir.client.setUserPowerLevel(await moderator.getUserId(), banListId, 100);

        equal(banList.allRules.length, 0);

        // Test adding a new rule
        await utils.createPolicyRule(mjolnir.client, banListId, RULE_USER, "@added:localhost:9999", "");
        let { changes } = await banList.updateList();
        equal(changes.length, 1, "There should only be one change");
        equal(changes[0].changeType, ChangeType.Added);
        equal(changes[0].sender, await mjolnir.client.getUserId());
        equal(banList.userRules.length, 1);
        equal(banList.allRules.length, 1);

        // Test modifiying a rule
        let originalEventId = await utils.createPolicyRule(
            mjolnir.client,
            banListId,
            RULE_USER,
            "@modified:localhost:9999",
            "",
        );
        await banList.updateList();
        let modifyingEventId = await utils.createPolicyRule(
            mjolnir.client,
            banListId,
            RULE_USER,
            "@modified:localhost:9999",
            "modified reason",
        );
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Modified);
        equal(
            changes[0].previousState["event_id"],
            originalEventId,
            "There should be a previous state event for a modified rule",
        );
        equal(changes[0].event["event_id"], modifyingEventId);
        let modifyingAgainEventId = await utils.createPolicyRule(
            mjolnir.client,
            banListId,
            RULE_USER,
            "@modified:localhost:9999",
            "modified again",
        );
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Modified);
        equal(
            changes[0].previousState["event_id"],
            modifyingEventId,
            "There should be a previous state event for a modified rule",
        );
        equal(changes[0].event["event_id"], modifyingAgainEventId);
        equal(
            banList.userRules.length,
            2,
            "There should be two rules, one for @modified:localhost:9999 and one for @added:localhost:9999",
        );

        // Test redacting a rule
        const redactThis = await utils.createPolicyRule(
            mjolnir.client,
            banListId,
            RULE_USER,
            "@redacted:localhost:9999",
            "",
        );
        await banList.updateList();
        equal(banList.userRules.filter((r) => r.entity === "@redacted:localhost:9999").length, 1);
        await mjolnir.client.redactEvent(banListId, redactThis);
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Removed);
        equal(
            changes[0].event["event_id"],
            redactThis,
            "Should show the new version of the event with redacted content",
        );
        equal(
            Object.keys(changes[0].event["content"]).length,
            0,
            "Should show the new version of the event with redacted content",
        );
        notEqual(Object.keys(changes[0].previousState["content"]), 0, "Should have a copy of the unredacted state");
        notEqual(changes[0].rule, undefined, "The previous rule should be present");
        equal(
            banList.userRules.filter((r) => r.entity === "@redacted:localhost:9999").length,
            0,
            "The rule should be removed.",
        );

        // Test soft redaction of a rule
        const softRedactedEntity = "@softredacted:localhost:9999";
        await utils.createPolicyRule(mjolnir.client, banListId, RULE_USER, softRedactedEntity, "");
        await banList.updateList();
        equal(banList.userRules.filter((r) => r.entity === softRedactedEntity).length, 1);
        await mjolnir.client.sendStateEvent(banListId, RULE_USER, `rule:${softRedactedEntity}`, {});
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Removed);
        equal(
            Object.keys(changes[0].event["content"]).length,
            0,
            "Should show the new version of the event with redacted content",
        );
        notEqual(Object.keys(changes[0].previousState["content"]), 0, "Should have a copy of the unredacted state");
        notEqual(changes[0].rule, undefined, "The previous rule should be present");
        equal(
            banList.userRules.filter((r) => r.entity === softRedactedEntity).length,
            0,
            "The rule should have been removed",
        );

        // Now test a double soft redaction just to make sure stuff doesn't explode
        await mjolnir.client.sendStateEvent(banListId, RULE_USER, `rule:${softRedactedEntity}`, {});
        changes = (await banList.updateList()).changes;
        equal(
            changes.length,
            0,
            "It shouldn't detect a double soft redaction as a change, it should be seen as adding an invalid rule.",
        );
        equal(
            banList.userRules.filter((r) => r.entity === softRedactedEntity).length,
            0,
            "The rule should have been removed",
        );

        // Test that different (old) rule types will be modelled as the latest event type.
        originalEventId = await utils.createPolicyRule(
            mjolnir.client,
            banListId,
            "org.matrix.mjolnir.rule.user",
            "@old:localhost:9999",
            "",
        );
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Added);
        equal(banList.userRules.filter((r) => r.entity === "@old:localhost:9999").length, 1);
        modifyingEventId = await utils.createPolicyRule(
            mjolnir.client,
            banListId,
            "m.room.rule.user",
            "@old:localhost:9999",
            "modified reason",
        );
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Modified);
        equal(changes[0].event["event_id"], modifyingEventId);
        equal(
            changes[0].previousState["event_id"],
            originalEventId,
            "There should be a previous state event for a modified rule",
        );
        equal(banList.userRules.filter((r) => r.entity === "@old:localhost:9999").length, 1);
        modifyingAgainEventId = await utils.createPolicyRule(
            mjolnir.client,
            banListId,
            RULE_USER,
            "@old:localhost:9999",
            "changes again",
        );
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Modified);
        equal(changes[0].event["event_id"], modifyingAgainEventId);
        equal(
            changes[0].previousState["event_id"],
            modifyingEventId,
            "There should be a previous state event for a modified rule",
        );
        equal(banList.userRules.filter((r) => r.entity === "@old:localhost:9999").length, 1);
    });
    it("Will remove rules with old types when they are 'soft redacted' with a different but more recent event type.", async function () {
        this.timeout(3000);
        const mjolnir: Mjolnir = this.mjolnir!;
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        const banListId = await mjolnir.client.createRoom({ invite: [await moderator.getUserId()] });
        const banList = new PolicyList(banListId, banListId, mjolnir.client);
        await mjolnir.client.setUserPowerLevel(await moderator.getUserId(), banListId, 100);

        const entity = "@old:localhost:9999";
        let originalEventId = await utils.createPolicyRule(mjolnir.client, banListId, "m.room.rule.user", entity, "");
        let { changes } = await banList.updateList();
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Added);
        equal(
            banList.userRules.filter((rule) => rule.entity === entity).length,
            1,
            "There should be a rule stored that we just added...",
        );
        let softRedactingEventId = await mjolnir.client.sendStateEvent(banListId, RULE_USER, `rule:${entity}`, {});
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Removed);
        equal(changes[0].event["event_id"], softRedactingEventId);
        equal(
            changes[0].previousState["event_id"],
            originalEventId,
            "There should be a previous state event for a modified rule",
        );
        equal(
            banList.userRules.filter((rule) => rule.entity === entity).length,
            0,
            "The rule should no longer be stored.",
        );
    });
    it("A rule of the most recent type won't be deleted when an old rule is deleted for the same entity.", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        const banListId = await mjolnir.client.createRoom({ invite: [await moderator.getUserId()] });
        const banList = new PolicyList(banListId, banListId, mjolnir.client);
        await mjolnir.client.setUserPowerLevel(await moderator.getUserId(), banListId, 100);

        const entity = "@old:localhost:9999";
        let originalEventId = await utils.createPolicyRule(mjolnir.client, banListId, "m.room.rule.user", entity, "");
        let { changes } = await banList.updateList();
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Added);
        equal(
            banList.userRules.filter((rule) => rule.entity === entity).length,
            1,
            "There should be a rule stored that we just added...",
        );
        let updatedEventId = await utils.createPolicyRule(mjolnir.client, banListId, RULE_USER, entity, "");
        changes = (await banList.updateList()).changes;
        // If in the future you change this and it fails, it's really subjective whether this constitutes a modification, since the only thing that has changed
        // is the rule type. The actual content is identical.
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Modified);
        equal(changes[0].event["event_id"], updatedEventId);
        equal(
            changes[0].previousState["event_id"],
            originalEventId,
            "There should be a previous state event for a modified rule",
        );
        equal(
            banList.userRules.filter((rule) => rule.entity === entity).length,
            1,
            "Only the latest version of the rule gets returned.",
        );

        // Now we delete the old version of the rule without consequence.
        await mjolnir.client.sendStateEvent(banListId, "m.room.rule.user", `rule:${entity}`, {});
        changes = (await banList.updateList()).changes;
        equal(changes.length, 0);
        equal(banList.userRules.filter((rule) => rule.entity === entity).length, 1, "The rule should still be active.");

        // And we can still delete the new version of the rule.
        let softRedactingEventId = await mjolnir.client.sendStateEvent(banListId, RULE_USER, `rule:${entity}`, {});
        changes = (await banList.updateList()).changes;
        equal(changes.length, 1);
        equal(changes[0].changeType, ChangeType.Removed);
        equal(changes[0].event["event_id"], softRedactingEventId);
        equal(
            changes[0].previousState["event_id"],
            updatedEventId,
            "There should be a previous state event for a modified rule",
        );
        equal(
            banList.userRules.filter((rule) => rule.entity === entity).length,
            0,
            "The rule should no longer be stored.",
        );
    });
    it("Test: PolicyList Supports all entity types.", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const banListId = await mjolnir.client.createRoom();
        const banList = new PolicyList(banListId, banListId, mjolnir.client);
        for (let i = 0; i < ALL_RULE_TYPES.length; i++) {
            await utils.createPolicyRule(mjolnir.client, banListId, ALL_RULE_TYPES[i], `*${i}*`, "");
        }
        let { changes } = await banList.updateList();
        equal(changes.length, ALL_RULE_TYPES.length);
        equal(banList.allRules.length, ALL_RULE_TYPES.length);
    });
});

describe("Test: We will not be able to ban ourselves via ACL.", function () {
    it("We do not ban ourselves when we put ourselves into the policy list.", async function () {
        const mjolnir: Mjolnir = this.mjolnir;
        const serverName = new UserID(await mjolnir.client.getUserId()).domain;
        const banListId = await mjolnir.client.createRoom();
        const banList = new PolicyList(banListId, banListId, mjolnir.client);
        const aclUnit = new AccessControlUnit([banList]);
        await utils.createPolicyRule(mjolnir.client, banListId, RULE_SERVER, serverName, "");
        await utils.createPolicyRule(mjolnir.client, banListId, RULE_SERVER, "evil.com", "");
        await utils.createPolicyRule(mjolnir.client, banListId, RULE_SERVER, "*", "");
        // We should still intern the matching rules rule.
        let { changes } = await banList.updateList();
        equal(banList.serverRules.length, 3);
        // But when we construct an ACL, we should be safe.
        const acl = new ServerAcl(serverName);
        changes.forEach((change) => acl.denyServer(change.rule.entity));
        equal(acl.safeAclContent().deny.length, 1);
        equal(acl.literalAclContent().deny.length, 3);

        const aclUnitAcl = aclUnit.compileServerAcl(serverName);
        equal(aclUnitAcl.literalAclContent().deny.length, 1);
    });
});

describe("Test: ACL updates will batch when rules are added in succession.", function () {
    it("Will batch ACL updates if we spam rules into a PolicyList", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const serverName: string = new UserID(await mjolnir.client.getUserId()).domain;
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        await moderator.joinRoom(mjolnir.managementRoomId);
        const mjolnirId = await mjolnir.client.getUserId();

        // Setup some protected rooms so we can check their ACL state later.
        const protectedRooms: string[] = [];
        for (let i = 0; i < 5; i++) {
            const room = await moderator.createRoom({ invite: [mjolnirId] });
            await mjolnir.client.joinRoom(room);
            await moderator.setUserPowerLevel(mjolnirId, room, 100);
            await mjolnir.addProtectedRoom(room);
            protectedRooms.push(room);
        }

        // If a previous test hasn't cleaned up properly, these rooms will be populated by bogus ACLs at this point.
        await mjolnir.protectedRoomsTracker.syncLists();
        await Promise.all(
            protectedRooms.map(async (room) => {
                // We're going to need timeline pagination I'm afraid.
                const roomAcl = await mjolnir.client.getRoomStateEvent(room, "m.room.server_acl", "");
                equal(roomAcl?.deny?.length ?? 0, 0, "There should be no entries in the deny ACL.");
            }),
        );

        // Flood the watched list with banned servers, which should prompt Mjolnir to update server ACL in protected rooms.
        const banListId = await moderator.createRoom({ invite: [mjolnirId] });
        await mjolnir.client.joinRoom(banListId);
        await mjolnir.policyListManager.watchList(Permalinks.forRoom(banListId));
        const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*");
        const evilServerCount = 200;
        for (let i = 0; i < evilServerCount; i++) {
            const badServer = `${i}.evil.com`;
            acl.denyServer(badServer);
            await utils.createPolicyRule(moderator, banListId, RULE_SERVER, badServer, `Rule #${i}`);
            // Give them a bit of a spread over time.
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        // We do this because it should force us to wait until all the ACL events have been applied.
        // Even if that does mean the last few events will not go through batching...
        await mjolnir.protectedRoomsTracker.syncLists();

        // At this point we check that the state within Mjolnir is internally consistent, this is just because debugging the following
        // is a pita.
        const list: PolicyList = this.mjolnir.policyListManager.lists[0]!;
        equal(list.serverRules.length, evilServerCount, `There should be ${evilServerCount} rules in here`);

        // Check each of the protected rooms for ACL events and make sure they were batched and are correct.
        await Promise.all(
            protectedRooms.map(async (room) => {
                const roomAcl = await mjolnir.client.getRoomStateEvent(room, "m.room.server_acl", "");
                if (!acl.matches(roomAcl)) {
                    fail(`Room ${room} doesn't have the correct ACL: ${JSON.stringify(roomAcl, null, 2)}`);
                }
                let aclEventCount = 0;
                await getMessagesByUserIn(mjolnir.client, mjolnirId, room, 100, (events) => {
                    events.forEach((event) => (event.type === "m.room.server_acl" ? (aclEventCount += 1) : null));
                });
                LogService.debug("PolicyListTest", `aclEventCount: ${aclEventCount}`);
                // If there's less than two then it means the ACL was updated by this test calling `this.mjolnir!.syncLists()`
                // and not the listener that detects changes to ban lists (that we want to test!).
                // It used to be 30, but it was too low, 70 seems better for CI.
                equal(
                    aclEventCount < 70 && aclEventCount > 2,
                    true,
                    "We should have sent less than 70 ACL events to each room because they should be batched",
                );
            }),
        );
    });
});

describe("Test: unbaning entities via the PolicyList.", function () {
    afterEach(function () {
        this.moderator?.stop();
    });
    it("Will remove rules that have legacy types", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const serverName: string = new UserID(await mjolnir.client.getUserId()).domain;
        const moderator: MatrixClient = await newTestUser(this.config.homeserverUrl, {
            name: { contains: "moderator" },
        });
        this.moderator = moderator;
        await moderator.joinRoom(mjolnir.managementRoomId);
        const mjolnirId = await mjolnir.client.getUserId();

        // We'll make 1 protected room to test ACLs in.
        const protectedRoom = await moderator.createRoom({ invite: [mjolnirId] });
        await mjolnir.client.joinRoom(protectedRoom);
        await moderator.setUserPowerLevel(mjolnirId, protectedRoom, 100);
        await mjolnir.addProtectedRoom(protectedRoom);

        // If a previous test hasn't cleaned up properly, these rooms will be populated by bogus ACLs at this point.
        await mjolnir.protectedRoomsTracker.syncLists();
        // If this is not present, then it means the room isn't being protected, which is really bad.
        const roomAcl = await mjolnir.client.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        equal(roomAcl?.deny?.length ?? 0, 0, "There should be no entries in the deny ACL.");

        // Create some legacy rules on a PolicyList.
        const banListId = await moderator.createRoom({ invite: [mjolnirId] });
        await moderator.setUserPowerLevel(await mjolnir.client.getUserId(), banListId, 100);
        await moderator.sendStateEvent(banListId, "org.matrix.mjolnir.shortcode", "", { shortcode: "unban-test" });
        await mjolnir.client.joinRoom(banListId);
        await mjolnir.policyListManager.watchList(Permalinks.forRoom(banListId));
        // we use this to compare changes.
        const banList = new PolicyList(banListId, banListId, moderator);
        // we need two because we need to test the case where an entity has all rule types in the list
        // and another one that only has one (so that we would hit 404 while looking up state)
        const olderBadServer = "old.evil.example";
        const newerBadServer = "new.evil.example";
        await Promise.all(
            SERVER_RULE_TYPES.map((type) =>
                utils.createPolicyRule(moderator, banListId, type, olderBadServer, "gregg rulz ok"),
            ),
        );
        await utils.createPolicyRule(moderator, banListId, RULE_SERVER, newerBadServer, "this is bad sort it out.");
        await utils.createPolicyRule(
            moderator,
            banListId,
            RULE_SERVER,
            newerBadServer,
            "hidden with a non-standard state key",
            undefined,
            "rule_1",
        );
        // Wait for the ACL event to be applied to our protected room.
        await mjolnir.protectedRoomsTracker.syncLists();

        await banList.updateList();
        // rules are normalized by rule type, that's why there should only be 3.
        equal(banList.allRules.length, 3);

        // Check that we have setup our test properly and therefore evil.example is banned.
        const acl = new ServerAcl(serverName)
            .denyIpAddresses()
            .allowServer("*")
            .denyServer(olderBadServer)
            .denyServer(newerBadServer);
        const protectedAcl = await mjolnir.client.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        if (!acl.matches(protectedAcl)) {
            fail(`Room ${protectedRoom} doesn't have the correct ACL: ${JSON.stringify(roomAcl, null, 2)}`);
        }

        // Now unban the servers, we will go via the unban command for completeness sake.
        try {
            await moderator.start();
            for (const server of [olderBadServer, newerBadServer]) {
                await getFirstReaction(moderator, mjolnir.managementRoomId, "✅", async () => {
                    return await moderator.sendMessage(mjolnir.managementRoomId, {
                        msgtype: "m.text",
                        body: `!mjolnir unban unban-test server ${server}`,
                    });
                });
            }
        } finally {
            moderator.stop();
        }

        // Wait for mjolnir to sync protected rooms to update ACL.
        await mjolnir.protectedRoomsTracker.syncLists();
        // Confirm that the server is unbanned.
        await banList.updateList();
        equal(banList.allRules.length, 0);
        const aclAfter = await mjolnir.client.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        equal(aclAfter.deny.length, 0, "Should be no servers denied anymore");
    });
});

describe("Test: should apply bans to the most recently active rooms first", function () {
    it("Applies bans to the most recently active rooms first", async function () {
        this.timeout(180000);
        const mjolnir: Mjolnir = this.mjolnir!;
        const serverName: string = new UserID(await mjolnir.client.getUserId()).domain;
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        await moderator.joinRoom(mjolnir.managementRoomId);
        const mjolnirId = await mjolnir.client.getUserId();

        // Setup some protected rooms so we can check their ACL state later.
        const protectedRooms: string[] = [];
        for (let i = 0; i < 10; i++) {
            const room = await moderator.createRoom({ invite: [mjolnirId] });
            await mjolnir.client.joinRoom(room);
            await moderator.setUserPowerLevel(mjolnirId, room, 100);
            await mjolnir.addProtectedRoom(room);
            protectedRooms.push(room);
        }

        // If a previous test hasn't cleaned up properly, these rooms will be populated by bogus ACLs at this point.
        await mjolnir.protectedRoomsTracker.syncLists();
        await Promise.all(
            protectedRooms.map(async (room) => {
                const roomAcl = await mjolnir.client
                    .getRoomStateEvent(room, "m.room.server_acl", "")
                    .catch((e) => (e.statusCode === 404 ? { deny: [] } : Promise.reject(e)));
                equal(roomAcl?.deny?.length ?? 0, 0, "There should be no entries in the deny ACL.");
            }),
        );

        // Flood the watched list with banned servers, which should prompt Mjolnir to update server ACL in protected rooms.
        const banListId = await moderator.createRoom({ invite: [mjolnirId] });
        await mjolnir.client.joinRoom(banListId);
        await mjolnir.policyListManager.watchList(Permalinks.forRoom(banListId));

        await mjolnir.protectedRoomsTracker.syncLists();

        // shuffle protected rooms https://stackoverflow.com/a/12646864, we do this so we can create activity "randomly" in them.
        for (let i = protectedRooms.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [protectedRooms[i], protectedRooms[j]] = [protectedRooms[j], protectedRooms[i]];
        }
        // create some activity in the same order.
        for (const roomId of protectedRooms.slice().reverse()) {
            await moderator.sendMessage(roomId, { body: `activity`, msgtype: "m.text" });
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        // check the rooms are in the expected order
        for (let i = 0; i < protectedRooms.length; i++) {
            equal(mjolnir.protectedRoomsTracker.protectedRoomsByActivity()[i], protectedRooms[i]);
        }

        // just ban one server
        const badServer = `evil.com`;
        const acl = new ServerAcl(serverName).denyIpAddresses().allowServer("*").denyServer(badServer);
        // collect all the rooms that received an ACL event.
        const aclRooms: any[] = await new Promise(async (resolve) => {
            const rooms: any[] = [];
            this.mjolnir.client.on("room.event", (room: string, event: any) => {
                if (protectedRooms.includes(room)) {
                    rooms.push(room);
                }
                if (rooms.length === protectedRooms.length) {
                    resolve(rooms);
                }
            });
            // create the rule that will ban the server.
            await utils.createPolicyRule(moderator, banListId, RULE_SERVER, badServer, `Rule ${badServer}`);
        });

        // Wait until all the ACL events have been applied.
        await mjolnir.protectedRoomsTracker.syncLists();

        for (let i = 0; i < protectedRooms.length; i++) {
            equal(aclRooms[i], protectedRooms[i], "The ACL should have been applied to the active rooms first.");
        }

        // Check that the most recently active rooms got the ACL update first.
        let last_event_ts = 0;
        for (const roomId of protectedRooms) {
            let roomAclEvent: null | any;
            // Can't be the best way to get the whole event, but ok.
            await getMessagesByUserIn(mjolnir.client, mjolnirId, roomId, 1, (events) => (roomAclEvent = events[0]));
            const roomAcl = roomAclEvent!.content;
            if (!acl.matches(roomAcl)) {
                fail(`Room ${roomId} doesn't have the correct ACL: ${JSON.stringify(roomAcl, null, 2)}`);
            }
            equal(
                roomAclEvent.origin_server_ts > last_event_ts,
                true,
                `This room was more recently active so should have the more recent timestamp`,
            );
            last_event_ts = roomAclEvent.origin_server_ts;
        }
    });
});

/**
 * Assert that the AccessUnitOutcome entity test has the right access.
 * @param expected The Access we expect the entity to have, See Access.
 * @param query The result of a test on AccessControlUnit e.g. `unit.getAccessForUser'@meow:localhost')`
 * @param message A message for the console if the entity doesn't have the expected access.
 */
function assertAccess(expected: Access, query: EntityAccess, message?: string) {
    equal(query.outcome, expected, message);
}

describe("Test: AccessControlUnit interaction with policy lists.", function () {
    it("The AccessControlUnit correctly reflects the policies that have been set in its watched lists.", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const policyListId = await mjolnir.client.createRoom();
        const policyList = new PolicyList(policyListId, Permalinks.forRoom(policyListId), mjolnir.client);
        const aclUnit = new AccessControlUnit([policyList]);
        assertAccess(
            Access.Allowed,
            aclUnit.getAccessForUser("@anyone:anywhere.example.com", "CHECK_SERVER"),
            "Empty lists should implicitly allow.",
        );

        await utils.createPolicyRule(mjolnir.client, policyListId, RULE_SERVER, "matrix.org", "", {
            recommendation: Recommendation.Allow,
        });
        // we want to imagine that the banned server was never taken off the allow after being banned.
        await utils.createPolicyRule(
            mjolnir.client,
            policyListId,
            RULE_SERVER,
            "bad.example.com",
            "",
            { recommendation: Recommendation.Allow },
            "something-else",
        );
        await utils.createPolicyRule(mjolnir.client, policyListId, RULE_SERVER, "bad.example.com", "", {
            recommendation: Recommendation.Ban,
        });
        await utils.createPolicyRule(mjolnir.client, policyListId, RULE_SERVER, "*.ddns.example.com", "", {
            recommendation: Recommendation.Ban,
        });

        await policyList.updateList();

        assertAccess(Access.Allowed, aclUnit.getAccessForServer("matrix.org"));
        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@someone:matrix.org", "CHECK_SERVER"));
        assertAccess(Access.NotAllowed, aclUnit.getAccessForServer("anywhere.else.example.com"));
        assertAccess(Access.NotAllowed, aclUnit.getAccessForUser("@anyone:anywhere.else.example.com", "CHECK_SERVER"));
        assertAccess(Access.Banned, aclUnit.getAccessForServer("bad.example.com"));
        assertAccess(Access.Banned, aclUnit.getAccessForUser("@anyone:bad.example.com", "CHECK_SERVER"));
        // They're not allowed in the first place, never mind that they are also banned.
        assertAccess(Access.NotAllowed, aclUnit.getAccessForServer("meow.ddns.example.com"));
        assertAccess(Access.NotAllowed, aclUnit.getAccessForUser("@anyone:meow.ddns.example.com", "CHECK_SERVER"));

        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@spam:matrix.org", "CHECK_SERVER"));
        await utils.createPolicyRule(mjolnir.client, policyListId, RULE_USER, "@spam:matrix.org", "", {
            recommendation: Recommendation.Ban,
        });
        await policyList.updateList();
        assertAccess(Access.Banned, aclUnit.getAccessForUser("@spam:matrix.org", "CHECK_SERVER"));
        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@someone:matrix.org", "CHECK_SERVER"));

        // protect a room and check that only bad.example.com, *.ddns.example.com are in the deny ACL and not matrix.org
        await mjolnir.policyListManager.watchList(policyList.roomRef);
        const protectedRoom = await mjolnir.client.createRoom();
        await mjolnir.protectedRoomsTracker.addProtectedRoom(protectedRoom);
        await mjolnir.protectedRoomsTracker.syncLists();
        const roomAcl = await mjolnir.client.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        equal(roomAcl?.deny?.length ?? 0, 2, "There should be two entries in the deny ACL.");
        for (const serverGlob of ["*.ddns.example.com", "bad.example.com"]) {
            equal((roomAcl?.deny ?? []).includes(serverGlob), true);
        }
        equal(roomAcl.deny.includes("matrix.org"), false);
        equal(roomAcl.allow.includes("matrix.org"), true);

        // Now we remove the rules and hope that everything functions noramally.
        await utils.removePolicyRule(mjolnir.client, policyListId, RULE_SERVER, "matrix.org");
        await utils.removePolicyRule(mjolnir.client, policyListId, RULE_SERVER, "bad.example.com", "something-else");
        await utils.removePolicyRule(mjolnir.client, policyListId, RULE_SERVER, "bad.example.com");
        await utils.removePolicyRule(mjolnir.client, policyListId, RULE_SERVER, "*.ddns.example.com");
        await utils.removePolicyRule(mjolnir.client, policyListId, RULE_USER, "@spam:matrix.org");
        const { changes } = await policyList.updateList();
        await mjolnir.protectedRoomsTracker.syncLists();

        equal(changes.length, 5, "The rules should have correctly been removed");
        assertAccess(Access.Allowed, aclUnit.getAccessForServer("matrix.org"));
        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@someone:matrix.org", "CHECK_SERVER"));
        assertAccess(Access.Allowed, aclUnit.getAccessForServer("anywhere.else.example.com"));
        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@anyone:anywhere.else.example.com", "CHECK_SERVER"));
        assertAccess(Access.Allowed, aclUnit.getAccessForServer("bad.example.com"));
        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@anyone:bad.example.com", "CHECK_SERVER"));
        assertAccess(Access.Allowed, aclUnit.getAccessForServer("meow.ddns.example.com"));
        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@anyone:meow.ddns.example.com", "CHECK_SERVER"));
        assertAccess(Access.Allowed, aclUnit.getAccessForUser("@spam:matrix.org", "CHECK_SERVER"));

        const roomAclAfter = await mjolnir.client.getRoomStateEvent(protectedRoom, "m.room.server_acl", "");
        equal(roomAclAfter.deny?.length ?? 0, 0, "There should be no entries in the deny ACL.");
        equal(roomAclAfter.allow?.length ?? 0, 1, "There should be 1 entry in the allow ACL.");
        equal(roomAclAfter.allow.includes("*"), true);
    });
    it("removing a rule from a different list will not clobber anything.", async function () {
        const mjolnir: Mjolnir = this.mjolnir!;
        const policyLists = await Promise.all(
            [...Array(2).keys()].map(async (_) => {
                const policyListId = await mjolnir.client.createRoom();
                return new PolicyList(policyListId, Permalinks.forRoom(policyListId), mjolnir.client);
            }),
        );
        const banMeServer = "banme.example.com";
        const aclUnit = new AccessControlUnit(policyLists);
        await Promise.all(
            policyLists.map((policyList) => {
                return utils.createPolicyRule(mjolnir.client, policyList.roomId, RULE_SERVER, banMeServer, "", {
                    recommendation: Recommendation.Ban,
                });
            }),
        );
        await Promise.all(policyLists.map((list) => list.updateList()));
        assertAccess(Access.Banned, aclUnit.getAccessForServer(banMeServer));

        // remove the rule that bans `banme.example.com` from just one of the lists.
        await utils.removePolicyRule(mjolnir.client, policyLists[0].roomId, RULE_SERVER, banMeServer);
        await Promise.all(policyLists.map((list) => list.updateList()));
        assertAccess(Access.Banned, aclUnit.getAccessForServer(banMeServer), "Should still be banned at this point.");
        await utils.removePolicyRule(mjolnir.client, policyLists[1].roomId, RULE_SERVER, banMeServer);
        await Promise.all(policyLists.map((list) => list.updateList()));
        assertAccess(Access.Allowed, aclUnit.getAccessForServer(banMeServer), "Should not longer be any rules");
    });
});

describe("Test: Creating policy lists.", function () {
    it("Will automatically invite and op users from invites", async function () {
        const mjolnir: Mjolnir = this.mjolnir;
        const testUsers = await Promise.all(
            [...Array(2)].map((_) => newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } })),
        );
        const invite = await Promise.all(testUsers.map((client) => client.getUserId()));
        const policyListId = await PolicyList.createList(mjolnir.client, randomUUID(), invite);
        // Check power levels are right.
        const powerLevelEvent = await mjolnir.client.getRoomStateEvent(policyListId, "m.room.power_levels", "");
        equal(Object.keys(powerLevelEvent.users ?? {}).length, invite.length + 1);
        // Check create event for MSC3784 support.
        const createEvent = await mjolnir.client.getRoomStateEvent(policyListId, "m.room.create", "");
        equal(createEvent.type, PolicyList.ROOM_TYPE);
        // We can't create rooms without forgetting the type.
        await rejects(async () => {
            await PolicyList.createList(mjolnir.client, randomUUID(), [], {
                creation_content: {},
            });
        }, TypeError);
    });
});
