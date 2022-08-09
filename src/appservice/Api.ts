import * from "request";
import { MjolnirAppService } from "./AppService";
import { MjolnirManager } from "./MjolnirManager";

export class Api {
    private httpdConfig: express.Express = express();

    constructor(
        private homeserver: string,
        private appService: MjolnirAppService,
        private manager: MjolnirManager,
    ) {}

    private resolveAccessToken(accessToken: string): Promise<string> {
        return new Promise((resolve, reject) => {
            request({
                url: `${this.homeserver}/_matrix/federation/v1/openid/userinfo`,
                qs: { access_token: accessToken },
            }, (err, response, body) => {
                if (err) {
                    reject(null);
                }

                var response: { sub: string};
                try {
                    response = JSON.parse(body);
                } catch (e) {
                    reject(null);
                }

                resolve(response.sub);
            });
        });
    }

    public start(port: number) {
        this.httpdConfig.get("/get", this.pathGet);
        this.httpdConfig.get("/list", this.pathList);
        this.httpdConfig.post("/create", this.pathCreate);

        const httpServer = this.httpdConfig.listen(port);
    }

    private async pathGet(request: express.Request, response: express.Response) {
        const accessToken = request.params.query["openId"];
        if (accessToken === undefined) {
            response.status(401);
            return;
        }

        const mjolnirId = request.params.query["mxid"];
        if (mjolnirId === undefined) {
            response.status(400);
            return;
        }

        const userId = await this.resolveAccesstoken(accessToken);
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
        const accessToken = request.params.query["openId"];
        if (accessToken === undefined) {
            response.status(401);
            return;
        }

        const userId = await this.resolveAccessToken(accessToken);
        // doesn't exist yet
        //const existing = this.appService.listForUser(userId);
        const existing = ["@mjolnir_12345:matrix.org", "@mjolnir_12346:matrix.org"];
        response.status(200).json(existing);
    }

    private async pathCreate(request: express.Request, response: express.Response) {
        const accessToken = request.params.query["openId"];
        if (accessToken === undefined) {
            response.status(401);
            return;
        }

        const managementRoom = request.params.query["roomId"] || null;

        const userId = await this.resolveAccessToken(accessToken);
        const mjolnirId = this.appService.provisionNewMjolnir(
            userId,
            // method doesn't take a managementRoom yet
            //managementRoom,
        );

        // privisionNewMjolnir can't fail yet, but it should be able to
        //if (mjolnirId === null) {
        //}

        response.status(200).json({ mxid: mjolnirId });
    }
}
