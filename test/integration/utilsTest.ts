import { strict as assert } from "assert";

import { UserID } from "matrix-bot-sdk";
import config from "../../src/config";
import { replaceRoomIdsWithPills } from "../../src/utils";

describe("Test: utils", function() {
    it("replaceRoomIdsWithPills correctly turns a room ID in to a pill", async function() {
        this.timeout(20000);

        await this.mjolnir.client.sendStateEvent(
            this.mjolnir.managementRoomId,
            "m.room.canonical_alias",
            "",
            { alias: config.managementRoom }
        );

        const out = await replaceRoomIdsWithPills(
            this.mjolnir,
            `it's fun here in ${this.mjolnir.managementRoomId}`,
            new Set([this.mjolnir.managementRoomId])
        );

        const ourHomeserver = new UserID(await this.mjolnir.client.getUserId()).domain;
        assert.equal(
            out.formatted_body,
            `it's fun here in <a href="https://matrix.to/#/${config.managementRoom}?via=${ourHomeserver}">${config.managementRoom}</a>`
        );
    });
});

