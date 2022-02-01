/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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

import * as express from "express";
import { LogService, MatrixClient } from "matrix-bot-sdk";

import config from "../config";
import RuleServer from "../models/RuleServer";
import { ReportManager } from "../report/ReportManager";


/**
 * A common prefix for all web-exposed APIs.
 */
const API_PREFIX = "/api/1";

const AUTHORIZATION: RegExp = new RegExp("Bearer (.*)");

export class WebAPIs {
    private webController: express.Express = express();
    private httpServer?: Server;

    constructor(private reportManager: ReportManager, private readonly ruleServer: RuleServer|null) {
        // Setup JSON parsing.
        this.webController.use(express.json());
    }

    /**
     * Start accepting requests to the Web API.
     */
    public async start() {
        if (!config.web.enabled) {
            return;
        }
        this.httpServer = this.webController.listen(config.web.port, config.web.address);

        // Configure /report API.
        if (config.web.abuseReporting.enabled) {
            console.log(`Configuring ${API_PREFIX}/report/:room_id/:event_id...`);
            this.webController.post(`${API_PREFIX}/report/:room_id/:event_id`, async (request, response) => {
                console.debug(`Received a message on ${API_PREFIX}/report/:room_id/:event_id`, request.params);
                await this.handleReport({ request, response, roomId: request.params.room_id, eventId: request.params.event_id })
            });
            console.log(`Configuring ${API_PREFIX}/report/:room_id/:event_id... DONE`);
        }

        // Configure ruleServer API.
        // FIXME: Doesn't this need some kind of access control?
        // See https://github.com/matrix-org/mjolnir/issues/139#issuecomment-1012221479.
        if (config.web.ruleServer?.enabled) {
            const updatesUrl = `${API_PREFIX}/ruleserver/updates`;
            LogService.info("WebAPIs", `Configuring ${updatesUrl}...`);
            if (!this.ruleServer) {
                throw new Error("The rule server to use has not been configured for the WebAPIs.");
            }
            const ruleServer: RuleServer = this.ruleServer;
            this.webController.get(updatesUrl, async (request, response) => {
                await this.handleRuleServerUpdate(ruleServer, { request, response, since: request.query.since as string});
            });
            LogService.info("WebAPIs", `Configuring ${updatesUrl}... DONE`);
        }
    }

    public stop() {
        if (this.httpServer) {
            console.log("Stopping WebAPIs.");
            this.httpServer.close();
            this.httpServer = undefined;
        }
    }

    /**
     * Handle a call to the /report API.
     *
     * In case of success, respond an empty JSON body.
     *
     * @param roomId The room in which the reported event took place. Already extracted from the URL.
     * @param eventId The event. Already extracted from the URL.
     * @param request The request. Its body SHOULD hold an object `{reason?: string}`
     * @param response The response. Used to propagate HTTP success/error.
     */
    async handleReport({ roomId, eventId, request, response }: { roomId: string, eventId: string, request: express.Request, response: express.Response }) {
        // To display any kind of useful information, we need
        //
        // 1. The reporter id;
        // 2. The accused id, to be able to warn/kick/ban them if necessary;
        // 3. The content of the event **if the room is unencrypted**.

        try {
            let reporterId;
            let event;
            {
                // -- Create a client on behalf of the reporter.
                // We'll use it to confirm the authenticity of the report.
                let accessToken;

                // Authentication mechanism 1: Request header.
                let authorization = request.get('Authorization');

                if (authorization) {
                    [, accessToken] = AUTHORIZATION.exec(authorization)!;
                } else {
                    // Authentication mechanism 2: Access token as query parameter.
                    accessToken = request.query["access_token"];
                }

                // Create a client dedicated to this report.
                //
                // VERY IMPORTANT NOTES
                //
                // We're impersonating the user to get the context of the report.
                //
                // For privacy's sake, we MUST ensure that:
                //
                // - we DO NOT sync with this client, as this would let us
                //    snoop on messages other than the context of the report;
                // - we DO NOT associate a crypto store (e.g. Pantalaimon),
                //    as this would let us read encrypted messages;
                // - this client is torn down as soon as possible to avoid
                //    any case in which it could somehow be abused if a
                //    malicious third-party gains access to Mjölnir.
                //
                // Rationales for using this mechanism:
                //
                // 1. This /report interception feature can only be setup by someone
                //    who already controls the server. In other words, if they wish
                //    to snoop on unencrypted messages, they can already do it more
                //    easily at the level of the proxy.
                // 2. The `reporterClient` is used only to provide
                //    - identity-checking; and
                //    - features that are already available in the Synapse Admin API
                //      (possibly in the Admin APIs of other homeservers, I haven't checked)
                //    so we are not extending the abilities of Mjölnir
                // 3. We are avoiding the use of the Synapse Admin API to ensure that
                //    this feature can work with all homeservers, not just Synapse.
                let reporterClient = new MatrixClient(config.rawHomeserverUrl, accessToken);
                reporterClient.start = () => {
                    throw new Error("We MUST NEVER call start on the reporter client");
                };

                reporterId = await reporterClient.getUserId();

                /*
                Past this point, the following invariants hold:

                - The report was sent by a Matrix user.
                - The identity of the Matrix user who sent the report is stored in `reporterId`.
                */

                // Now, let's gather more info on the event.
                // IMPORTANT: The following call will return the event without decyphering it, so we're
                // not obtaining anything that we couldn't also obtain through a homeserver's Admin API.
                //
                // By doing this with the reporterClient, we ensure that this feature of Mjölnir can work
                // with all Matrix homeservers, rather than just Synapse.
                event = await reporterClient.getEvent(roomId, eventId);
            }

            let reason = request.body["reason"];
            await this.reportManager.handleServerAbuseReport({ roomId, eventId, reporterId, event, reason });

            // Match the spec behavior of `/report`: return 200 and an empty JSON.
            response.status(200).json({});
        } catch (ex) {
            console.warn("Error responding to an abuse report", roomId, eventId, ex);
            response.status(503);
        }
    }

    async handleRuleServerUpdate(ruleServer: RuleServer, { since, request, response }: { since: string, request: express.Request, response: express.Response }) {
        // FIXME Have to do this because express sends keep alive by default and during tests.
        // The server will never be able to close because express never closes the sockets, only stops accepting new connections.
        // See https://github.com/matrix-org/mjolnir/issues/139#issuecomment-1012221479.
        response.set("Connection", "close");
        try {
            response.json(ruleServer.getUpdates(since)).status(200);
        } catch (ex) {
            LogService.error("WebAPIs", `Error responding to a rule server updates request`, since, ex);
        }
    }
}
