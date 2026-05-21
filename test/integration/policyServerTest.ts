/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Mjolnir } from "../../src/Mjolnir";
import * as http from "node:http";
import { AddressInfo } from "node:net";
import { strict as assert } from "assert";

describe("Test: Policy Servers", function () {
    const ed25519Key = "this would be a real unpadded base64 key in production";
    let mjolnir: Mjolnir;
    let lookInRoomId: string;
    let policyServerUrl: string;
    let policyServer: http.Server;

    function delay(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    beforeEach(async function () {
        mjolnir = this.config.RUNTIME.client!;
        policyServer = http.createServer((req, res) => {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
                JSON.stringify({
                    public_keys: {
                        ed25519: ed25519Key,
                    },
                }),
            );
        });
        // grab any port by not specifying one to listen on
        policyServer.listen(() => {
            policyServerUrl = `http://localhost:${(policyServer.address()! as AddressInfo).port}`;
        });

        // Create a room we can inspect
        lookInRoomId = await mjolnir.client.createRoom();
        await mjolnir.client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir rooms add ${lookInRoomId}`,
        });
    });

    afterEach(async function () {
        policyServer.close();
    });

    it("should set the policy server information on demand", async function () {
        this.timeout(15000);

        // Verify the room does *not* have a policy server set
        try {
            await mjolnir.client.getRoomStateEventContent(lookInRoomId, "m.room.policy", "");
            assert.fail("Room should not have a policy server set");
        } catch (e) {
            assert.equal(e.statusCode, 404);
        }

        // Set the policy server, wait a bit, then check for it
        await mjolnir.client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir policy_server ${policyServerUrl}`,
        });
        await delay(1500);
        let policyServerContent = await mjolnir.client.getRoomStateEventContent(lookInRoomId, "m.room.policy", "");
        assert.equal(policyServerContent.url, policyServerUrl);
        assert.equal((policyServerContent.public_keys! as Record<string, string>).ed25519, ed25519Key);

        // Now unset it, wait a bit more, then check for lack of server again
        await mjolnir.client.sendMessage(this.mjolnir.managementRoomId, {
            msgtype: "m.text",
            body: `!mjolnir policy_server unset`,
        });
        await delay(1500);
        policyServerContent = await mjolnir.client.getRoomStateEventContent(lookInRoomId, "m.room.policy", "");
        assert.equal(policyServerContent.url, undefined);
        assert.equal(policyServerContent.public_keys, undefined);
    });
});
