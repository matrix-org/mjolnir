import Tokenizr from "tokenizr";

// For some reason, different versions of TypeScript seem
// to disagree on how to import Tokenizr
import * as TokenizrModule from "tokenizr";
import { parseDuration } from "../utils";
const TokenizrClass = Tokenizr || TokenizrModule;

/**
 * A lexer for common cases.
 */
export class Lexer extends TokenizrClass {
    constructor(string: string) {
        super();

        // Ignore whitespace.
        this.rule(/\s+/, (ctx) => {
            ctx.ignore()
        })

        // Command rules, e.g. `!mjolnir`
        this.rule("command", /![a-zA-Z_]+/, (ctx) => {
            ctx.accept("command");
        });

        // Identifier rules, used e.g. for subcommands `get`, `set` ...
        this.rule("id", /[a-zA-Z_]+/, (ctx) => {
            ctx.accept("id");
        });

        // Users
        this.rule("userID", /@[a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("userID");
        });
        this.rule("globUserID", /@[a-zA-Z0-9_.=\-?*/]+:.+/, (ctx) => {
            ctx.accept("globUserID");
        });

        // Rooms
        this.rule("roomID", /![a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("roomID");
        });
        this.rule("roomAlias", /#[a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("roomAlias");
        });
        this.rule("roomAliasOrID", /[#!][a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("roomAliasOrID");
        });

        // Numbers.
        this.rule("int", /[+-]?[0-9]+/, (ctx, match) => {
            ctx.accept("int", parseInt(match[0]))
        });

        // Quoted strings.
        this.rule("string", /"((?:\\"|[^\r\n])*)"/, (ctx, match) => {
            ctx.accept("string", match[1].replace(/\\"/g, "\""))
        });

        // Dates and durations.
        try {
            this.rule("dateOrDuration", /(?:"([^"]+)")|(\S+)/, (ctx, match) => {
                let content = match[1] || match[2];
                console.debug("YORIC", "Lexer", "dateOrDuration", content);
                let date = new Date(content);
                console.debug("YORIC", "Lexer", "dateOrDuration", "date", date);
                if (!date || Number.isNaN(date.getDate())) {
                    let duration = parseDuration(content);
                    console.debug("YORIC", "Lexer", "dateOrDuration", "duration", duration);
                    if (!duration || Number.isNaN(duration)) {
                        ctx.reject();
                    } else {
                        ctx.accept("duration", duration);
                    }
                } else {
                    ctx.accept("date", date);
                }
            });
        } catch (ex) {
            console.error("YORIC", ex);
        }

        // Jokers.
        this.rule("STAR", /\*/, (ctx) => {
            ctx.accept("STAR");
        });

        // Everything left in the string.
        this.rule("ETC", /.*/, (ctx) => {
            ctx.accept("ETC")
        });

        console.debug("YORIC", "Preparing lexer", string);
        this.input(string);
    }

    public token(state?: string): TokenizrModule.Token {
        if (typeof state === "string") {
            this.state(state);
        }
        return super.token();
    }
}
