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

import { ClientCredentials, AccessToken } from "simple-oauth2";
import { IConfig } from "./config";
import axios from "axios";
import { LogService } from "@vector-im/matrix-bot-sdk";

export class MASClient {
    public readonly config: IConfig;
    private client: ClientCredentials;
    private accessToken?: AccessToken;

    constructor(config: IConfig) {
        LogService.info("MAS client", "Setting up MAS client");
        this.config = config;
        const clientConfig = {
            client: {
                id: config.MAS.clientId,
                secret: config.MAS.clientSecret,
            },
            auth: {
                tokenPath: config.MAS.url + "/oauth2/token",
                tokenHost: config.MAS.url,
            },
        };
        this.client = new ClientCredentials(clientConfig);
    }

    public async getAccessToken() {
        if (!this.accessToken || this.accessToken.expired()) {
            // fetch a new one
            const tokenParams = { scope: "urn:mas:admin" };
            try {
                this.accessToken = await this.client.getToken(tokenParams);
            } catch (error: any) {
                LogService.error("MAS client", "Error fetching auth token for MAS:", error.message);
                throw error;
            }
        }
        return this.accessToken;
    }

    public async getMASUserId(userId: string): Promise<string> {
        const index = userId.indexOf(":");
        const localpart = userId.substring(1, index);

        try {
            const resp = await this.doRequest("get", `/api/admin/v1/users/by-username/${localpart}`);
            return resp.data.id;
        } catch (error: any) {
            LogService.error("MAS client", `Error fetching MAS id for user ${userId}:`, error.message);
            throw error;
        }
    }

    public async deactivateMASUser(userId: string): Promise<void> {
        const MASId = await this.getMASUserId(userId);
        try {
            await this.doRequest("post", `/api/admin/v1/users/${MASId}/deactivate`);
        } catch (error: any) {
            LogService.error("MAS client", `Error deactivating user ${userId} via MAS`, error.message);
            throw error;
        }
    }

    public async lockMASUser(userId: string): Promise<void> {
        const MASId = await this.getMASUserId(userId);
        try {
            await this.doRequest("post", `/api/admin/v1/users/${MASId}/lock`);
        } catch (error: any) {
            LogService.error("MAS client", `Error locking user ${userId} via MAS:`, error.message);
            throw error;
        }
    }

    public async unlockMASUser(userId: string): Promise<void> {
        const MASId = await this.getMASUserId(userId);
        try {
            await this.doRequest("post", `/api/admin/v1/users/${MASId}/unlock`);
        } catch (error: any) {
            LogService.error("MAS client", `Error unlocking user ${userId} via MAS:`, error.message);
            throw error;
        }
    }

    public async UserIsMASAdmin(userId: string): Promise<boolean> {
        const index = userId.indexOf(":");
        const localpart = userId.substring(1, index);
        const path = `/api/admin/v1/users/by-username/${localpart}`;

        let resp;
        try {
            resp = await this.doRequest("get", path);
        } catch (error: any) {
            LogService.error("MAS client", `Error determining if MAS user ${userId} is admin: `, error.message);
            throw error;
        }
        return resp.data.attributes.admin;
    }

    public async doRequest(method: string, path: string) {
        const url = this.config.MAS.url + path;
        const accessToken = await this.getAccessToken();
        const headers = {
            "User-Agent": "Mjolnir",
            "Content-Type": "application/json; charset=UTF-8",
            "Authorization": `Bearer ${accessToken.token.access_token}`,
        };
        LogService.info("MAS client", `Calling ${url}`);

        const resp = await axios({
            method,
            url,
            headers,
        });
        return resp.data;
    }
}
