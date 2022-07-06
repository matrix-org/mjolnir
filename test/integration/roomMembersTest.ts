import { strict as assert } from "assert";
import { randomUUID } from "crypto";
import { RoomMemberManager } from "../../src/RoomMembers";
import { newTestUser } from "./clientHelper";
import { getFirstReply, getNthReply } from "./commands/commandUtils";

describe("Test: Testing RoomMemberManager", function() {
    it("RoomMemberManager counts correctly when we call handleEvent manually", function() {
        let manager: RoomMemberManager = this.mjolnir.roomJoins;
        let start = new Date(Date.now() - 100_000_000);
        const ROOMS = [
            "!room_0@localhost",
            "!room_1@localhost"
        ];
        for (let room of ROOMS) {
            manager.addRoom(room);
        }

        let joinDate = (i: number) => new Date(start.getTime() + i * 100_000);
        let userId = (i: number) => `@sender_${i}:localhost`;

        // First, add a number of joins.
        const SAMPLE_SIZE = 100;
        for (let i = 0; i < SAMPLE_SIZE; ++i) {
            const event = {
                type: 'm.room.member',
                state_key: userId(i),
                sender: userId(i),
                content: {
                    membership: "join"
                }
            };
            manager.handleEvent(ROOMS[i % ROOMS.length], event, joinDate(i));
        }

        {
            const joins0 = manager.getUsersInRoom(ROOMS[0], start, 100_000);
            const joins1 = manager.getUsersInRoom(ROOMS[1], start, 100_000);

            const joins0ByUserId = new Map(joins0.map(join => [join.userId, join.timestamp]));
            const joins1ByUserId = new Map(joins1.map(join => [join.userId, join.timestamp]));

            for (let i = 0; i < SAMPLE_SIZE; ++i) {
                const user = userId(i);
                let map = i % 2 === 0 ? joins0ByUserId : joins1ByUserId;
                const ts = map.get(user);
                assert.ok(ts, `User ${user} should have been seen joining room ${i % 2}`);
                assert.equal(ts, joinDate(i).getTime(), `User ${user} should have been seen joining the room at the right timestamp`);
                map.delete(user);
            }

            assert.equal(joins0ByUserId.size, 0, "We should have found all the users in room 0");
            assert.equal(joins1ByUserId.size, 0, "We should have found all the users in room 1");
        }

        // Now, let's add a few leave events.
        let leaveDate = (i: number) => new Date(start.getTime() + (SAMPLE_SIZE + i) * 100_000);

        for (let i = 0; i < SAMPLE_SIZE / 3; ++i) {
            const user = userId(i * 3);
            const event = {
                type: 'm.room.member',
                state_key: user,
                sender: user,
                content: {
                    membership: "leave"
                },
                unsigned: {
                    prev_content: {
                        membership: "join"
                    }
                }
            };
            manager.handleEvent(ROOMS[0], event, leaveDate(i));
            manager.handleEvent(ROOMS[1], event, leaveDate(i));
        }

        // Let's see if we have properly updated the joins/leaves
        {
            const joins0 = manager.getUsersInRoom(ROOMS[0], start, 100_000);
            const joins1 = manager.getUsersInRoom(ROOMS[1], start, 100_000);

            const joins0ByUserId = new Map(joins0.map(join => [join.userId, join.timestamp]));
            const joins1ByUserId = new Map(joins1.map(join => [join.userId, join.timestamp]));

            for (let i = 0; i < SAMPLE_SIZE; ++i) {
                const user = userId(i);
                let map = i % 2 === 0 ? joins0ByUserId : joins1ByUserId;
                let isStillJoined = i % 3 !== 0;
                const ts = map.get(user);
                if (isStillJoined) {
                    assert.ok(ts, `User ${user} should have been seen joining room ${i % 2}`);
                    assert.equal(ts, joinDate(i).getTime(), `User ${user} should have been seen joining the room at the right timestamp`);
                    map.delete(user);
                } else {
                    assert.ok(!ts, `User ${user} should not be seen as a member of room ${i % 2} anymore`);
                }
            }

            assert.equal(joins0ByUserId.size, 0, "We should have found all the users in room 0");
            assert.equal(joins1ByUserId.size, 0, "We should have found all the users in room 1");
        }

        // Now let's make a few of these users rejoin.
        let rejoinDate = (i: number) => new Date(start.getTime() + (SAMPLE_SIZE * 2 + i) * 100_000);

        for (let i = 0; i < SAMPLE_SIZE / 9; ++i) {
            const user = userId(i * 9);
            const event = {
                type: 'm.room.member',
                state_key: user,
                sender: user,
                content: {
                    membership: "join"
                },
                unsigned: {
                    prev_content: {
                        membership: "leave"
                    }
                }
            };
            const room = ROOMS[i * 9 % 2];
            manager.handleEvent(room, event, rejoinDate(i * 9));
        }

        // Let's see if we have properly updated the joins/leaves
        {
            const joins0 = manager.getUsersInRoom(ROOMS[0], start, 100_000);
            const joins1 = manager.getUsersInRoom(ROOMS[1], start, 100_000);

            const joins0ByUserId = new Map(joins0.map(join => [join.userId, join.timestamp]));
            const joins1ByUserId = new Map(joins1.map(join => [join.userId, join.timestamp]));

            for (let i = 0; i < SAMPLE_SIZE; ++i) {
                const user = userId(i);
                let map = i % 2 === 0 ? joins0ByUserId : joins1ByUserId;
                let hasLeft = i % 3 === 0;
                let hasRejoined = i % 9 === 0;
                const ts = map.get(user);
                if (hasRejoined) {
                    assert.ok(ts, `User ${user} should have been seen rejoining room ${i % 2}`);
                    assert.equal(ts, rejoinDate(i).getTime(), `User ${user} should have been seen rejoining the room at the right timestamp, got ${ts}`);
                    map.delete(user);
                } else if (hasLeft) {
                    assert.ok(!ts, `User ${user} should not be seen as a member of room ${i % 2} anymore`);
                } else {
                    assert.ok(ts, `User ${user} should have been seen joining room ${i % 2}`);
                    assert.equal(ts, joinDate(i).getTime(), `User ${user} should have been seen joining the room at the right timestamp`);
                    map.delete(user);
                }
            }

            assert.equal(joins0ByUserId.size, 0, "We should have found all the users in room 0");
            assert.equal(joins1ByUserId.size, 0, "We should have found all the users in room 1");
        }

        // Now let's check only the most recent joins.
        {
            const joins0 = manager.getUsersInRoom(ROOMS[0], rejoinDate(-1), 100_000);
            const joins1 = manager.getUsersInRoom(ROOMS[1], rejoinDate(-1), 100_000);

            const joins0ByUserId = new Map(joins0.map(join => [join.userId, join.timestamp]));
            const joins1ByUserId = new Map(joins1.map(join => [join.userId, join.timestamp]));

            for (let i = 0; i < SAMPLE_SIZE; ++i) {
                const user = userId(i);
                let map = i % 2 === 0 ? joins0ByUserId : joins1ByUserId;
                let hasRejoined = i % 9 === 0;
                const ts = map.get(user);
                if (hasRejoined) {
                    assert.ok(ts, `User ${user} should have been seen rejoining room ${i % 2}`);
                    assert.equal(ts, rejoinDate(i).getTime(), `User ${user} should have been seen rejoining the room at the right timestamp, got ${ts}`);
                    map.delete(user);
                } else {
                    assert.ok(!ts, `When looking only at recent entries, user ${user} should not be seen as a member of room ${i % 2} anymore`);
                }
            }

            assert.equal(joins0ByUserId.size, 0, "We should have found all the users who recently joined room 0");
            assert.equal(joins1ByUserId.size, 0, "We should have found all the users who recently joined room 1");
        }

        // Perform a cleanup on both rooms, check that we have the same results.
        for (let roomId of ROOMS) {
            manager.cleanup(roomId);
        }

        // Let's see if we have properly updated the joins/leaves
        {
            const joins0 = manager.getUsersInRoom(ROOMS[0], start, 100_000);
            const joins1 = manager.getUsersInRoom(ROOMS[1], start, 100_000);

            const joins0ByUserId = new Map(joins0.map(join => [join.userId, join.timestamp]));
            const joins1ByUserId = new Map(joins1.map(join => [join.userId, join.timestamp]));

            for (let i = 0; i < SAMPLE_SIZE; ++i) {
                const user = userId(i);
                let map = i % 2 === 0 ? joins0ByUserId : joins1ByUserId;
                let hasLeft = i % 3 === 0;
                let hasRejoined = i % 9 === 0;
                const ts = map.get(user);
                if (hasRejoined) {
                    assert.ok(ts, `After cleanup, user ${user} should have been seen rejoining room ${i % 2}`);
                    assert.equal(ts, rejoinDate(i).getTime(), `After cleanup, user ${user} should have been seen rejoining the room at the right timestamp, got ${ts}`);
                    map.delete(user);
                } else if (hasLeft) {
                    assert.ok(!ts, `After cleanup, user ${user} should not be seen as a member of room ${i % 2} anymore`);
                } else {
                    assert.ok(ts, `After cleanup, user ${user} should have been seen joining room ${i % 2}`);
                    assert.equal(ts, joinDate(i).getTime(), `After cleanup, user ${user} should have been seen joining the room at the right timestamp`);
                    map.delete(user);
                }
            }

            assert.equal(joins0ByUserId.size, 0, "After cleanup, we should have found all the users in room 0");
            assert.equal(joins1ByUserId.size, 0, "After cleanup, we should have found all the users in room 1");
        }

        // Now let's check only the most recent joins.
        {
            const joins0 = manager.getUsersInRoom(ROOMS[0], rejoinDate(-1), 100_000);
            const joins1 = manager.getUsersInRoom(ROOMS[1], rejoinDate(-1), 100_000);

            const joins0ByUserId = new Map(joins0.map(join => [join.userId, join.timestamp]));
            const joins1ByUserId = new Map(joins1.map(join => [join.userId, join.timestamp]));

            for (let i = 0; i < SAMPLE_SIZE; ++i) {
                const user = userId(i);
                let map = i % 2 === 0 ? joins0ByUserId : joins1ByUserId;
                let hasRejoined = i % 9 === 0;
                const ts = map.get(user);
                if (hasRejoined) {
                    assert.ok(ts, `After cleanup, user ${user} should have been seen rejoining room ${i % 2}`);
                    assert.equal(ts, rejoinDate(i).getTime(), `After cleanup, user ${user} should have been seen rejoining the room at the right timestamp, got ${ts}`);
                    map.delete(user);
                } else {
                    assert.ok(!ts, `After cleanup, when looking only at recent entries, user ${user} should not be seen as a member of room ${i % 2} anymore`);
                }
            }

            assert.equal(joins0ByUserId.size, 0, "After cleanup, we should have found all the users who recently joined room 0");
            assert.equal(joins1ByUserId.size, 0, "After cleanup, we should have found all the users who recently joined room 1");
        }
    });

    afterEach(async function() {
        await this.moderator?.stop();
        for (let array of [this.users, this.goodUsers, this.badUsers]) {
            for (let client of array || []) {
                await client.stop();
            }
        }
    });

    it("RoomMemberManager counts correctly when we actually join/leave/get banned from the room", async function() {
        this.timeout(60000);
        const start = new Date(Date.now() - 10_000);

        // Setup a moderator.
        this.moderator = await newTestUser({ name: { contains: "moderator" } });
        await this.mjolnir.client.inviteUser(await this.moderator.getUserId(), this.mjolnir.managementRoomId)
        await this.moderator.joinRoom(this.mjolnir.managementRoomId);

        // Create a few users and two rooms.
        this.users = [];
        const SAMPLE_SIZE = 10;
        for (let i = 0; i < SAMPLE_SIZE; ++i) {
            this.users.push(await newTestUser({ name: { contains: `user_${i}_room_member_test` } }));
        }
        const userIds = [];
        for (let client of this.users) {
            userIds.push(await client.getUserId());
        }
        const roomId1 = await this.moderator.createRoom({
            invite: userIds,
            preset: "public_chat",
        });
        const roomId2 = await this.moderator.createRoom({
            invite: userIds,
            preset: "public_chat",
        });
        const roomIds = [roomId1, roomId2];

        for (let roomId of roomIds) {
            await this.moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${roomId}` });
        }

        let protectedRoomsUpdated = false;
        do {
            let protectedRooms = this.mjolnir.protectedRooms;
            protectedRoomsUpdated = true;
            for (let roomId of roomIds) {
                if (!(roomId in protectedRooms)) {
                    protectedRoomsUpdated = false;
                    await new Promise(resolve => setTimeout(resolve, 1_000));
                }
            }
        } while (!protectedRoomsUpdated);


        // Initially, we shouldn't know about any user in these rooms... except Mjölnir itself.
        const manager: RoomMemberManager = this.mjolnir.roomJoins;
        for (let roomId of roomIds) {
            const joined = manager.getUsersInRoom(roomId, start, 100);
            assert.equal(joined.length, 1, "Initially, we shouldn't know about any other user in these rooms");
            assert.equal(joined[0].userId, await this.mjolnir.client.getUserId(), "Initially, Mjölnir should be the only known user in these rooms");
        }

        // Initially, the command should show that same result.
        for (let roomId of roomIds) {
            const reply = await getFirstReply(this.mjolnir.client, this.mjolnir.managementRoomId, () => {
                const command = `!mjolnir status joins ${roomId}`;
                return this.moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: command });
            });
            const body = reply["content"]?.["body"] as string;
            assert.ok(body.includes("\n1 recent joins"), "Initially the command should respond with 1 user");
        }

        // Now join a few rooms.
        for (let i = 0; i < userIds.length; ++i) {
            await this.users[i].joinRoom(roomIds[i % roomIds.length]);
        }

        // Lists should have been updated.
        for (let i = 0; i < roomIds.length; ++i) {
            const roomId = roomIds[i];
            const joined = manager.getUsersInRoom(roomId, start, 100);
            assert.equal(joined.length, SAMPLE_SIZE / 2 /* half of the users */ + 1 /* mjolnir */, "We should now see all joined users in the room");
            const reply = await getFirstReply(this.mjolnir.client, this.mjolnir.managementRoomId, () => {
                const command = `!mjolnir status joins ${roomId}`;
                return this.moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: command });
            });
            const body = reply["content"]?.["body"] as string;
            assert.ok(body.includes(`\n${joined.length} recent joins`), `After joins, the command should respond with ${joined.length} users`);
            for (let j = 0; j < userIds.length; ++j) {
                if (j % roomIds.length === i) {
                    assert.ok(body.includes(userIds[j]), `After joins, the command should display user ${userIds[j]} in room ${roomId}`);
                } else {
                    assert.ok(!body.includes(userIds[j]), `After joins, the command should NOT display user ${userIds[j]} in room ${roomId}`);
                }
            }
        }

        // Let's kick/ban a few users and see if they still show up.
        const removedUsers = new Set();
        for (let i = 0; i < SAMPLE_SIZE / 2; ++i) {
            const roomId = roomIds[i % roomIds.length];
            const userId = userIds[i];
            if (i % 3 === 0) {
                await this.moderator.kickUser(userId, roomId);
                removedUsers.add(userIds[i]);
            } else if (i % 3 === 1) {
                await this.moderator.banUser(userId, roomId);
                removedUsers.add(userId);
            }
        }

        // Lists should have been updated.

        for (let i = 0; i < roomIds.length; ++i) {
            const roomId = roomIds[i];
            const reply = await getFirstReply(this.mjolnir.client, this.mjolnir.managementRoomId, () => {
                const command = `!mjolnir status joins ${roomId}`;
                return this.moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: command });
            });
            const body = reply["content"]?.["body"] as string;
            for (let j = 0; j < userIds.length; ++j) {
                const userId = userIds[j];
                if (j % roomIds.length === i && !removedUsers.has(userId)) {
                    assert.ok(body.includes(userId), `After kicks, the command should display user ${userId} in room ${roomId}`);
                } else {
                    assert.ok(!body.includes(userId), `After kicks, the command should NOT display user ${userId} in room ${roomId}`);
                }
            }
        }
    });

    it("!mjolnir since kicks the correct users", async function() {
        this.timeout(600_000);
        const start = new Date(Date.now() - 10_000);

        // Setup a moderator.
        this.moderator = await newTestUser({ name: { contains: "moderator" } });
        await this.moderator.joinRoom(this.mjolnir.managementRoomId);

        // Create a few users.
        this.goodUsers = [];
        this.badUsers = [];
        const SAMPLE_SIZE = 10;
        for (let i = 0; i < SAMPLE_SIZE; ++i) {
            this.goodUsers.push(await newTestUser({ name: { contains: `good_user_${i}_room_member_test` } }));
            this.badUsers.push(await newTestUser({ name: { contains: `bad_user_${i}_room_member_test` } }));
        }
        const goodUserIds: string[] = [];
        const badUserIds: string[] = [];
        for (let client of this.goodUsers) {
            goodUserIds.push(await client.getUserId());
        }
        for (let client of this.badUsers) {
            badUserIds.push(await client.getUserId());
        }

        // Create and protect rooms.
        //
        // We reserve two control rooms:
        // - room 0, also known as the "control unprotected room" is unprotected
        //     (we're not calling `!mjolnir rooms add` for this room), so none
        //     of the operations of `!mjolnir since` shoud affect it. We are
        //     using it to control, at the end of each experiment, that none of
        //     the `!mjolnir since` operations affect it.
        // - room 1, also known as the "control protected room" is protected
        //     (we are calling `!mjolnir rooms add` for this room), but we are
        //     never directly requesting any `!mjolnir since` action against
        //     this room. We are using it to control, at the end of each experiment,
        //     that none of the `!mjolnir since` operations that should target
        //     one single other room also affect that room. It is, however, affected
        //     by general operations that are designed to affect all protected rooms.
        const NUMBER_OF_ROOMS = 18;
        const allRoomIds: string[] = [];
        const allRoomAliases: string[] = [];
        const mjolnirUserId = await this.mjolnir.client.getUserId();
        for (let i = 0; i < NUMBER_OF_ROOMS; ++i) {
            const roomId = await this.moderator.createRoom({
                invite: [mjolnirUserId, ...goodUserIds, ...badUserIds],
            });
            allRoomIds.push(roomId);

            const alias = `#since-test-${randomUUID()}:localhost:9999`;
            await this.moderator.createRoomAlias(alias, roomId);
            allRoomAliases.push(alias);
        }
        for (let i = 1; i < allRoomIds.length; ++i) {
            // Protect all rooms except allRoomIds[0], as control.
            const roomId = allRoomIds[i];
            await this.mjolnir.client.joinRoom(roomId);
            await this.moderator.setUserPowerLevel(mjolnirUserId, roomId, 100);
            await this.moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir rooms add ${roomId}` });
        }

        let protectedRoomsUpdated = false;
        do {
            let protectedRooms = this.mjolnir.protectedRooms;
            protectedRoomsUpdated = true;
            for (let i = 1; i < allRoomIds.length; ++i) {
                const roomId = allRoomIds[i];
                if (!(roomId in protectedRooms)) {
                    protectedRoomsUpdated = false;
                    await new Promise(resolve => setTimeout(resolve, 1_000));
                }
            }
        } while (!protectedRoomsUpdated);

        // Good users join before cut date.
        for (let user of this.goodUsers) {
            for (let roomId of allRoomIds) {
                await user.joinRoom(roomId);
            }
        }

        await new Promise(resolve => setTimeout(resolve, 5_000));

        const cutDate = new Date();

        await new Promise(resolve => setTimeout(resolve, 5_000));

        // Bad users join after cut date.
        for (let user of this.badUsers) {
            for (let roomId of allRoomIds) {
                await user.joinRoom(roomId);
            }
        }

        // Finally, prepare our control rooms and separate them
        // from the regular rooms.
        const CONTROL_UNPROTECTED_ROOM_ID = allRoomIds[0];
        const CONTROL_PROTECTED_ID = allRoomIds[1];
        const roomIds = allRoomIds.slice(2);
        const roomAliases = allRoomAliases.slice(2);

        enum Method {
            kick,
            ban,
            mute,
            unmute,
        }
        class Experiment {
            // A human-readable name for the command.
            readonly name: string;
            // If `true`, this command should affect room `CONTROL_PROTECTED_ID`.
            // Defaults to `false`.
            readonly shouldAffectControlProtected: boolean;
            // The actual command-line.
            readonly command: (roomId: string, roomAlias: string) => string;
            // The number of responses we expect to this command.
            // Defaults to `1`.
            readonly n: number;
            // How affected users should leave the room.
            readonly method: Method;

            // If `true`, should this experiment look at the same room as the previous one.
            // Defaults to `false`.
            readonly isSameRoomAsPrevious: boolean;

            // The index of the room on which we're acting.
            //
            // Initialized by `addTo`.
            roomIndex: number | undefined;

            constructor({name, shouldAffectControlProtected, command, n, method, sameRoom}: {name: string, command: (roomId: string, roomAlias: string) => string, shouldAffectControlProtected?: boolean, n?: number, method: Method, sameRoom?: boolean}) {
                this.name = name;
                this.shouldAffectControlProtected = typeof shouldAffectControlProtected === "undefined" ? false : shouldAffectControlProtected;
                this.command = command;
                this.n = typeof n === "undefined" ? 1 : n;
                this.method = method;
                this.isSameRoomAsPrevious = typeof sameRoom === "undefined" ? false : sameRoom;
            }

            // Add an experiment to the list of experiments.
            //
            // This is how `roomIndex` gets initialized.
            addTo(experiments: Experiment[]) {
                if (this.isSameRoomAsPrevious) {
                    this.roomIndex = experiments[experiments.length - 1].roomIndex;
                } else if (experiments.length === 0) {
                    this.roomIndex = 0;
                } else {
                    this.roomIndex = experiments[experiments.length - 1].roomIndex! + 1;
                }
                experiments.push(this);
            }
        }
        const EXPERIMENTS: Experiment[] = [];
        for (let experiment of [
            // Kick bad users in one room, using duration syntax, no reason.
            new Experiment({
                name: "kick with duration",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms kick 100 ${roomId}`,
                method: Method.kick,
            }),
            // Ban bad users in one room, using duration syntax, no reason.
            new Experiment({
                name: "ban with duration",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms ban 100 ${roomId}`,
                method: Method.ban,
            }),
            // Mute bad users in one room, using duration syntax, no reason.
            new Experiment({
                name: "mute with duration",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms mute 100 ${roomId}`,
                method: Method.mute,
            }),
            new Experiment({
                name: "unmute with duration",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms unmute 100 ${roomId}`,
                method: Method.unmute,
                sameRoom: true,
            }),
            // Kick bad users in one room, using date syntax, no reason.
            new Experiment({
                name: "kick with date",
                command: (roomId: string) => `!mjolnir since "${cutDate}" kick 100 ${roomId}`,
                method: Method.kick,
            }),
            // Ban bad users in one room, using date syntax, no reason.
            new Experiment({
                name: "ban with date",
                command: (roomId: string) => `!mjolnir since "${cutDate}" ban 100 ${roomId}`,
                method: Method.ban,
            }),
            // Mute bad users in one room, using date syntax, no reason.
            new Experiment({
                name: "mute with date",
                command: (roomId: string) => `!mjolnir since "${cutDate}" mute 100 ${roomId}`,
                method: Method.mute,
            }),
            new Experiment({
                name: "unmute with date",
                command: (roomId: string) => `!mjolnir since "${cutDate}" unmute 100 ${roomId}`,
                method: Method.unmute,
                sameRoom: true,
            }),

            // Kick bad users in one room, using duration syntax, with reason.
            new Experiment({
                name: "kick with duration and reason",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms kick 100 ${roomId} bad, bad user`,
                method: Method.kick,
            }),
            // Ban bad users in one room, using duration syntax, with reason.
            new Experiment({
                name: "ban with duration and reason",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms ban 100 ${roomId} bad, bad user`,
                method: Method.ban,
            }),
            // Mute bad users in one room, using duration syntax, with reason.
            new Experiment({
                name: "mute with duration and reason",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms mute 100 ${roomId} bad, bad user`,
                method: Method.mute,
            }),
            new Experiment({
                name: "unmute with duration and reason",
                command: (roomId: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms unmute 100 ${roomId} bad, bad user`,
                method: Method.unmute,
                sameRoom: true,
            }),

            // Kick bad users in one room, using date syntax, with reason.
            new Experiment({
                name: "kick with date and reason",
                command: (roomId: string) => `!mjolnir since "${cutDate}" kick 100 ${roomId} bad, bad user`,
                shouldAffectControlProtected: false,
                n: 1,
                method: Method.kick,
            }),
            // Ban bad users in one room, using date syntax, with reason.
            new Experiment({
                name: "ban with date and reason",
                command: (roomId: string) => `!mjolnir since "${cutDate}" ban 100 ${roomId} bad, bad user`,
                method: Method.ban,
            }),
            // Mute bad users in one room, using date syntax, with reason.
            new Experiment({
                name: "mute with date and reason",
                command: (roomId: string) => `!mjolnir since "${cutDate}" mute 100 ${roomId} bad, bad user`,
                method: Method.mute,
            }),
            new Experiment({
                name: "unmute with date and reason",
                command: (roomId: string) => `!mjolnir since "${cutDate}" unmute 100 ${roomId} bad, bad user`,
                method: Method.unmute,
                sameRoom: true,
            }),

            // Kick bad users in one room, using duration syntax, without reason, using alias.
            new Experiment({
                name: "kick with duration, no reason, alias",
                command: (_: string, roomAlias: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms kick 100 ${roomAlias}`,
                method: Method.kick,
            }),
            // Kick bad users in one room, using duration syntax, with reason, using alias.
            new Experiment({
                name: "kick with duration, reason and alias",
                command: (_: string, roomAlias: string) => `!mjolnir since ${Date.now() - cutDate.getTime()}ms kick 100 ${roomAlias} for some reason`,
                method: Method.kick,
            }),

            // Kick bad users everywhere, no reason
            new Experiment({
                name: "kick with date everywhere",
                command: () => `!mjolnir since "${cutDate}" kick 100 * bad, bad user`,
                shouldAffectControlProtected: true,
                n: NUMBER_OF_ROOMS - 1,
                method: Method.kick,
            }),
        ]) {
            experiment.addTo(EXPERIMENTS);
        }

        // Just-in-case health check, before starting.
        {
            const usersInUnprotectedControlProtected = await this.mjolnir.client.getJoinedRoomMembers(CONTROL_UNPROTECTED_ROOM_ID);
            const usersInControlProtected = await this.mjolnir.client.getJoinedRoomMembers(CONTROL_PROTECTED_ID);
            for (let userId of goodUserIds) {
                assert.ok(usersInUnprotectedControlProtected.includes(userId), `Initially, good user ${userId} should be in the unprotected control room`);
                assert.ok(usersInControlProtected.includes(userId), `Initially, good user ${userId} should be in the control room`);
            }
            for (let userId of badUserIds) {
                assert.ok(usersInUnprotectedControlProtected.includes(userId), `Initially, bad user ${userId} should be in the unprotected control room`);
                assert.ok(usersInControlProtected.includes(userId), `Initially, bad user ${userId} should be in the control room`);
            }
        }

        for (let i = 0; i < EXPERIMENTS.length; ++i) {
            const experiment = EXPERIMENTS[i];
            const index = experiment.roomIndex!;
            const roomId = roomIds[index];
            const roomAlias = roomAliases[index];
            const joined = this.mjolnir.roomJoins.getUsersInRoom(roomId, start, 100);
            console.debug(`Running experiment ${i} "${experiment.name}" in room index ${index} (${roomId} / ${roomAlias}): \`${experiment.command(roomId, roomAlias)}\``);
            assert.ok(joined.length >= 2 * SAMPLE_SIZE, `In experiment ${experiment.name}, we should have seen ${2 * SAMPLE_SIZE} users, saw ${joined.length}`);

            // Run experiment.
            await getNthReply(this.mjolnir.client, this.mjolnir.managementRoomId, experiment.n, async () => {
                const command = experiment.command(roomId, roomAlias);
                let result = await this.moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: command });
                return result;
            });

            // Check post-conditions.
            const usersInRoom = await this.mjolnir.client.getJoinedRoomMembers(roomId);
            const usersInUnprotectedControlProtected = await this.mjolnir.client.getJoinedRoomMembers(CONTROL_UNPROTECTED_ROOM_ID);
            const usersInControlProtected = await this.mjolnir.client.getJoinedRoomMembers(CONTROL_PROTECTED_ID);
            for (let userId of goodUserIds) {
                assert.ok(usersInRoom.includes(userId), `After a ${experiment.name}, good user ${userId} should still be in affected room`);
                assert.ok(usersInControlProtected.includes(userId), `After a ${experiment.name}, good user ${userId} should still be in control room (${CONTROL_PROTECTED_ID})`);
                assert.ok(usersInUnprotectedControlProtected.includes(userId), `After a ${experiment.name}, good user ${userId} should still be in unprotected control room (${CONTROL_UNPROTECTED_ROOM_ID})`);
            }
            if (experiment.method === Method.mute) {
                for (let userId of goodUserIds) {
                    let canSpeak = await this.mjolnir.client.userHasPowerLevelFor(userId, roomId, "m.message", false);
                    assert.ok(canSpeak, `After a ${experiment.name}, good user ${userId} should still be allowed to speak in the room`);
                }
                for (let userId of badUserIds) {
                    let canSpeak = await this.mjolnir.client.userHasPowerLevelFor(userId, roomId, "m.message", false);
                    assert.ok(!canSpeak, `After a ${experiment.name}, bad user ${userId} should NOT be allowed to speak in the room`);
                }
            } else if (experiment.method === Method.unmute) {
                for (let userId of goodUserIds) {
                    let canSpeak = await this.mjolnir.client.userHasPowerLevelFor(userId, roomId, "m.message", false);
                    assert.ok(canSpeak, `After a ${experiment.name}, good user ${userId} should still be allowed to speak in the room`);
                }
                for (let userId of badUserIds) {
                    let canSpeak = await this.mjolnir.client.userHasPowerLevelFor(userId, roomId, "m.message", false);
                    assert.ok(canSpeak, `After a ${experiment.name}, bad user ${userId} should AGAIN be allowed to speak in the room`);
                }
            } else {
                for (let userId of badUserIds) {
                    assert.ok(!usersInRoom.includes(userId), `After a ${experiment.name}, bad user ${userId} should NOT be in affected room`);
                    assert.equal(usersInControlProtected.includes(userId), !experiment.shouldAffectControlProtected, `After a ${experiment.name}, bad user ${userId} should ${experiment.shouldAffectControlProtected ? "NOT" : "still"} be in control room`);
                    assert.ok(usersInUnprotectedControlProtected.includes(userId), `After a ${experiment.name}, bad user ${userId} should still be in unprotected control room`);
                    const leaveEvent = await this.mjolnir.client.getRoomStateEvent(roomId, "m.room.member", userId);
                    switch (experiment.method) {
                        case Method.kick:
                            assert.equal(leaveEvent.membership, "leave");
                            break;
                        case Method.ban:
                            assert.equal(leaveEvent.membership, "ban");
                            break;
                    }
                }
            }
        }
    });
});
