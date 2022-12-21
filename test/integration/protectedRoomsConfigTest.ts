
import { strict as assert } from "assert";
import { MatrixClient, Permalinks, UserID } from "matrix-bot-sdk";
import { MatrixSendClient } from "../../src/MatrixEmitter";
import { Mjolnir } from "../../src/Mjolnir";
import PolicyList from "../../src/models/PolicyList";
import { newTestUser } from "./clientHelper";
import { createBanList, getFirstReaction } from "./commands/commandUtils";

async function createPolicyList(client: MatrixClient): Promise<PolicyList> {
    const serverName = new UserID(await client.getUserId()).domain;
    const policyListId = await client.createRoom({ preset: "public_chat" });
    return new PolicyList(policyListId, Permalinks.forRoom(policyListId), client);
}

async function getProtectedRoomsFromAccountData(client: MatrixSendClient): Promise<string[]> {
    const rooms: { rooms?: string[] } = await client.getAccountData("org.matrix.mjolnir.protected_rooms");
    return rooms.rooms!;
}

describe('Test: config.protectAllJoinedRooms behaves correctly.', function() {
    it('does not clobber the account data.', async function() {
        // set up account data for a protected room with your own list and a watched list.
        const mjolnir: Mjolnir = this.mjolnir!;

        // moderator sets up some rooms, that aren't explicitly protected
        const moderator = await newTestUser(this.config.homeserverUrl, { name: { contains: "moderator" } });
        await moderator.joinRoom(mjolnir.managementRoomId);
        const implicitlyProtectedRooms = await Promise.all(
            [...Array(2).keys()].map(_ => moderator.createRoom({ preset: "public_chat" }))
        );
        await Promise.all(
            implicitlyProtectedRooms.map(roomId => mjolnir.client.joinRoom(roomId))
        );

        // we sync and check that none of them end up in account data
        await mjolnir.protectedRoomsTracker.syncLists();
        (await getProtectedRoomsFromAccountData(mjolnir.client))
            .forEach(roomId => assert.equal(implicitlyProtectedRooms.includes(roomId), false));
        
        // ... but they are protected
        mjolnir.protectedRoomsTracker.getProtectedRooms()
            .forEach(roomId => assert.equal(implicitlyProtectedRooms.includes(roomId), true));

        // We create one policy list with Mjolnir, and we watch another that is maintained by someone else.
        const policyListShortcode = await createBanList(mjolnir.managementRoomId, mjolnir.matrixEmitter, moderator);
        const unprotectedWatchedList = await createPolicyList(moderator);
        await mjolnir.policyListManager.watchList(unprotectedWatchedList.roomRef);
        await mjolnir.protectedRoomsTracker.syncLists();

        // We expect that the watched list will not be protected, despite config.protectAllJoinedRooms being true
        // this is necessary so that it doesn't try change acl, ban users etc in someone else's list.
        assert.equal(mjolnir.protectedRoomsTracker.getProtectedRooms().includes(unprotectedWatchedList.roomId), false);
        const accountDataAfterListSetup = await getProtectedRoomsFromAccountData(mjolnir.client);
        assert.equal(accountDataAfterListSetup.includes(unprotectedWatchedList.roomId), false);
        // But our own list should be protected AND stored in account data
        assert.equal(accountDataAfterListSetup.length, 1);
        const policyListId = accountDataAfterListSetup[0];
        assert.equal(mjolnir.protectedRoomsTracker.getProtectedRooms().includes(policyListId), true);
        // Confirm that it is the right room, since we only get the shortcode back when using the command to create a list.
        const shortcodeInfo = await mjolnir.client.getRoomStateEvent(policyListId, "org.matrix.mjolnir.shortcode", "");
        assert.equal(shortcodeInfo.shortcode, policyListShortcode);
    })
});

