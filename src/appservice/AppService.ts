
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
import { AppServiceRegistration, Bridge, Cli, Request, WeakEvent, BridgeContext, MatrixUser, UserBridgeStore, RemoteUser } from "matrix-appservice-bridge";
// needed by appservice irc, though it looks completely dead.
import * as Datastore from "nedb";
import { MjolnirManager } from ".//MjolnirManager";
import { Api } from "./Api";
// ts-node src/appservice/AppService.ts -r -u "http://localhost:9000" # remember to add the registration to homeserver.yaml! you probably want host.docker.internal as the hostname of the appservice if using mx-tester
// ts-node src/appservice/AppService -p 9000 # to start.

export class MjolnirAppService {

    public readonly bridge: Bridge;
    public readonly mjolnirManager: MjolnirManager = new MjolnirManager();

    public constructor() {
        new Api("http://localhost:8081", this).start(9001);
        this.bridge = new Bridge({
            homeserverUrl: "http://localhost:8081",
            domain: "localhost:9999",
            registration: "mjolnir-registration.yaml",
            controller: {
                onUserQuery: this.onUserQuery.bind(this),
                onEvent: this.onEvent.bind(this),
            },
            userStore: new UserBridgeStore(new Datastore()),
        });
    }

    public async provisionNewMjolnir(requestingUserId: string): Promise<[string, string]> {
        // FIXME: we need to restrict who can do it (special list? ban remote users?)
        const issuedMjolnirs = await this.bridge.getUserStore()!.getRemoteUsersFromMatrixId(requestingUserId);
        if (issuedMjolnirs.length === 0) {
            // Now we need to make one of the transparent mjolnirs and add it to the monitor.
            const mjIntent = await this.bridge.getIntentFromLocalpart(`mjolnir_${randomUUID()}`);
            await mjIntent.ensureRegistered();
            // we're only doing this because it's complaining about missing profiles.
            // actually the user id wasn't even right, so this might not be necessary anymore.
            await mjIntent.ensureProfile('Mjolnir');

            const managementRoomId = (await mjIntent.createRoom({
                createAsClient: true,
                options: {
                    preset: 'private_chat',
                    invite: [requestingUserId],
                    name: `${requestingUserId}'s mjolnir`
                }
            })).room_id;

            await this.mjolnirManager.createNew(requestingUserId, managementRoomId, mjIntent.matrixClient);
            // Technically the mjolnir is a remote user, but also not because it's matrix-matrix.
            //const mjAsRemote = new RemoteUser(mjIntent.userId)
            //const bridgeStore = this.bridge.getUserStore()!;
            //bridgeStore.setRemoteUser()
            await this.bridge.getUserStore()!.linkUsers(new MatrixUser(requestingUserId), new RemoteUser(mjIntent.userId));
            return [mjIntent.userId, managementRoomId];
        } else {
            throw new Error(`User: ${requestingUserId} has already provisioned ${issuedMjolnirs.length} mjolnirs.`);
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
}

new Cli({
    registrationPath: "mjolnir-registration.yaml",
    generateRegistration: function(reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("mjolnir");
        reg.addRegexPattern("users", "@mjolnir_.*", true);
        reg.setRateLimited(false);
        callback(reg);
    },
    run: function(port: number) {
        const service = new MjolnirAppService();
        console.log("Matrix-side listening on port %s", port);
        service.bridge.run(port);
    }
}).run();