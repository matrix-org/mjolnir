/*
Copyright 2023 The Matrix.org Foundation C.I.C.

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

/**
 * Utilities to deal with untrusted values coming from Matrix events.
 *
 * e.g. to confirm that a value `foo` has type `{ bar: string[]}`,
 * run
 * ```ts
 * new SubTypeObjectContent({
 *   bar: STRING_CONTENT.array()
 * }).check_type(value)
 * ```
 */

/**
 * The abstract root class for all content we wish to validate against.
 */
abstract class AbstractContent {
    /**
     * Validate the type of a value against `this`.
     * @param value
     */
    abstract checkType(value: any): boolean;

    /**
     * If `value` has `this` type, return `value`, otherwise
     * return `defaults()`.
     */
    fallback(value: any, defaults: () => any): any {
        if (this.checkType(value)) {
            return value;
        }
        return defaults();
    }

    /**
     * Return an `AbstractContent` for values of type `this | null | undefined`.
     */
    optional(): AbstractContent {
        return new OptionalContent(this);
    }

    /**
     * Return a `AbstractContent` for values of type `this[]`.
     *
     * This is a shortcut for `new OptionalContent(this)`
     */
    array(): AbstractContent {
        return new ArrayContent(this);
    }
};

/**
 * A content validator for numbers.
 */
class StringContent extends AbstractContent {
    /**
     * Check that `value` is a string.
     */
    checkType(value: any): boolean {
        return typeof value === "string";
    }
};
/**
 * A content validator for strings (singleton).
 */
export const STRING_CONTENT = new StringContent();


/**
 * A content validator for numbers.
 */
class NumberContent extends AbstractContent {
    checkType(value: any): boolean {
        return typeof value === "number";
    }
};

/**
 * A content validator for numbers (singleton).
 */
export const NUMBER_CONTENT = new NumberContent();

/**
 * A content validator for arrays.
 */
class ArrayContent extends AbstractContent {
    constructor(public readonly content: AbstractContent) {
        super()
    }
    /**
     * Check that `value` is an array and that each value it contains
     * has type `type.content`.
     */
    checkType(value: any): boolean {
        if (!Array.isArray(value)) {
            return false;
        }
        for (let item of value) {
            if (!this.content.checkType(item)) {
                return false;
            }
        }
        return true;
    }
}
class OptionalContent extends AbstractContent {
    constructor(public readonly content: AbstractContent) {
        super()
    }
    optional(): AbstractContent {
        return this;
    }
    /**
     * Check that value either has type `this.content` or is `null` or `undefined`.
     */
    checkType(value: any): boolean {
        if (typeof value === "undefined") {
            return true;
        }
        if (value === null) {
            return true;
        }
        if (this.content.checkType(value)) {
            return true;
        }
        return false;
    }
}
export class SubTypeObjectContent extends AbstractContent {
    constructor(public readonly fields: Record<string, AbstractContent>) {
        super()
    }
    /**
     * Check that `value` contains **at least** the fields of `this.fields`
     * and that each field specified in `this.fields` holds a value that
     * matches the type specified in `this.fields`.
     */
    checkType(value: any): boolean {
        if (typeof value !== "object") {
            return false;
        }
        if (value === null) {
            // Let's not forget that `typeof null === "object"`
            return false;
        }
        if (Array.isArray(value)) {
            // Let's not forget that `typeof [...] === "object"`
            return false;
        }
        for (let [k, expected] of Object.entries(this.fields)) {
            if (!expected.checkType(value[k])) {
                return false;
            }
        }
        return true;
    }
}

export class ExactTypeObjectContent extends SubTypeObjectContent {
    constructor(public readonly fields: Record<string, AbstractContent>) {
        super(fields)
    }
    /**
     * Check that `value` contains **exactly** the fields of `this.fields`
     * and that each field specified in `this.fields` holds a value that
     * matches the type specified in `this.fields`.
     */
    checkType(value: any): boolean {
        if (!super.checkType(value)) {
            return false;
        }
        // Check that we don't have any field we're not expecting.
        for (let k of Object.keys(value)) {
            if (!(k in this.fields)) {
                return false;
            }
        }
        return true;
    }
}
