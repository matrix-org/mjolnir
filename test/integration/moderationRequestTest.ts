import { strict as assert } from "assert";
import { ABUSE_REPORT_KEY } from "../../src/report/ReportManager";
import { newTestUser } from "./clientHelper";

const REPORT_NOTICE_REGEXPS = {
    reporter: /Filed by (?<reporterDisplay>[^ ]*) \((?<reporterId>[^ ]*)\)/,
    accused: /Against (?<accusedDisplay>[^ ]*) \((?<accusedId>[^ ]*)\)/,
    room: /Room (?<roomAliasOrId>[^ ]*)/,
    event: /Event (?<eventId>[^ ]*) Go to event/,
    content: /Content (?<eventContent>.*)/,
    comments: /Comments Comments (?<comments>.*)/,
    nature: /Nature (?<natureDisplay>[^(]*) \((?<natureSource>[^ ]*)\)/,
};

const EVENT_MODERATED_BY = "org.matrix.msc3215.room.moderation.moderated_by";
const EVENT_MODERATOR_OF = "org.matrix.msc3215.room.moderation.moderator_of";
const EVENT_MODERATION_REQUEST = "org.matrix.msc3215.abuse.report";

enum SetupMechanism {
    ManualCommand,
    Protection
}

describe("Test: Requesting moderation", async () => {
    it(`Mjölnir can setup a room for moderation requests using !mjolnir command`, async function() {
        // Create a few users and a room, make sure that Mjölnir is moderator in the room.
        let goodUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reporting-abuse-good-user" }});
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reporting-abuse-bad-user" }});

        let roomId = await goodUser.createRoom({ invite: [await badUser.getUserId(), await this.mjolnir.client.getUserId()] });
        await goodUser.inviteUser(await badUser.getUserId(), roomId);
        await badUser.joinRoom(roomId);
        await goodUser.setUserPowerLevel(await this.mjolnir.client.getUserId(), roomId, 100);

        // Setup moderated_by/moderator_of.
        await this.mjolnir.client.sendText(this.mjolnir.managementRoomId, `!mjolnir rooms setup ${roomId} reporting`);

        // Wait until moderated_by/moderator_of are setup
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                await goodUser.getRoomStateEvent(roomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY);
            } catch (ex) {
                console.log("moderated_by not setup yet, waiting");
                continue;
            }
            try {
                await this.mjolnir.client.getRoomStateEvent(this.mjolnir.managementRoomId, EVENT_MODERATOR_OF, roomId);
            } catch (ex) {
                console.log("moderator_of not setup yet, waiting");
                continue;
            }
            break;
        }
    });
    it(`Mjölnir can setup a room for moderation requests using room protections`, async function() {
        await this.mjolnir.protectionManager.enableProtection("LocalAbuseReports");

        // Create a few users and a room, make sure that Mjölnir is moderator in the room.
        let goodUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reporting-abuse-good-user" }});
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reporting-abuse-bad-user" }});

        let roomId = await goodUser.createRoom({ invite: [await badUser.getUserId(), await this.mjolnir.client.getUserId()] });
        await goodUser.inviteUser(await badUser.getUserId(), roomId);
        await badUser.joinRoom(roomId);
        await this.mjolnir.client.joinRoom(roomId);
        await goodUser.setUserPowerLevel(await this.mjolnir.client.getUserId(), roomId, 100);

        // Wait until Mjölnir has joined the room.
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const joinedRooms = await this.mjolnir.client.getJoinedRooms();
            console.debug("Looking for room", roomId, "in", joinedRooms);
            if (joinedRooms.some(joinedRoomId => joinedRoomId == roomId)) {
                break;
            } else {
                console.log("Mjölnir hasn't joined the room yet, waiting");
            }
        }

        // Setup moderated_by/moderator_of.
        this.mjolnir.addProtectedRoom(roomId);

        // Wait until moderated_by/moderator_of are setup
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                await goodUser.getRoomStateEvent(roomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY);
            } catch (ex) {
                console.log("moderated_by not setup yet, waiting");
                continue;
            }
            try {
                await this.mjolnir.client.getRoomStateEvent(this.mjolnir.managementRoomId, EVENT_MODERATOR_OF, roomId);
            } catch (ex) {
                console.log("moderator_of not setup yet, waiting");
                continue;
            }
            break;
        }
    });
    it(`Mjölnir propagates moderation requests`, async function() {
        this.timeout(90000);

        // Listen for any notices that show up.
        let notices: any[] = [];

        this.mjolnir.client.on("room.event", (roomId, event) => {
            if (roomId = this.mjolnir.managementRoomId) {
                notices.push(event);
            }
        });

        // Create a few users and a room, make sure that Mjölnir is moderator in the room.
        let goodUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reporting-abuse-good-user" }});
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reporting-abuse-bad-user" }});
        let goodUserId = await goodUser.getUserId();
        let badUserId = await badUser.getUserId();

        let roomId = await goodUser.createRoom({ invite: [await badUser.getUserId(), await this.mjolnir.client.getUserId()] });
        await goodUser.inviteUser(await badUser.getUserId(), roomId);
        await badUser.joinRoom(roomId);
        await goodUser.setUserPowerLevel(await this.mjolnir.client.getUserId(), roomId, 100);

        // Setup moderated_by/moderator_of.
        await this.mjolnir.client.sendText(this.mjolnir.managementRoomId, `!mjolnir rooms setup ${roomId} reporting`);

        // Prepare DM room to send moderation requests.
        let dmRoomId = await goodUser.createRoom({ invite: [await this.mjolnir.client.getUserId() ]});
        this.mjolnir.client.joinRoom(dmRoomId);

        // Wait until moderated_by/moderator_of are setup
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                await goodUser.getRoomStateEvent(roomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY);
            } catch (ex) {
                console.log("moderated_by not setup yet, waiting");
                continue;
            }
            try {
                await this.mjolnir.client.getRoomStateEvent(this.mjolnir.managementRoomId, EVENT_MODERATOR_OF, roomId);
            } catch (ex) {
                console.log("moderator_of not setup yet, waiting");
                continue;
            }
            break;
        }

        console.log("Test: Requesting moderation - send messages");
        // Exchange a few messages.
        let goodText = `GOOD: ${Math.random()}`; // Will NOT be reported.
        let badText = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let badText2 = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let badText3 = `<b>BAD</b>: ${Math.random()}`; // Will be reported as abuse.
        let badText4 = [...Array(1024)].map(_ => `${Math.random()}`).join(""); // Text is too long.
        let badText5 = [...Array(1024)].map(_ => "ABC").join("\n"); // Text has too many lines.
        let badEventId = await badUser.sendText(roomId, badText);
        let badEventId2 = await badUser.sendText(roomId, badText2);
        let badEventId3 = await badUser.sendText(roomId, badText3);
        let badEventId4 = await badUser.sendText(roomId, badText4);
        let badEventId5 = await badUser.sendText(roomId, badText5);
        let badEvent2Comment = `COMMENT: ${Math.random()}`;

        console.log("Test: Requesting moderation - send reports");
        let reportsToFind: any[] = []

        let sendReport = async ({eventId, nature, comment, text, textPrefix}: {eventId: string, nature: string, text?: string, textPrefix?: string, comment?: string}) => {
            await goodUser.sendRawEvent(dmRoomId, EVENT_MODERATION_REQUEST, {
                event_id: eventId,
                room_id: roomId,
                moderated_by_id: await this.mjolnir.client.getUserId(),
                nature,
                reporter: goodUserId,
                comment,
            });
            reportsToFind.push({
                reporterId: goodUserId,
                accusedId: badUserId,
                eventId,
                text,
                textPrefix,
                comment: comment || null,
                nature,
            });
        };

        // Without a comment.
        await sendReport({ eventId: badEventId, nature: "org.matrix.msc3215.abuse.nature.disagreement", text: badText });
        // With a comment.
        await sendReport({ eventId: badEventId2, nature: "org.matrix.msc3215.abuse.nature.toxic", text: badText2, comment: badEvent2Comment });
        // With html in the text.
        await sendReport({ eventId: badEventId3, nature: "org.matrix.msc3215.abuse.nature.illegal", text: badText3 });
        // With a long text.
        await sendReport({ eventId: badEventId4, nature: "org.matrix.msc3215.abuse.nature.spam", textPrefix: badText4.substring(0, 256) });
        // With a very long text.
        await sendReport({ eventId: badEventId5, nature: "org.matrix.msc3215.abuse.nature.other", textPrefix: badText5.substring(0, 256).split("\n").join(" ") });

        console.log("Test: Reporting abuse - wait");
        await new Promise(resolve => setTimeout(resolve, 1000));
        let found: any[] = [];
        for (let toFind of reportsToFind) {
            for (let event of notices) {
                if ("content" in event && "body" in event.content) {
                    if (!(ABUSE_REPORT_KEY in event.content) || event.content[ABUSE_REPORT_KEY].event_id != toFind.eventId) {
                        // Not a report or not our report.
                        continue;
                    }
                    let report = event.content[ABUSE_REPORT_KEY];
                    let body = event.content.body as string;
                    let matches: Map<string, RegExpMatchArray> | null = new Map();
                    for (let key of Object.keys(REPORT_NOTICE_REGEXPS)) {
                        let match = body.match(REPORT_NOTICE_REGEXPS[key]);
                        if (match) {
                            console.debug("We have a match", key, REPORT_NOTICE_REGEXPS[key], match.groups);
                        } else {
                            console.debug("Not a match", key, REPORT_NOTICE_REGEXPS[key]);
                            matches = null;
                            break;
                        }
                        matches.set(key, match);
                    }
                    if (!matches) {
                        // Not a report, skipping.
                        console.debug("Not a report, skipping");
                        continue;
                    }

                    assert(body.length < 3000, `The report shouldn't be too long ${body.length}`);
                    assert(body.split("\n").length < 200, "The report shouldn't have too many newlines.");

                    assert.equal(matches.get("event")!.groups!.eventId, toFind.eventId, "The report should specify the correct event id");;

                    assert.equal(matches.get("reporter")!.groups!.reporterId, toFind.reporterId, "The report should specify the correct reporter");
                    assert.equal(report.reporter_id, toFind.reporterId, "The embedded report should specify the correct reporter");
                    assert.ok(toFind.reporterId.includes(matches.get("reporter")!.groups!.reporterDisplay), "The report should display the correct reporter");

                    assert.equal(matches.get("accused")!.groups!.accusedId, toFind.accusedId, "The report should specify the correct accused");
                    assert.equal(report.accused_id, toFind.accusedId, "The embedded report should specify the correct accused");
                    assert.ok(toFind.accusedId.includes(matches.get("accused")!.groups!.accusedDisplay), "The report should display the correct reporter");

                    if (toFind.text) {
                        assert.equal(matches.get("content")!.groups!.eventContent, toFind.text, "The report should contain the text we inserted in the event");
                    }
                    if (toFind.textPrefix) {
                        assert.ok(matches.get("content")!.groups!.eventContent.startsWith(toFind.textPrefix), `The report should contain a prefix of the long text we inserted in the event: ${toFind.textPrefix} in? ${matches.get("content")!.groups!.eventContent}`);
                    }
                    if (toFind.comment) {
                        assert.equal(matches.get("comments")!.groups!.comments, toFind.comment, "The report should contain the comment we added");
                    }
                    assert.equal(matches.get("room")!.groups!.roomAliasOrId, roomId, "The report should specify the correct room");
                    assert.equal(report.room_id, roomId, "The embedded report should specify the correct room");
                    assert.equal(matches.get("nature")!.groups!.natureSource, toFind.nature, "The report should specify the correct nature");
                    found.push(toFind);
                    break;
                }
            }
        }
        assert.deepEqual(found, reportsToFind, `Found ${found.length} reports out of ${reportsToFind.length}`);
    });

    it('The redact action works', async function() {
        this.timeout(60000);

        // Listen for any notices that show up.
        let notices: any[] = [];
        this.mjolnir.client.on("room.event", (roomId, event) => {
            if (roomId = this.mjolnir.managementRoomId) {
                notices.push(event);
            }
        });

        // Create a moderator.
        let moderatorUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reporting-abuse-moderator-user" }});
        this.mjolnir.client.inviteUser(await moderatorUser.getUserId(), this.mjolnir.managementRoomId);
        await moderatorUser.joinRoom(this.mjolnir.managementRoomId);

        // Create a few users and a room.
        let goodUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reacting-abuse-good-user" }});
        let badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "reacting-abuse-bad-user" }});
        let goodUserId = await goodUser.getUserId();
        let badUserId = await badUser.getUserId();

        let roomId = await moderatorUser.createRoom({ invite: [await badUser.getUserId()] });
        await moderatorUser.inviteUser(await goodUser.getUserId(), roomId);
        await moderatorUser.inviteUser(await badUser.getUserId(), roomId);
        await badUser.joinRoom(roomId);
        await goodUser.joinRoom(roomId);

        // Setup Mjölnir as moderator for our room.
        await moderatorUser.inviteUser(await this.mjolnir.client.getUserId(), roomId);
        await moderatorUser.setUserPowerLevel(await this.mjolnir.client.getUserId(), roomId, 100);

        // Setup moderated_by/moderator_of.
        await this.mjolnir.client.sendText(this.mjolnir.managementRoomId, `!mjolnir rooms setup ${roomId} reporting`);

        // Prepare DM room to send moderation requests.
        let dmRoomId = await goodUser.createRoom({ invite: [await this.mjolnir.client.getUserId() ]});
        this.mjolnir.client.joinRoom(dmRoomId);

        // Wait until moderated_by/moderator_of are setup
        while (true) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            try {
                await goodUser.getRoomStateEvent(roomId, EVENT_MODERATED_BY, EVENT_MODERATED_BY);
            } catch (ex) {
                console.log("moderated_by not setup yet, waiting");
                continue;
            }
            try {
                await this.mjolnir.client.getRoomStateEvent(this.mjolnir.managementRoomId, EVENT_MODERATOR_OF, roomId);
            } catch (ex) {
                console.log("moderator_of not setup yet, waiting");
                continue;
            }
            break;
        }

        console.log("Test: Reporting abuse - send messages");
        // Exchange a few messages.
        let goodText = `GOOD: ${Math.random()}`; // Will NOT be reported.
        let badText = `BAD: ${Math.random()}`;   // Will be reported as abuse.
        let goodEventId = await goodUser.sendText(roomId, goodText);
        let badEventId = await badUser.sendText(roomId, badText);
        let goodEventId2 = await goodUser.sendText(roomId, goodText);

        console.log("Test: Reporting abuse - send reports");

        // Time to report.
        await goodUser.sendRawEvent(dmRoomId, EVENT_MODERATION_REQUEST, {
            event_id: badEventId,
            room_id: roomId,
            moderated_by_id: await this.mjolnir.client.getUserId(),
            nature: "org.matrix.msc3215.abuse.nature.test",
            reporter: goodUserId,
        });


        console.log("Test: Reporting abuse - wait");
        await new Promise(resolve => setTimeout(resolve, 1000));

        let mjolnirRooms = new Set(await this.mjolnir.client.getJoinedRooms());
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
        let buttons: any[] = [];
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
        let newBadEvent = await this.mjolnir.client.getEvent(roomId, badEventId);
        assert.deepEqual(Object.keys(newBadEvent.content), [], "Redaction should have removed the content of the offending event");
    });
});