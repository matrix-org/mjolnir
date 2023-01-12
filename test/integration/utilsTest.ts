import { strict as assert } from "assert";
import { LogLevel } from "matrix-bot-sdk";
import ManagementRoomOutput from "../../src/ManagementRoomOutput";
import * as UntrustedContent from "../../src/UntrustedContent";

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

describe("Test: UntrustedContent", function() {
    it("accepts valid content and rejects invalid content", async function() {
        /**
         * IMPORTANT NOTE
         *
         * For some reason, `assert()` gets its source tracking wrong. If you need to check an error in this file,
         * look at the line number in the stack trace, not at what `assert()` prints out!
         */

        // Numbers
        assert(UntrustedContent.NUMBER_CONTENT.checkType(100));
        assert(UntrustedContent.NUMBER_CONTENT.checkType(-100));
        assert(UntrustedContent.NUMBER_CONTENT.checkType(NaN));
        assert(UntrustedContent.NUMBER_CONTENT.checkType(Number.NEGATIVE_INFINITY));
        assert(UntrustedContent.NUMBER_CONTENT.checkType(Number.POSITIVE_INFINITY));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType(null));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType(undefined));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType(""));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType("foobar"));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType(true));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType(false));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType({}));
        assert(! UntrustedContent.NUMBER_CONTENT.checkType([]));


        // Strings
        assert(UntrustedContent.STRING_CONTENT.checkType(""));
        assert(UntrustedContent.STRING_CONTENT.checkType("<>"));
        assert(UntrustedContent.STRING_CONTENT.checkType(`${"template"}`));
        assert(! UntrustedContent.STRING_CONTENT.checkType(null));
        assert(! UntrustedContent.STRING_CONTENT.checkType(undefined));
        assert(! UntrustedContent.STRING_CONTENT.checkType(0));
        assert(! UntrustedContent.STRING_CONTENT.checkType(true));
        assert(! UntrustedContent.STRING_CONTENT.checkType(false));
        assert(! UntrustedContent.STRING_CONTENT.checkType({}));
        assert(! UntrustedContent.STRING_CONTENT.checkType([]));

        // Number Arrays
        assert(UntrustedContent.NUMBER_CONTENT.array().checkType([]));
        assert(UntrustedContent.NUMBER_CONTENT.array().checkType([1, 2, 3, 4]));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType(null));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType(undefined));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType(""));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType(0));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType("foobar"));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType(true));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType(false));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType({}));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType([null]));
        assert(! UntrustedContent.NUMBER_CONTENT.array().checkType([undefined]));

        // String Arrays
        assert(UntrustedContent.STRING_CONTENT.array().checkType([]));
        assert(UntrustedContent.STRING_CONTENT.array().checkType(["1", "2", "3", "4"]));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType(null));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType(undefined));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType(""));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType(0));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType("foobar"));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType(true));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType(false));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType({}));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType([null]));
        assert(! UntrustedContent.STRING_CONTENT.array().checkType([undefined]));

        // Optional numbers
        assert(UntrustedContent.NUMBER_CONTENT.optional().checkType(null));
        assert(UntrustedContent.NUMBER_CONTENT.optional().checkType(undefined));
        assert(UntrustedContent.NUMBER_CONTENT.optional().checkType(100));
        assert(UntrustedContent.NUMBER_CONTENT.optional().checkType(-100));
        assert(UntrustedContent.NUMBER_CONTENT.optional().checkType(NaN));
        assert(UntrustedContent.NUMBER_CONTENT.optional().checkType(Number.NEGATIVE_INFINITY));
        assert(UntrustedContent.NUMBER_CONTENT.optional().checkType(Number.POSITIVE_INFINITY));
        assert(! UntrustedContent.NUMBER_CONTENT.optional().checkType(""));
        assert(! UntrustedContent.NUMBER_CONTENT.optional().checkType("foobar"));
        assert(! UntrustedContent.NUMBER_CONTENT.optional().checkType(true));
        assert(! UntrustedContent.NUMBER_CONTENT.optional().checkType(false));
        assert(! UntrustedContent.NUMBER_CONTENT.optional().checkType({}));
        assert(! UntrustedContent.NUMBER_CONTENT.optional().checkType([]));


        // Optional strings
        assert(UntrustedContent.STRING_CONTENT.optional().checkType(null));
        assert(UntrustedContent.STRING_CONTENT.optional().checkType(undefined));
        assert(UntrustedContent.STRING_CONTENT.optional().checkType(""));
        assert(UntrustedContent.STRING_CONTENT.optional().checkType("<>"));
        assert(UntrustedContent.STRING_CONTENT.optional().checkType(`${"template"}`));
        assert(! UntrustedContent.STRING_CONTENT.optional().checkType(0));
        assert(! UntrustedContent.STRING_CONTENT.optional().checkType(true));
        assert(! UntrustedContent.STRING_CONTENT.optional().checkType(false));
        assert(! UntrustedContent.STRING_CONTENT.optional().checkType({}));
        assert(! UntrustedContent.STRING_CONTENT.optional().checkType([]));


        // Optional arrays
        assert(UntrustedContent.NUMBER_CONTENT.array().optional().checkType(null));
        assert(UntrustedContent.NUMBER_CONTENT.array().optional().checkType(undefined));
        assert(UntrustedContent.NUMBER_CONTENT.array().optional().checkType([]));
        assert(UntrustedContent.NUMBER_CONTENT.array().optional().checkType([1, 2, 3, 4]));
        assert(UntrustedContent.STRING_CONTENT.array().optional().checkType(null));
        assert(UntrustedContent.STRING_CONTENT.array().optional().checkType(undefined));
        assert(UntrustedContent.STRING_CONTENT.array().optional().checkType([]));
        assert(UntrustedContent.STRING_CONTENT.array().optional().checkType(["1", "2", "3", "4"]));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType(""));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType(0));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType("foobar"));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType(true));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType(false));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType({}));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType([null]));
        assert(! UntrustedContent.NUMBER_CONTENT.array().optional().checkType([undefined]));

        // Arrays of optionals
        assert(UntrustedContent.NUMBER_CONTENT.optional().array().checkType([]));
        assert(UntrustedContent.NUMBER_CONTENT.optional().array().checkType([1, 2, 3, 4]));
        assert(UntrustedContent.NUMBER_CONTENT.optional().array().checkType([1, 2, 3, 4, null]));
        assert(UntrustedContent.NUMBER_CONTENT.optional().array().checkType([1, 2, 3, 4, undefined]));
        assert(! UntrustedContent.NUMBER_CONTENT.optional().array().checkType([1, 2, 3, 4, undefined, "foobar"]));

        assert(UntrustedContent.STRING_CONTENT.optional().array().checkType([]));
        assert(UntrustedContent.STRING_CONTENT.optional().array().checkType(["1", "2", "3", "4"]));
        assert(UntrustedContent.STRING_CONTENT.optional().array().checkType(["1", "2", "3", "4", null]));
        assert(UntrustedContent.STRING_CONTENT.optional().array().checkType(["1", "2", "3", "4", undefined]));
        assert(! UntrustedContent.STRING_CONTENT.optional().array().checkType(["1", "2", "3", "4", undefined, 5]));

        // Subtype objects
        assert(new UntrustedContent.SubTypeObjectContent({}).checkType({}));
        assert(new UntrustedContent.SubTypeObjectContent({}).checkType({"foo": 1}));
        assert(! new UntrustedContent.SubTypeObjectContent({}).checkType(null));
        assert(! new UntrustedContent.SubTypeObjectContent({}).checkType(undefined));
        assert(! new UntrustedContent.SubTypeObjectContent({}).checkType(0));
        assert(! new UntrustedContent.SubTypeObjectContent({}).checkType(true));
        assert(! new UntrustedContent.SubTypeObjectContent({}).checkType(false));
        assert(! new UntrustedContent.SubTypeObjectContent({}).checkType([]));

        assert(new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": 1}));
        assert(new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": 1, "bar": "sna"}));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(null));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(undefined));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(0));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(true));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(false));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType([]));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({}));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": null}));
        assert(! new UntrustedContent.SubTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": "string"}));

        // Exact objects
        assert(new UntrustedContent.ExactTypeObjectContent({}).checkType({}));
        assert(! new UntrustedContent.ExactTypeObjectContent({}).checkType({"foo": 1}));
        assert(! new UntrustedContent.ExactTypeObjectContent({}).checkType(null));
        assert(! new UntrustedContent.ExactTypeObjectContent({}).checkType(undefined));
        assert(! new UntrustedContent.ExactTypeObjectContent({}).checkType(0));
        assert(! new UntrustedContent.ExactTypeObjectContent({}).checkType(true));
        assert(! new UntrustedContent.ExactTypeObjectContent({}).checkType(false));
        assert(! new UntrustedContent.ExactTypeObjectContent({}).checkType([]));

        assert(new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": 1}));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": 1, "bar": "sna"}));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(null));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(undefined));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(0));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(true));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType(false));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType([]));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({}));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": null}));
        assert(! new UntrustedContent.ExactTypeObjectContent({"foo": UntrustedContent.NUMBER_CONTENT}).checkType({"foo": "string"}));
    });
});
