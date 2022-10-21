
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
import { AccessControl } from "./AccessControl";
import { Access } from "../models/AccessControlUnit";

export class MjolnirAppService {

    private constructor(
        public readonly config: IConfig,
        private readonly bridge: Bridge,
        private readonly dataStore: DataStore,
        private readonly mjolnirManager: MjolnirManager,
        private readonly accessControl: AccessControl,
    ) {
        new Api(config.homeserver.url, this).start(config.webAPI.port);
    }

    public static async makeMjolnirAppService(config: IConfig, dataStore: DataStore) {
        const bridge = new Bridge({
            homeserverUrl: config.homeserver.url,
            domain: config.homeserver.domain,
            registration: "mjolnir-registration.yaml",
            // We lazily initialize the controller to avoid null checks
            // It also allows us to combine constructor/initialize logic
            // to make the code base much simpler. A small hack to pay for an overall less hacky code base.
            controller: {
                onUserQuery: () => {throw new Error("Mjolnir uninitialized")},
                onEvent: () => {throw new Error("Mjolnir uninitialized")},
            },
            suppressEcho: false,
        });
        const mjolnirManager = new MjolnirManager();
        const accessControlListId = await bridge.getBot().getClient().resolveRoom(config.accessControlList);
        const appService = new MjolnirAppService(
            config,
            bridge,
            dataStore,
            mjolnirManager,
            await AccessControl.setupAccessControl(accessControlListId, bridge)
        );
        bridge.opts.controller = {
            onUserQuery: appService.onUserQuery.bind(appService),
            onEvent: appService.onEvent.bind(appService),
        };
        return appService;
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
        // How do we get that information in bridge context?
        // Alternatively we have to either use their advanced user member caching or track this ourselves somehow ffs.
        // Alternatively just don't care about it right now, let it push events through to them all and get
        // consultation from bridge people (Halfy).
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
        const dataStore = new PgDataStore(config.db.connectionString);
        const service = await MjolnirAppService.makeMjolnirAppService(config, dataStore);
        await service.bridge.initalise();
        await service.init();
        // Can't stress how important it is that listen happens last.
        console.log("Matrix-side listening on port %s", port);
        await service.bridge.listen(port);
    }
}
