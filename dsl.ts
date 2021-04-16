/**
 * A antispam rule.
 * 
 * The rule will **reject** (i.e. consider as spam) if either `literals`
 * or `regexp` matches the value.
 *
 * The rule will **accept** (i.e. let pass) otherwise.
 *
 * Note that this rule is typically obtained by or-ing several rules
 * on the ruleserver side.
 */
type Rule = {
    /// The date of the latest update.
    ///
    /// Used to avoid needlessly recompiling rules on the spamchecker side,
    /// as this can be long and memory-expensive.
    latest_update: Date,

    /// Literal values.
    ///
    /// When reasonable, prefer one or several literal values to a regexp,
    /// as they can be compiled into a faster and more memory-efficient
    /// FSM than a general regexp.
    substrings: string[],

    /// A single Python regexp (typically obtained by or-ing numerous regexps),
    /// as specced by https://docs.python.org/3/library/re.html
    regexp: string | null,
};

/**
 * All the sources of information available to the antispam
 * when running `user_may_invite`.
 */
type InviteRules = {
    /// The full user id of the inviter.
    inviter_user_id: Rule,

    /// The full user id if the potential new room member.
    new_member_user_id: Rule,

    /// The room id.
    room_id: Rule,
};

/**
 * All the sources of information available to the antispam
 * when running `user_may_create_room`.
 */
type RoomCreateRules = {
    /// The full user id of the room creator.
    user_id: Rule,
};

/**
 * All the sources of information available to the antispam
 * when running `user_may_create_room_alias`.
 */
type AliasCreateRules = {
    /// The full user id of the alias creator.
    user_id: Rule,

    /// The human-readable alias.
    desired_alias: Rule,
};

/**
 * All the sources of information available to the antispam
 * when running `user_may_publish_room`.
 */
type PublishRoomRules = {
    /// The full user id of the publisher.
    publisher_user_id: Rule,

    /// The room id.
    room_id: Rule,
};

/**
 * All the sources of information available to the antispam
 * when running `check_username_for_spam`.
 */
type CheckUsernameForSpamRules = {
    /// The full user id of the user.
    user_id: Rule,

    /// The display name of the user.
    display_name: Rule,

    /// The URL towards the avatar of the user.
    avatar_url: Rule,
};

/**
 * All the sources of information available to the antispam
 * when running `check_registration_for_spam`.
 */
type CheckRegistrationForSpamRules = {
    /// The username, if available.
    maybe_user_name: Rule,

    /// The email used for registration, if available.
    maybe_email: Rule,

    /// The list of user agents used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// user agents matches the rule.
    user_agent_list: Rule,

    /// The list of IPs used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// IPs matches the rule.
    ip_list: Rule,

    /// The auth provider, if available, e.g. "oidc", "saml", ...
    maybe_auth_provider_id: Rule
};

/**
 * All the sources of information available to the antispam
 * when running `check_event_for_spam`.
 */
type CheckEventForSpamRules = {
    /// A path of fields within the event object.
    ///
    /// e.g. `"content.formatted_body"` will return `event.content.formatted_body`.
    ///
    /// If any of the fields is not present, the rule will **not** match (i.e. the
    /// message will not be considered spam).
    event: { [path: string]: Rule },
};

/**
 * A batch of rules.
 */
type RuleSet = {
    user_may_invite: InviteRules,
    user_may_create_room: RoomCreateRules,
    user_may_create_room_alias: AliasCreateRules,
    user_may_publish_room: PublishRoomRules,
    check_username_for_spam: CheckUsernameForSpamRules,
    check_registration_for_spam: CheckRegistrationForSpamRules,
    check_event_for_spam: CheckEventForSpamRules,
};

/**
 * An update sent by the rule server to the antispam.
 */
type Update = {
    /// A batch of rules to remove.
    ///
    /// Use special value `"*"` to clear out all rules.
    remove: RuleSet | "*",

    /// A batch of rules to add.
    add: RuleSet,
};
