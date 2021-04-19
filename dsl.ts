/**
 * A format for sending spam-checker rules from a rule server to
 * a synapse spam-checker.
 * 
 * The intended use is that the spam-checker will regularly
 *
 * GET https://example.org/mjolnir/rules?since=timestamp
 *
 * And receive an update of the rules since timestamp.
 */

interface Literal {}
interface Regexp {}

/// A list of additions/removal.
///
/// Additions are resolved *after* removals.
///
/// Type parameter `T` is used as a phantom type to distinguish between
/// literal strings (`Literal`) or regexp strings (`Regexp`).
type Patch<T> = {
    /// Remove some or all items.
    remove?: "clear" | string[],

    /// Add items.
    add?: string[],
}

/**
 * An update to an elementary spam rule, attempting to match a single value
 * (e.g. a user_id) against a number of regexps.
 * 
 * The rule will **reject** (i.e. consider as spam) if the value **contains**
 * any of the regexps or literals.
 *
 * The rule will **accept** (i.e. let pass) otherwise.
 */
type Update = {
        /// Any number of literals to add/remove.
        ///
        /// Whenever possible, prefer literals to regexps, as they are both
        /// more faster and more memory-efficient.
        literals?: Patch<Literal>,

        /// Any number of regexps to add/remove.
        ///
        /// The regexps will be or-ed and compiled spamcheck-side.
        ///
        /// These regexps MUST follow the specs of https://docs.python.org/3/library/re.html .
        regexps?: Patch<Regexp>,
    };

/**
 * An antispam rule for `user_may_invite`.
 */
type InviteUpdates = {
    /// The full user id of the inviter.
    inviter_user_id: Update,

    /// The full user id if the potential new room member.
    new_member_user_id: Update,

    /// The room id.
    room_id: Update,
};

/**
 * An antispam rule for `user_may_create_room`.
 */
type RoomCreateUpdates = {
    /// The full user id of the room creator.
    user_id: Update,
};

/**
 * An antispam rule for `user_may_create_room_alias`.
 */
type AliasCreateUpdates = {
    /// The full user id of the alias creator.
    user_id: Update,

    /// The human-readable alias.
    desired_alias: Update,
};

/**
 * An antispam rule for `user_may_publish_room`.
 */
type PublishRoomUpdates = {
    /// The full user id of the publisher.
    publisher_user_id: Update,

    /// The room id.
    room_id: Update,
};

/**
 * An antispam rule for `check_username_for_spam`.
 */
type CheckUsernameForSpamUpdates = {
    /// The full user id of the user.
    user_id: Update,

    /// The display name of the user.
    display_name: Update,

    /// The URL towards the avatar of the user.
    avatar_url: Update,
};

/**
 * An antispam rule for `check_registration_for_spam`.
 */
type CheckRegistrationForSpamUpdates = {
    /// The username, if available.
    maybe_user_name: Update,

    /// The email used for registration, if available.
    maybe_email: Update,

    /// The list of user agents used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// user agents matches the rule.
    user_agent: Update,

    /// The list of IPs used during registration (possibly empty).
    /// A registration will be considered spammy if any of the
    /// IPs matches the rule.
    ip: Update,

    /// The auth provider, if available, e.g. "oidc", "saml", ...
    maybe_auth_provider_id: Update
};

/**
 * An antispam rule for `check_event_for_spam`.
 */
type CheckEventForSpamUpdates = {
    /// A path of fields within the event object.
    ///
    /// e.g. `"content.formatted_body"` will return `event.content.formatted_body`.
    ///
    /// If any of the fields is not present, the rule will **not** match (i.e. the
    /// message will not be considered spam).
    event: { [path: string]: Update },
};

/**
 * The complete list of rules for an instance of the spam-checker.
 */
type GlobalUpdate = {
    /// If the rules match, user cannot invite other user.
    user_may_invite?: InviteUpdates,

    /// If the rules match, user cannot create room.
    user_may_create_room?: RoomCreateUpdates,

    /// If the rules match, user cannot create an alias for the room.
    user_may_create_room_alias?: AliasCreateUpdates,

    /// If the rules match, user cannot make the room public.
    user_may_publish_room?: PublishRoomUpdates,

    /// If the rules match, register user and immediately shadowban them.
    check_registration_for_spam_shadowban?: CheckRegistrationForSpamUpdates,

    /// If the rules of `check_registration_for_spam_shadowban` do NOT
    /// match but these rules match, deny registration.
    check_registration_for_spam_deny?: CheckRegistrationForSpamUpdates,

    /// If the rules match, deny registration, regardless of
    /// the result of `check_registration_for_spam_shadowban`
    /// and `check_registration_for_spam_deny`.
    check_username_for_spam?: CheckUsernameForSpamUpdates,

    /// If the rules match, event will bounce.
    check_event_for_spam?: CheckEventForSpamUpdates,

    /// The instant of the latest update, in milliseconds since the Unix epoch.
    ///
    /// This value is meant to be passed as argument when requesting
    /// more recent update.
    latest_update_ts: number,
};
