import { Mjolnir } from "../Mjolnir";
import { Request, WeakEvent, BridgeContext, Bridge } from "matrix-appservice-bridge";
import { IConfig, read as configRead } from "../config";
import PolicyList from "../models/PolicyList";
import { Permalinks, MatrixClient } from "matrix-bot-sdk";
import { DataStore } from "./datastore";
import { AccessControl } from "./AccessControl";
import { Access } from "../models/AccessControlUnit";
import { randomUUID } from "crypto";

/**
 * The MjolnirManager is responsible for:
 * * Provisioning new mjolnir instances.
 * * Starting mjolnirs when the appservice is brought online.
 * * Informing mjolnirs about new events.
 */
export class MjolnirManager {
    private readonly mjolnirs: Map</*the user id of the mjolnir*/string, ManagedMjolnir> = new Map();

    private constructor(
        private readonly dataStore: DataStore,
        private readonly bridge: Bridge,
        private readonly accessControl: AccessControl
    ) {

    }

    public static async makeMjolnirManager(dataStore: DataStore, bridge: Bridge, accessControl: AccessControl): Promise<MjolnirManager> {
        const mjolnirManager = new MjolnirManager(dataStore, bridge, accessControl);
        mjolnirManager.createMjolnirsFromDataStore();
        return mjolnirManager;
    }

    public getDefaultMjolnirConfig(managementRoom: string): IConfig {
        let config = configRead();
        config.managementRoom = managementRoom;
        config.protectedRooms = [];
        return config;
    }

    public async makeInstance(requestingUserId: string, managementRoomId: string, client: MatrixClient): Promise<ManagedMjolnir> {
        const managedMjolnir = new ManagedMjolnir(
            requestingUserId,
            await Mjolnir.setupMjolnirFromConfig(client, this.getDefaultMjolnirConfig(managementRoomId))
        );
        this.mjolnirs.set(await client.getUserId(), managedMjolnir);
        return managedMjolnir;
    }

    public getMjolnir(mjolnirId: string, ownerId: string): ManagedMjolnir|undefined {
        const mjolnir = this.mjolnirs.get(mjolnirId);
        if (mjolnir) {
            if (mjolnir.ownerId !== ownerId) {
                throw new Error(`${mjolnirId} is owned by a different user to ${ownerId}`);
            } else {
                return mjolnir;
            }
        } else {
            return undefined;
        }
    }

    public getOwnedMjolnirs(ownerId: string): ManagedMjolnir[] {
        // TODO we need to use the database for this but also provide the utility
        // for going from a MjolnirRecord to a ManagedMjolnir.
        return [...this.mjolnirs.values()].filter(mjolnir => mjolnir.ownerId !== ownerId);
    }

    public onEvent(request: Request<WeakEvent>, context: BridgeContext) {
        // We honestly don't know how we're going to map from bridge to user
        // https://github.com/matrix-org/matrix-appservice-bridge/blob/6046d31c54d461ad53e6d6e244ce2d944b62f890/src/components/room-bridge-store.ts
        // looks like it might work, but we will ask, figure it out later.
        [...this.mjolnirs.values()].forEach((mj: ManagedMjolnir) => mj.onEvent(request));
    }

    public async provisionNewMjolnir(requestingUserId: string): Promise<[string, string]> {
        const access = this.accessControl.getUserAccess(requestingUserId);
        if (access.outcome !== Access.Allowed) {
            throw new Error(`${requestingUserId} tried to provision a mjolnir when they do not have access ${access.outcome} ${access.rule?.reason ?? 'no reason specified'}`);
        }
        const provisionedMjolnirs = await this.dataStore.lookupByOwner(requestingUserId);
        if (provisionedMjolnirs.length === 0) {
            const mjolnirLocalPart = `mjolnir_${randomUUID()}`;
            const [mjolnirUserId, mjolnirClient] = await this.makeMatrixClient(mjolnirLocalPart);

            const managementRoomId = await mjolnirClient.createRoom({
                preset: 'private_chat',
                invite: [requestingUserId],
                name: `${requestingUserId}'s mjolnir`
            });

            const mjolnir = await this.makeInstance(requestingUserId, managementRoomId, mjolnirClient);
            await mjolnir.createFirstList(requestingUserId, "list");

            await this.dataStore.store({
                local_part: mjolnirLocalPart,
                owner: requestingUserId,
                management_room: managementRoomId,
            });

            return [mjolnirUserId, managementRoomId];
        } else {
            throw new Error(`User: ${requestingUserId} has already provisioned ${provisionedMjolnirs.length} mjolnirs.`);
        }
    }

    private async makeMatrixClient(localPart: string): Promise<[string, MatrixClient]> {
        // Now we need to make one of the transparent mjolnirs and add it to the monitor.
        const mjIntent = await this.bridge.getIntentFromLocalpart(localPart);
        await mjIntent.ensureRegistered();
        return [mjIntent.userId, mjIntent.matrixClient];
    }

    // Still think that we should check each time a command is sent or something, rather than like this ...
    private async createMjolnirsFromDataStore() {
        for (const mjolnirRecord of await this.dataStore.list()) {
            const [_mjolnirUserId, mjolnirClient] = await this.makeMatrixClient(mjolnirRecord.local_part);
            const access = this.accessControl.getUserAccess(mjolnirRecord.owner);
            if (access.outcome !== Access.Allowed) {
                // Don't await, we don't want to clobber initialization just because we can't tell someone they're no longer allowed.
                mjolnirClient.sendNotice(mjolnirRecord.management_room, `Your mjolnir has been disabled by the administrator: ${access.rule?.reason ?? "no reason supplied"}`);
            } else {
                await this.makeInstance(
                    mjolnirRecord.owner,
                    mjolnirRecord.management_room,
                    mjolnirClient,
                );
            }
        }
    }
}

// Isolating this mjolnir is going to require provisioning an access token just for this user to be useful.
// We can use fork and node's IPC to inform the process of matrix evnets.
export class ManagedMjolnir {
    public constructor(
        public readonly ownerId: string,
        private readonly mjolnir: Mjolnir,
    ) { }

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

    public get managementRoomId(): string {
        return this.mjolnir.managementRoomId;
    }
}