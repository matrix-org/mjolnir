/**
 * An elementary antispam rule, used to match a single value against a
 * regexp (or an equivalent but more optimized substring search).
 * 
 * The rule will **reject** (i.e. consider as spam) if either `substrings`
 * or `regexp` matches the value.
 *
 * The rule will **accept** (i.e. let pass) otherwise.
 *
 * Note that this rule is typically obtained by or-ing several rules
 * on the ruleserver side.
 */
type Matcher = {
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
 * An antispam rule for `user_may_invite`.
 */
type InviteRules = {
    /// The full user id of the inviter.
    inviter_user_id: Matcher,

    /// The full user id if the potential new room member.
    new_member_user_id: Matcher,

    /// The room id.
    room_id: Matcher,
};

/**
 * An antispam rule for `user_may_create_room`.
 */
type RoomCreateRules = {
    /// The full user id of the room creator.
    user_id: Matcher,
};

/**
 * An antispam rule for `user_may_create_room_alias`.
 */
type AliasCreateRules = {
    /// The full user id of the alias creator.
    user_id: Matcher,

    /// The human-readable alias.
    desired_alias: Matcher,
};

/**
 * An antispam rule for `user_may_publish_room`.
 */
type PublishRoomRules = {
    /// The full user id of the publisher.
    publisher_user_id: Matcher,

    /// The room id.
    room_id: Matcher,
};

/**
 * An antispam rule for `check_username_for_spam`.
 */
type CheckUsernameForSpamRules = {
    /// The full user id of the user.
    user_id: Matcher,

    /// The display name of the user.
    display_name: Matcher,

    /// The URL towards the avatar of the user.
    avatar_url: Matcher,
};

/**
 * An antispam rule for `check_registration_for_spam`.
 */
type CheckRegistrationForSpamRules = {
    /// The username, if available.
    maybe_user_name: Matcher,

    /// The email used for registration, if available.
    maybe_email: Matcher,

    /// The list of user agents used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// user agents matches the rule.
    user_agent: Matcher,

    /// The list of IPs used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// IPs matches the rule.
    ip: Matcher,

    /// The auth provider, if available, e.g. "oidc", "saml", ...
    maybe_auth_provider_id: Matcher
};

/**
 * An antispam rule for `check_event_for_spam`.
 */
type CheckEventForSpamRules = {
    /// A path of fields within the event object.
    ///
    /// e.g. `"content.formatted_body"` will return `event.content.formatted_body`.
    ///
    /// If any of the fields is not present, the rule will **not** match (i.e. the
    /// message will not be considered spam).
    event: { [path: string]: Matcher },
};

/**
 * The complete list of rules for an instance of the spam-checker.
 */
type RuleSet = {
    /// If the rules match, user cannot invite other user.
    user_may_invite: InviteRules,

    /// If the rules match, user cannot create room.
    user_may_create_room: RoomCreateRules,

    /// If the rules match, user cannot create an alias for the room.
    user_may_create_room_alias: AliasCreateRules,

    /// If the rules match, user cannot make the room public.
    user_may_publish_room: PublishRoomRules,

    /// If the rules match, register user and immediately shadowban them.
    check_registration_for_spam_shadowban: CheckRegistrationForSpamRules,

    /// If the rules of `check_registration_for_spam_shadowban` do NOT
    /// match but these rules match, deny registration.
    check_registration_for_spam_deny: CheckRegistrationForSpamRules,

    /// If the rules match, deny registration, regardless of
    /// the result of `check_registration_for_spam_shadowban`
    /// and `check_registration_for_spam_deny`.
    check_username_for_spam: CheckUsernameForSpamRules,

    /// If the rules match, event will bounce.
    check_event_for_spam: CheckEventForSpamRules,
};
