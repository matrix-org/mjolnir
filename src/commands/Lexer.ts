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

        // Identifier rules, used e.g. for subcommands `get`, `set` ...
        this.rule(/[a-zA-Z_]+/, (ctx) => {
            ctx.accept("id");
        });

        // User IDs
        this.rule(/@[a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("userID");
        });
        this.rule(/@[a-zA-Z0-9_.=\-?*/]+:.+/, (ctx) => {
            ctx.accept("globUserID");
        });

        // User IDs
        this.rule(/![a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("roomID");
        });
        this.rule(/#[a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("roomAlias");
        });
        this.rule(/[#!][a-zA-Z0-9_.=\-/]+:.+/, (ctx) => {
            ctx.accept("roomAliasOrID");
        });
        
        // Numbers.
        this.rule(/[+-]?[0-9]+/, (ctx, match) => {
            ctx.accept("int", parseInt(match[0]))
        });

        // Quoted strings.
        this.rule(/"((?:\\"|[^\r\n])*)"/, (ctx, match) => {
            ctx.accept("string", match[1].replace(/\\"/g, "\""))
        });

        // Arbitrary non-space content.
        this.rule(/\S+/, (ctx) => {
            ctx.accept("nospace");
        });

        // Dates and durations.
        this.rule(/\S+/, (ctx, match) => {
            let date = new Date(match[0]);
            if (!date || Number.isNaN(date.getDate())) {
                let duration = parseDuration(match[0]);
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
        this.rule(/\*/, (ctx) => {
            ctx.accept("STAR");
        });
        this.rule(/.*/, ctx => {
            ctx.accept("EVERYTHING ELSE");
        });

        this.input(string);
    }
}
