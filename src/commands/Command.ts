/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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

import { Mjolnir } from '../Mjolnir';
import Tokenizr from "tokenizr";

// For some reason, different versions of TypeScript seem
// to disagree on how to import Tokenizr
import * as TokenizrModule from "tokenizr";
import { htmlEscape, parseDuration } from "../utils";
import { LogService, RichReply } from 'matrix-bot-sdk';
const TokenizrClass = Tokenizr || TokenizrModule;

const WHITESPACE = /\s+/;
const COMMAND = /[a-zA-Z_]+/;
const USER_ID = /@[a-zA-Z0-9_.=\-/]+:\S+/;
const GLOB_USER_ID = /@[a-zA-Z0-9_.=\-?*/]+:\S+/;
const ROOM_ID = /![a-zA-Z0-9_.=\-/]+:\S+/;
const ROOM_ALIAS = /#[a-zA-Z0-9_.=\-/]+:\S+/;
const ROOM_ALIAS_OR_ID = /[#!][a-zA-Z0-9_.=\-/]+:\S+/;
const INT = /[+-]?[0-9]+/;
const STRING = /"((?:\\"|[^\r\n])*)"/;
const DATE_OR_DURATION = /(?:"([^"]+)")|([^"]\S+)/;
const STAR = /\*/;
const ETC = /.*$/;
const WORD = /\S+/;
const PERMALINK = /https:\/\/matrix.to\*\S+]/;

export enum Token {
    WHITESPACE = "whitespace",
    COMMAND = "command",
    USER_ID = "userID",
    GLOB_USER_ID = "globUserID",
    ROOM_ID = "roomID",
    ROOM_ALIAS = "roomAlias",
    ROOM_ALIAS_OR_ID = "roomAliasOrID",
    INT = "int",
    STRING = "string",
    DATE_OR_DURATION = "dateOrDuration",
    STAR = "star",
    ETC = "etc",
    WORD = "word",
    PERMALINK = "permalink",
    DATE = "date",
    DURATION = "duration",
}

/**
 * A lexer for command parsing.
 *
 * Recommended use is `lexer.token("state")`.
 */
export class Lexer extends TokenizrClass {
    constructor(string: string) {
        super();
        // Ignore whitespace.
        this.rule(WHITESPACE, (ctx) => {
            ctx.ignore()
        })

        // Identifier rules, used e.g. for subcommands `get`, `set` ...
        this.rule(Token.COMMAND, COMMAND, (ctx) => {
            ctx.accept(Token.COMMAND);
        });

        // Users
        this.rule(Token.USER_ID, USER_ID, (ctx) => {
            ctx.accept(Token.USER_ID);
        });
        this.rule(Token.GLOB_USER_ID, GLOB_USER_ID, (ctx) => {
            ctx.accept(Token.GLOB_USER_ID);
        });

        // Rooms
        this.rule(Token.ROOM_ID, ROOM_ID, (ctx) => {
            ctx.accept(Token.ROOM_ID);
        });
        this.rule(Token.ROOM_ALIAS, ROOM_ALIAS, (ctx) => {
            ctx.accept(Token.ROOM_ALIAS);
        });
        this.rule(Token.ROOM_ALIAS_OR_ID, ROOM_ALIAS_OR_ID, (ctx) => {
            ctx.accept(Token.ROOM_ALIAS_OR_ID);
        });

        // Numbers.
        this.rule(Token.INT, INT, (ctx, match) => {
            ctx.accept(Token.INT, parseInt(match[0]))
        });

        // Quoted strings.
        this.rule(Token.STRING, STRING, (ctx, match) => {
            ctx.accept(Token.STRING, match[1].replace(/\\"/g, "\""))
        });

        // Dates and durations.
        this.rule(Token.DATE_OR_DURATION, DATE_OR_DURATION, (ctx, match) => {
            let content = match[1] || match[2];
            let date = new Date(content);
            if (!date || Number.isNaN(date.getDate())) {
                let duration = parseDuration(content);
                if (!duration || Number.isNaN(duration)) {
                    ctx.reject();
                } else {
                    ctx.accept(Token.DURATION, duration);
                }
            } else {
                ctx.accept(Token.DATE, date);
            }
        });

        this.rule(Token.PERMALINK, PERMALINK, (ctx) => {
            ctx.accept(Token.PERMALINK);
        });

        // Jokers.
        this.rule(Token.STAR, STAR, (ctx) => {
            ctx.accept(Token.STAR);
        });
        this.rule(Token.WORD, WORD, (ctx)=> {
            ctx.accept(Token.WORD);
        });

        // Everything left in the string.
        this.rule(Token.ETC, ETC, (ctx, match) => {
            ctx.accept(Token.ETC, match[0].trim());
        });

        this.input(string);
    }

    public token(state?: Token | string): TokenizrModule.Token {
        if (typeof state !== "undefined") {
            this.state(state);
        }
        return super.token();
    }
}

export interface Command {
    /**
     * The name for the command, e.g. "get".
     */
    readonly command: string;

    /**
     * A human-readable help for the command.
     */
    readonly helpDescription: string;

    /**
     * A human-readable description for the arguments.
     */
    readonly helpArgs: string;

    readonly accept?: (lexer: Lexer) => boolean;

    /**
     * Execute the command.
     *
     * @param mjolnir The owning instance of Mjolnir.
     * @param roomID The command room. Used mainly to display responses.
     * @param lexer The lexer holding the command-line. Both `!mjolnir` (or equivalent) and `this.command`
     *  have already been consumed. This `Command` is responsible for validating the contents
     *  of this command-line.
     * @param event The original event. Used mainly to post response.
     */
    exec(mjolnir: Mjolnir, roomID: string, lexer: Lexer, event: any): Promise<void>;
}

export class CommandManager {
    /**
     * All commands, in the order of registration.
     */
    private readonly commands: Command[];

    /**
     * A map of command string (e.g. `status`) to `Command`.
     */
    private readonly commandsPerCommand: Map<string, Command>;

    /**
     * The command used when no command is given.
     */
    private defaultCommand: Command | null;

    /**
     * The command used to display the help message.
     */
    private readonly helpCommand: Command;

    /**
     * The callback used to process messages.
     */
    private readonly onMessageCallback: (roomId: string, event: any) => Promise<void>;

    /**
     * All the prefixes this bot needs to answer to.
     */
    private readonly prefixes: string[] = [];

    /**
     * Register a new command.
     */
    public add(command: Command, options: { isDefault?: boolean } = {}) {
        const isDefault = options?.isDefault || false;
        this.commands.push(command);
        this.commandsPerCommand.set(command.command, command);
        if (isDefault) {
            this.defaultCommand = command;
        }
    }

    public constructor(
        private readonly managementRoomId: string,
        private readonly mjolnir: Mjolnir
    ) {
        this.onMessageCallback = this.handleMessage.bind(this);

        // Prepare help message.
        const commands = this.commands;
        const getMainPrefix = () => this.prefixes[0].trim();
        class HelpCommand implements Command {
            command: "help";
            helpDescription: "This help message";
            // For the time being we don't support `!mjolnir help <command>`.
            helpArgs: "";
            async exec(mjolnir: Mjolnir, roomID: string, lexer: Lexer, event: any): Promise<void> {
                // Inject the help at the end of commands.
                let allCommands = [...commands, this];

                let prefixes = [];
                let width = 0;
                let mainPrefix = getMainPrefix();

                // Compute width to display the help properly.
                for (let command of allCommands) {
                    let prefix = `${mainPrefix} ${command.command} ${command.helpArgs} `;
                    width = Math.max(width, prefix.length);
                    prefixes.push(prefix);
                }

                // Now build actual help message.
                let lines = [];
                for (let i = 0; i < prefixes.length; ++i) {
                    let prefix = prefixes[i].padEnd(width);
                    let line = `${prefix} - ${allCommands[i].helpDescription}`;
                    lines.push(line);
                }

                let message = lines.join("\n");
                const html = `<b>Mjolnir help:</b><br><pre><code>${htmlEscape(message)}</code></pre>`;
                const text = `Mjolnir help:\n${message}`;
                const reply = RichReply.createFor(roomID, event, text, html);
                reply["msgtype"] = "m.notice";
                await mjolnir.client.sendMessage(roomID, reply);    
            }
        }
        this.helpCommand = new HelpCommand();
    }

    public async init(prefixes: string[]) {
        // Prepare prefixes.
        this.prefixes.length = 0;
        for (let prefix of prefixes) {
            let lowercase = prefix.trim().toLowerCase();
            if (!lowercase.startsWith("!")) {
                // Note: This means that if the prefix is `!mjolnir`, we will also
                // respond to `!mjolniren` or any other suffixed variant.
                this.prefixes.push(`!${lowercase}`);
            }
            if (!lowercase.endsWith(":")) {
                this.prefixes.push(`${lowercase}:`);
            }
            this.prefixes.push(`${lowercase} `);
        }
        
        this.mjolnir.client.on("room.message", this.onMessageCallback);
    }

    public async dispose() {
        this.mjolnir.client.removeListener("room.message", this.onMessageCallback);
    }

    /**
     * Handle messages in any room to which we belong.
     *
     * @param roomId The room in which the message is received.
     * @param event An untrusted event.
     */
    private async handleMessage(roomId: string, event: any) {
        try {
            if (roomId != this.managementRoomId) {
                // Security-critical: We only ever accept commands from our management room.
                return;
            }
            const content = event['content'];
            if (!content || content['msgtype'] !== "m.text" || content['body']) {
                return;
            }

            const body = content['body'];
            const lowercaseBody = body.toLowerCase();
            const prefixUsed = this.prefixes.find(p => lowercaseBody.startsWith(p));
            if (!prefixUsed) {
                // Not a message for the bot.
                return;
            }

            // Consume the prefix.
            // Note: We're making the assumption that uppercase and lowercase have the
            // same length. This might not be true in some locales.
            const line = body.substring(prefixUsed.length).trim();
            LogService.info("Mjolnir", `Command being run by ${event['sender']}: ${event['content']['body']}`);
            /* No need to await */ this.mjolnir.client.sendReadReceipt(roomId, event['event_id']);

            // Lookup the command.
            // It's complicated a bit by the fact that we have commands:
            // - containing spaces;
            // - that are prefixes of other commands.
            // In theory, this could probably be fixed by introducing
            // subcommands, sub-sub-commands, etc. but as of this writing,
            // I have not found how to implement that without introducing
            // backwards incompatibilities.
            let cmd;
            if (line.length === 0) {
                cmd = this.defaultCommand;
            } else {
                // Scan full list, looking for longest match.
                let longestLength = -1;
                for (let command of this.commands) {
                    if (command.command.length > longestLength
                        && line.startsWith(command.command)) {
                        if (command.accept) {
                            let lexer = new Lexer(line.substring(command.command.length));
                            if (!command.accept(lexer)) {
                                continue;
                            }
                        }
                        longestLength = command.command.length;
                        cmd = command;
                    }
                }
            }

            let lexer;
            if (cmd) {
                lexer = new Lexer(line.substring(cmd.command.length).trim());
            } else {
                // Fallback to help.
                // Don't attempt to parse line.
                cmd = this.helpCommand;
                lexer = new Lexer("");
            }

            await cmd.exec(this.mjolnir, roomId, lexer, event);
        } catch (ex) {
            if (ex instanceof Lexer.ParsingError) {
                this.helpCommand.exec(this.mjolnir, roomId, new Lexer(""), event);
            } else {
                LogService.error("Mjolnir", `Error while processing command: ${ex}`);
                const text = `There was an error processing your command: ${htmlEscape(ex.message)}`;
                const reply = RichReply.createFor(roomId, event, text, text);
                reply["msgtype"] = "m.notice";
                await this.mjolnir.client.sendMessage(roomId, reply);        
            }
        }
    }
}

export abstract class AbstractLegacyCommand implements Command {
    abstract command: string;
    abstract helpDescription: string;
    abstract helpArgs: string;
    abstract legacyExec(roomID: string, event: any, mjolnir: Mjolnir, parts: string[]): Promise<void>;
    async exec(mjolnir: Mjolnir, roomID: string, lexer: Lexer, event: any): Promise<void> {
        // Fit legacy signature into `lexer`-based parsing.
        const line = lexer.token("ETC").text;
        const parts = line.trim().split(' ').filter(p => p.trim().length > 0);
        parts.unshift("!mjolnir", this.command);
        await this.legacyExec(roomID, event, mjolnir, parts);
    }
}

