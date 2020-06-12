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

import config from "../config";
import * as http from "http";
import { LogService } from "matrix-bot-sdk";

export class Healthz {
    private static healthCode: number;

    public static set isHealthy(val: boolean) {
        Healthz.healthCode = val ? config.health.healthz.healthyStatus : config.health.healthz.unhealthyStatus;
    }

    public static get isHealthy(): boolean {
        return Healthz.healthCode === config.health.healthz.healthyStatus;
    }

    public static listen() {
        const server = http.createServer((req, res) => {
            res.writeHead(Healthz.healthCode);
            res.end(`health code: ${Healthz.healthCode}`);
        });
        server.listen(config.health.healthz.port, config.health.healthz.address, () => {
            LogService.info("Healthz", `Listening for health requests on ${config.health.healthz.address}:${config.health.healthz.port}`);
        });
    }
}
