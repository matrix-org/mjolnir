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

type ValidationMatchExpression<Ok, Err> = { ok?: (ok: Ok) => any, err?: (err: Err) => any};

/**
 * Why do we need a Result Monad for the parser signiture.
 * I (Gnuxie) don't like monadic error handling, simply because
 * I'm a strong believer in failing early, yes i may be misinformed.
 * The only reason we don't use an exception in this case is because
 * these are NOT to be used nilly willy and thrown out of context
 * from an unrelated place. The Monad ensures locality (in terms of call chain)
 * to the user interface by being infuriating to deal with.
 * It also does look different to an exception
 * to a naive programmer. Ideally though, if the world had adopted
 * condition based error handling i would simply create a condition
 * type for validation errors that can be translated/overidden by
 * the command handler, and it wouldn't have to look like this.
 * It's important to remember the errors we are reporting are to do with user input,
 * we're trying to tell the user they did something wrong and what that is.
 * This is something completely different to a normal exception,
 * where we are saying to ourselves that our assumptions in our code about
 * the thing we're doing are completely wrong. The user never
 * should see these as there is nothing they can do about it.
 *
 * OK, it would be too annoying even for me to have a real Monad.
 * So this is dumb as hell, no worries though
 * 
 * OK I'm beginning to regret my decision.
 * 
 * TODO: Can we make ValidationResult include ValidationError
 */
 export class ValidationResult<Ok, Err> {
    private constructor(
        private readonly okValue: Ok|null,
        private readonly errValue: Err|null,
    ) {

    }
    public static Ok<Ok, Err>(value: Ok): ValidationResult<Ok, Err> {
        return new ValidationResult<Ok, Err>(value, null);
    }

    public static Err<Ok, Err>(value: Err): ValidationResult<Ok, Err> {
        return new ValidationResult<Ok, Err>(null, value);
    }

    public async match(expression: ValidationMatchExpression<Ok, Err>) {
        return this.okValue ? await expression.ok!(this.ok) : await expression.err!(this.err);
    }

    public isOk(): boolean {
        return this.okValue !== null;
    }

    public isErr(): boolean {
        return this.errValue !== null;
    }

    public get ok(): Ok {
        if (this.isOk()) {
            return this.okValue!;
        } else {
            throw new TypeError("You did not check isOk before accessing ok");
        }
    }

    public get err(): Err {
        if (this.isErr()) {
            return this.errValue!;
        } else {
            throw new TypeError("You did not check isErr before accessing err");
        }
    }
}

export class ValidationError {
    private static readonly ERROR_CODES = new Map<string, symbol>();

    private constructor(
        public readonly code: symbol,
        public readonly message: string,
    ) {

    }

    private static ensureErrorCode(code: string): symbol {
        const existingCode = ValidationError.ERROR_CODES.get(code);
        if (existingCode) {
            return existingCode;
        } else {
            const newCode = Symbol(code);
            ValidationError.ERROR_CODES.set(code, newCode);
            return newCode;
        }
    }

    private static findErrorCode(code: string) {
        const existingCode = ValidationError.ERROR_CODES.get(code);
        if (existingCode) {
            return existingCode;
        } else {
            throw new TypeError(`No code was registered ${code}`);
        }
    }

    public static makeValidationError(code: string, message: string) {
        return new ValidationError(ValidationError.ensureErrorCode(code), message);
    }

    public async match<T>(cases: {[keys: string]: (error: ValidationError) => Promise<T>}): Promise<void> {
        for (const [key, handler] of Object.entries(cases)) {
            const keySymbol = ValidationError.findErrorCode(key);
            if (this.code === keySymbol) {
                await handler.call(this);
                break;
            }
        }
        const defaultHandler = cases.default;
        if (defaultHandler) {
            await defaultHandler.call(this);
        }
    }
}
