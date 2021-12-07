import { strict as assert } from "assert";

import config from "../../src/config";
import { PROTECTIONS } from "../../src/protections/protections";
import { ProtectionSettingValidationError } from "../../src/protections/ProtectionSettings";
import { NumberProtectionSetting } from "../../src/protections/ProtectionSettings";
import { newTestUser } from "./clientHelper";
import { matrixClient, mjolnir } from "./mjolnirSetupUtils";

describe("Test: Protection settings", function() {
    it('Mjolnir refuses to save invalid protection setting values', function() {
        this.timeout(20000);
        assert.throws(
            async () => await mjolnir().setProtectionSettings('BasicFloodingProtection', {'maxPerMinute': 'soup'}),
            ProtectionSettingValidationError
        );
    });
    it('Mjolnir successfully saves valid protection setting values', async function() {
        this.timeout(20000);
        await mjolnir().setProtectionSettings('BasicFloodingProtection', {'maxPerMinute': 123});
        assert.equal(
            await mjolnir().getProtectionSettings('BasicFloodProtection')['maxPerMinute'],
            123
        )
    });
    it('Mjolnir should accumulate changed settings', async function() {
        this.timeout(20000);
        PROTECTIONS['test'] = {
            description: "A test protection",
            factory: () => new class implements IProtection {
                name = "test";
                async handleEvent(mjolnir: Mjolnir, roomId: string, event: any) {};
                settings = {
                    "test1": StringProtectionSetting(),
                    "test2": StringProtectionSetting()
                }
            }
        }

        await mjolnir().setProtectionSettings('test', {'test1': "asd1"});
        await mjolnir().setProtectionSettings('test', {'test2': "asd2"});
        assert.equal(
            await mjolnir().getProtectionSettings('BasicFloodProtection'),
            {"test1": "asd1", "test2": "asd2"}
        );
    });
    it('Mjolnir validates number settings correctly', function() {
        this.timeout(20000);
        const numberSetting = new NumberProtectionSetting(123, 1, 999);

        assert.equal(numberSetting.parse('321'), 321);
        assert.equal(numberSetting.parse('1.2'), 1.2);
        assert.equal(numberSetting.parse('a'), undefined);

        assert.equal(number.Setting.validate(123), true);
        assert.equal(number.Setting.validate(1234), false);
    });
});

