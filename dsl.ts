/**
 * All the sources of information available to the antispam
 * when running `user_may_invite`.
 */
enum InviteContext {
    /// The full user id of the inviter.
    inviter_user_id,

    /// The domain of the inviter.
    inviter_user_domain,

    /// The full user id if the potential new room member.
    new_member_user_id,

    /// The domain of the potential new room member.
    new_member_user_domain,

    /// The room id.
    room_id,
};

/**
 * All the sources of information available to the antispam
 * when running `user_may_create_room`.
 */
enum RoomCreateContext {
    /// The full user id of the room creator.
    user_id,

    /// The domain of the room creator.
    user_domain,
};

/**
 * All the sources of information available to the antispam
 * when running `user_may_create_room_alias`.
 */
enum AliasCreateContext {
    /// The full user id of the alias creator.
    user_id,

    /// The domain of the alias creator.
    user_domain,

    /// The human-readable alias.
    desired_alias,
};

/**
 * All the sources of information available to the antispam
 * when running `user_may_publish_room`.
 */
enum PublishRoomContext {
    /// The full user id of the publisher.
    publisher_user_id,

    /// The domain of the publisher.
    publisher_domain,

    /// The room id.
    room_id,
};

/**
 * All the sources of information available to the antispam
 * when running `check_username_for_spam`.
 */
enum CheckUsernameForSpamContext {
    /// The full user id of the user.
    user_id,

    /// The domain of the user.
    user_domain,

    /// The display name of the user.
    display_name,

    /// The URL towards the avatar of the user.
    avatar_url,
};

/**
 * All the sources of information available to the antispam
 * when running `check_registration_for_spam`.
 */
enum CheckRegistrationForSpamContext {
    /// The username, if available.
    maybe_user_name,

    /// The email used for registration, if available.
    maybe_email,

    /// The list of user agents used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// user agents matches the regexp.
    user_agent_list,

    /// The list of IPs used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// IPs matches the regexp.
    ip_list,

    /// The auth provider, if available, e.g. "oidc", "saml", ...
    maybe_auth_provider_id
};

/**
 * All the sources of information available to the antispam
 * when running `check_event_for_spam`.
 */
type CheckEventForSpamContext =
    /// The full user id of the sender.
    "sender_user_id"

    /// The domain of the sender.
    | "sender_domain"

    /// The room id.
    | "room_id"

    | {
        /// A path of fields within the event object.
        ///
        /// e.g. `["content", "formatted_body"]` will return `event.content.formatted_body`.
        ///
        /// If any of the fields is not present, the rule will **not** match (i.e. the
        /// message will not be considered spam).
        path: string[]
    }
    ;

/**
 * A manner of matching strings.
 *
 * When possible, prefer `literal` as it is faster and more memory-efficient
 * than `regexp`.
 */
type Matcher =
    {
        /// The Python regexp against which to match a string value, as specced
        /// by https://docs.python.org/3/library/re.html
        regexp: string
    }
    | {
        /// A literal string against which to match a string value.
        literal: string
    };

/**
 * A rule served by the Rule Server.
 * 
 * `T` is one of `InviteContext`, `RoomCreateContext`, ...
 * 
 * The rule will **reject** (i.e. consider as spam) if `matcher` matches `value`.
 * The rule will **accept** (i.e. let pass) otherwise.
 */
type Rule<T> = {
    /// The value to match.
    value: T,

    /// The criteria to decide whether `value` is spam.
    matcher: Matcher,
};

/**
 * A batch of rules.
 */
type RuleSet = {
    user_may_invite: Rule<InviteContext>[],
    user_may_create_room: Rule<RoomCreateContext>[],
    user_may_create_room_alias: Rule<AliasCreateContext>[],
    user_may_publish_room: Rule<PublishRoomContext>[],
    check_username_for_spam: Rule<CheckUsernameForSpamContext>[],
    check_registration_for_spam: Rule<CheckRegistrationForSpamContext>[],
    check_event_for_spam: Rule<CheckEventForSpamContext>[],
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
