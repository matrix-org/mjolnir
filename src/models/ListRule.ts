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

export enum EntityType {
    /// `entity` is to be parsed as a glob of users IDs
    RULE_USER = "m.policy.rule.user",

    /// `entity` is to be parsed as a glob of room IDs/aliases
    RULE_ROOM = "m.policy.rule.room",

    /// `entity` is to be parsed as a glob of server names
    RULE_SERVER = "m.policy.rule.server",
}

export const RULE_USER = EntityType.RULE_USER;
export const RULE_ROOM = EntityType.RULE_ROOM;
export const RULE_SERVER = EntityType.RULE_SERVER;

// README! The order here matters for determining whether a type is obsolete, most recent should be first.
// These are the current and historical types for each type of rule which were used while MSC2313 was being developed
// and were left as an artifact for some time afterwards.
// Most rules (as of writing) will have the prefix `m.room.rule.*` as this has been in use for roughly 2 years.
export const USER_RULE_TYPES = [RULE_USER, "m.room.rule.user", "org.matrix.mjolnir.rule.user"];
export const ROOM_RULE_TYPES = [RULE_ROOM, "m.room.rule.room", "org.matrix.mjolnir.rule.room"];
export const SERVER_RULE_TYPES = [RULE_SERVER, "m.room.rule.server", "org.matrix.mjolnir.rule.server"];
export const ALL_RULE_TYPES = [...USER_RULE_TYPES, ...ROOM_RULE_TYPES, ...SERVER_RULE_TYPES];

export enum Recommendation {
    /// The rule recommends a "ban".
    ///
    /// The actual semantics for this "ban" may vary, e.g. room ban,
    /// server ban, ignore user, etc. To determine the semantics for
    /// this "ban", clients need to take into account the context for
    /// the list, e.g. how the rule was imported.
    Ban = "m.ban",

    /// The rule specifies an "opinion", as a number in [-100, +100],
    /// where -100 represents a user who is considered absolutely toxic
    /// by whoever issued this ListRule and +100 represents a user who
    /// is considered absolutely absolutely perfect by whoever issued
    /// this ListRule.
    Opinion = "org.matrix.msc3845.opinion",

    /**
     * This is a rule that recommends allowing a user to participate.
     * Used for the construction of allow lists.
     */
    Allow = "org.matrix.mjolnir.allow",
}

/**
 * All variants of recommendation `m.ban`
 */
const RECOMMENDATION_BAN_VARIANTS = [
    // Stable
    Recommendation.Ban,
    // Unstable prefix, for compatibility.
    "org.matrix.mjolnir.ban"
];

/**
 * All variants of recommendation `m.opinion`
 */
const RECOMMENDATION_OPINION_VARIANTS: string[] = [
    // Unstable
    Recommendation.Opinion
];

const RECOMMENDATION_ALLOW_VARIANTS: string[] = [
    // Unstable
    Recommendation.Allow
]

export const OPINION_MIN = -100;
export const OPINION_MAX = +100;

interface MatrixStateEvent {
    type: string,
    content: any,
    event_id: string,
    state_key: string,
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
         * The event source for the rule.
         */
        public readonly sourceEvent: MatrixStateEvent,
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
         * The recommendation for this rule, e.g. "ban" or "opinion", or `null`
         * if the recommendation is one that Mjölnir doesn't understand.
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

    /**
     * @returns Whether the entity in he rule represents a Matrix glob (and not a literal).
     */
    public isGlob(): boolean {
        return /[*?]/.test(this.entity);
    }

    /**
     * Validate and parse an event into a ListRule.
     *
     * @param event An *untrusted* event.
     * @returns null if the ListRule is invalid or not recognized by Mjölnir.
     */
    public static parse(event: MatrixStateEvent): ListRule | null {
        // Parse common fields.
        // If a field is ill-formed, discard the rule.
        const content = event['content'];
        if (!content || typeof content !== "object") {
            return null;
        }
        const entity = content['entity'];
        if (!entity || typeof entity !== "string") {
            return null;
        }
        const recommendation = content['recommendation'];
        if (!recommendation || typeof recommendation !== "string") {
            return null;
        }

        const reason = content['reason'] || '<no reason>';
        if (typeof reason !== "string") {
            return null;
        }

        let type = event['type'];
        let kind;
        if (USER_RULE_TYPES.includes(type)) {
            kind = EntityType.RULE_USER;
        } else if (ROOM_RULE_TYPES.includes(type)) {
            kind = EntityType.RULE_ROOM;
        } else if (SERVER_RULE_TYPES.includes(type)) {
            kind = EntityType.RULE_SERVER;
        } else {
            return null;
        }

        // From this point, we may need specific fields.
        if (RECOMMENDATION_BAN_VARIANTS.includes(recommendation)) {
            return new ListRuleBan(event, entity, reason, kind);
        } else if (RECOMMENDATION_OPINION_VARIANTS.includes(recommendation)) {
            let opinion = content['opinion'];
            if (!Number.isInteger(opinion)) {
                return null;
            }
            return new ListRuleOpinion(event, entity, reason, kind, opinion);
        } else if (RECOMMENDATION_ALLOW_VARIANTS.includes(recommendation)) {
            return new ListRuleAllow(event, entity, reason, kind);
        } else {
            // As long as the `recommendation` is defined, we assume
            // that the rule is correct, just unknown.
            return new ListRuleUnknown(event, entity, reason, kind, content);
        }
    }
}

/**
 * A rule representing a "ban".
 */
export class ListRuleBan extends ListRule {
    constructor(
        /**
         * The event source for the rule.
         */
        sourceEvent: MatrixStateEvent,
        /**
         * The entity covered by this rule, e.g. a glob user ID, a room ID, a server domain.
         */
        entity: string,
        /**
         * A human-readable reason for this rule, for audit purposes.
         */
        reason: string,
        /**
         * The type of entity for this rule, e.g. user, server domain, etc.
         */
        kind: EntityType,
    ) {
        super(sourceEvent, entity, reason, kind, Recommendation.Ban)
    }
}

/**
 * A rule representing an "allow".
 */
 export class ListRuleAllow extends ListRule {
    constructor(
        /**
         * The event source for the rule.
         */
        sourceEvent: MatrixStateEvent,
        /**
         * The entity covered by this rule, e.g. a glob user ID, a room ID, a server domain.
         */
        entity: string,
        /**
         * A human-readable reason for this rule, for audit purposes.
         */
        reason: string,
        /**
         * The type of entity for this rule, e.g. user, server domain, etc.
         */
        kind: EntityType,
    ) {
        super(sourceEvent, entity, reason, kind, Recommendation.Allow)
    }
}

/**
 * A rule representing an "opinion"
 */
export class ListRuleOpinion extends ListRule {
    constructor(
        /**
         * The event source for the rule.
         */
        sourceEvent: MatrixStateEvent,
        /**
         * The entity covered by this rule, e.g. a glob user ID, a room ID, a server domain.
         */
        entity: string,
        /**
         * A human-readable reason for this rule, for audit purposes.
         */
        reason: string,
        /**
         * The type of entity for this rule, e.g. user, server domain, etc.
         */
        kind: EntityType,
        /**
         * A number in [-100, +100] where -100 represents the worst possible opinion
         * on the entity (e.g. toxic user or community) and +100 represents the best
         * possible opinion on the entity (e.g. pillar of the community).
         */
        public readonly opinion: number
    ) {
        super(sourceEvent, entity, reason, kind, Recommendation.Opinion);
        if (!Number.isInteger(opinion)) {
            throw new TypeError(`The opinion must be an integer, got ${opinion}`);
        }
        if (opinion < OPINION_MIN || opinion > OPINION_MAX) {
            throw new TypeError(`The opinion must be within [-100, +100], got ${opinion}`);
        }
    }
}

/**
 * Any list rule that we do not understand.
 */
export class ListRuleUnknown extends ListRule {
    constructor(
        /**
         * The event source for the rule.
         */
        sourceEvent: MatrixStateEvent,
        /**
         * The entity covered by this rule, e.g. a glob user ID, a room ID, a server domain.
         */
        entity: string,
        /**
         * A human-readable reason for this rule, for audit purposes.
         */
        reason: string,
        /**
         * The type of entity for this rule, e.g. user, server domain, etc.
         */
        kind: EntityType,
        /**
         * The event used to create the rule.
         */
        public readonly content: any,
    ) {
        super(sourceEvent, entity, reason, kind, null);
    }
}
