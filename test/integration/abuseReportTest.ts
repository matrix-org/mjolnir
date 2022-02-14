import { strict as assert } from "assert";

import config from "../../src/config";
import { matrixClient } from "./mjolnirSetupUtils";
import { newTestUser } from "./clientHelper";
import { ReportManager, ABUSE_ACTION_CONFIRMATION_KEY, ABUSE_REPORT_KEY } from "../../src/report/ReportManager";

/**
 * Test the ability to turn abuse reports into room messages.
 */

const REPORT_NOTICE_REGEXPS = {
    reporter: /Filed by (?<reporterDisplay>[^ ]*) \((?<reporterId>[^ ]*)\)/,
    accused: /Against (?<accusedDisplay>[^ ]*) \((?<accusedId>[^ ]*)\)/,
    room: /Room (?<roomAliasOrId>[^ ]*)/,
    event: /Event (?<eventId>[^ ]*) Go to event/,
    content: /Content (?<eventContent>.*)/,
    comments: /Comments Comments (?<comments>.*)/
};


describe("Test: Reporting abuse", async () => {
    it('Mjölnir intercepts abuse reports', async function() {
        this.timeout(60000);

        // Listen for any notices that show up.
        let notices = [];
        matrixClient().on("room.event", (roomId, event) => {
            if (roomId = this.mjolnir.managementRoomId) {
                notices.push(event);
            }
        });

        // Create a few users and a room.
        let goodUser = await newTestUser({ name: { contains: "reporting-abuse-good-user" }});
        let badUser = await newTestUser({ name: { contains: "reporting-abuse-bad-user" }});
        let goodUserId = await goodUser.getUserId();
        let badUserId = await badUser.getUserId();

        let roomId = await goodUser.createRoom({ invite: [await badUser.getUserId()] });
        await goodUser.inviteUser(await badUser.getUserId(), roomId);
        await badUser.joinRoom(roomId);

        console.log("Test: Reporting abuse - send messages");
        // Exchange a few messages.
        let goodText = `GOOD: ${Math.random()}`; // Will NOT be reported.
        let badText = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let badText2 = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let badText3 = `<b>BAD</b>: ${Math.random()}`; // Will be reported as abuse.
        let badText4 = [...Array(1024)].map(_ => `${Math.random()}`).join(""); // Text is too long.
        let badText5 = [...Array(1024)].map(_ => "ABC").join("\n"); // Text has too many lines.
        let goodEventId = await goodUser.sendText(roomId, goodText);
        let badEventId = await badUser.sendText(roomId, badText);
        let badEventId2 = await badUser.sendText(roomId, badText2);
        let badEventId3 = await badUser.sendText(roomId, badText3);
        let badEventId4 = await badUser.sendText(roomId, badText4);
        let badEventId5 = await badUser.sendText(roomId, badText5);
        let badEvent2Comment = `COMMENT: ${Math.random()}`;

        console.log("Test: Reporting abuse - send reports");
        let reportsToFind = []

        // Time to report, first without a comment, then with one.
        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId)}`);
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId: badEventId,
                text: badText,
                comment: null,
            });
        } catch (e) {
            console.error("Could not send first report", e.body || e);
            throw e;
        }

        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId2)}`, "", {
                reason: badEvent2Comment
            });
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId: badEventId2,
                text: badText2,
                comment: badEvent2Comment,
            });
        } catch (e) {
            console.error("Could not send second report", e.body || e);
            throw e;
        }

        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId3)}`, "");
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId: badEventId3,
                text: badText3,
                comment: null,
            });
        } catch (e) {
            console.error("Could not send third report", e.body || e);
            throw e;
        }

        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId4)}`, "");
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId: badEventId4,
                text: null,
                textPrefix: badText4.substring(0, 256),
                comment: null,
            });
        } catch (e) {
            console.error("Could not send fourth report", e.body || e);
            throw e;
        }

        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId5)}`, "");
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId: badEventId5,
                text: null,
                textPrefix: badText5.substring(0, 256).split("\n").join(" "),
                comment: null,
            });
        } catch (e) {
            console.error("Could not send fifth report", e.body || e);
            throw e;
        }

        console.log("Test: Reporting abuse - wait");
        await new Promise(resolve => setTimeout(resolve, 1000));
        let found = [];
        for (let toFind of reportsToFind) {
            for (let event of notices) {
                if ("content" in event && "body" in event.content) {
                    if (!(ABUSE_REPORT_KEY in event.content) || event.content[ABUSE_REPORT_KEY].event_id != toFind.eventId) {
                        // Not a report or not our report.
                        continue;
                    }
                    let report = event.content[ABUSE_REPORT_KEY];
                    let body = event.content.body as string;
                    let matches = new Map();
                    for (let key of Object.keys(REPORT_NOTICE_REGEXPS)) {
                        let match = body.match(REPORT_NOTICE_REGEXPS[key]);
                        if (match) {
                            console.debug("We have a match", key, REPORT_NOTICE_REGEXPS[key], match.groups);
                        } else {
                            console.debug("Not a match", key, REPORT_NOTICE_REGEXPS[key]);
                            // Not a report, skipping.
                            matches = null;
                            break;
                        }
                        matches.set(key, match);
                    }
                    if (!matches) {
                        // Not a report, skipping.
                        continue;
                    }

                    assert(body.length < 3000, `The report shouldn't be too long ${body.length}`);
                    assert(body.split("\n").length < 200, "The report shouldn't have too many newlines.");

                    assert.equal(matches.get("event")!.groups.eventId, toFind.eventId, "The report should specify the correct event id");;

                    assert.equal(matches.get("reporter")!.groups.reporterId, toFind.reporterId, "The report should specify the correct reporter");
                    assert.equal(report.reporter_id, toFind.reporterId, "The embedded report should specify the correct reporter");
                    assert.ok(toFind.reporterId.includes(matches.get("reporter")!.groups.reporterDisplay), "The report should display the correct reporter");

                    assert.equal(matches.get("accused")!.groups.accusedId, toFind.accusedId, "The report should specify the correct accused");
                    assert.equal(report.accused_id, toFind.accusedId, "The embedded report should specify the correct accused");
                    assert.ok(toFind.accusedId.includes(matches.get("accused")!.groups.accusedDisplay), "The report should display the correct reporter");

                    if (toFind.text) {
                        assert.equal(matches.get("content")!.groups.eventContent, toFind.text, "The report should contain the text we inserted in the event");
                    }
                    if (toFind.textPrefix) {
                        assert.ok(matches.get("content")!.groups.eventContent.startsWith(toFind.textPrefix), `The report should contain a prefix of the long text we inserted in the event: ${toFind.textPrefix} in? ${matches.get("content")!.groups.eventContent}`);
                    }
                    if (toFind.comment) {
                        assert.equal(matches.get("comments")!.groups.comments, toFind.comment, "The report should contain the comment we added");
                    }
                    assert.equal(matches.get("room")!.groups.roomAliasOrId, roomId, "The report should specify the correct room");
                    assert.equal(report.room_id, roomId, "The embedded report should specify the correct room");
                    found.push(toFind);
                    break;
                }
            }
        }
        assert.deepEqual(found, reportsToFind);

        // Since Mjölnir is not a member of the room, the only buttons we should find
        // are `help` and `ignore`.
        for (let event of notices) {
            if (event.content && event.content["m.relates_to"] && event.content["m.relates_to"]["key"]) {
                let regexp = /\/([[^]]*)\]/;
                let matches = event.content["m.relates_to"]["key"].match(regexp);
                if (!matches) {
                    continue;
                }
                switch (matches[1]) {
                    case "bad-report":
                    case "help":
                        continue;
                    default:
                        throw new Error(`Didn't expect label ${matches[1]}`);
                }
            }
        }
    });
    it('The redact action works', async function() {
        this.timeout(60000);

        // Listen for any notices that show up.
        let notices = [];
        matrixClient().on("room.event", (roomId, event) => {
            if (roomId = this.mjolnir.managementRoomId) {
                notices.push(event);
            }
        });

        // Create a moderator.
        let moderatorUser = await newTestUser({ name: { contains: "reporting-abuse-moderator-user" }});
        matrixClient().inviteUser(await moderatorUser.getUserId(), this.mjolnir.managementRoomId);
        await moderatorUser.joinRoom(this.mjolnir.managementRoomId);

        // Create a few users and a room.
        let goodUser = await newTestUser({ name: { contains: "reacting-abuse-good-user" }});
        let badUser = await newTestUser({ name: { contains: "reacting-abuse-bad-user" }});
        let goodUserId = await goodUser.getUserId();
        let badUserId = await badUser.getUserId();

        let roomId = await moderatorUser.createRoom({ invite: [await badUser.getUserId()] });
        await moderatorUser.inviteUser(await goodUser.getUserId(), roomId);
        await moderatorUser.inviteUser(await badUser.getUserId(), roomId);
        await badUser.joinRoom(roomId);
        await goodUser.joinRoom(roomId);

        // Setup Mjölnir as moderator for our room.
        await moderatorUser.inviteUser(await matrixClient().getUserId(), roomId);
        await moderatorUser.setUserPowerLevel(await matrixClient().getUserId(), roomId, 100);

        console.log("Test: Reporting abuse - send messages");
        // Exchange a few messages.
        let goodText = `GOOD: ${Math.random()}`; // Will NOT be reported.
        let badText = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let goodEventId = await goodUser.sendText(roomId, goodText);
        let badEventId = await badUser.sendText(roomId, badText);
        let goodEventId2 = await goodUser.sendText(roomId, goodText);

        console.log("Test: Reporting abuse - send reports");

        // Time to report.
        let reportToFind = {
            reporterId: goodUserId,
            accusedId: badUserId,
            eventId: badEventId,
            text: badText,
            comment: null,
        };
        try {
            await goodUser.doRequest("POST", `/_matrix/client/r0/rooms/${encodeURIComponent(roomId)}/report/${encodeURIComponent(badEventId)}`);
        } catch (e) {
            console.error("Could not send first report", e.body || e);
            throw e;
        }

        console.log("Test: Reporting abuse - wait");
        await new Promise(resolve => setTimeout(resolve, 1000));

        let mjolnirRooms = new Set(await matrixClient().getJoinedRooms());
        assert.ok(mjolnirRooms.has(roomId), "Mjölnir should be a member of the room");

        // Find the notice
        let noticeId;
        for (let event of notices) {
            if ("content" in event && ABUSE_REPORT_KEY in event.content) {
                if (!(ABUSE_REPORT_KEY in event.content) || event.content[ABUSE_REPORT_KEY].event_id != badEventId) {
                    // Not a report or not our report.
                    continue;
                }
                noticeId = event.event_id;
                break;
            }
        }
        assert.ok(noticeId, "We should have found our notice");

        // Find the buttons.
        let buttons = [];
        for (let event of notices) {
            if (event["type"] != "m.reaction") {
                continue;
            }
            if (event["content"]["m.relates_to"]["rel_type"] != "m.annotation") {
                continue;
            }
            if (event["content"]["m.relates_to"]["event_id"] != noticeId) {
                continue;
            }
            buttons.push(event);
        }

        // Find the redact button... and click it.
        let redactButtonId = null;
        for (let button of buttons) {
            if (button["content"]["m.relates_to"]["key"].includes("[redact-message]")) {
                redactButtonId = button["event_id"];
                await moderatorUser.sendEvent(this.mjolnir.managementRoomId, "m.reaction", button["content"]);
                break;
            }
        }
        assert.ok(redactButtonId, "We should have found the redact button");

        await new Promise(resolve => setTimeout(resolve, 1000));

        // This should have triggered a confirmation request, with more buttons!
        let confirmEventId = null;
        for (let event of notices) {
            console.debug("Is this the confirm button?", event);
            if (!event["content"]["m.relates_to"]) {
                console.debug("Not a reaction");
                continue;
            }
            if (!event["content"]["m.relates_to"]["key"].includes("[confirm]")) {
                console.debug("Not confirm");
                continue;
            }
            if (!event["content"]["m.relates_to"]["event_id"] == redactButtonId) {
                console.debug("Not reaction to redact button");
                continue;
            }

            // It's the confirm button, click it!
            confirmEventId = event["event_id"];
            await moderatorUser.sendEvent(this.mjolnir.managementRoomId, "m.reaction", event["content"]);
            break;
        }
        assert.ok(confirmEventId, "We should have found the confirm button");

        await new Promise(resolve => setTimeout(resolve, 1000));

        // This should have redacted the message.
        let newBadEvent = await matrixClient().getEvent(roomId, badEventId);
        assert.deepEqual(Object.keys(newBadEvent.content), [], "Redaction should have removed the content of the offending event");
    });
});
