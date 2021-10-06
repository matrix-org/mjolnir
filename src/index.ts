/*
Copyright 2019, 2020 The Matrix.org Foundation C.I.C.

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

import * as path from "path";
import {
    LogLevel,
    LogService,
    MatrixClient,
    PantalaimonClient,
    RichConsoleLogger,
    SimpleFsStorageProvider
} from "matrix-bot-sdk";
import config from "./config";
import { logMessage } from "./LogProxy";
import { Healthz } from "./health/healthz";
import { Mjolnir } from "./Mjolnir";

config.RUNTIME = {};

LogService.setLogger(new RichConsoleLogger());
LogService.setLevel(LogLevel.fromString(config.logLevel, LogLevel.DEBUG));

LogService.info("index", "Starting bot...");

Healthz.isHealthy = false; // start off unhealthy
if (config.health.healthz.enabled) {
    Healthz.listen();
}

(async function () {
    const storagePath = path.isAbsolute(config.dataPath) ? config.dataPath : path.join(__dirname, '../', config.dataPath);
    const storage = new SimpleFsStorageProvider(path.join(storagePath, "bot.json"));

    let client: MatrixClient;
    if (config.pantalaimon.use) {
        const pantalaimon = new PantalaimonClient(config.homeserverUrl, storage);
        client = await pantalaimon.createClientWithCredentials(config.pantalaimon.username, config.pantalaimon.password);
    } else {
        client = new MatrixClient(config.homeserverUrl, config.accessToken, storage);
    }

    config.RUNTIME.client = client;

    let bot = await Mjolnir.setupMjolnirFromConfig(client);
    await bot.start();
})().catch(err => {
    logMessage(LogLevel.ERROR, "index", err);
    process.exit(1);
});
