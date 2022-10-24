/*
Copyright 2022 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { AppServiceRegistration, Bridge, Request, WeakEvent, BridgeContext, MatrixUser } from "matrix-appservice-bridge";
import { MjolnirManager } from ".//MjolnirManager";
import { DataStore, PgDataStore } from ".//datastore";
import { Api } from "./Api";
import { IConfig } from "./config/config";
import { AccessControl } from "./AccessControl";

export class MjolnirAppService {

    private readonly api: Api;

    private constructor(
        public readonly config: IConfig,
        public readonly bridge: Bridge,
        private readonly mjolnirManager: MjolnirManager,
        private readonly accessControl: AccessControl,
        private readonly dataStore: DataStore,
    ) {
        this.api = new Api(config.homeserver.url, mjolnirManager);
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
        await bridge.initalise();
        const accessControlListId = await bridge.getBot().getClient().resolveRoom(config.accessControlList);
        const accessControl = await AccessControl.setupAccessControl(accessControlListId, bridge);
        const mjolnirManager = await MjolnirManager.makeMjolnirManager(dataStore, bridge, accessControl);
        const appService = new MjolnirAppService(
            config,
            bridge,
            mjolnirManager,
            accessControl,
            dataStore
        );
        bridge.opts.controller = {
            onUserQuery: appService.onUserQuery.bind(appService),
            onEvent: appService.onEvent.bind(appService),
        };
        return appService;
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
                await this.mjolnirManager.provisionNewMjolnir(mxEvent.sender);
            }
        }
        this.accessControl.handleEvent(mxEvent['room_id'], mxEvent);
        this.mjolnirManager.onEvent(request, context);
    }

    public async start(port: number) {
        console.log("Matrix-side listening on port %s", port);
        this.api.start(this.config.webAPI.port);
        await this.bridge.listen(port);
    }

    public async close(): Promise<void> {
        await this.bridge.close();
        await this.dataStore.close();
    }

    public static generateRegistration(reg: AppServiceRegistration, callback: (finalRegisration: AppServiceRegistration) => void) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("mjolnir-bot");
        reg.addRegexPattern("users", "@mjolnir_.*", true);
        reg.setRateLimited(false);
        callback(reg);
    }

    public static async run(port: number, config: IConfig) {
        const dataStore = new PgDataStore(config.db.connectionString);
        await dataStore.init();
        const service = await MjolnirAppService.makeMjolnirAppService(config, dataStore);
        // Can't stress how important it is that listen happens last.
        await service.start(port);
    }
}
