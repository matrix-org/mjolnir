export class Consequence {
    /*
     * A requested action to take against a user after detected abuse
     *
     * @param name The name of the consequence being requested
     * @param reason Brief explanation of why we're taking an action, printed to management room.
     *  this will be HTML escaped before printing, just in case it has user-provided data
     */
    constructor(public name: string, public reason: string) { }
}

export class ConsequenceAlert extends Consequence {
    /*
     * Request an alert to be created after detected abuse
     *
     * @param reason Brief explanation of why we're taking an action, printed to management room.
     *  this will be HTML escaped before printing, just in case it has user-provided data
     */
    constructor(reason: string) {
        super("alert", reason);
    }
}
export class ConsequenceRedact extends Consequence {
    /*
     * Request a message redaction after detected abuse
     *
     * @param reason Brief explanation of why we're taking an action, printed to management room.
     *  this will be HTML escaped before printing, just in case it has user-provided data
     */
    constructor(reason: string) {
        super("redact", reason);
    }
}
export class ConsequenceBan extends Consequence {
    /*
     * Request a ban after detected abuse
     *
     * @param reason Brief explanation of why we're taking an action, printed to management room.
     *  this will be HTML escaped before printing, just in case it has user-provided data
     */
    constructor(reason: string) {
        super("ban", reason);
    }
}
