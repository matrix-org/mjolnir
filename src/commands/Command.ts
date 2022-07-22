import { Mjolnir } from '../Mjolnir';
import Tokenizr from "tokenizr";

// For some reason, different versions of TypeScript seem
// to disagree on how to import Tokenizr
import * as TokenizrModule from "tokenizr";
import { htmlEscape, parseDuration } from "../utils";
import { COMMAND_PREFIX } from './CommandHandler';
import config from '../config';
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
        this.rule("command", COMMAND, (ctx) => {
            ctx.accept("command");
        });

        // Users
        this.rule("userID", USER_ID, (ctx) => {
            ctx.accept("userID");
        });
        this.rule("globUserID", GLOB_USER_ID, (ctx) => {
            ctx.accept("globUserID");
        });

        // Rooms
        this.rule("roomID", ROOM_ID, (ctx) => {
            ctx.accept("roomID");
        });
        this.rule("roomAlias", ROOM_ALIAS, (ctx) => {
            ctx.accept("roomAlias");
        });
        this.rule("roomAliasOrID", ROOM_ALIAS_OR_ID, (ctx) => {
            ctx.accept("roomAliasOrID");
        });

        // Numbers.
        this.rule("int", INT, (ctx, match) => {
            ctx.accept("int", parseInt(match[0]))
        });

        // Quoted strings.
        this.rule("string", STRING, (ctx, match) => {
            ctx.accept("string", match[1].replace(/\\"/g, "\""))
        });

        // Dates and durations.
        this.rule("dateOrDuration", DATE_OR_DURATION, (ctx, match) => {
            let content = match[1] || match[2];
            let date = new Date(content);
            if (!date || Number.isNaN(date.getDate())) {
                let duration = parseDuration(content);
                if (!duration || Number.isNaN(duration)) {
                    ctx.reject();
                } else {
                    ctx.accept("duration", duration);
                }
            } else {
                ctx.accept("date", date);
            }
        });

        // Jokers.
        this.rule("STAR", STAR, (ctx) => {
            ctx.accept("STAR");
        });

        // Everything left in the string.
        this.rule("ETC", ETC, (ctx, match) => {
            ctx.accept("ETC", match[0].trim());
        });

        this.input(string);
    }

    public token(state?: string): TokenizrModule.Token {
        if (typeof state === "string") {
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
    private PREFIXES: string[] = [];

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
        /**
         * A list of command-prefixes to answer to, e.g. `mjolnir`.
         */
        public readonly prefixes: string[],
        private readonly managementRoomId: string,
        private readonly mjolnir: Mjolnir
    ) {
        this.onMessageCallback = this.handleMessage.bind(this);
        // Prepare prefixes.

        // Prepare help message.
        const commands = this.commands;
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

                // Compute width to display the help properly.
                for (let command of allCommands) {
                    let prefix = `${this.c} ${command.command} ${command.helpArgs} `;
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

    public async init() {
        // Initialize the list of prefixes to which the bot will respond.
        // We perform lowercase-comparison, 
        const userId = await (await this.mjolnir.client.getUserId()).toLowerCase();
        const profile = await this.mjolnir.client.getUserProfile(userId);
        const localpart = userId.split(':')[0].substring(1);
        this.PREFIXES = [
            COMMAND_PREFIX.toLowerCase(),
            localpart + ":",
            localpart + " ",
        ];

        const displayName = profile['displayName']?.toLowerCase();
        if (displayName) {
            this.PREFIXES.push(displayName + ":");
            this.PREFIXES.push(displayName + " ");
        }

        for (let additionalPrefix of config.commands.additionalPrefixes || []) {
            const lowercase = additionalPrefix.toLowerCase();
            for (let prefix of [
                `!${lowercase}`,
                `${lowercase}:`,
                `!${lowercase} `
            ]) {
                this.PREFIXES.push(prefix);
            }
        }
        if (config.commands.allowNoPrefix) {
            this.PREFIXES.push("!");
        }

        // Initialize listening to messages.
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
            const prefixUsed = this.PREFIXES.find(p => lowercaseBody.startsWith(p));
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

            // Lookup the command. As some commands contain spaces, we cannot
            // simply use the lexer and a lookup in a map.
            let cmd = line.length === 0 ?
                this.defaultCommand
                : this.commands.find(cmd => line.startsWith(cmd.command));

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
            LogService.error("Mjolnir", `Error while processing command: ${ex}`);
            const text = `There was an error processing your command: ${htmlEscape(ex.message)}`;
            const reply = RichReply.createFor(roomId, event, text, text);
            reply["msgtype"] = "m.notice";
            await this.mjolnir.client.sendMessage(roomId, reply);    
        }
    }
}