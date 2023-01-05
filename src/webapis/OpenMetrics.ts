/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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

import { Server } from "http";
import express from "express";
import { LogService } from "matrix-bot-sdk";
import { IHealthConfig } from "../config";
import { collectDefaultMetrics, register } from "prom-client";

export class OpenMetrics {
    private webController: express.Express = express();
    private httpServer?: Server;

    constructor(private readonly config: IHealthConfig) {
        // Setup JSON parsing.
        this.webController.use(express.json());
    }

    /**
     * Start accepting requests to the OpenMetrics API.
     *
     * Does nothing if openMetrics is disabled in the config.
     */
    public async start() {
        if (!this.config.health?.openMetrics?.enabled) {
            LogService.info("OpenMetrics server is disabled.");
            return;
        }
        // Make sure that we collect the Prometheus-recommended metrics.
        try {
            collectDefaultMetrics({ register });
        } catch (ex) {
            if (ex.message.startsWith("A metric with the name")) {
                // `collectDefaultMetrics` throws this error if it is called
                // more than once in the same process, as is the case during
                // testing.
                //
                // Sadly, `register.clear()`, which should be designed to
                // prevent this, seems to work asynchronously and non-deterministically,
                // sometimes not clearing the register at all by the time we re-register
                // default metrics and sometimes clearing metrics that we haven't registered
                // yet.
                //
                // Just ignore this error.
            } else {
                throw ex;
            }
        }

        LogService.info("Starting OpenMetrics server.");
        this.httpServer = this.webController.listen(this.config.health.openMetrics!.port, this.config.health.openMetrics!.address);
        this.webController.options(this.config.health.openMetrics!.address, async (_request, response) => {
            // reply with CORS options
            response.header("Access-Control-Allow-Origin", "*");
            response.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type, Authorization, Date");
            response.header("Access-Control-Allow-Methods", "POST, OPTIONS");
            response.status(200);
            return response.send();
        });
        // Respond to Prometheus collection.
        LogService.info(`configuring GET ${this.config.health.openMetrics.endpoint}`);
        this.webController.get(this.config.health.openMetrics.endpoint, async (_request, response) => {
            // set CORS headers for the response
            response.header("Access-Control-Allow-Origin", "*");
            response.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type, Authorization, Date");
            response.header("Access-Control-Allow-Methods", "POST, OPTIONS");
            try {
                response.set('Content-Type', register.contentType);
                response.end(await register.metrics());
            } catch (ex) {
                response.status(500).end(ex);
            }
        });
        LogService.info(`configuring GET ${this.config.health.openMetrics.endpoint}... DONE`);
        LogService.info("OpenMetrics server ready.");
    }

    public stop() {
        if (this.httpServer) {
            LogService.info("Stopping OpenMetrics server.");
            this.httpServer.close();
            this.httpServer = undefined;
        }
    }

    public get isEnabled(): boolean {
        return !!this.httpServer
    }
}
