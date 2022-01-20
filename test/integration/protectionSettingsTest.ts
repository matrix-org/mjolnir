import { strict as assert } from "assert";

import config from "../../src/config";
import { PROTECTIONS } from "../../src/protections/protections";
import { ProtectionSettingValidationError } from "../../src/protections/ProtectionSettings";
import { NumberProtectionSetting } from "../../src/protections/ProtectionSettings";
import { newTestUser } from "./clientHelper";
import { matrixClient, mjolnir } from "./mjolnirSetupUtils";

describe("Test: Protection settings", function() {
    it("Mjolnir refuses to save invalid protection setting values", async function() {
        this.timeout(20000);
        await assert.rejects(
            async () => await this.mjolnir.setProtectionSettings("BasicFloodingProtection", {"maxPerMinute": "soup"}),
            ProtectionSettingValidationError
        );
    });
    it("Mjolnir successfully saves valid protection setting values", async function() {
        this.timeout(20000);

        PROTECTIONS["test1"] = {
            description: "A test protection",
            factory: () => new class implements IProtection {
                name = "test1";
                async handleEvent(mjolnir: Mjolnir, roomId: string, event: any) {};
                settings = { test: new NumberProtectionSetting(3) };
            }
        };

        await this.mjolnir.setProtectionSettings("test1", { test: 123 });
        assert.equal(
            (await this.mjolnir.getProtectionSettings("test1"))["test"],
            123
        );
    });
    it("Mjolnir should accumulate changed settings", async function() {
        this.timeout(20000);

        PROTECTIONS["test2"] = {
            description: "A test protection",
            factory: () => new class implements IProtection {
                name = "test2";
                async handleEvent(mjolnir: Mjolnir, roomId: string, event: any) {};
                settings = {
                    test1: new NumberProtectionSetting(3),
                    test2: new NumberProtectionSetting(4)
                };
            }
        };

        await this.mjolnir.setProtectionSettings("test2", { test1: 1 });
        await this.mjolnir.setProtectionSettings("test2", { test2: 2 });
        const settings = await this.mjolnir.getProtectionSettings("test2");
        //assert.equal(settings["test1"], 1);
        assert.equal(settings["test2"], 2);
    });
});

