/*
Copyright 2019 The Matrix.org Foundation C.I.C.

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
    AutojoinRoomsMixin,
    LogService,
    MatrixClient,
    RichConsoleLogger,
    SimpleFsStorageProvider
} from "matrix-bot-sdk";
import config from "./config";

LogService.setLogger(new RichConsoleLogger());

const storage = new SimpleFsStorageProvider(path.join(config.dataPath, "bot.json"));
const client = new MatrixClient(config.homeserverUrl, config.accessToken, storage);

if (config.autojoin) {
    AutojoinRoomsMixin.setupOnClient(client);
}

client.on("room.message", async (roomId, event) => {
    if (!event['content']) return;

    const content = event['content'];
    if (content['msgtype'] === 'm.text' && content['body'] === '!mjolnir') {
        await client.sendNotice(roomId, "Hello world!");
    }
});

client.start().then(() => LogService.info("index", "Bot started!"));
