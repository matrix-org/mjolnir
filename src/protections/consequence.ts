
export class Consequence {
    public alert: boolean;
    public ban: boolean;
    public redact: boolean;
    public reason?: string;

    /*
     * Action to take upon detection of abuse and an optional explanation of the detection
     *
     * @param alert Whether this Consequence should create an alert
     * @param ban Whether this Consequence should create a ban
     * @param redact Whether this Consequence should create a redaction
     * @param reason Brief explanation of why we're taking an action, printed to management room.
     *  this will be HTML escaped before printing, just in case it has user-provided data
     */
    constructor({ alert = false, ban = false, redact = false, reason }: {
        alert?: boolean,
        ban?: boolean,
        redact?: boolean,
        reason?: string,
    }) {
        this.alert = alert;
        this.ban = ban;
        this.redact = redact;
        this.reason = reason;
    }
}
