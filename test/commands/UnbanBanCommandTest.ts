/*
Copyright 2019 The Matrix.org Foundation C.I.C.

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

import expect from "expect";
import { Mjolnir } from "../../src/Mjolnir";
import { DEFAULT_LIST_EVENT_TYPE } from "../../src/commands/SetDefaultBanListCommand";
import { parseArguments } from "../../src/commands/UnbanBanCommand";
import { read as configRead } from "../../src/config";
import { RULE_ROOM, RULE_SERVER, RULE_USER } from "../../src/models/ListRule";

function createTestMjolnir(defaultShortcode: string|null = null): Mjolnir {
    const config = configRead();
    const client = {
        // Mock `MatrixClient.getAccountData` .
        getAccountData: (eventType: string): Promise<any> => {
            if (eventType === DEFAULT_LIST_EVENT_TYPE || defaultShortcode) {
                return Promise.resolve({shortcode: defaultShortcode});
            }
            throw new Error(`Unknown event type ${eventType}, expected ${DEFAULT_LIST_EVENT_TYPE}`);
        },
    };
    return <Mjolnir>{
        client,
        config,
        policyListManager: {}
    };
}

function createFakeEvent(command: string): any {
    return {
        sender: "@alice:example.org",
        event_id: "$example",
        content: {
            body: command,
            msgtype: "m.text",
        },
    };
}

describe("UnbanBanCommand", () => {
    describe("parseArguments", () => {
        it("should be able to detect servers", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test example.org";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_SERVER);
            expect(bits!.entity).toBe("example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect servers with ban reasons", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test example.org reason here";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBe("reason here");
            expect(bits!.ruleType).toBe(RULE_SERVER);
            expect(bits!.entity).toBe("example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect servers with globs", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test *.example.org --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_SERVER);
            expect(bits!.entity).toBe("*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect servers with the type specified", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test server @*.example.org --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_SERVER);
            expect(bits!.entity).toBe("@*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect room IDs", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test !example.org";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_ROOM);
            expect(bits!.entity).toBe("!example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect room IDs with ban reasons", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test !example.org reason here";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBe("reason here");
            expect(bits!.ruleType).toBe(RULE_ROOM);
            expect(bits!.entity).toBe("!example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect room IDs with globs", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test !*.example.org --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_ROOM);
            expect(bits!.entity).toBe("!*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect room aliases", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test #example.org";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_ROOM);
            expect(bits!.entity).toBe("#example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect room aliases with ban reasons", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test #example.org reason here";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBe("reason here");
            expect(bits!.ruleType).toBe(RULE_ROOM);
            expect(bits!.entity).toBe("#example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect room aliases with globs", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test #*.example.org --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_ROOM);
            expect(bits!.entity).toBe("#*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect rooms with the type specified", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test room @*.example.org --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_ROOM);
            expect(bits!.entity).toBe("@*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect user IDs", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test @example.org";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_USER);
            expect(bits!.entity).toBe("@example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect user IDs with ban reasons", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test @example.org reason here";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBe("reason here");
            expect(bits!.ruleType).toBe(RULE_USER);
            expect(bits!.entity).toBe("@example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect user IDs with globs", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test @*.example.org --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_USER);
            expect(bits!.entity).toBe("@*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should be able to detect user IDs with the type specified", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test user #*.example.org --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBeFalsy();
            expect(bits!.ruleType).toBe(RULE_USER);
            expect(bits!.entity).toBe("#*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        it("should error if wildcards used without --force", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                expect(content).toBeDefined();
                expect(content['body']).toContain("Wildcard bans require an additional `--force` argument to confirm");
                return Promise.resolve("$fake");
            };

            const command = "!mjolnir ban test *.example.org";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeFalsy();
        });

        it("should have correct ban reason with --force after", async () => {
            const mjolnir = createTestMjolnir();
            (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
            mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
            };

            const command = "!mjolnir ban test user #*.example.org reason here --force";
            const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
            expect(bits).toBeTruthy();
            expect(bits!.reason).toBe("reason here");
            expect(bits!.ruleType).toBe(RULE_USER);
            expect(bits!.entity).toBe("#*.example.org");
            expect(bits!.list).toBeDefined();
            expect(bits!.list!.listShortcode).toBe("test");
        });

        describe("[without default list]", () => {
            it("should error if no list (with type) is specified", async () => {
                const mjolnir = createTestMjolnir();
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    expect(content).toBeDefined();
                    expect(content['body']).toContain("No ban list matching that shortcode was found");
                    return Promise.resolve("$fake");
                };

                const command = "!mjolnir ban user @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeFalsy();
            });

            it("should error if no list (without type) is specified", async () => {
                const mjolnir = createTestMjolnir();
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    expect(content).toBeDefined();
                    expect(content['body']).toContain("No ban list matching that shortcode was found");
                    return Promise.resolve("$fake");
                };

                const command = "!mjolnir ban @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeFalsy();
            });

            it("should not error if a list (with type) is specified", async () => {
                const mjolnir = createTestMjolnir();
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban user test @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("test");
            });

            it("should not error if a list (without type) is specified", async () => {
                const mjolnir = createTestMjolnir();
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban test @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("test");
            });

            it("should not error if a list (with type reversed) is specified", async () => {
                const mjolnir = createTestMjolnir();
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban test user @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("test");
            });
        });

        describe("[with default list]", () => {
            it("should use the default list if no list (with type) is specified", async () => {
                const mjolnir = createTestMjolnir("test");
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}, {listShortcode: "other"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban user @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("test");
            });

            it("should use the default list if no list (without type) is specified", async () => {
                const mjolnir = createTestMjolnir("test");
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}, {listShortcode: "other"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("test");
            });

            it("should use the specified list if a list (with type) is specified", async () => {
                const mjolnir = createTestMjolnir("test");
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}, {listShortcode: "other"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban user other @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("other");
            });

            it("should use the specified list if a list (without type) is specified", async () => {
                const mjolnir = createTestMjolnir("test");
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}, {listShortcode: "other"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban other @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("other");
            });

            it("should not error if a list (with type reversed) is specified", async () => {
                const mjolnir = createTestMjolnir("test");
                (<any>mjolnir).policyListManager.lists = [{listShortcode: "test"}, {listShortcode: "other"}];
                mjolnir.client.sendMessage = (roomId: string, content: any): Promise<string> => {
                    throw new Error("sendMessage should not have been called: " + JSON.stringify(content));
                };

                const command = "!mjolnir ban other user @example:example.org";
                const bits = await parseArguments("!a", createFakeEvent(command), mjolnir, command.split(' '));
                expect(bits).toBeTruthy();
                expect(bits!.reason).toBeFalsy();
                expect(bits!.ruleType).toBe(RULE_USER);
                expect(bits!.entity).toBe("@example:example.org");
                expect(bits!.list).toBeDefined();
                expect(bits!.list!.listShortcode).toBe("other");
            });
        });
    });
});
