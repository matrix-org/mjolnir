

export enum ConsequenceType {
    alert,
    redact,
    ban
}

export class Consequence {
    /*
     * A description of an action to take when a protection detects abuse
     *
     * @param type Action to take
     * @param reason Brief explanation of why we're taking an action, printed to management room.
     *  this wil be HTML escaped before printing, just in case it has user-provided data
     */
    constructor(public readonly type: ConsequenceType, public readonly reason?: string) {}
}
