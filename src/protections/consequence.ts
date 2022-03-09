
/*
 * Distinct individual actions that can be caused as a result of detected abuse
 */
export enum ConsequenceType {
    // effectively a no-op. just tell the management room
    alert,
    // redact the event that triggered this consequence
    redact,
    // ban the user that sent the event that triggered this consequence
    ban
}

export class Consequence {
    /*
     * Action to take upon detection of abuse and an optional explanation of the detection
     *
     * @param type Action to take
     * @param reason Brief explanation of why we're taking an action, printed to management room.
     *  this will be HTML escaped before printing, just in case it has user-provided data
     */
    constructor(public readonly type: ConsequenceType, public readonly reason?: string) {}
}
