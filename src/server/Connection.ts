/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import {Socket} from "net";
import {Mjolnir} from "../Mjolnir";
import {LogService} from "matrix-bot-sdk";
import BanList from "../models/BanList";

const COMMAND_PREFIX = "|C,";
const COMMAND_SUFFIX = ",C|";
const SUBSCRIBE_PREFIX = `${COMMAND_PREFIX}SUBSCRIBE,`;
const RESET_PREFIX = `${COMMAND_PREFIX}RESET,`;
const RULE_PREFIX = `${COMMAND_PREFIX}RULE,`;

export class Connection {

    private currentCommand = "";
    private subscribedRooms: string[] = [];

    constructor(private socket: Socket, private mjolnir: Mjolnir, private disconnectFn: (Socket) => void) {
        socket.on("data", this.onData.bind(this));
        socket.on("close", this.onClose.bind(this));
    }

    private onListUpdate(list: BanList) {
        if (!this.subscribedRooms.includes(list.roomId)) {
            return; // Ignore list update
        }

        this.socket.write(`${RESET_PREFIX}${list.roomId}${COMMAND_SUFFIX}`);
        for (const rule of list.allRules) {
            this.socket.write(`${RULE_PREFIX}${rule.kind},${rule.entity}${COMMAND_SUFFIX}`);
        }
    }

    private onClose() {
        this.disconnectFn(this);
    }

    private onData(b: Buffer) {
        this.currentCommand += b.toString("ascii");

        // Try and parse the command
        const commandStart = this.currentCommand.indexOf(COMMAND_PREFIX);
        if (commandStart < 0) return; // No command yet

        let command = this.currentCommand.slice(commandStart);
        let idx = command.indexOf(COMMAND_SUFFIX);
        if (idx < 0) return; // incomplete command
        command = command.substring(0, idx);
        this.currentCommand = this.currentCommand.substring(commandStart + command.length);

        LogService.info("Running " + command);
        if (command.startsWith(SUBSCRIBE_PREFIX)) {
            const roomId = command.substring(SUBSCRIBE_PREFIX.length, (command.length - COMMAND_SUFFIX.length - 1) + SUBSCRIBE_PREFIX.length);
            const banList = this.mjolnir.lists.find(i => i.roomId === roomId);
            if (!banList) {
                LogService.warn("Connection", `Connection tried to subscribe to unknown ban list ${roomId}`);
            } else {
                this.subscribedRooms.push(roomId);
                this.onListUpdate(banList);
            }
        } // else unknown command
    }
}