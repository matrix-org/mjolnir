import Tokenizr from "tokenizr";

// For some reason, different versions of TypeScript seem
// to disagree on how to import Tokenizr
import * as TokenizrModule from "tokenizr";
import { parseDuration } from "../utils";
const TokenizrClass = Tokenizr || TokenizrModule;

const WHITESPACE = /\s+/;
const COMMAND = /![a-zA-Z_]+/;
const IDENTIFIER = /[a-zA-Z_]+/;
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

        // Command rules, e.g. `!mjolnir`
        this.rule("command", COMMAND, (ctx) => {
            ctx.accept("command");
        });

        // Identifier rules, used e.g. for subcommands `get`, `set` ...
        this.rule("id", IDENTIFIER, (ctx) => {
            ctx.accept("id");
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
