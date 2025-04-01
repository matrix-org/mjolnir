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
import { LogLevel, LogService, MXCUrl } from "@vector-im/matrix-bot-sdk";
import { node, Tensor3D } from "@tensorflow/tfjs-node";
import { spawn } from "node:child_process";
import { ReadableStream } from "node:stream/web";

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
];

const FFMPEG_SUPPORTED_TYPES = ["video/", "image/"];

const FFMPEG_EXTRA_ARGS: Record<string, string[]> = {
    // Extra params needed to extract svg thumbnails.
    "image/svg+xml": ["-f", "svg_pipe", "-frame_size", "10000", "-video_size", "512x512"],
};

export class NsfwProtection extends Protection {
    settings = {};
    // @ts-ignore
    private model: nsfw.NSFWJS;

    private classificationCache = new Map<string, boolean>();

    /**
     * Extract the first frame from a video or image source.
     * @param ffmpegPath The path to the `ffmpeg` binary.
     * @param stream The stream containing the source.
     * @param mimetype The mimetype provided by the source.
     *
     * @returns A byte array containing the thumbnail in JPEG format.
     */
    static async extractFrame(
        ffmpegPath: string,
        stream: ReadableStream<Uint8Array>,
        mimetype: string,
    ): Promise<Uint8Array> {
        const errData: Buffer[] = [];
        const imageData: Buffer[] = [];
        const extraArgs = FFMPEG_EXTRA_ARGS[mimetype] ?? [];
        const cmd = spawn(ffmpegPath, [
            ...extraArgs,
            "-i",
            "-",
            "-update",
            "true",
            "-frames:v",
            "1",
            "-f",
            "image2",
            "-",
        ]);
        let stdinErrorFinished!: Promise<void>;
        const p = new Promise<Uint8Array>((resolve, reject) => {
            cmd.once("exit", (code) => {
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
            // EPIPE is "normal" for ffmpeg to emit after it's finished processing an input.
            stdinErrorFinished = new Promise((res, rej) => {
                cmd.stdin.once("error", (e: { code: string }) => {
                    if (e.code !== "EPIPE") {
                        LogService.debug("NsfwProtection", "Unexpected error from ffmpeg", e);
                        rej(e);
                    }
                    res();
                });
            });
        });
        for await (const element of stream) {
            if (cmd.stdin.write(element) === false) {
                // Wait for either a drain, or the whole stream to complete
                await Promise.race([stdinErrorFinished, new Promise((r) => cmd.stdin.once("drain", r))]);
            }
        }
        if (!cmd.stdin.writableEnded) {
            cmd.stdin.end();
        }
        try {
            return await p;
        } finally {
            LogService.debug("NsfwProtection", `Generated thumbnail`);
        }
    }

    constructor() {
        super();
    }

    async initialize(modelName: string) {
        this.model = await nsfw.load(modelName);
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

    /**
     * Given a MXC URL, attempt to extract a image supported by our NSFW model.
     * @param mjolnir The mjolnir instance.
     * @param mxc The MXC url.
     * @returns Bytes of an image processable by the model.
     */
    private async determineImageFromMedia(mjolnir: Mjolnir, mxc: MXCUrl): Promise<Uint8Array | null> {
        const res = await fetch(
            `${mjolnir.client.homeserverUrl}/_matrix/client/v1/media/download/${encodeURIComponent(mxc.domain)}/${encodeURIComponent(mxc.mediaId)}`,
            {
                headers: {
                    Authorization: `Bearer ${mjolnir.client.accessToken}`,
                },
            },
        );
        if (!res.body || res.status !== 200) {
            LogService.error("NsfwProtection", `Could not fetch mxc ${mxc}: ${res.status}`);
            return null;
        }
        const contentType = res.headers.get("content-type")?.split(";")[0];
        if (!contentType) {
            LogService.warn("NsfwProtection", `No content type header specified`);
            return null;
        }
        console.log(contentType);
        if (TENSOR_SUPPORTED_TYPES.includes(contentType)) {
            return new Uint8Array(await res.arrayBuffer());
        }
        // Why do we do this?
        // - We don't want to trust client thumbnails, which might not match the content. Or they might
        //   not exist at all (which forces clients to generate their own)
        // - We also don't want to make our homeserver generate thumbnails of potentially
        //   harmful images, so this locally generates a thumbnail of a range of types in memory.
        if (mjolnir.config.ffmpegPath && FFMPEG_SUPPORTED_TYPES.some((mt) => contentType.startsWith(mt))) {
            const stream = res.body as ReadableStream<Uint8Array>;
            try {
                LogService.debug(
                    "NsfwProtection",
                    `Image type ${contentType} is unsupported by model, attempting to generate thumbnail`,
                );
                return await NsfwProtection.extractFrame(mjolnir.config.ffmpegPath, stream, contentType);
            } catch (ex) {
                LogService.warn("NsfwProtection", "Could not extract thumbnail from image", ex);
                return null;
            }
        }

        LogService.debug("NsfwProtection", `Unsupported file type ${contentType}`);
        return null;
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
            // If we've already scanned this media, return early.
            if (this.classificationCache.has(mxc)) {
                if (this.classificationCache.get(mxc)) {
                    await this.redactEvent(mjolnir, roomId, event, room);
                    break;
                }
                continue;
            }

            const data = await this.determineImageFromMedia(mjolnir, MXCUrl.parse(mxc));
            if (!data) {
                // Couldn't extract an image, skip.
                continue;
            } else {
                LogService.debug("NsfwProtection", `Thumbnail generated for ${mxc}`);
            }
            let decodedImage: Tensor3D | undefined;
            try {
                decodedImage = (await node.decodeImage(data, 3)) as Tensor3D;
                const predictions = await this.model.classify(decodedImage);
                LogService.debug("NsfwProtection", `Classified ${mxc} as`, predictions);
                const isNsfw = predictions.some(
                    (prediction) =>
                        ["Hentai", "Porn"].includes(prediction.className) &&
                        prediction.probability > mjolnir.config.nsfwSensitivity,
                );
                this.classificationCache.set(mxc, isNsfw);
                if (isNsfw) {
                    await this.redactEvent(mjolnir, roomId, event, room);
                    // Stop scanning media once we've redacted.
                    break;
                }
            } catch (e) {
                LogService.error("NsfwProtection", `There was an error processing an image: ${e}`);
                continue;
            } finally {
                if (decodedImage) {
                    decodedImage.dispose();
                }
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
