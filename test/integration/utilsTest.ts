import { strict as assert } from "assert";
import { LogLevel } from "matrix-bot-sdk";
import ManagementRoomOutput from "../../src/ManagementRoomOutput";

describe("Test: utils", function() {
    it("replaceRoomIdsWithPills correctly turns a room ID in to a pill", async function() {
        const managementRoomAlias = this.config.managementRoom;
        const managementRoomOutput: ManagementRoomOutput = this.mjolnir.managementRoomOutput;
        await this.mjolnir.client.sendStateEvent(
            this.mjolnir.managementRoomId,
            "m.room.canonical_alias",
            "",
            { alias: managementRoomAlias }
        );

        const message: any = await new Promise(async resolve => {
            this.mjolnir.client.on('room.message', (roomId, event) => {
                if (roomId === this.mjolnir.managementRoomId) {
                    if (event.content?.body?.startsWith("it's")) {
                        resolve(event);
                    }
                }
            })
            await managementRoomOutput.logMessage(LogLevel.INFO, 'replaceRoomIdsWithPills test',
                `it's fun here in ${this.mjolnir.managementRoomId}`,
                [this.mjolnir.managementRoomId, "!myfaketestid:example.com"]);
        });
        assert.equal(
            message.content.formatted_body,
            `it's fun here in <a href="https://matrix.to/#/${managementRoomAlias}">${managementRoomAlias}</a>`
        );
    });
});

