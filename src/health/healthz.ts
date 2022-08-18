/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import * as http from "http";
import { LogService } from "matrix-bot-sdk";
import { IConfig } from "../config";
// allowed to use the global configuration since this is only intended to be used by `src/index.ts`.

export class Healthz {
    private healthCode: number;

    constructor(private config: IConfig) { }

    public set isHealthy(val: boolean) {
        this.healthCode = val ? this.config.health.healthz.healthyStatus : this.config.health.healthz.unhealthyStatus;
    }

    public get isHealthy(): boolean {
        return this.healthCode === this.config.health.healthz.healthyStatus;
    }

    public listen() {
        const server = http.createServer((req, res) => {
            res.writeHead(this.healthCode);
            res.end(`health code: ${this.healthCode}`);
        });
        server.listen(this.config.health.healthz.port, this.config.health.healthz.address, () => {
            LogService.info("Healthz", `Listening for health requests on ${this.config.health.healthz.address}:${this.config.health.healthz.port}`);
        });
    }
}
