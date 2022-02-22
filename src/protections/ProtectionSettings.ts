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

import { EventEmitter } from "events";
import { default as parseDuration } from "parse-duration";

// Define a few aliases to simplify parsing durations.

parseDuration["milliseconds"] = parseDuration["millis"] = parseDuration["ms"];
parseDuration["days"] = parseDuration["day"];
parseDuration["weeks"] = parseDuration["week"] = parseDuration["wk"];
parseDuration["months"] = parseDuration["month"];
parseDuration["years"] = parseDuration["year"];

export class ProtectionSettingValidationError extends Error {};

/*
 * @param TChange Type for individual pieces of data (e.g. `string`)
 * @param TValue Type for overall value of this setting (e.g. `string[]`)
 */
export class AbstractProtectionSetting<TChange, TValue> extends EventEmitter {
    // the current value of this setting
    value: TValue

    /*
     * Deserialise a value for this setting type from a string
     *
     * @param data Serialised value
     * @returns Deserialised value or undefined if deserialisation failed
     */
    fromString(data: string): TChange | undefined {
        throw new Error("not Implemented");
    }

    /*
     * Check whether a given value is valid for this setting
     *
     * @param data Setting value
     * @returns Validity of provided value
     */
    validate(data: TChange): boolean {
        throw new Error("not Implemented");
    }

    /*
     * Store a value in this setting, only to be used after `validate()`
     * @param data Validated setting value
     */
    setValue(data: TValue) {
        this.value = data;
        this.emit("set", data);
    }
}
export class AbstractProtectionListSetting<TChange, TValue> extends AbstractProtectionSetting<TChange, TValue> {
    /*
     * Add `data` to the current setting value, and return that new object
     *
     * @param data Value to add to the current setting value
     * @returns The potential new value of this setting object
     */
    addValue(data: TChange): TValue {
        throw new Error("not Implemented");
    }

    /*
     * Remove `data` from the current setting value, and return that new object
     *
     * @param data Value to remove from the current setting value
     * @returns The potential new value of this setting object
     */
    removeValue(data: TChange): TValue {
        throw new Error("not Implemented");
    }
}
export function isListSetting(object: any): object is AbstractProtectionListSetting<any, any> {
    return object instanceof AbstractProtectionListSetting;
}


export class StringProtectionSetting extends AbstractProtectionSetting<string, string> {
    value = "";
    fromString = (data: string): string => data;
    validate = (data: string): boolean => true;
}
export class StringListProtectionSetting extends AbstractProtectionListSetting<string, string[]> {
    value: string[] = [];
    fromString = (data: string): string => data;
    validate = (data: string): boolean => true;
    addValue(data: string): string[] {
        this.emit("add", data);
        this.value.push(data);
        return this.value;
    }
    removeValue(data: string): string[] {
        this.emit("remove", data);
        this.value =  this.value.filter(i => i !== data);
        return this.value;
    }
}

export class StringSetProtectionSetting extends AbstractProtectionListSetting<string, Set<String>> {
    value: Set<string> = new Set();
    fromString = (data: string): string => data;
    validate = (data: string): boolean => true;
    addValue(data: string): Set<string> {
        this.emit("add", data);
        this.value.add(data);
        return this.value;
    }
    removeValue(data: string): Set<string> {
        this.emit("remove", data);
        this.value.delete(data);
        return this.value;
    }
}

// A list of strings that match the glob pattern @*:*
export class MXIDListProtectionSetting extends StringListProtectionSetting {
    // validate an individual piece of data for this setting - namely a single mxid
    validate = (data: string) => /^@\S+:\S+$/.test(data);
}

export class NumberProtectionSetting extends AbstractProtectionSetting<number, number> {
    min: number|undefined;
    max: number|undefined;

    constructor(
            defaultValue: number,
            min: number|undefined = undefined,
            max: number|undefined = undefined
    ) {
        super();
        this.setValue(defaultValue);
        this.min = min;
        this.max = max;
    }

    fromString(data: string) {
        let number = Number(data);
        return isNaN(number) ? undefined : number;
    }
    validate(data: number) {
        return (!isNaN(data)
            && (this.min === undefined || this.min <= data)
            && (this.max === undefined || data <= this.max))
    }
}

/**
 * A setting holding durations, in ms.
 *
 * When parsing, the setting expects a unit, e.g. "1ms".
 */
export class DurationMSProtectionSetting extends AbstractProtectionSetting<number, number> {
    constructor(
            defaultValue: number,
            public readonly minMS: number|undefined = undefined,
            public readonly maxMS: number|undefined = undefined
    ) {
        super();
        this.setValue(defaultValue);
    }

    fromString(data: string) {
        let number = parseDuration(data);
        return isNaN(number) ? undefined : number;
    }
    validate(data: number) {
        return (!isNaN(data)
            && (this.minMS === undefined || this.minMS <= data)
            && (this.maxMS === undefined || data <= this.maxMS))
    }
}
