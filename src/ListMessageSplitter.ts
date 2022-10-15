/**
    The list splitter is meant to help with large itemized messages (such as a ban list),
    which each have "headers" (bits of text that introduce the list).

    The behaviour is such that one pumps items and headers one-by-one into ListMessageSplitter,
    which then splits them internally to accomodate maximum matrix event sizes, and renders them simultaniously.

    As such, a workflow with ListMessageSplitter would look something like this;

    ```js
    const splitter = new ListMessageSplitter();

    // Start a new list, input both html and text versions of the header.
    splitter.add_header("<b>Rules currently in use:</b>", "Rules currently in use:");

    for (rule of this.rules) {
      // Add a new "paragraph", an item, se string templates here for each item.
      splitter.add_paragraph(
        `rule <code>#${rule.number}</code>: ${rule.text()}`,
        `rule #${rule.number}: ${rule.text()}`
      )
    }

    if (this.rules.length === 0) {
        splitter.add_paragraph(
            "No rules configured",
            "No rules configured"
        )
    }

    // Add another header, start a new list in the same message.
    splitter.add_header("<b>Servers currently observed:</b>", "Servers currently observed:");

    for (server of this.servers) {
      splitter.add_paragraph(
        `server ${server.name()}`,
        `server ${server.name()}`
      )
    }

    if (this.servers.length === 0) {
        splitter.add_paragraph(
            "No servers observed",
            "No servers observed"
        )
    }

    // Reply to an event with the whole deal, splitting into multiple messages as needed.
    splitter.reply(mjolnir.client, roomId, event, true)
    ```
*/

import {MatrixClient, RichReply} from "matrix-bot-sdk";

// Helper type for html + text tuples.
export type MessageSnippet = { html: string, text: string };

// The max size a message can be, with 24_000 picked at random to accommodate for overhead.

// Note: This amount was checked through trial and error, a conservative estimate would be
// 65_536 / 2, though this author does not know overhead estimates of matrix E2EE.

// The overhead from E2EE.
export const OVERHEAD = 24_000
// The max size a message can be.
export const MAX_SIZE = 65_536 - OVERHEAD;

// The extra bits that a <ul> tag wrapping would add to a message
const UL_TAG_WRAP_SIZE = "<ul></ul>".length;
// The extra bits that a <il> list tag wrapping would add to a message
const HTML_LIST_ITEM_EXTRA_SIZE = "<li></li>".length;
// The extra bits that listification of plaintext items would add to a message.
const TEXT_LIST_ITEM_EXTRA_SIZE = " * \n".length;

/**
 * An "Item" object to push into the list splitter.
 *
 * Note: `html` and `text` must collectively not exceed MAX_SIZE.
 */
export class MessageListItem {
    public readonly html: string;
    public readonly text: string;

    constructor(
        html: string,
        text: string,
    ) {
        if ((html.length + text.length) > MAX_SIZE)
            throw new Error("HTML + text string size too large for one item")
        this.html = html;
        this.text = text;
    }

    /**
     * The total size of this list item, were it to be rendered.
     */
    public size(): number {
        return this.html.length + HTML_LIST_ITEM_EXTRA_SIZE
            + this.text.length + TEXT_LIST_ITEM_EXTRA_SIZE
    }
}

/**
 * A "header" object to push into the list splitter.
 */
export class MessageListHeader extends MessageListItem {
    public size(): number {
        return this.html.length + this.text.length
    }
}

/**
 * An internal helper class to hold a series of items, together with an optional header.
 *
 * Mainly provides a coherent split_at_size function that would allow for on-demand-sized splitting of
 * listings with headers.
 */
class MessageListing {
    public items: MessageListItem[] = [];

    constructor(public readonly header: MessageListHeader | null) {
    }

    /**
     * Attempts to split this listing into a `sized` and `rest` listing.
     *
     * @param desiredSize The desired max size to try to fit this listing in.
     * @returns "sized" and "rest".
     *
     *  "sized" will be non-null either if the current listing fits entirely within the desired size,
     *  or if it could be split to a desired size. Non-null "sized" is always within the desired size.
     *
     *  "rest" will be non-null with either the "rest" of the listing (after sized has been split),
     *  or a copy of the current listing (if sized couldn't be made fit to the desired size).
     */
    public splitAtSize(desiredSize: number): {sized: MessageListing | null, rest: MessageListing | null} {
        if (this.size() <= desiredSize) {
            // If the current listing is under the desired size, just return it, rest = null.
            return {sized: this, rest: null};
        } else {
            // Else, split it.

            // Create a new listing with just the current header,
            // as a candidate for the new sized listing.
            const sized = new MessageListing(this.header);
            if (sized.size() > desiredSize) {
                // If the header alone is too much, just give up.
                return {sized: null, rest: this}
            }

            // Create another listing, and dump the rest of all items in there.
            const rest = new MessageListing(null);
            // Be sure to shallow copy, to not disturb the `this` listing.
            rest.items = [...this.items];

            // Perform initial shift of item into a variable.
            let currentItem = rest.items.shift();

            // Keep looping while there are still items left.
            // (Replaced at the end of the loop)
            while (currentItem !== undefined) {
                // Add the new item to `sized` tentatively.
                sized.items.push(currentItem);

                if (sized.size() > desiredSize) {
                    // If we went over the limit, return the last item and return the results
                    rest.items.unshift(sized.items.pop()!)

                    if (sized.items.length > 0) {
                        return {sized, rest};
                    } else {
                        // If this was the first item, `sized` is empty, return null.
                        return {sized: null, rest}
                    }
                }

                currentItem = rest.items.shift();
            }

            // ??? We somehow did not go over the size limit when testing it per item?
            // This is a weird state, as we should have already caught this with the
            // `this.size() <= desiredSize` conditional.

            // There is one situation where this can happen, and that is if this.items is empty.
            if (this.items.length !== 0)
                throw new Error(`Undefined state: encountered end of while loop while this.items is non-empty`)
            else
                return {sized, rest: null}
        }
    }

    /**
     * The complete size of this listing. (if it were to be rendered)
     */
    public size(): number {
        const withHeader = this.header !== null ? this.header.size() + "\n".length + "<br>".length : 0;

        return withHeader
            + (this.items.length > 0 ? UL_TAG_WRAP_SIZE : 0)
            + this.items.reduce((prev, curr) => prev + curr.size(), 0);
    }

    /**
     * Render this listing into a MessageSnippet.
     */
    public render(): MessageSnippet {
        const current: MessageSnippet = {
            html: "",
            text: ""
        };

        for (const item of this.items) {
            current.html += `<li>${item.html}</li>`
            current.text += ` * ${item.text}\n`
        }

        current.html = this.items.length > 0 ? `<ul>${current.html}</ul>` : "";

        if (this.header !== null) {
            current.html = this.header.html + "<br>".length + current.html;
            current.text = this.header.text + "\n" + current.text;
        }

        return current;
    }
}

/**
 * A class that allows splitting items and headers into multiple messages.
 */
export class ListMessageSplitter {
    private listings: MessageListing[] = [];

    constructor() {
    }

    /**
     * Add a header to start a listing with, to be followed up with paragraphs/items of text.
     *
     * @param html The HTML that the header consists of.
     * @param text The "fallback" text that the header consists of.
     */
    public addHeader(html: string, text: string) {
        this.add(new MessageListHeader(html, text))
    }

    /**
     * Add a paragraph of text to the current latest listing, this will be itemized.
     *
     * @param html The HTML that the paragraph consists of.
     * @param text The "fallback" text that the paragraph consists of.
     */
    public addParagraph(html: string, text: string) {
        this.add(new MessageListItem(html, text))
    }

    /**
     * Add a single "item" to the current listings.
     *
     * This method is not recommended for easy use, use addHeader or addParagraph instead.
     *
     * @param item The listing item to add, either a header or a list item.
     */
    public add(item: MessageListItem | MessageListHeader) {
        if (item instanceof MessageListHeader) {
            this.listings.push(new MessageListing(item))
        } else {
            if (this.listings.length === 0) {
                const listing = new MessageListing(null);
                listing.items.push(item);
                this.listings.push(listing);
            } else {
                this.listings[-1].items.push(item)
            }
        }
    }

    // Split the listings until they do not hit MAX_SIZE anymore.
    private splitListings(listings: MessageListing[]): MessageListing[][] {
        const result: MessageListing[][] = [];

        let current: MessageListing[] = [];
        let currentSize = 0;

        let listing: MessageListing | null;
        for (listing of listings) {
            while (listing !== null) {
                let { sized, rest } = listing.splitAtSize(MAX_SIZE - currentSize);

                if (sized !== null) {
                    current.push(sized);
                    currentSize += sized.size()
                } else {
                    result.push(current);
                    current = [];
                    currentSize = 0;
                }

                listing = rest;
            }
        }

        result.push(current);

        return result;
    }

    /**
     * Render the current listings inside the splitter into a series of message (html and text)
     * snippets to be posted to the room.
     */
    public render(): MessageSnippet[] {
        const rendered: MessageSnippet[] = [];

        const chunks = this.splitListings(this.listings);

        for (const chunk of chunks) {
            const current: MessageSnippet = {
                html: "",
                text: "",
            }

            for (const listing of chunk) {
                const {html, text} = listing.render();
                current.html += html;
                current.text += text;
            }

            rendered.push(current)
        }

        return rendered;
    }

    /**
     * Render the current listings, and reply to a message with the first message,
     * posting the following messages in the room as-is.
     *
     * @param client The matrix client with which to send these messages.
     * @param roomId The room to respond into.
     * @param toEvent The event to reply to.
     * @param mNotice Whether or not these messages should be m.notice or not.
     */
    public async reply(client: MatrixClient, roomId: string, toEvent: any, mNotice: boolean) {
        const rendered = this.render();
        const first = rendered.shift()!;

        const reply = RichReply.createFor(roomId, toEvent, first.text, first.html);
        if (mNotice)
            reply["msgtype"] = "m.notice";

        await client.sendMessage(roomId, reply);

        for (const message of rendered) {
            await client.sendMessage(roomId, {
                msgtype: mNotice ? "m.notice" : "m.text",
                body: message.text,
                format: "org.matrix.custom.html",
                formatted_body: message.html,
            });
        }
    }
}
