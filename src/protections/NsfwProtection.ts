/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { Protection } from "./IProtection";
import { Mjolnir } from "../Mjolnir";
import * as nsfw from "nsfwjs";
import { LogLevel, LogService } from "@vector-im/matrix-bot-sdk";
import { node } from "@tensorflow/tfjs-node";
import { getMXCsInMessage } from "../utils";
import { BooleanProtectionSetting } from "./ProtectionSettings";

export class NsfwProtection extends Protection {
    settings = {
        quarantine: new BooleanProtectionSetting(),
    };
    // @ts-ignore
    private model: any;

    constructor() {
        super();
    }

    async initialize() {
        this.model = await nsfw.load();
    }

    public get name(): string {
        return "NsfwProtection";
    }

    public get description(): string {
        return (
            "Scans all images sent into a protected room to determine if the image is " +
            "NSFW. If it is, the image will automatically be redacted." +
            " This protection may optionally also automatically quarantine media, see the" +
            "`quarantine` protection setting."
        );
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event.type !== "m.room.message" && event.type !== "m.sticker") {
            return;
        }

        const mxcs = getMXCsInMessage(event.content);
        // try and grab a human-readable alias for more helpful management room output
        const maybeAlias = await mjolnir.client.getPublishedAlias(roomId);
        const room = maybeAlias ? maybeAlias : roomId;

        // Skip classification if sensitivity is 0, as it's a waste of resources
        // We are using 0.0001 as a threshold to avoid floating point errors
        if (mjolnir.config.nsfwSensitivity <= 0.0001) {
            await this.redactEvent(mjolnir, roomId, event, room);
            return;
        }

        let shouldQuarantine = false;

        for (const mxc of mxcs) {
            const image = await mjolnir.client.downloadContent(`mxc://${mxc.domain}/${mxc.mediaId}`);

            let decodedImage;
            try {
                decodedImage = await node.decodeImage(image.data, 3);
            } catch (e) {
                LogService.error("NsfwProtection", `There was an error processing an image: ${e}`);
                continue;
            }

            const predictions = await this.model.classify(decodedImage);

            for (const prediction of predictions) {
                if (["Hentai", "Porn"].includes(prediction["className"])) {
                    if (prediction["probability"] > mjolnir.config.nsfwSensitivity) {
                        await this.redactEvent(mjolnir, roomId, event, room);
                        shouldQuarantine = this.settings.quarantine.value;
                        break;
                    }
                }
            }
            decodedImage.dispose();
        }
        if (shouldQuarantine) {
            console.log("Attempting to quarantine", mxcs);
            for (const mxc of mxcs) {
                await mjolnir.quarantineMedia(mxc);
            }
        }
    }

    private async redactEvent(mjolnir: Mjolnir, roomId: string, event: any, room: string): Promise<any> {
        try {
            await mjolnir.client.redactEvent(roomId, event["event_id"]);
        } catch (err) {
            await mjolnir.managementRoomOutput.logMessage(
                LogLevel.ERROR,
                "NSFWProtection",
                `There was an error redacting ${event["event_id"]} in ${room}: ${err}`,
            );
        }
        let eventId = event["event_id"];
        let body = `Redacted an image in ${room} ${eventId}`;
        let formatted_body = `<details>
                              <summary>Redacted an image in ${room}</summary>
                              <pre>${eventId}</pre>  <pre>${room}</pre>
                              </details>`;
        const msg = {
            msgtype: "m.notice",
            body: body,
            format: "org.matrix.custom.html",
            formatted_body: formatted_body,
        };
        await mjolnir.client.sendMessage(mjolnir.managementRoomId, msg);
    }
}
