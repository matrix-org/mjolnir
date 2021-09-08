import {
    MatrixClient,
    Permalinks,
} from "matrix-bot-sdk";
import config from "../../src/config";

export async function createManagementRoom(client: MatrixClient) {
    let roomId = await client.createRoom();
    return await client.createRoomAlias(config.managementRoom, roomId);
}

export async function ensureManagementRoomExists(client: MatrixClient): Promise<string> {
    return await client.resolveRoom(config.managementRoom).catch(async e => {
        if (e?.body?.errcode === 'M_NOT_FOUND') {
            console.info("moderation room hasn't been created yet, so we're making it now.")
            return await createManagementRoom(client);
        }
        throw e;
    });
}

export async function ensureLobbyRoomExists(client: MatrixClient): Promise<string> {
    const alias = Permalinks.parseUrl(config.protectedRooms[0]).roomIdOrAlias;
    return await client.resolveRoom(alias).catch(async e => {
        if (e?.body?.errcode === 'M_NOT_FOUND') {
            console.info(`${alias} hasn't been created yet, so we're making it now.`)
            return await client.createRoomAlias(alias, await client.createRoom());
        }
        throw e;
    });
}