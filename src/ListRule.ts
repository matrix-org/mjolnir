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

export const RECOMMENDATION_BAN = "m.ban";
export const RECOMMENDATION_BAN_TYPES = [RECOMMENDATION_BAN, "org.matrix.mjolnir.ban"];

export class ListRule {
    constructor(public entity: string, private action: string, public reason: string) {
        // TODO: Convert entity to regex
    }

    public get recommendation(): string {
        if (RECOMMENDATION_BAN_TYPES.includes(this.action)) return RECOMMENDATION_BAN;
    }

    // TODO: Match checking functions
}
