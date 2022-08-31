import { Mjolnir } from "../Mjolnir";
import { Request, WeakEvent, BridgeContext } from "matrix-appservice-bridge";
import { IConfig, read as configRead } from "../config";
import { SHORTCODE_EVENT_TYPE } from "../models/PolicyList";
import { Permalinks, MatrixClient } from "matrix-bot-sdk";

export class MjolnirManager {
    private readonly mjolnirs: Map</*the user id of the mjolnir*/string, ManagedMjolnir> = new Map();

    public getDefaultMjolnirConfig(managementRoom: string): IConfig {
        let config = configRead();
        config.managementRoom = managementRoom;
        return config;
    }

    public async createNew(requestingUserId: string, managementRoomId: string, client: MatrixClient) {
        // FIXME: We should be creating the intent here and generating the id surely?
        // rather than externally...
        // FIXME: We need to verify that we haven't stored a mjolnir already if we aren't doing the above.

        // get mjolnir list wroking by just avoiding it for now and see if protections work
        // and bans.
        // Find out trade offs of changing mjolnir to make it work vs making new subcomponent of mjolnir.
        const managedMjolnir = new ManagedMjolnir(await Mjolnir.setupMjolnirFromConfig(client, this.getDefaultMjolnirConfig(managementRoomId)));
        await managedMjolnir.moveMeSomewhereCommonAndStopImplementingFunctionalityOnACommandFirstBasis(requestingUserId, 'list')
        this.mjolnirs.set(await client.getUserId(), managedMjolnir);
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

    public async moveMeSomewhereCommonAndStopImplementingFunctionalityOnACommandFirstBasis(mjolnirOwnerId: string, shortcode: string) {
        const powerLevels: { [key: string]: any } = {
            "ban": 50,
            "events": {
                "m.room.name": 100,
                "m.room.power_levels": 100,
            },
            "events_default": 50, // non-default
            "invite": 0,
            "kick": 50,
            "notifications": {
                "room": 20,
            },
            "redact": 50,
            "state_default": 50,
            "users": {
                [await this.mjolnir.client.getUserId()]: 100,
                [mjolnirOwnerId]: 50
            },
            "users_default": 0,
        };
    
        const listRoomId = await this.mjolnir.client.createRoom({
            preset: "public_chat",
            invite: [mjolnirOwnerId],
            initial_state: [{type: SHORTCODE_EVENT_TYPE, state_key: "", content: {shortcode: shortcode}}],
            power_level_content_override: powerLevels,
        });
    
        const roomRef = Permalinks.forRoom(listRoomId);
        await this.mjolnir.watchList(roomRef);
    }
}