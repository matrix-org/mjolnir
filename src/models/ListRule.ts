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

import { MatrixGlob } from "matrix-bot-sdk";
import { EntityType } from "./PolicyList";

export enum Recommendation {
    /// The rule recommends a "ban".
    ///
    /// The actual semantics for this "ban" may vary, e.g. room ban,
    /// server ban, ignore user, etc. To determine the semantics for
    /// this "ban", clients need to take into account the context for
    /// the list, e.g. how the rule was imported.
    Ban = "m.ban",

    /// The rule specifies an "opinion", as a number in [-100, +100],
    /// where +100 represents a user who is absolutely trusted and
    /// -100 represents a user who is absolutely untrusted.
    Opinion = "org.matrix.msc3845.opinion"
}

/**
 * All types for `m.ban`
 */
const RECOMMENDATION_BAN_VARIANTS = [
    // Stable
    Recommendation.Ban,
    // Unstable prefix, for compatibility.
    "org.matrix.mjolnir.ban"
];

/**
 * All types for `m.ban`
 */
const RECOMMENDATION_OPINION_VARIANTS: string[] = [
    // Unstable
    Recommendation.Opinion
];

export const OPINION_MIN = -100;
export const OPINION_MAX = +100;

// FIXME: This function is only ever called with a constant?
export function recommendationToStable(recommendation: string): Recommendation | null {
    if (RECOMMENDATION_BAN_VARIANTS.includes(recommendation)) return Recommendation.Ban;
    if (RECOMMENDATION_OPINION_VARIANTS.includes(recommendation)) return Recommendation.Opinion;
    return null;
}

/**
 * Representation of a rule within a Policy List.
 */
export abstract class ListRule {
    /**
     * A glob for `entity`.
     */
    private glob: MatrixGlob;
    constructor(
        /**
         * The entity covered by this rule, e.g. a glob user ID, a room ID, a server domain.
         */
        public readonly entity: string,
        /**
         * A human-readable reason for this rule, for audit purposes.
         */
        public readonly reason: string,
        /**
         * The type of entity for this rule, e.g. user, server domain, etc.
         */
        public readonly kind: EntityType,
        /**
         * The recommendation for this rule, e.g. "ban" or "opinion".
         */
        public readonly recommendation: Recommendation | null) {
        this.glob = new MatrixGlob(entity);
    }

    /**
     * Determine whether this rule should apply to a given entity.
     */
    public isMatch(entity: string): boolean {
        return this.glob.test(entity);
    }
}

/**
 * A rule representing a "ban".
 */
export class ListRuleBan extends ListRule {
    constructor(
        /**
    * The entity covered by this rule, e.g. a glob user ID, a room ID, a server domain.
    */
        public readonly entity: string,
        /**
         * A human-readable reason for this rule, for audit purposes.
         */
        public readonly reason: string,
        /**
         * The type of entity for this rule, e.g. user, server domain, etc.
         */
        public readonly kind: EntityType,
    ) {
        super(entity, reason, kind, Recommendation.Ban)
    }
}

/**
 * A rule representing an "opinion"
 */
export class ListRuleOpinion extends ListRule {
    constructor(

        /**
 * The entity covered by this rule, e.g. a glob user ID, a room ID, a server domain.
 */
        public readonly entity: string,
        /**
         * A human-readable reason for this rule, for audit purposes.
         */
        public readonly reason: string,
        /**
         * The type of entity for this rule, e.g. user, server domain, etc.
         */
        public readonly kind: EntityType,
        /**
         * A number in [-100, +100] where -100 represents the worst possible opinion
         * on the entity (e.g. toxic user or community) and +100 represents the best
         * possible opinion on the entity (e.g. absolute trust).
         */
        public readonly opinion: number
    ) {
        super(entity, reason, kind, Recommendation.Opinion);
        if (!Number.isInteger(opinion)) {
            throw new TypeError(`The opinion must be an integer, got ${opinion}`);
        }
        if (opinion < OPINION_MIN || opinion > OPINION_MAX) {
            throw new TypeError(`The opinion must be within [-100, +100], got ${opinion}`);
        }
    }
}
