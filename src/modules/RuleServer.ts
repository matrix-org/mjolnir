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

import { LogLevel, MatrixClient } from "matrix-bot-sdk";
import BanList, { ALL_RULE_TYPES } from "../models/BanList";
import { logMessage } from "../LogProxy";
import { Healthz } from "../health/healthz";
import config, { IRuleServerBlocks } from "../config";
import { ListRule } from "../models/ListRule";
import * as http from "http";

interface IRule {
    search: string; // python
    pattern: string;
}

interface IPyRules {
    checks: {
        spam: IRule[];
        invites: IRule[];
        profiles: IRule[];
        createRoom: IRule[];
        createAlias: IRule[];
        publishRoom: IRule[];
    };
}

export class RuleServer {
    private pyRules: IPyRules;

    constructor(private client: MatrixClient, private banLists: BanList[]) {
        client.on("room.event", this.handleEvent.bind(this));
    }

    public async start() {
        for (const list of this.banLists) {
            await list.updateList();
        }
        await this.rebuildRules();

        await this.client.start();
        Healthz.isHealthy = true;

        http.createServer((req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.writeHead(200);
            res.end(JSON.stringify({healthy: Healthz.isHealthy, ...this.pyRules}));
        }).listen(config.ruleServer.port, config.ruleServer.address, async () => {
            await logMessage(LogLevel.INFO, "RuleServer", "Rule server is running");
        });
    }

    private async handleEvent(roomId: string, event: any) {
        const banList = this.banLists.find(b => b.roomId === roomId);
        if (!banList) return; // not useful to us
        if (!ALL_RULE_TYPES.includes(event['type'])) return; // not useful to us
        await banList.updateList();
        await this.rebuildRules();
    }

    private async rebuildRules() {
        const userRules = this.banLists.map(b => b.userRules).reduce((a, c) => {a.push(...c); return a;}, []);
        const roomRules = this.banLists.map(b => b.roomRules).reduce((a, c) => {a.push(...c); return a;}, []);
        const serverRules = this.banLists.map(b => b.serverRules).reduce((a, c) => {a.push(...c); return a;}, []);

        console.log({userRules, roomRules, serverRules});

        this.pyRules = {
            checks: {
                spam: pythonForRulesCond('messages', {
                    users: {rules: userRules, python: "event.get('sender', '')"},
                    rooms: {rules: roomRules, python: "event.get('room_id', '')"},
                    servers: {rules: serverRules, python: "UserID.from_string(event.get('sender', '')).domain"},
                }),
                invites: pythonForRulesCond('invites', {
                    users: {rules: userRules, python: "inviter_user_id"},
                    rooms: {rules: roomRules, python: "room_id"},
                    servers: {rules: serverRules, python: "UserID.from_string(inviter_user_id).domain"},
                }),
                profiles: [
                    ...pythonForRulesCond('usernames', {
                        users: {rules: userRules, python: 'user_profile["user_id"]'},
                        rooms: null, // not possible
                        servers: {rules: serverRules, python: 'UserID.from_string(user_profile["user_id"]).domain'},
                    }),
                    ...pythonForRulesCond('usernames', {
                        // run a second check on the user's display name
                        users: {rules: userRules, python: 'user_profile["display_name"]'},
                        rooms: null,
                        servers: null,
                    }),
                ],
                createRoom: pythonForRulesCond('roomCreate', {
                    users: {rules: userRules, python: "user_id"},
                    rooms: null,
                    servers: {rules: serverRules, python: "UserID.from_string(user_id).domain"},
                }),
                createAlias: pythonForRulesCond('makeAlias', {
                    users: {rules: userRules, python: "user_id"},
                    rooms: {rules: roomRules, python: "room_alias"},
                    servers: {rules: serverRules, python: "UserID.from_string(user_id).domain"},
                }),
                publishRoom: pythonForRulesCond('publishRoom', {
                    users: {rules: userRules, python: "user_id"},
                    rooms: {rules: roomRules, python: "room_id"},
                    servers: {rules: serverRules, python: "UserID.from_string(user_id).domain"},
                }),
            },
        };

        await logMessage(LogLevel.INFO, "RuleServer", "Python rule set updated");
    }
}

// ==== mini python lib below ====

interface IPythonRuleEntity {
    rules: ListRule[];
    python: string;
}

interface IPythonRule {
    users: IPythonRuleEntity;
    rooms: IPythonRuleEntity;
    servers: IPythonRuleEntity;
}

function pythonForRulesCond(blockName: keyof IRuleServerBlocks, conf: IPythonRule): IRule[] {
    const generated: IRule[] = [];

    if (config.ruleServer.blocks[blockName].users && conf.users) {
        for (const rule of conf.users.rules) {
            generated.push({pattern: rule.glob.regex.source, search: conf.users.python});
        }
    }

    if (config.ruleServer.blocks[blockName].rooms && conf.rooms) {
        for (const rule of conf.rooms.rules) {
            generated.push({pattern: rule.glob.regex.source, search: conf.rooms.python});
        }
    }

    if (config.ruleServer.blocks[blockName].servers && conf.servers) {
        for (const rule of conf.servers.rules) {
            generated.push({pattern: rule.glob.regex.source, search: conf.servers.python});
        }
    }

    return generated;
}
