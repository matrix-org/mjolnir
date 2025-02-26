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

export class MASclient {
    public readonly config: IConfig;
    private client: ClientCredentials;
    private accessToken: AccessToken;

    constructor(config: IConfig) {
        LogService.info("MAS client", "Setting up mas client");
        this.config = config;
        const clientConfig = {
            client: {
                id: config.mas.clientId,
                secret: config.mas.clientSecret,
            },
            auth: {
                tokenPath: config.mas.url + "/oauth2/token",
                tokenHost: config.mas.url,
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
            } catch (error) {
                LogService.error("MAS client", "Error fetching auth token for MAS:", error.message);
                throw error;
            }
        }
        return this.accessToken;
    }

    public async getMASUserId(userId: string): Promise<string> {
        const index = userId.indexOf(":");
        const localpart = userId.substring(1, index);
        const accessToken = await this.getAccessToken();
        try {
            const resp = await axios({
                method: "get",
                url: this.config.mas.url + `/api/admin/v1/users/by-username/${localpart}`,
                headers: {
                    "User-Agent": "Mjolnir",
                    "Content-Type": "application/json; charset=UTF-8",
                    "Authorization": `Bearer ${accessToken.token.access_token}`,
                },
            });
            return resp.data.data.id;
        } catch (error) {
            LogService.error("MAS client", `Error fetching MAS id for user ${userId}:`, error.message);
            throw error;
        }
    }

    public async deactivateMasUser(userId: string): Promise<void> {
        const masId = await this.getMASUserId(userId);
        const accessToken = await this.getAccessToken();
        const url = this.config.mas.url + `/api/admin/v1/users/${masId}/deactivate`;
        try {
            await axios({
                method: "post",
                url: url,
                headers: {
                    "User-Agent": "Mjolnir",
                    "Content-Type": "application/json; charset=UTF-8",
                    "Authorization": `Bearer ${accessToken.token.access_token}`,
                },
            });
        } catch (error) {
            LogService.error("MAS client", `Error deactivating user ${userId} via MAS`, error.message);
            throw error;
        }
    }

    public async lockMasUser(userId: string): Promise<void> {
        const masId = await this.getMASUserId(userId);
        const accessToken = await this.getAccessToken();
        try {
            await axios({
                method: "post",
                url: this.config.mas.url + `/api/admin/v1/users/${masId}/lock`,
                headers: {
                    "User-Agent": "Mjolnir",
                    "Content-Type": "application/json; charset=UTF-8",
                    "Authorization": `Bearer ${accessToken.token.access_token}`,
                },
            });
        } catch (error) {
            LogService.error("Mas client", `Error locking user ${userId} via MAS:`, error.message);
            throw error;
        }
    }

    public async unlockMasUser(userId: string): Promise<void> {
        const masId = await this.getMASUserId(userId);
        const accessToken = await this.getAccessToken();
        try {
            await axios({
                method: "post",
                url: this.config.mas.url + `/api/admin/v1/users/${masId}/unlock`,
                headers: {
                    "User-Agent": "Mjolnir",
                    "Content-Type": "application/json; charset=UTF-8",
                    "Authorization": `Bearer ${accessToken.token.access_token}`,
                },
            });
        } catch (error) {
            LogService.error("Mas client", `Error unlocking user ${userId} via MAS:`, error.message);
            throw error;
        }
    }

    public async masUserIsAdmin(userId: string): Promise<boolean> {
        const index = userId.indexOf(":");
        const localpart = userId.substring(1, index);
        const accessToken = await this.getAccessToken();

        var resp;
        try {
            resp = await axios({
                method: "get",
                url: this.config.mas.url + `/api/admin/v1/users/by-username/${localpart}`,
                headers: {
                    "User-Agent": "Janitor",
                    "Content-Type": "application/json; charset=UTF-8",
                    "Authorization": `Bearer ${accessToken.token.access_token}`,
                },
            });
        } catch (error) {
            LogService.error("MAS client", `Error determining if MAS user ${userId} is admin: `, error.message);
            throw error;
        }
        return resp.data.data.attributes.admin;
    }
}
