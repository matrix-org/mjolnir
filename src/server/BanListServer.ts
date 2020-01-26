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

import {Mjolnir} from "../Mjolnir";
import * as net from "net";
import {Socket} from "net";
import config from "../config";
import {LogService} from "matrix-bot-sdk";
import {Connection} from "./Connection";

export class BanListServer {

    private connections: Connection[] = [];

    constructor(private mjolnir: Mjolnir) {
    }

    public async start() {
        LogService.info("BanListServer", `Starting server on ${config.banListServer.bind}:${config.banListServer.port}`);
        const server = net.createServer(this.onConnect.bind(this));
        server.listen(config.banListServer.port, config.banListServer.bind);
    }

    private onDisconnect(connection: Connection): void {
        const index = this.connections.indexOf(connection);
        if (index >= 0) this.connections.splice(index, 1);
    }

    private onConnect(socket: Socket) {
        LogService.info("BanListServer", `New client connection from ${socket.address().toString()}`);
        this.connections.push(new Connection(socket, this.mjolnir, this.onDisconnect.bind(this)));
    }
}