
/**
 * What kind of vulnerabilities make process isolation count?
 * Either way they have the token to the appservice even with process isolation
 * the bounds are limitless.
 * 
 * In both casees we have to migrate the configuration away from being static
 * so that it can be built on the fly to start new processes.
 * Yes we could also write to a file but that's disgusting and i refuse.
 * The config is the biggest piece of static bullshit that makes things a pita,
 * so this removes one of the arguments against in-process work.
 * 
 * Ok so my idea is to just use fork and have a special Mjolnir instance
 * that basically proxies the mjolnir in the forked processes.
 * 
 */

import { randomUUID } from "crypto";
import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, MatrixUser } from "matrix-appservice-bridge";
import { MatrixClient } from "matrix-bot-sdk";
import { MjolnirManager } from ".//MjolnirManager";
import { DataStore, PgDataStore } from ".//datastore";
import { Api } from "./Api";
import { IConfig } from "./config/config";

// so one problem we have in regards to the ACL unit
// and the policy list is that we can't initialize those 
// until the bridge has read the access tokens with init etc.
export class MjolnirAppService {

    public readonly dataStore: DataStore;
    public readonly bridge: Bridge;
    public readonly mjolnirManager: MjolnirManager = new MjolnirManager();

    public constructor(config: IConfig) {
        this.dataStore = new PgDataStore(config.db.connectionString);
        new Api(config.homeserver.url, this).start(config.webAPI.port);
        this.bridge = new Bridge({
            homeserverUrl: config.homeserver.url,
            domain: config.homeserver.domain,
            registration: "mjolnir-registration.yaml",
            controller: {
                onUserQuery: this.onUserQuery.bind(this),
                onEvent: this.onEvent.bind(this),
            },
            suppressEcho: false,
        });
    }

    // FIXME: this needs moving the MjolnirManager.
    public async init(): Promise<void> {
        await this.dataStore.init();
        for (var mjolnirRecord of await this.dataStore.list()) {
            const [_mjolnirUserId, mjolnirClient] = await this.makeMatrixClient(mjolnirRecord.local_part);
            await this.mjolnirManager.makeInstance(
                mjolnirRecord.owner,
                mjolnirRecord.management_room,
                mjolnirClient,
            );
        }
    }

    public async makeMatrixClient(localPart: string): Promise<[string, MatrixClient]> {
            // Now we need to make one of the transparent mjolnirs and add it to the monitor.
            const mjIntent = await this.bridge.getIntentFromLocalpart(localPart);
            await mjIntent.ensureRegistered();
            // we're only doing this because it's complaining about missing profiles.
            // actually the user id wasn't even right, so this might not be necessary anymore.
            await mjIntent.ensureProfile('Mjolnir');
            return [mjIntent.userId, mjIntent.matrixClient];
    }

    public async provisionNewMjolnir(requestingUserId: string): Promise<[string, string]> {
        // FIXME: we need to restrict who can do it (special list? ban remote users?)
        const provisionedMjolnirs = await this.dataStore.lookupByOwner(requestingUserId);
        if (provisionedMjolnirs.length === 0) {
            const mjolnirLocalPart = `mjolnir_${randomUUID()}`;
            const [mjolnirUserId, mjolnirClient] = await this.makeMatrixClient(mjolnirLocalPart);

            const managementRoomId = await mjolnirClient.createRoom({
                preset: 'private_chat',
                invite: [requestingUserId],
                name: `${requestingUserId}'s mjolnir`
            });

            const mjolnir = await this.mjolnirManager.makeInstance(requestingUserId, managementRoomId, mjolnirClient);
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

    public onUserQuery (queriedUser: MatrixUser) {
        return {}; // auto-provision users with no additonal data
    }

    // is it ok for this to be async? seems a bit dodge.
    // it should be BridgeRequestEvent not whatever this is
    public async onEvent(request: Request<WeakEvent>, context: BridgeContext) {
        // https://github.com/matrix-org/matrix-appservice-irc/blob/develop/src/bridge/MatrixHandler.ts#L921
        // ^ that's how matrix-appservice-irc maps from room to channel, we basically need to do the same but map
        // from room to which mjolnir it's for, unless that information is present in BridgeContext, which it might be...
        const mxEvent = request.getData();
        if ('m.room.member' === mxEvent.type) {
            if ('invite' === mxEvent.content['membership'] && mxEvent.state_key === this.bridge.botUserId) {
                await this.provisionNewMjolnir(mxEvent.sender);
            }
        }
        this.mjolnirManager.onEvent(request, context);
    }

    public static generateRegistration(reg: AppServiceRegistration, callback: (finalRegisration: AppServiceRegistration) => void) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("mjolnir");
        reg.addRegexPattern("users", "@mjolnir_.*", true);
        reg.setRateLimited(false);
        callback(reg);
    }

    public static async run(port: number, config: IConfig) {
        const service = new MjolnirAppService(config);
        await service.bridge.initalise();
        await service.init();
        console.log("Matrix-side listening on port %s", port);
        await service.bridge.listen(port);
    }
}
