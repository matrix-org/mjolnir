import config from "../../src/config";
import { Mjolnir } from "../../src/Mjolnir";
import { makeMjolnir, teardownManagementRoom } from "./mjolnirSetupUtils";

// when mjolnir starts it clobbers the config, which is cached between runs,
// by resolving the alias and setting it to a roomid.
export const mochaHooks = {
    beforeEach: [
      async function() {
        this.managementRoomAlias = config.managementRoom
        this.mjolnir = await makeMjolnir()
        this.mjolnir.start()
      }
    ],
    afterEach: [
        async function() {
            console.log("stopping mjolnir");
            await this.mjolnir.stop();
            // unclobber mjolnir's dirty work, i thought the config was being cached
            // and was global, but that might have just been supersitiion, needs confirming.
            let managementRoomId = config.managementRoom;
            config.managementRoom = this.managementRoomAlias;
            // remove alias from management room and leave it.
            await teardownManagementRoom(this.mjolnir.client, managementRoomId, this.managementRoomAlias);
        }
    ]
  };