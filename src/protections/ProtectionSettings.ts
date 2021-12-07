/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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

export class ProtectionSettingValidationError extends Error {};

export interface IProtectionSetting<T> {
    // the current value of this setting
    value: T

    /*
     * Deserialise a value for this setting type from a string
     *
     * @param data Serialised value
     * @returns Deserialised value or undefined if deserialisation failed
     */
    fromString(data: string): T | undefined;

    /*
     * Check whether a given value is valid for this setting
     *
     * @param data Setting value
     * @returns Validity of provided value
     */
    validate(data: T): boolean;

    /*
     * Store a value in this setting, only to be used after `validate()`
     * @param data Validated setting value
     */
    setValue(data: T): void;
}

class ProtectionSetting<T> implements IProtectionSetting<T> {
    value: T
    fromString(data: string): T | undefined {
        throw new Error("not Implemented");
    }
    validate(data: T): boolean {
        throw new Error("not Implemented");
    }
    setValue = (data) => this.value = data;
}

export class StringProtectionSetting extends ProtectionSetting<string> {
    value = "";
    fromString = (data) => data;
    validate = (data) => true;
}

export class NumberProtectionSetting extends ProtectionSetting<number> {
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

    fromString(data) {
        let number = Number(data);
        return isNaN(number) ? undefined : number;
    }
    validate(data) {
        return (!isNaN(data)
            && (this.min === undefined || this.min <= data)
            && (this.max === undefined || data <= this.max))
    }

}
