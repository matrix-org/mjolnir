import { Mjolnir } from "../Mjolnir";
import { Request, WeakEvent, BridgeContext } from "matrix-appservice-bridge";
import { IConfig, read as configRead } from "../config";
import PolicyList, { SHORTCODE_EVENT_TYPE } from "../models/PolicyList";
import { Permalinks, MatrixClient } from "matrix-bot-sdk";

export class MjolnirManager {
    public readonly mjolnirs: Map</*the user id of the mjolnir*/string, ManagedMjolnir> = new Map();

    public getDefaultMjolnirConfig(managementRoom: string): IConfig {
        let config = configRead();
        config.managementRoom = managementRoom;
        config.protectedRooms = [];
        return config;
    }

    public async makeInstance(requestingUserId: string, managementRoomId: string, client: MatrixClient): Promise<ManagedMjolnir> {
        const managedMjolnir = new ManagedMjolnir(await Mjolnir.setupMjolnirFromConfig(client, this.getDefaultMjolnirConfig(managementRoomId)));
        this.mjolnirs.set(await client.getUserId(), managedMjolnir);
        return managedMjolnir;
    }

    public onEvent(request: Request<WeakEvent>, context: BridgeContext) {
        // We honestly don't know how we're going to map from bridge to user
        // https://github.com/matrix-org/matrix-appservice-bridge/blob/6046d31c54d461ad53e6d6e244ce2d944b62f890/src/components/room-bridge-store.ts
        // looks like it might work, but we will ask, figure it out later.
        [...this.mjolnirs.values()].forEach((mj: ManagedMjolnir) => mj.onEvent(request));
    }
}

// Isolating this mjolnir is going to require provisioning an access token just for this user to be useful.
// We can use fork and node's IPC to inform the process of matrix evnets.
export class ManagedMjolnir {
    public constructor(private readonly mjolnir: Mjolnir) { }

    public async onEvent(request: Request<WeakEvent>) {
        // phony sync.
        const mxEvent = request.getData();
        if (mxEvent['type'] !== undefined) {
            this.mjolnir.client.emit('room.event', mxEvent.room_id, mxEvent);
            if (mxEvent.type === 'm.room.message') {
                this.mjolnir.client.emit('room.message', mxEvent.room_id, mxEvent);
            }
            // room.join requires us to know the joined rooms before so lol.
        }
        if (mxEvent['type'] === 'm.room.member') {
            if (mxEvent['content']['membership'] === 'invite' && mxEvent.state_key === await this.mjolnir.client.getUserId()) {
                this.mjolnir.client.emit('room.invite', mxEvent.room_id, mxEvent);
            }
        }
    }

    public async joinRoom(roomId: string) {
        await this.mjolnir.client.joinRoom(roomId);
    }
    public async addProtectedRoom(roomId: string) {
        await this.mjolnir.addProtectedRoom(roomId);
    }

    public async createFirstList(mjolnirOwnerId: string, shortcode: string) {
        const listRoomId = await PolicyList.createList(
            this.mjolnir.client,
            shortcode,
            [mjolnirOwnerId],
            { name: `${mjolnirOwnerId}'s policy room` }
        );
        const roomRef = Permalinks.forRoom(listRoomId);
        return await this.mjolnir.watchList(roomRef);
    }
}