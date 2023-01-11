import { Cli } from "matrix-appservice-bridge";
import { MjolnirAppService } from "./AppService";
import { IConfig as IAppserviceConfig, addDefaults } from "./config/config";
import * as utils from "../utils";

/**
 * This file provides the entrypoint for the appservice mode for mjolnir.
 * A registration file can be generated `ts-node src/appservice/cli.ts -r -u "http://host.docker.internal:9000"`
 * and the appservice can be started with `ts-node src/appservice/cli -p 9000 -c your-confg.yaml`.
 */
const cli = new Cli({
    registrationPath: "mjolnir-registration.yaml",
    bridgeConfig: {
        schema: {},
        affectsRegistration: false,
        defaults: {}
    },
    generateRegistration: MjolnirAppService.generateRegistration,
    run: async function(port: number) {
        const config: IAppserviceConfig | null = cli.getConfig() as any;
        if (config === null) {
            throw new Error("Couldn't load config");
        }
        addDefaults(config);
        utils.initializeSentry(config);
        utils.initializeGlobalPerformanceMetrics(config);
        await MjolnirAppService.run(port, config, cli.getRegistrationFilePath());
    }
});

cli.run();
