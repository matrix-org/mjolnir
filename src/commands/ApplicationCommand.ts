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

/**
 * A feature that an application supports.
 * Used by ApplicationCommands as required feature flags they depend on to function.
 */
export interface ApplicationFeature {
    name: string,
    description: string,
}


/**
 * These are features that have been defined using `defineApplicationCommand`.
 * you can access them using `getApplicationFeature`.
 */
const APPLICATION_FEATURES = new Map<string/*feature name*/, ApplicationFeature>();

export function defineApplicationFeature(feature: ApplicationFeature): void {
    if (APPLICATION_FEATURES.has(feature.name)) {
        throw new TypeError(`Application feature has already been defined ${feature.name}`);
    }
    APPLICATION_FEATURES.set(feature.name, feature);
}

export function getApplicationFeature(name: string): ApplicationFeature|undefined {
    return APPLICATION_FEATURES.get(name);
}

export class ApplicationCommand<ExecutorType extends (...args: any) => Promise<any>> {
    constructor(
        public readonly requiredFeatures: ApplicationFeature[],
        public readonly executor: ExecutorType
    ) {
    }
}

export function defineApplicationCommand<ExecutorType extends (...args: any) => Promise<any>>(
    requiredFeatureNames: string[],
    executor: ExecutorType) {
    const features = requiredFeatureNames.map(name => {
        const feature =  getApplicationFeature(name);
        if (feature) {
            return feature
        } else {
            throw new TypeError(`Can't find a feature called ${name}`);
        }
    })
    return new ApplicationCommand<ExecutorType>(features, executor);
}

defineApplicationFeature({
    name: "synapse admin",
    description: "Requires that the mjolnir account has Synapse admin"
});
