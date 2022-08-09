/**
 * This file is used to launch mjolnir for manual testing, creating a user and management room automatically if it doesn't already exist.
 */

import { makeMjolnir } from "./mjolnirSetupUtils";
import config from '../../src/config';

(async () => {
    let mjolnir = await makeMjolnir(config);
    await mjolnir.start();
})();
