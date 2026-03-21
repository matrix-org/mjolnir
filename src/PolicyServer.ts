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

import { LogService } from "@vector-im/matrix-bot-sdk";

export class PolicyServer {
    private ed25519Key: string | undefined;
    private lastCheck: Date;
    private serverNameOverride: string | undefined;

    constructor(private serverName: string) {
        // Check for HTTP URIs in the server name, just in case we're running a test
        if (this.serverName.startsWith("http://")) {
            const uri = new URL(this.serverName);
            this.serverNameOverride = uri.hostname;
        }

        this.lastCheck = new Date(0);
    }

    public get name(): string {
        if (this.serverNameOverride) {
            return this.serverNameOverride;
        }
        return this.serverName;
    }

    public async getEd25519Key(): Promise<string | undefined> {
        const keyStillFresh = (this.lastCheck.getTime() + 1000 * 60 * 60 * 24) > Date.now(); // valid for 24 hours
        if (this.ed25519Key && keyStillFresh) {
            return this.ed25519Key;
        }

        const errorStillFresh = (this.lastCheck.getTime() + 1000 * 60 * 60) > Date.now(); // errors are valid for 1 hour
        if (!this.ed25519Key && errorStillFresh) {
            return undefined;
        }

        this.lastCheck = new Date();

        // As per spec/MSC4284
        // We allow HTTP URIs in the server name for testing purposes
        let schemeAndHostname = `https://${this.name}`; // will be the hostname if an HTTP link, per constructor
        if (this.serverName.startsWith("http://")) { // this is the unnormalized name
            LogService.warn("PolicyServer", "Using non-HTTP URI for policy server: " + this.serverName);
            schemeAndHostname = this.serverName;
        }
        const response = await fetch(`${schemeAndHostname}/.well-known/matrix/policy_server`);
        if (!response.ok) {
            LogService.warn("PolicyServer", `Failed to fetch ed25519 key for ${this.name}: ${response.statusText}`);
            this.ed25519Key = undefined;
            return undefined;
        }

        const keyInfo = await response.json();
        if (typeof keyInfo !== "object" || typeof keyInfo.public_keys !== "object" || typeof keyInfo.public_keys.ed25519 !== "string") {
            LogService.warn("PolicyServer", `Failed to parse ed25519 key for ${this.name}: invalid response or no key`);
            this.ed25519Key = undefined;
            return undefined;
        }

        this.ed25519Key = keyInfo.public_keys.ed25519;
        return this.ed25519Key;
    }
}