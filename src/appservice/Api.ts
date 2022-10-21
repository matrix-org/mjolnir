import request from "request";
import express from "express";
import * as bodyParser from "body-parser";
import { MjolnirManager } from "./MjolnirManager";

export class Api {
    private httpdConfig: express.Express = express();

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

                var response: { sub: string};
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

    public start(port: number) {
        this.httpdConfig.use(bodyParser.json());

        this.httpdConfig.get("/get", this.pathGet.bind(this));
        this.httpdConfig.get("/list", this.pathList.bind(this));
        this.httpdConfig.post("/create", this.pathCreate.bind(this));
        this.httpdConfig.post("/join", this.pathJoin.bind(this));

        this.httpdConfig.listen(port);
    }

    private async pathGet(request: express.Request, response: express.Response) {
        const accessToken = request.query["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const mjolnirId = request.query["mxid"];
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

    private async pathList(request: express.Request, response: express.Response) {
        const accessToken = request.query["openId"];
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

    private async pathCreate(request: express.Request, response: express.Response) {
        const accessToken = request.body["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const roomId = request.body["roomId"];
        if (roomId === undefined) {
            response.status(400).send("invalid request");
            return;
        }

        const userId = await this.resolveAccessToken(accessToken);
        if (userId === null) {
            response.status(401).send("unauthorised");
            return;
        }

        const [mjolnirId, managementRoom] = await this.mjolnirManager.provisionNewMjolnir(userId);

        // privisionNewMjolnir can't fail yet, but it should be able to
        //if (mjolnirId === null) {
        //}

        response.status(200).json({ mxid: mjolnirId, roomId: managementRoom });
    }

    private async pathJoin(request: express.Request, response: express.Response) {
        const accessToken = request.body["openId"];
        if (accessToken === undefined) {
            response.status(401).send("unauthorised");
            return;
        }

        const userId = await this.resolveAccessToken(accessToken);
        if (userId === null) {
            response.status(401).send("unauthorised");
            return;
        }

        const mjolnirId = request.body["mxid"];
        if (mjolnirId === undefined) {
            response.status(400).send("invalid request");
            return;
        }

        const roomId = request.body["roomId"];
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
