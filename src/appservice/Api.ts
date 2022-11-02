import request from "request";
import express from "express";
import * as bodyParser from "body-parser";
import { MjolnirManager } from "./MjolnirManager";
import * as http from "http";

export class Api {
    private httpdConfig: express.Express = express();
    private httpServer?: http.Server;

    constructor(
        private homeserver: string,
        private mjolnirManager: MjolnirManager,
    ) {}

    private resolveAccessToken(accessToken: string): Promise<string> {
        return new Promise((resolve, reject) => {
            request({
                url: `${this.homeserver}/_matrix/federation/v1/openid/userinfo`,
                qs: { access_token: accessToken },
            }, (err, homeserver_response, body) => {
                if (err) {
                    reject(null);
                }

                let response: { sub: string};
                try {
                    response = JSON.parse(body);
                } catch (e) {
                    reject(null);
                    return;
                }

                resolve(response.sub);
            });
        });
    }

    public async close() {
        return await new Promise((resolve, reject) => {
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

    private async pathGet(req: express.Request, response: express.Response) {
        const accessToken = req.query["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const mjolnirId = req.query["mxid"];
        if (mjolnirId === undefined) {
            response.status(400).send("invalid request");
            return;
        }

        //const userId = await this.resolveAccessToken(accessToken);
        // doesn't exist yet
        //if (!this.appService.canSeeMjolnir(userId, mjolnirId)) {
        if (false) {
            response.status(403);
            return;
        }

        // doesn't exist yet
        //const managementRoom = this.appService.managementRoomFor(mjolnirId);
        const managementRoom = "!123456:matrix.org";
        response.status(200).json({ managementRoom: managementRoom });
    }

    private async pathList(req: express.Request, response: express.Response) {
        const accessToken = req.query["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        //const userId = await this.resolveAccessToken(accessToken);
        // doesn't exist yet
        //const existing = this.appService.listForUser(userId);
        const existing = ["@mjolnir_12345:matrix.org", "@mjolnir_12346:matrix.org"];
        response.status(200).json(existing);
    }

    /**
     * Creates a new mjolnir for the requesting user and protects their first room.
     * @param req.body.roomId The room id that the request to create a mjolnir originates from.
     * This is so that mjolnir can protect the room once the authenticity of the request has been verified.
     * @param req.body.openId An OpenID token to verify the send of the request with.
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
        const [mjolnirId, managementRoom] = await this.mjolnirManager.provisionNewMjolnir(userId);

        response.status(200).json({ mxid: mjolnirId, roomId: managementRoom });
    }

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

        const mjolnir = this.mjolnirManager.mjolnirs.get(mjolnirId);
        if (mjolnir === undefined) {
            response.status(400).send("unknown mjolnir mxid");
            return;
        }

        await mjolnir.joinRoom(roomId);
        await mjolnir.addProtectedRoom(roomId);

        response.status(200).json({});
    }
}
