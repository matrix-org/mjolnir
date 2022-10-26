import { Cli } from "matrix-appservice-bridge";
import { MjolnirAppService } from "./AppService";
import { IConfig } from "./config/config";

// ts-node src/appservice/AppService.ts -r -u "http://host.docker.internal:9000"
// ts-node src/appservice/AppService -p 9000 -c your-confg.yaml # to start
const cli = new Cli({
    registrationPath: "mjolnir-registration.yaml",
    bridgeConfig: {
        schema: {},
        affectsRegistration: false,
        defaults: {}
    },
    generateRegistration: MjolnirAppService.generateRegistration,
    run: async function(port: number) {
        const config: IConfig | null = cli.getConfig() as any;
        if (config === null) {
            throw new Error("Couldn't load config");
        }
        await MjolnirAppService.run(port, config, cli.getRegistrationFilePath());
    }
});

cli.run();
