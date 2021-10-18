/**
 * This file is used to launch mjolnir for manual testing, creating a user and management room automatically if it doesn't already exist.
 */

import { makeMjolnir } from "./mjolnirSetupUtils";

(async () => {
    let mjolnir = await makeMjolnir();
    await mjolnir.start();
})();
