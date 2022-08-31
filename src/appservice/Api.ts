import * as request from "request";
import * as express from "express";
import { MjolnirAppService } from "./AppService";

export class Api {
    private httpdConfig: express.Express = express();

    constructor(
        private homeserver: string,
        private appService: MjolnirAppService,
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
        this.httpdConfig.use(express.json());

        this.httpdConfig.get("/get", this.pathGet);
        this.httpdConfig.get("/list", this.pathList);
        this.httpdConfig.post("/create", this.pathCreate);

        this.httpdConfig.listen(port);
    }

    private async pathGet(request: express.Request, response: express.Response) {
        const accessToken = request.query["openId"];
        if (accessToken === undefined) {
            response.status(401);
            return;
        }

        const mjolnirId = request.query["mxid"];
        if (mjolnirId === undefined) {
            response.status(400);
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
            response.status(401);
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
            response.status(401);
            return;
        }

        const managementRoom = request.params.query["roomId"];

        const userId = await this.resolveAccessToken(accessToken);
        const mjolnirId = this.appService.provisionNewMjolnir(
            userId, managementRoom,
        );

        // privisionNewMjolnir can't fail yet, but it should be able to
        //if (mjolnirId === null) {
        //}

        response.status(200).json({ mxid: mjolnirId });
    }
}
