import { strict as assert } from "assert";
import { SynapseRoomProperty } from "matrix-bot-sdk";
import { RoomMemberManager } from "../../src/RoomMembers";
import { newTestUser } from "./clientHelper";
import { getFirstReply } from "./commands/commandUtils";

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

        let joinDate = i => new Date(start.getTime() + i * 100_000);
        let userId = i => `@sender_${i}:localhost`;

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
                let map = i % 2 == 0 ? joins0ByUserId : joins1ByUserId;
                const ts = map.get(user);
                assert.ok(ts, `User ${user} should have been seen joining room ${i % 2}`);
                assert.equal(ts, joinDate(i).getTime(), `User ${user} should have been seen joining the room at the right timestamp`);
                map.delete(user);
            }

            assert.equal(joins0ByUserId.size, 0, "We should have found all the users in room 0");
            assert.equal(joins1ByUserId.size, 0, "We should have found all the users in room 1");
        }

        // Now, let's add a few leave events.
        let leaveDate = i => new Date(start.getTime() + (SAMPLE_SIZE + i) * 100_000);

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
                let map = i % 2 == 0 ? joins0ByUserId : joins1ByUserId;
                let isStillJoined = i % 3 != 0;
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
        let rejoinDate = i => new Date(start.getTime() + (SAMPLE_SIZE * 2 + i) * 100_000);

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
                let map = i % 2 == 0 ? joins0ByUserId : joins1ByUserId;
                let hasLeft = i % 3 == 0;
                let hasRejoined = i % 9 == 0;
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
                let map = i % 2 == 0 ? joins0ByUserId : joins1ByUserId;
                let hasRejoined = i % 9 == 0;
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
                let map = i % 2 == 0 ? joins0ByUserId : joins1ByUserId;
                let hasLeft = i % 3 == 0;
                let hasRejoined = i % 9 == 0;
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
                let map = i % 2 == 0 ? joins0ByUserId : joins1ByUserId;
                let hasRejoined = i % 9 == 0;
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
        if (this.users) {
            for (let client of this.users) {
                await client.stop();
            }
        }
    });

    it("RoomMemberManager counts correctly when we actually join/leave/get banned from the room", async function() {
        this.timeout(60000);
        const start = new Date(Date.now() - 10_000);

        // Setup a moderator.
        this.moderator = await newTestUser({ name: { contains: "moderator" } });
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
        });
        const roomId2 = await this.moderator.createRoom({
            invite: userIds,
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

        const longBeforeJoins = new Date();

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
                if (j % roomIds.length == i) {
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
            if (i % 3 == 0) {
                await this.moderator.kickUser(userId, roomId);
                removedUsers.add(userIds[i]);
            } else if (i % 3 == 1) {
                await this.moderator.banUser(userId, roomId);
                removedUsers.add(userId);
            }
        }

        // Lists should have been updated.

        for (let i = 0; i < roomIds.length; ++i) {
            const roomId = roomIds[i];
            const joined = manager.getUsersInRoom(roomId, start, 100);
            const reply = await getFirstReply(this.mjolnir.client, this.mjolnir.managementRoomId, () => {
                const command = `!mjolnir status joins ${roomId}`;
                return this.moderator.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: command });
            });
            const body = reply["content"]?.["body"] as string;
            for (let j = 0; j < userIds.length; ++j) {
                const userId = userIds[j];
                if (j % roomIds.length == i && !removedUsers.has(userId)) {
                    assert.ok(body.includes(userId), `After kicks, the command should display user ${userId} in room ${roomId}`);
                } else {
                    assert.ok(!body.includes(userId), `After kicks, the command should NOT display user ${userId} in room ${roomId}`);
                }
            }
        }
    });
});