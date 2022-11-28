import * as request from "request";
import { MatrixClient } from "matrix-bot-sdk";

interface OpenIDTokenInfo {
    access_token: string,
    expires_in: number,
    matrix_server_name: string,
    token_type: string
}

async function getOpenIDToken(client: MatrixClient): Promise<string> {
    const tokenInfo: OpenIDTokenInfo = await client.doRequest("POST", `/_matrix/client/v3/user/${await client.getUserId()}/openid/request_token`, undefined, {});
    return tokenInfo.access_token;
}

export interface CreateMjolnirResponse {
    mjolnirUserId: string,
    managementRoomId: string,
}

export class MjolnirWebAPIClient {

    private constructor(
        private readonly openIDToken: string,
        private readonly baseURL: string,
    ) {

    }

    public static async makeClient(client: MatrixClient, baseUrl: string): Promise<MjolnirWebAPIClient> {
        const token = await getOpenIDToken(client);
        return new MjolnirWebAPIClient(token, baseUrl);
    }

    public async createMjolnir(roomToProtectId: string): Promise<CreateMjolnirResponse> {
        const body: { mxid: string, roomId: string } = await new Promise((resolve, reject) => {
            request.post(`${this.baseURL}/create`, {
                json: {
                    openId: this.openIDToken,
                    roomId: roomToProtectId,
                },
            }, (error, response) => error ? reject(error) : resolve(response.body))
        });
        return {
            mjolnirUserId: body.mxid,
            managementRoomId: body.roomId
        }
    }
}
