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
enum CheckEventForSpamContext {
    /// The full user id of the sender.
    sender_user_id,

    /// The domain of the sender.
    sender_domain,

    /// The room id.
    room_id,

    /// If the message contains a text, the content of the text.
    maybe_message_text,
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