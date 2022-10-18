/*
Copyright 2019-2022 The Matrix.org Foundation C.I.C.

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

import PolicyList, { ChangeType, ListRuleChange } from "./PolicyList";
import { EntityType, ListRule, Recommendation, RULE_SERVER, RULE_USER } from "./ListRule";
import { LogService, UserID } from "matrix-bot-sdk";
import { ServerAcl } from "./ServerAcl";

/**
 * The ListRuleCache is a cache for all the rules in a set of lists for a specific entity type and recommendation.
 * The cache can then be used to quickly test against all the rules for that specific entity/recommendation.
 * E.g. The cache can be used for all the m.ban rules for users in a set of lists to conveniently test members of a room.
 * While some effort has been made to optimize the testing of entities, the main purpose of this class is to stop
 * ad-hoc destructuring of policy lists to test rules against entities.
 *
 * Note: This cache should not be used to unban or introspect about the state of `PolicyLists`, for this
 * see `PolicyList.unban` and `PolicyList.rulesMatchingEntity`, as these will make sure to account
 * for unnormalized entity types.
 */
class ListRuleCache {
    /**
     * Glob rules always have to be scanned against every entity.
     */
    private readonly globRules: Map<string/** The entity that the rules specify */, ListRule[]> = new Map();
    /**
     * This table allows us to skip matching an entity against every literal.
     */
    private readonly literalRules: Map<string/* the string literal */, ListRule[]/* the rules matching this literal */> = new Map();
    private readonly listUpdateListener: ((list: PolicyList, changes: ListRuleChange[]) => void);

    constructor(
        /**
         * The entity type that this cache is for e.g. RULE_USER.
         */
        public readonly entityType: EntityType,
        /**
         * The recommendation that this cache is for e.g. m.ban (RECOMMENDATION_BAN).
         */
        public readonly recommendation: Recommendation,
    ) {
        this.listUpdateListener = (list: PolicyList, changes: ListRuleChange[]) => this.updateCache(changes);
    }

    /**
     * Test the entitiy for the first matching rule out of all the watched lists.
     * @param entity e.g. an mxid for a user, the server name for a server.
     * @returns A single `ListRule` matching the entity.
     */
    public getAnyRuleForEntity(entity: string): ListRule|null {
        const literalRule = this.literalRules.get(entity);
        if (literalRule !== undefined) {
            return literalRule[0];
        }
        for (const rule of this.globRules.values()) {
            if (rule[0].isMatch(entity)) {
                return rule[0];
            }
        }
        return null;
    }

    /**
     * Watch a list and add all its rules (and future rules) to the cache.
     * Will automatically update with the list.
     * @param list A PolicyList.
     */
    public watchList(list: PolicyList): void {
        list.on('PolicyList.update', this.listUpdateListener);
        const rules = list.rulesOfKind(this.entityType, this.recommendation);
        rules.forEach(this.internRule, this);
    }

    /**
     * Unwatch a list and remove all of its rules from the cache.
     * Will stop updating the cache from this list.
     * @param list A PolicyList.
     */
    public unwatchList(list: PolicyList): void {
        list.removeListener('PolicyList.update', this.listUpdateListener);
        const rules = list.rulesOfKind(this.entityType, this.recommendation);
        rules.forEach(this.uninternRule, this);
    }

    /**
     * @returns True when there are no rules in the cache.
     */
    public isEmpty(): boolean {
        return this.globRules.size + this.literalRules.size === 0;
    }

    /**
     * Returns all the rules in the cache, without duplicates from different lists.
     */
    public get allRules(): ListRule[] {
        return [...this.literalRules.values(), ...this.globRules.values()].map(rules => rules[0]);
    }

    /**
     * Remove a rule from the cache as it is now invalid. e.g. it was removed from a policy list.
     * @param rule The rule to remove.
     */
    private uninternRule(rule: ListRule) {
        /**
         * Remove a rule from the map, there may be rules from different lists in the cache.
         * We don't want to invalidate those.
         * @param map A map of entities to rules.
         */
        const removeRuleFromMap = (map: Map<string, ListRule[]>) => {
            const entry = map.get(rule.entity);
            if (entry !== undefined) {
                const newEntry = entry.filter(internedRule => internedRule.sourceEvent.event_id !== rule.sourceEvent.event_id);
                if (newEntry.length === 0) {
                    map.delete(rule.entity);
                } else {
                    map.set(rule.entity, newEntry);
                }
            }
        };
        if (rule.isGlob()) {
            removeRuleFromMap(this.globRules);
        } else {
            removeRuleFromMap(this.literalRules);
        }
    }

    /**
     * Add a rule to the cache e.g. it was added to a policy list.
     * @param rule The rule to add.
     */
    private internRule(rule: ListRule) {
        /**
         * Add a rule to the map, there might be duplicates of this rule in other lists.
         * @param map A map of entities to rules.
         */
        const addRuleToMap = (map: Map<string, ListRule[]>) => {
            const entry = map.get(rule.entity);
            if (entry !== undefined) {
                entry.push(rule);
            } else {
                map.set(rule.entity, [rule]);
            }
        }
        if (rule.isGlob()) {
            addRuleToMap(this.globRules);
        } else {
            addRuleToMap(this.literalRules);
        }
    }

    /**
     * Update the cache for a single `ListRuleChange`.
     * @param change The change made to a rule that was present in the policy list.
     */
    private updateCacheForChange(change: ListRuleChange): void {
        if (change.rule.kind !== this.entityType || change.rule.recommendation !== this.recommendation) {
            return;
        }
        switch (change.changeType) {
            case ChangeType.Added:
            case ChangeType.Modified:
                this.internRule(change.rule);
                break;
            case ChangeType.Removed:
                this.uninternRule(change.rule);
                break;
            default:
                throw new TypeError(`Uknown ListRule change type: ${change.changeType}`);
        }
    }

    /**
     * Update the cache for a change in a policy list.
     * @param changes The changes that were made to list rules since the last update to this policy list.
     */
    private updateCache(changes: ListRuleChange[]) {
        changes.forEach(this.updateCacheForChange, this);
    }
}

export enum Access {
    /// The entity was explicitly banned by a policy list.
    Banned,
    /// The entity did not match any allow rule.
    NotAllowed,
    /// The user was allowed and didn't match any ban.
    Allowed,
}

/**
 * A description of the access an entity has.
 * If the access is `Banned`, then a single rule that bans the entity will be included.
 */
export interface EntityAccess {
    readonly outcome: Access,
    readonly rule?: ListRule,
}

/**
 * This allows us to work out the access an entity has to some thing based on a set of watched/unwatched lists.
 */
export default class AccessControlUnit {
    private readonly userBans = new ListRuleCache(RULE_USER, Recommendation.Ban);
    private readonly serverBans = new ListRuleCache(RULE_SERVER, Recommendation.Ban);
    private readonly userAllows = new ListRuleCache(RULE_USER, Recommendation.Allow);
    private readonly serverAllows = new ListRuleCache(RULE_SERVER, Recommendation.Allow);
    private readonly caches = [this.userBans, this.serverBans, this.userAllows, this.serverAllows]

    constructor(policyLists: PolicyList[]) {
        policyLists.forEach(this.watchList, this);
    }

    public watchList(list: PolicyList) {
        for (const cache of this.caches) {
            cache.watchList(list);
        }
    }

    public unwatchList(list: PolicyList) {
        for (const cache of this.caches) {
            cache.watchList(list);
        }
    }

    /**
     * Test whether the server is allowed by the ACL unit.
     * @param domain The server name to test.
     * @returns A description of the access that the server has.
     */
    public getAccessForServer(domain: string): EntityAccess {
        return this.getAccessForEntity(domain, this.serverAllows, this.serverBans);
    }

    /**
     * Get the level of access the user has for the ACL unit.
     * @param mxid The user id to test.
     * @param policy Whether to check the server part of the user id against server rules.
     * @returns A description of the access that the user has.
     */
    public getAccessForUser(mxid: string, policy: "CHECK_SERVER" | "IGNORE_SERVER"): EntityAccess {
        const userAccess = this.getAccessForEntity(mxid, this.userAllows, this.userBans);
        if (userAccess.outcome === Access.Allowed) {
            if (policy === "IGNORE_SERVER") {
                return userAccess;
            } else {
                const userId = new UserID(mxid);
                return this.getAccessForServer(userId.domain);
            }
        } else {
            return userAccess;
        }
    }

    private getAccessForEntity(entity: string, allowCache: ListRuleCache, bannedCache: ListRuleCache): EntityAccess {
        // Check if the entity is explicitly allowed.
        // We have to infer that a rule exists for '*' if the allowCache is empty, otherwise you brick the ACL.
        const allowRule = allowCache.getAnyRuleForEntity(entity);
        if (allowRule === null && !allowCache.isEmpty()) {
            return { outcome: Access.NotAllowed }
        }
        // Now check if the entity is banned.
        const banRule = bannedCache.getAnyRuleForEntity(entity);
        if (banRule !== null) {
            return { outcome: Access.Banned, rule: banRule };
        }
        // If they got to this point, they're allowed!!
        return { outcome: Access.Allowed };
    }

    /**
     * Create a ServerAcl instance from the rules contained in this unit.
     * @param serverName The name of the server that you are operating from, used to ensure you cannot brick yourself.
     * @returns A new `ServerAcl` instance with deny and allow entries created from the rules in this unit.
     */
    public compileServerAcl(serverName: string): ServerAcl {
        const acl = new ServerAcl(serverName).denyIpAddresses();
        const allowedServers = this.serverAllows.allRules;
        // Allowed servers (allow).
        if (allowedServers.length === 0) {
            acl.allowServer('*');
        } else {
            for (const rule of allowedServers) {
                acl.allowServer(rule.entity);
            }
            if (this.getAccessForServer(serverName).outcome === Access.NotAllowed) {
                acl.allowServer(serverName);
                LogService.warn('AccessControlUnit', `The server ${serverName} we are operating from was not on the allowed when constructing the server ACL, so it will be injected it into the server acl. Please check the ACL lists.`)
            }
        }
        // Banned servers (deny).
        for (const rule of this.serverBans.allRules) {
            if (rule.isMatch(serverName)) {
                LogService.warn('AccessControlUnit', `The server ${serverName} we are operating from was found to be banned by ${rule.entity} by a rule from the event: ${rule.sourceEvent.event_id}, `
                    + 'while constructing a server acl. Ignoring the rule. Please check the ACL lists.'
                );
            } else {
                acl.denyServer(rule.entity);
            }
        }
        return acl;
    }
}
