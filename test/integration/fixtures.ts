import { Mjolnir } from "../../src/Mjolnir";
import { makeMjolnir } from "./mjolnirSetupUtils";

export async function mochaGlobalSetup() {
    console.log("Starting mjolnir.");
    try {
        this.bot = await makeMjolnir()
        // do not block on this!
        this.bot.start();
    } catch (e) {
        console.trace(e);
        throw e;
    }
}

export async function mochaGlobalTeardown() {
    this.bot.stop();
    console.log('stopping mjolnir');
  }