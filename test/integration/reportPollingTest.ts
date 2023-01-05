import { Mjolnir } from "../../src/Mjolnir";
import { Protection } from "../../src/protections/IProtection";
import { newTestUser } from "./clientHelper";

describe("Test: Report polling", function() {
    let client;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "protection-settings" }});
    })
    it("Mjolnir correctly retrieves a report from synapse", async function() {
        this.timeout(40000);

        let protectedRoomId = await this.mjolnir.client.createRoom({ invite: [await client.getUserId()] });
        await client.joinRoom(protectedRoomId);
        await this.mjolnir.addProtectedRoom(protectedRoomId);

        const eventId = await client.sendMessage(protectedRoomId, {msgtype: "m.text", body: "uwNd3q"});
        class CustomProtection extends Protection {
            name = "jYvufI";
            description = "A test protection";
            settings = { };
            constructor(private resolve) {
                super();
            }
            async handleReport (mjolnir: Mjolnir, roomId: string, reporterId: string, event: any, reason?: string) {
                if (reason === "x5h1Je") {
                    this.resolve(null);
                }
            }
        }
        await new Promise(async resolve => {
            await this.mjolnir.protectionManager.registerProtection(new CustomProtection(resolve));
            await this.mjolnir.protectionManager.enableProtection("jYvufI");
            await client.doRequest(
                "POST",
                `/_matrix/client/r0/rooms/${encodeURIComponent(protectedRoomId)}/report/${encodeURIComponent(eventId)}`, "", {
                    reason: "x5h1Je"
                }
            );
        });
        // So I kid you not, it seems like we can quit before the webserver for reports sends a respond to the client (via L#26)
        // because the promise above gets resolved before we finish awaiting the report sending request on L#31,
        // then mocha's cleanup code runs (and shuts down the webserver) before the webserver can respond.
        // Wait a minute 😲😲🤯 it's not even supposed to be using the webserver if this is testing report polling.
        // Ok, well apparently that needs a big refactor to change, but if you change the config before running this test,
        // then you can ensure that report polling works. https://github.com/matrix-org/mjolnir/issues/326.
        await new Promise(resolve => setTimeout(resolve, 1000));
    });
});

