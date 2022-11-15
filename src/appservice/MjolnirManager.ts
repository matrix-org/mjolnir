import { Mjolnir } from "../Mjolnir";
import { Request, WeakEvent, BridgeContext, Bridge, Intent } from "matrix-appservice-bridge";
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

    /**
     * Create the mjolnir manager from the datastore and the access control.
     * @param dataStore The data store interface that has the details for provisioned mjolnirs.
     * @param bridge The bridge abstraction that encapsulates details about the appservice.
     * @param accessControl Who has access to the bridge.
     * @returns A new mjolnir manager.
     */
    public static async makeMjolnirManager(dataStore: DataStore, bridge: Bridge, accessControl: AccessControl): Promise<MjolnirManager> {
        const mjolnirManager = new MjolnirManager(dataStore, bridge, accessControl);
        await mjolnirManager.createMjolnirsFromDataStore();
        return mjolnirManager;
    }

    /**
     * Gets the default config to give the newly provisioned mjolnirs.
     * @param managementRoomId A room that has been created to serve as the mjolnir's management room for the owner.
     * @returns A config that can be directly used by the new mjolnir.
     */
    private getDefaultMjolnirConfig(managementRoomId: string): IConfig {
        let config = configRead();
        config.managementRoom = managementRoomId;
        config.protectedRooms = [];
        return config;
    }

    /**
     * Creates a new mjolnir for a user.
     * @param requestingUserId The user that is requesting this mjolnir and who will own it.
     * @param managementRoomId An existing matrix room to act as the management room.
     * @param client A client for the appservice virtual user that the new mjolnir should use.
     * @returns A new managed mjolnir.
     */
    public async makeInstance(requestingUserId: string, managementRoomId: string, client: MatrixClient): Promise<ManagedMjolnir> {
        const managedMjolnir = new ManagedMjolnir(
            requestingUserId,
            await Mjolnir.setupMjolnirFromConfig(client, this.getDefaultMjolnirConfig(managementRoomId))
        );
        this.mjolnirs.set(await client.getUserId(), managedMjolnir);
        return managedMjolnir;
    }

    /**
     * Gets a mjolnir for the corresponding mxid that is owned by a specific user.
     * @param mjolnirId The mxid of the mjolnir we are trying to get.
     * @param ownerId The owner of the mjolnir. We ask for it explicitly to not leak access to another user's mjolnir.
     * @returns The matching managed mjolnir instance.
     */
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

    /**
     * Find all of the mjolnirs that are owned by this specific user.
     * @param ownerId An owner of multiple mjolnirs.
     * @returns Any mjolnirs that they own.
     */
    public getOwnedMjolnirs(ownerId: string): ManagedMjolnir[] {
        // TODO we need to use the database for this but also provide the utility
        // for going from a MjolnirRecord to a ManagedMjolnir.
        // https://github.com/matrix-org/mjolnir/issues/409
        return [...this.mjolnirs.values()].filter(mjolnir => mjolnir.ownerId !== ownerId);
    }

    /**
     * Listener that should be setup and called by `MjolnirAppService` while listening to the bridge abstraction provided by matrix-appservice-bridge.
     */
    public onEvent(request: Request<WeakEvent>, context: BridgeContext) {
        // TODO We need a way to map a room id (that the event is from) to a set of managed mjolnirs that should be informed.
        // https://github.com/matrix-org/mjolnir/issues/412
        [...this.mjolnirs.values()].forEach((mj: ManagedMjolnir) => mj.onEvent(request));
    }

    /**
     * provision a new mjolnir for a matrix user.
     * @param requestingUserId The mxid of the user we are creating a mjolnir for.
     * @returns The matrix id of the new mjolnir and its management room.
     */
    public async provisionNewMjolnir(requestingUserId: string): Promise<[string, string]> {
        const access = this.accessControl.getUserAccess(requestingUserId);
        if (access.outcome !== Access.Allowed) {
            throw new Error(`${requestingUserId} tried to provision a mjolnir when they do not have access ${access.outcome} ${access.rule?.reason ?? 'no reason specified'}`);
        }
        const provisionedMjolnirs = await this.dataStore.lookupByOwner(requestingUserId);
        if (provisionedMjolnirs.length === 0) {
            const mjolnirLocalPart = `mjolnir_${randomUUID()}`;
            const mjIntent = await this.makeMatrixIntent(mjolnirLocalPart);

            const managementRoomId = await mjIntent.matrixClient.createRoom({
                preset: 'private_chat',
                invite: [requestingUserId],
                name: `${requestingUserId}'s mjolnir`
            });

            const mjolnir = await this.makeInstance(requestingUserId, managementRoomId, mjIntent.matrixClient);
            await mjolnir.createFirstList(requestingUserId, "list");

            await this.dataStore.store({
                local_part: mjolnirLocalPart,
                owner: requestingUserId,
                management_room: managementRoomId,
            });

            return [mjIntent.userId, managementRoomId];
        } else {
            throw new Error(`User: ${requestingUserId} has already provisioned ${provisionedMjolnirs.length} mjolnirs.`);
        }
    }

    /**
     * Utility that creates a matrix client for a virtual user on our homeserver with the specified loclapart.
     * @param localPart The localpart of the virtual user we need a client for.
     * @returns A bridge intent with the complete mxid of the virtual user and a MatrixClient.
     */
    private async makeMatrixIntent(localPart: string): Promise<Intent> {
        const mjIntent = this.bridge.getIntentFromLocalpart(localPart);
        await mjIntent.ensureRegistered();
        return mjIntent;
    }

    // TODO: We need to check that an owner still has access to the appservice each time they send a command to the mjolnir or use the web api.
    // https://github.com/matrix-org/mjolnir/issues/410
    /**
     * Used at startup to create all the ManagedMjolnir instances and start them so that they will respond to users.
     */
    private async createMjolnirsFromDataStore() {
        for (const mjolnirRecord of await this.dataStore.list()) {
            const mjIntent = await this.makeMatrixIntent(mjolnirRecord.local_part);
            const access = this.accessControl.getUserAccess(mjolnirRecord.owner);
            if (access.outcome !== Access.Allowed) {
                // Don't await, we don't want to clobber initialization just because we can't tell someone they're no longer allowed.
                mjIntent.matrixClient.sendNotice(mjolnirRecord.management_room, `Your mjolnir has been disabled by the administrator: ${access.rule?.reason ?? "no reason supplied"}`);
            } else {
                await this.makeInstance(
                    mjolnirRecord.owner,
                    mjolnirRecord.management_room,
                    mjIntent.matrixClient,
                );
            }
        }
    }
}

export class ManagedMjolnir {
    public constructor(
        public readonly ownerId: string,
        private readonly mjolnir: Mjolnir,
    ) { }

    public async onEvent(request: Request<WeakEvent>) {
        // Emulate the client syncing.
        // https://github.com/matrix-org/mjolnir/issues/411
        const mxEvent = request.getData();
        if (mxEvent['type'] !== undefined) {
            this.mjolnir.client.emit('room.event', mxEvent.room_id, mxEvent);
            if (mxEvent.type === 'm.room.message') {
                this.mjolnir.client.emit('room.message', mxEvent.room_id, mxEvent);
            }
            // TODO: We need to figure out how to inform the mjolnir of `room.join`.
            // https://github.com/matrix-org/mjolnir/issues/411
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
