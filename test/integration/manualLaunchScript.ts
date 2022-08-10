/**
 * This file is used to launch mjolnir for manual testing, creating a user and management room automatically if it doesn't already exist.
 */

import { makeMjolnir } from "./mjolnirSetupUtils";
import { read as config_read } from '../../src/config';

(async () => {
    const config = config_read();
    let mjolnir = await makeMjolnir(config);
    await mjolnir.start();
})();
