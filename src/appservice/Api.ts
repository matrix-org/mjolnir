import request from "request";
import express from "express";
import * as bodyParser from "body-parser";
import { MjolnirManager } from "./MjolnirManager";
import * as http from "http";
import { Logger } from "matrix-appservice-bridge";

const log = new Logger("Api");
/**
 * This provides a web api that is designed to power the mjolnir widget https://github.com/matrix-org/mjolnir-widget.
 */
export class Api {
    private httpdConfig: express.Express = express();
    private httpServer?: http.Server;

    constructor(
        private homeserver: string,
        private mjolnirManager: MjolnirManager,
    ) {}

    /**
     * Resolves an open id access token to find a matching user that the token is valid for.
     * @param accessToken An openID token.
     * @returns The mxid of the user that this token belongs to or null if the token could not be authenticated.
     */
    private resolveAccessToken(accessToken: string): Promise<string|null> {
        return new Promise((resolve, reject) => {
            request({
                url: `${this.homeserver}/_matrix/federation/v1/openid/userinfo`,
                qs: { access_token: accessToken },
            }, (err, homeserver_response, body) => {
                if (err) {
                    log.error(`Error resolving openID token from ${this.homeserver}`, err);
                    reject(null);
                }

                let response: { sub: string};
                try {
                    response = JSON.parse(body);
                } catch (e) {
                    log.error(`Received ill formed response from ${this.homeserver} when resolving an openID token`, e);
                    reject(null);
                    return;
                }

                resolve(response.sub);
            });
        });
    }

    public async close(): Promise<void> {
        await new Promise((resolve, reject) => {
            if (!this.httpServer) {
                throw new TypeError("Server was never started");
            }
            this.httpServer.close(error => error ? reject(error) : resolve(undefined))
        });
    }

    public start(port: number) {
        if (this.httpServer) {
            throw new TypeError("server already started");
        }
        this.httpdConfig.use(bodyParser.json());

        this.httpdConfig.get("/get", this.pathGet.bind(this));
        this.httpdConfig.get("/list", this.pathList.bind(this));
        this.httpdConfig.post("/create", this.pathCreate.bind(this));
        this.httpdConfig.post("/join", this.pathJoin.bind(this));

        this.httpServer = this.httpdConfig.listen(port);
    }

    /**
     * Finds the management room for a mjolnir.
     * @param req.body.openId An OpenID token to verify that the sender of the request owns the mjolnir described in `req.body.mxid`.
     * @param req.body.mxid   The mxid of the mjolnir we want to find the management room for.
     */
    private async pathGet(req: express.Request, response: express.Response) {
        const accessToken = req.body["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const userId = await this.resolveAccessToken(accessToken);
        if (userId === null) {
            response.status(401).send("unauthorised");
            return;
        }

        const mjolnirId = req.body["mxid"];
        if (mjolnirId === undefined) {
            response.status(400).send("invalid request");
            return;
        }

        // TODO: getMjolnir can fail if the ownerId doesn't match the requesting userId.
        // https://github.com/matrix-org/mjolnir/issues/408
        const mjolnir = this.mjolnirManager.getMjolnir(mjolnirId, userId);
        if (mjolnir === undefined) {
            response.status(400).send("unknown mjolnir mxid");
            return;
        }

        response.status(200).json({ managementRoom: mjolnir.managementRoomId });
    }

    /**
     * Return the mxids of mjolnirs that this user has provisioned.
     * @param req.body.openId An OpenID token to find the sender of the request with and find their provisioned mjolnirs.
     */
    private async pathList(req: express.Request, response: express.Response) {
        const accessToken = req.body["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const userId = await this.resolveAccessToken(accessToken);
        if (userId === null) {
            response.status(401).send("unauthorised");
            return;
        }

        const existing = this.mjolnirManager.getOwnedMjolnirs(userId)
        response.status(200).json(existing);
    }

    /**
     * Creates a new mjolnir for the requesting user and protects their first room.
     * @param req.body.roomId The room id that the request to create a mjolnir originates from.
     * This is so that mjolnir can protect the room once the authenticity of the request has been verified.
     * @param req.body.openId An OpenID token to find the sender of the request with.
     */
    private async pathCreate(req: express.Request, response: express.Response) {
        const accessToken = req.body["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const roomId = req.body["roomId"];
        if (roomId === undefined) {
            response.status(400).send("invalid request");
            return;
        }

        const userId = await this.resolveAccessToken(accessToken);
        if (userId === null) {
            response.status(401).send("unauthorised");
            return;
        }

        // TODO: provisionNewMjolnir will throw if it fails...
        // https://github.com/matrix-org/mjolnir/issues/408
        const mjolnir = await this.mjolnirManager.provisionNewMjolnir(userId);

        response.status(200).json({ mxid: await mjolnir.getUserId(), roomId: mjolnir.managementRoomId });
    }

    /**
     * Request a mjolnir to join and protect a room.
     * @param req.body.openId An OpenID token to find the sender of the request with and that they own the mjolnir described in `req.body.mxid`.
     * @param req.body.mxid   The mxid of the mjolnir that should join the room.
     * @param req.body.roomId The room that this mjolnir should join and protect.
     */
    private async pathJoin(req: express.Request, response: express.Response) {
        const accessToken = req.body["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const userId = await this.resolveAccessToken(accessToken);
        if (userId === null) {
            response.status(401).send("unauthorised");
            return;
        }

        const mjolnirId = req.body["mxid"];
        if (mjolnirId === undefined) {
            response.status(400).send("invalid request");
            return;
        }

        const roomId = req.body["roomId"];
        if (roomId === undefined) {
            response.status(400).send("invalid request");
            return;
        }

        // TODO: getMjolnir can fail if the ownerId doesn't match the requesting userId.
        // https://github.com/matrix-org/mjolnir/issues/408
        const mjolnir = this.mjolnirManager.getMjolnir(mjolnirId, userId);
        if (mjolnir === undefined) {
            response.status(400).send("unknown mjolnir mxid");
            return;
        }

        await mjolnir.joinRoom(roomId);
        await mjolnir.addProtectedRoom(roomId);

        response.status(200).json({});
    }
}
