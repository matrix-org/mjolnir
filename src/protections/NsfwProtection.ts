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
import { spawn } from "node:child_process";

const TENSOR_SUPPORTED_TYPES = [
    "image/png",
    "image/apng",
    "image/bmp",
    "image/x-bmp",
    "image/gif",
    "image/jpeg",
    "image/jp2",
    "image/jpx",
    "image/jpm",
    // Catch-all
    "application/octet-stream",
];

const FFMPEG_SUPPORTED_TYPES = [
    "video/",
    "image/",
];



export class NsfwProtection extends Protection {
    settings = {};
    // @ts-ignore
    private model: any;

    /**
     * 
     * @param buffer 
     * @returns 
     */
    static extractFrame(mjolnir: Mjolnir, buffer: Buffer): Promise<Buffer> {        
        return new Promise((resolve, reject) => {
            const errData: Buffer[] = [];
            const imageData: Buffer[] = [];
            const cmd = spawn(mjolnir.config.ffmpegPath, ["-i", "-", "-update", "true", "-frames:v","1", "-f", "image2", "-"]);
            cmd.on("exit", (code) => {
                if (code !== 0) {
                    reject(new Error(`FFMPEG failed to run: ${code}, ${Buffer.concat(errData).toString()}`));
                } else {
                    resolve(Buffer.concat(imageData));
                }
            });
            cmd.stderr.on("data", (b) => {
                errData.push(b);
            });
            cmd.stdout.on("data", (b) => {
                imageData.push(b);
            });
            cmd.stdin.write(buffer);
            cmd.stdin.end();
        })

    }

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
            "NSFW. If it is, the image will automatically be redacted."
        );
    }

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event.type !== "m.room.message" && event.type !== "m.sticker") {
            return;
        }

        const content = JSON.stringify(event.content);
        const mxcs = content.match(/(mxc:\/\/[^\s'"]+)/gim);
        if (!mxcs) {
            return;
        }
        // try and grab a human-readable alias for more helpful management room output
        const maybeAlias = await mjolnir.client.getPublishedAlias(roomId);
        const room = maybeAlias ? maybeAlias : roomId;

        // Skip classification if sensitivity is 0, as it's a waste of resources
        // We are using 0.0001 as a threshold to avoid floating point errors
        if (mjolnir.config.nsfwSensitivity <= 0.0001) {
            await this.redactEvent(mjolnir, roomId, event, room);
            return;
        }

        for (const mxc of mxcs) {
            let image = await mjolnir.client.downloadContent(mxc);
            if (!TENSOR_SUPPORTED_TYPES.includes(image.contentType)) {
                // Why do we do this?
                // - We don't want to trust client thumbnails, which might not match the content. Or they might
                //   not exist at all (which forces clients to generate their own)
                // - We also don't want to make our homeserver generate thumbnails of potentially
                //   harmful images, so this locally generates a thumbnail of a range of types in memory.
                if (FFMPEG_SUPPORTED_TYPES.some(mt => image.contentType.startsWith(mt))) {
                    try {
                        LogService.debug("NsfwProtection", `Image type ${image.contentType} is unsupported, attempting to generate thumbnail`);
                        image = {
                            data: await NsfwProtection.extractFrame(mjolnir, image.data),
                            contentType: "image/jpeg"
                        };
                    } catch (ex) {
                        LogService.warn("NsfwProtection", "Could not extract thumbnail from image", ex);
                        continue;
                    }
                } else {
                    LogService.debug("NsfwProtection", `Unsupported file type`);
                    continue;
                }
            }

            // If the mimetype is not found, then try to decode it anyway.
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
                        break;
                    }
                }
            }
            decodedImage.dispose();
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
