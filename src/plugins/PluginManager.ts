/*
Copyright 2024 The Matrix.org Foundation C.I.C.

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

import { Mjolnir } from "../Mjolnir";
import { Protection } from "../protections/IProtection";
import { HMAPlugin } from "./HMAPlugin/HMAPlugin";

let PLUGINS: Protection[] = [];

export class PluginManager {
    private plugins: Protection[] = [];

    constructor(private mjolnir: Mjolnir) {
        PLUGINS = [
            new HMAPlugin(),
        ];
    }

    public async start() {
        for (const plugin of PLUGINS) {
            this.plugins.push(plugin);
        }
    }

    public async handleEvent(roomId: string, event: any): Promise<boolean> {
        for (const plugin of this.plugins) {
            if (await plugin.handleEvent(this.mjolnir, roomId, event)) {
                return true;
            }
        }
        return false;
    }
} 