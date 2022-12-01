import { read as configRead } from "../../src/config";
import { makeMjolnir, teardownManagementRoom } from "./mjolnirSetupUtils";
import { register } from "prom-client";

// When Mjolnir starts (src/index.ts) it clobbers the config by resolving the management room
// alias specified in the config (config.managementRoom) and overwriting that with the room ID.
// Unfortunately every piece of code importing that config imports the same instance, including
// testing code, which is problematic when we want to create a fresh management room for each test.
// So there is some code in here to "undo" the mutation after we stop Mjolnir syncing.
export const mochaHooks = {
    beforeEach: [
        async function() {
            console.error("---- entering test", JSON.stringify(this.currentTest.title)); // Makes MatrixClient error logs a bit easier to parse.
            console.log("mochaHooks.beforeEach");
            // Sometimes it takes a little longer to register users.
            this.timeout(30000);
            const config = this.config = configRead();
            this.managementRoomAlias = config.managementRoom;
            this.mjolnir = await makeMjolnir(config);
            config.RUNTIME.client = this.mjolnir.client;
            await Promise.all([
                this.mjolnir.client.setAccountData('org.matrix.mjolnir.protected_rooms', { rooms: [] }),
                this.mjolnir.client.setAccountData('org.matrix.mjolnir.watched_lists', { references: [] }),
            ]);
            await this.mjolnir.start();
            console.log("mochaHooks.beforeEach DONE");
        }
    ],
    afterEach: [
        async function() {
            this.timeout(10000)
            await this.mjolnir.stop();
            await Promise.all([
                this.mjolnir.client.setAccountData('org.matrix.mjolnir.protected_rooms', { rooms: [] }),
                this.mjolnir.client.setAccountData('org.matrix.mjolnir.watched_lists', { references: [] }),
            ]);
            // remove alias from management room and leave it.
            await teardownManagementRoom(this.mjolnir.client, this.mjolnir.managementRoomId, this.managementRoomAlias);
            console.error("---- completed test", JSON.stringify(this.currentTest.title), "\n\n"); // Makes MatrixClient error logs a bit easier to parse.
        }
    ]
};
