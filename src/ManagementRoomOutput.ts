/*
Copyright 2019, 2022 The Matrix.org Foundation C.I.C.

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

import * as Sentry from "@sentry/node";
import { extractRequestError, LogLevel, LogService, MessageType, Permalinks, TextualMessageEventContent, UserID } from "matrix-bot-sdk";
import { IConfig } from "./config";
import { MatrixSendClient } from "./MatrixEmitter";
import { htmlEscape } from "./utils";

const levelToFn = {
    [LogLevel.DEBUG.toString()]: LogService.debug,
    [LogLevel.INFO.toString()]: LogService.info,
    [LogLevel.WARN.toString()]: LogService.warn,
    [LogLevel.ERROR.toString()]: LogService.error,
};

/**
 * Allows the different componenets of mjolnir to send messages back to the management room without introducing a dependency on the entirity of a `Mjolnir` instance.
 */
export default class ManagementRoomOutput {

    constructor(
        private readonly managementRoomId: string,
        private readonly client: MatrixSendClient,
        private readonly config: IConfig,
    ) {

    }

    /**
     * Take an arbitrary string and a set of room IDs, and return a
     * TextualMessageEventContent whose plaintext component replaces those room
     * IDs with their canonical aliases, and whose html component replaces those
     * room IDs with their matrix.to room pills.
     *
     * @param client The matrix client on which to query for room aliases
     * @param text An arbitrary string to rewrite with room aliases and pills
     * @param roomIds A set of room IDs to find and replace in `text`
     * @param msgtype The desired message type of the returned TextualMessageEventContent
     * @returns A TextualMessageEventContent with replaced room IDs
     */
    private async replaceRoomIdsWithPills(text: string, roomIds: Set<string>, msgtype: MessageType = "m.text"): Promise<TextualMessageEventContent> {
        const content: TextualMessageEventContent = {
            body: text,
            formatted_body: htmlEscape(text),
            msgtype: msgtype,
            format: "org.matrix.custom.html",
        };

        // Though spec doesn't say so, room ids that have slashes in them are accepted by Synapse and Dendrite unfortunately for us.
        const escapeRegex = (v: string): string => {
            return v.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        };

        const viaServers = [(new UserID(await this.client.getUserId())).domain];
        for (const roomId of roomIds) {
            let alias = roomId;
            try {
                alias = (await this.client.getPublishedAlias(roomId)) || roomId;
            } catch (e) {
                // This is a recursive call, so tell the function not to try and call us
                await this.logMessage(LogLevel.WARN, "utils", `Failed to resolve room alias for ${roomId} - see console for details`, null, true);
                LogService.warn("utils", extractRequestError(e));
            }
            const regexRoomId = new RegExp(escapeRegex(roomId), "g");
            content.body = content.body.replace(regexRoomId, alias);
            if (content.formatted_body) {
                const permalink = Permalinks.forRoom(alias, alias !== roomId ? [] : viaServers);
                content.formatted_body = content.formatted_body.replace(regexRoomId, `<a href="${permalink}">${htmlEscape(alias)}</a>`);
            }
        }

        return content;
    }

    /**
     * Log a message to the management room and the console, replaces any room ids in additionalRoomIds with pills.
     *
     * @param level Used to determine whether to hide the message or not depending on `config.verboseLogging`.
     * @param module Used to help find where in the source the message is coming from (when logging to the console).
     * @param message The message we want to log.
     * @param additionalRoomIds The roomIds in the message that we want to be replaced by room pills.
     * @param isRecursive Whether logMessage is being called from logMessage.
     */
    public async logMessage(level: LogLevel, module: string, message: string | any, additionalRoomIds: string[] | string | null = null, isRecursive = false): Promise<any> {
        if (level === LogLevel.ERROR) {
            Sentry.captureMessage(`${module}: ${message}`, 'error');
        }
        if (!additionalRoomIds) additionalRoomIds = [];
        if (!Array.isArray(additionalRoomIds)) additionalRoomIds = [additionalRoomIds];

        if (this.config.verboseLogging || LogLevel.INFO.includes(level)) {
            let clientMessage = message;
            if (level === LogLevel.WARN) clientMessage = `⚠ | ${message}`;
            if (level === LogLevel.ERROR) clientMessage = `‼ | ${message}`;

            const client = this.client;
            const roomIds = [this.managementRoomId, ...additionalRoomIds];

            let evContent: TextualMessageEventContent = {
                body: message,
                formatted_body: htmlEscape(message),
                msgtype: "m.notice",
                format: "org.matrix.custom.html",
            };
            if (!isRecursive) {
                evContent = await this.replaceRoomIdsWithPills(clientMessage, new Set(roomIds), "m.notice");
            }

            try {
                await client.sendMessage(this.managementRoomId, evContent);
            } catch (ex) {
                // We want to be informed if we cannot log a message.
                Sentry.captureException(ex);
            }
        }

        levelToFn[level.toString()](module, message);
    }
}
