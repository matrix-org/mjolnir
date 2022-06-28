import { strict as assert } from "assert";
import { newTestUser } from "../clientHelper";
import { getFirstReaction } from "./commandUtils";
import { Mjolnir } from "../../../src/Mjolnir";

 describe("Test: The redaction command", function () {
    // If a test has a timeout while awaitng on a promise then we never get given control back.
    afterEach(function() { this.moderator?.stop(); });

    it("Kicks users matching ACL", async function () {
        // How tf
    })

    it("Kicks users matching a glob", async function () {
        this.timeout(120000)
        // create a bunch of users with a pattern in the name.
        const usersToRemove = await Promise.all([...Array(20)].map(_ => newTestUser({ name: { contains: "remove-me"}})));
        const usersToKeep = await Promise.all([...Array(20)].map(_ => newTestUser({ name: { contains: "keep-me"}})));
        // FIXME: Does our kick command kick from all protected rooms or just one room???
        const protectedRooms: string[] = [];
        for (let i = 0; i < 10; i++) {
            const room = await this.mjolnir.client.createRoom({ preset: "public_chat" });
            await this.mjolnir!.addProtectedRoom(room);
            protectedRooms.push(room);
            await Promise.all([...usersToKeep, ...usersToRemove].map(client => {
                return Promise.all(protectedRooms.map(r => client.joinRoom(r)));
            }));
        }
        // issue the glob kick
        await getFirstReaction(this.mjolnir.client, this.mjolnir.managementRoomId, '✅', async () => {
            return await this.mjolnir.client.sendMessage(this.mjolnir.managementRoomId, { msgtype: 'm.text', body: `!mjolnir kick *remove-me* --force` });
        });
        // make sure no one else got kicked
        await Promise.all(protectedRooms.map(async room => {
            const mjolnir: Mjolnir = this.mjolnir!;
            const members = await mjolnir.client.getJoinedRoomMembers(room);
            await Promise.all(usersToKeep.map(async client => {
                assert.equal(members.includes(await client.getUserId()), true);
            }));
            await Promise.all(usersToRemove.map(async client => {
                assert.equal(members.includes(await client.getUserId()), false);
            }));
        }));
    })

});
