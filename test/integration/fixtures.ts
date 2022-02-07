import config from "../../src/config";
import { makeMjolnir, teardownManagementRoom } from "./mjolnirSetupUtils";

// When Mjolnir starts (src/index.ts) it clobbers the config by resolving the management room
// alias specified in the config (config.managementRoom) and overwriting that with the room ID.
// Unfortunately every piece of code importing that config imports the same instance, including
// testing code, which is problematic when we want to create a fresh management room for each test.
// So there is some code in here to "undo" the mutation after we stop Mjolnir syncing.
export const mochaHooks = {
    beforeEach: [
        async function() {
            console.log("mochaHooks.beforeEach");
            // Sometimes it takes a little longer to register users.
            this.timeout(3000)
            this.managementRoomAlias = config.managementRoom;
            this.mjolnir = await makeMjolnir();
            config.RUNTIME.client = this.mjolnir.client;
            await this.mjolnir.start();
            console.log("mochaHooks.beforeEach DONE");
        }
    ],
    afterEach: [
        async function() {
            await this.mjolnir.stop();
            // remove alias from management room and leave it.
            await teardownManagementRoom(this.mjolnir.client, this.mjolnir.managementRoomId, config.managementRoom);
        }
    ]
};
