import { Mjolnir } from "../../Mjolnir";
import { Protection } from "../../protections/IProtection";
import { AbstractProtectionSetting } from "../../protections/ProtectionSettings";
import { Consequence, ConsequenceRedact } from "../../protections/consequence";
import { MatrixClient } from "../../../node_modules/@vector-im/matrix-bot-sdk/lib";
import axios from "axios";
import * as crypto from "crypto";

export class HMAPlugin extends Protection {
    public readonly name = "HMAPlugin";
    public readonly description = "Hashes media and sends it to an external service for analysis.";
    public readonly settings: { [setting: string]: AbstractProtectionSetting<any, any>; } = {};

    public async handleEvent(mjolnir: Mjolnir, roomId: string, event: any): Promise<any> {
        if (event.type === "m.room.message" && event.content.msgtype === "m.image") {
            const mxcUrl = event.content.url;
            const mediaUrl = new URL(mxcUrl, mjolnir.client.homeserverUrl).toString();
            const response = await axios.get(mediaUrl, { responseType: "arraybuffer" });
            const hash = crypto.createHash("sha256").update(response.data).digest("hex");

            const hmaUrl = mjolnir.config.hma.url;
            if (hmaUrl) {
                try {
                    const hmaResponse = await axios.post(hmaUrl, { hash });
                    if (hmaResponse.data.action === "block") {
                        return new ConsequenceRedact("Blocked by HMA service");
                    }
                } catch (e) {
                    console.error("Error sending hash to HMA service", e);
                }
            }
        }
    }
} 