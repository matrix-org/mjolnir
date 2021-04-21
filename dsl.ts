/**
 * A format of messages designed to allow communication with a configurable
 * spamchecker designed around the Synapse Spamcheck API.
 * 
 * - We call an implementation of the Synapse Spamcheck API that supports this
 *   protocol a *Checker*.
 * - The Checker is configured to receive instructions in a set of rooms
 *   Room1, Room2, ... RoomN. This set of rooms does not change during the
 *   lifetime of the Checker.
 * - Any member of Room1, ..., RoomN with authorization to send messages
 *   (aka a *Controller*) can send instructions to the Checker. We expect
 *   that the Controller will be an implementation of Mjölnir or Carlotta.
 *
 * A the time of this writing, the Checker supports only simple rules.
 * 
 * - A number of string properties are exposed to rules.
 * - A rule is a string property and a literal/regexp.
 * - During execution, if the regexp appears in the value of the string
 *    property, the message/user account creation request is rejected.
 * - Otherwise, it is accepted.
 */

/**
 * ------------------- Messages from controller ----------------------
 */

type MessageFromControllerContent = {
    type: "org.matrix.spamcheck.control",
    content:
    /// Update matchers on a single property.
    StringRuleUpdate | ObjectRuleUpdate
    /// Reset the Checker to remove all rules.
    | ClearEverything
    /// Request a snapshot of the current list of rules from the Checker.
    | ShowMeTheseRules
};

/**
 * ---------------- Properties that the Checker can match against -------
 */

enum StringProperty {
    /// The following properties point to strings.
    "org.matrix.spamcheck.user_may_invite.inviter_user_id",
    "org.matrix.spamcheck.user_may_invite.new_member_user_id",
    "org.matrix.spamcheck.user_may_invite.room_id",
    "org.matrix.spamcheck.user_may_create_room.user_id",
    "org.matrix.spamcheck.user_may_create_room_alias.user_id",
    "org.matrix.spamcheck.user_may_create_room_alias.desired_alias",
    "org.matrix.spamcheck.user_may_publish_room.publisher_user_id",
    "org.matrix.spamcheck.user_may_publish_room.room_id",
    "org.matrix.spamcheck.check_username_for_spam.user_id",
    "org.matrix.spamcheck.check_username_for_spam.display_name",
    "org.matrix.spamcheck.check_username_for_spam.avatar_url",
    "org.matrix.spamcheck.check_registration_for_spam_deny.maybe_user_name",
    "org.matrix.spamcheck.check_registration_for_spam_deny.maybe_email",
    "org.matrix.spamcheck.check_registration_for_spam_deny.user_agent",
    "org.matrix.spamcheck.check_registration_for_spam_deny.ip",
    "org.matrix.spamcheck.check_registration_for_spam_deny.maybe_auth_provider_id",
    "org.matrix.spamcheck.check_registration_for_spam_shadowban.maybe_user_name",
    "org.matrix.spamcheck.check_registration_for_spam_shadowban.maybe_email",
    "org.matrix.spamcheck.check_registration_for_spam_shadowban.user_agent",
    "org.matrix.spamcheck.check_registration_for_spam_shadowban.ip",
    "org.matrix.spamcheck.check_registration_for_spam_shadowban.maybe_auth_provider_id",
}

enum ObjectProperty {
    /// The following properties point to objects.
    "org.matrix.spamcheck.check_event_for_spam.event",
}

/**
 * ---------------- Checker Matching primitives  -------
 */

type Matcher =
    /// Matching against a literal string.
    ///
    /// If the string property contains this literal string, the rule **matches**
    /// i.e. the spamcheck will **reject** the operation. Matches are case-insensitive.
    ///
    /// # Example
    ///
    /// If literal `hailhydra` is a matcher for string property
    /// `org.matrix.spamcheck.check_registration_for_spam_deny.maybe_user_name`,
    ///  user won't be able to register an account with the name 'hailHydra'.
    { literal: string }

    /// Matching against a regexp.
    ///
    /// If the string property is matched by this regexp, the rule **matches**
    /// i.e. the spamcheck will **reject** the operation. Matches are case-insensitive.
    ///
    /// # Example
    ///
    /// If regexp `h[ae]il.*hydra` is a matcher for string property
    /// `org.matrix.spamcheck.check_registration_for_spam_deny.maybe_user_name`,
    /// user won't be able to register an account with the name 'hEil hYdra'.
    | { regexp: string }

/**
 * ------------------- Snapshot of rules ----------------------
 */

/**
 * The current matchers on a property that points to an object.
 */
type StringPropertyMatchers = {
    property: StringProperty,
    matchers: Matcher[],
}

/**
 * The current matchers on a property that points to an object.
 */
type ObjectPropertyMatchers = {
    property: ObjectProperty,
    matchers: {
        [path: string]: Matcher[]
    },
}

/**
 * A list of rules we wish to see.
 */
type RuleToShow =
    /// All the matchers for a StringProperty.
    StringProperty
    /// All the matchers for a single path in a ObjectProperty.
    | {
        property: ObjectProperty,
        path: string
    }
    /// All the matchers for all the paths in an ObjectProperty.
    | ObjectProperty;

/**
 * Show current rules.
 */
type ShowMeTheseRules = {
    "org.matrix.spamcheck.action": "snapshot",

    /// The list of rules to show:
    ///
    /// `*` for all rules
    property: RuleToShow[] | "*";
}

/**
 * A message with a snapshot of rules, as requested per `ShowMeTheseRules`.
 */
type RuleSnapshotMessage = {
    type: "org.matrix.spamcheck.snapshot",
    content: {
        dump: (StringPropertyMatchers | ObjectPropertyMatchers)[]
    }
}


const MESSAGE_RULE_DUMP_TYPE = "org.matrix.spamcheck.dump";
/**
 * ------------------- Updating rules ----------------------
 */

/// A list of additions/removal.
///
/// Resolved in the following order:
///
/// 1. remove;
/// 2. add;
type Patch = {
    /// Remove some or all items.
    remove?: "org.matrix.spamcheck.clear" | Matcher[],

    /// Add items.
    add?: Matcher[],
}


/**
 * An update to a single rule, for a property that points to a string.
 */
type StringRuleUpdate = {
    "org.matrix.spamcheck.action": "update",

    /// The property affected by this rule change.
    property: StringProperty,

    /// Matchers to add/remove.
    patch: Patch,
}

/**
 * An update to a single rule, for a property that points to an object.
 */
type ObjectRuleUpdate = {
    "org.matrix.spamcheck.action": "update",

    /// The property affected by this rule change.
    ///
    /// This property points to an object `o`.
    property: ObjectProperty,

    /// The path to follow within object `o` to access
    /// a string value.
    ///
    /// If the path is not defined or the value is not
    /// a string, the message is considered a non-match,
    /// i.e. it can pass.
    path: string,

    /// Matchers to add/remove.
    patch: Patch,
}


/**
 * Remove all the rules.
 */
type ClearEverything = {
    "org.matrix.spamcheck.action": "clear",
}
