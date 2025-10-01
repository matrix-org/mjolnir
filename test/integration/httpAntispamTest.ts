/*
Copyright 2025 The Matrix.org Foundation C.I.C.

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

import { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { newTestUser } from "./clientHelper";
import { RULE_USER } from "../../src/models/ListRule";
import * as utils from "../../src/utils";
import axios from "axios";

describe("Test: http-antispam integration", function () {
    let client: MatrixClient;
    let badUser: MatrixClient;
    let badUserId: string;
    let banListId: string;
    this.beforeEach(async function () {
        client = await newTestUser(this.config.homeserverUrl, { name: { contains: "http-antispam" } });
        badUser = await newTestUser(this.config.homeserverUrl, { name: { contains: "http-antispam-bad-user" } });
        badUserId = await badUser.getUserId();

        banListId = await this.mjolnir.client.createRoom({ invite: [await client.getUserId()] });
        await this.mjolnir.policyListManager.watchList(`https://matrix.to/#/${banListId}`);
    });
    it("should block invites from banned users", async function () {
        await utils.createPolicyRule(this.mjolnir.client, banListId, RULE_USER, badUserId, "");
        await this.mjolnir.protectedRoomsTracker.syncLists();

        // hit the webAPI directly to see if invite should be denied
        const canInviteUrl = "http://localhost:8082/api/1/spam_check/user_may_invite";
        const canInviteConfig = {
            url: canInviteUrl,
            method: "post",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.config.web.synapseHTTPAntispam!.authorization}`,
            },
            data: JSON.stringify({
                inviter: badUserId,
            }),
            timeout: 60000,
        };
        try {
            await axios(canInviteConfig);
        } catch (error: any) {
            if (error.isAxiosError && error.response && error.response.status === 403) {
                // pass test, correct error thrown
            } else {
                throw new Error(
                    `Expected a 403 Forbidden error, but received ${error.response ? error.response.status : error.message}`,
                );
            }
        }
    });
    it("should not block invites from users who are not banned", async function () {
        // hit the webAPI directly to see if invite should be denied
        const canInviteUrl = "http://localhost:8082/api/1/spam_check/user_may_invite";
        const canInviteConfig = {
            url: canInviteUrl,
            method: "post",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.config.web.synapseHTTPAntispam!.authorization}`,
            },
            data: JSON.stringify({
                inviter: "@testrando:testytest.com",
            }),
            timeout: 60000,
        };
        // this should not throw an error
        await axios(canInviteConfig);
    });
});
