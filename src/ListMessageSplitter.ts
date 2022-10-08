/*
    The list splitter is meant to help with large itemized messages (such as a ban list),
    which each have "headers" (bits of text that introduce the list).

    The behaviour is such that one pumps items and headers one-by-one into ListMessageSplitter,
    which then splits them internally to accomodate maximum matrix event sizes, and renders them simultaniously.

    As such, a workflow with ListMessageSplitter would look something like this;

    ```js
    let splitter = new ListMessageSplitter();

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

import {LogService, MatrixClient, RichReply} from "matrix-bot-sdk";

// Helper type for html + text tuples.
export type MessageSnippet = { html: string, text: string };

// The max size a message can be, with 24_000 picked at random to accommodate for overhead.
//
// Note: This amount was checked through trial and error, a conservative estimate would be
// 65_536 / 2, though this author does not know overhead estimates of matrix E2EE.
const OVERHEAD = 24_000
const MAX_SIZE = 65_536 - OVERHEAD;

// The extra bits that a <ul> tag wrapping would add to a message
const UL_TAG_WRAP_SIZE = "<ul></ul>".length;
// The extra bits that a <il> list tag wrapping would add to a message
const HTML_LIST_ITEM_EXTRA_SIZE = "<li></li>".length;
// The extra bits that listification of plaintext items would add to a message.
const TEXT_LIST_ITEM_EXTRA_SIZE = " * \n".length;

// An "Item" object to push into the list splitter.
export class MessageListItem {
    public readonly html: string;
    public readonly text: string;

    constructor(
        html: string,
        text: string,
    ) {
        if (html.length > (MAX_SIZE / 2)) {
            throw new Error("HTML string too long for one item")
        } else if (text.length > (MAX_SIZE / 2)) {
            throw new Error("text string too long for one item")
        }
        this.html = html;
        this.text = text;
    }

    public size(): number {
        return this.html.length + HTML_LIST_ITEM_EXTRA_SIZE
            + this.text.length + TEXT_LIST_ITEM_EXTRA_SIZE
    }
}

// A "header" object to push into the list splitter.
export class MessageListHeader extends MessageListItem {
    public size(): number {
        return this.html.length + this.text.length
    }
}

// An internal helper class to hold a series of items, together with an optional header.
//
// Mainly provides a coherent split_at_size function that would allow for on-demand-sized splitting of
// listings with headers.
class MessageListing {
    public items: MessageListItem[] = [];

    constructor(public header: MessageListHeader | null) {
    }

    // Attempts to split this listing into a `sized` and `rest` listing.
    //
    // Returns:
    // `sized` != null, if sized was adequate, or had to be split
    // `rest` != null, if sized was not adequate (and had to be split),
    //   or the first item is too big to be split at the desired size.
    public split_at_size(desired_size: number): {sized: MessageListing | null, rest: MessageListing | null} {
        if (this.size() <= desired_size) {
            // If the current listing is under the desired size, just return it, rest = null.
            return {sized: this, rest: null};
        } else {
            // Else, split it.

            // Create a new listing with just the current header,
            // as a candidate for the new sized listing.
            let sized = new MessageListing(this.header);
            if (sized.size() > desired_size) {
                // If the header alone is too much, just give up.
                return {sized: null, rest: this}
            }

            // Create another listing, and dump the rest of all items in there.
            let rest = new MessageListing(null);
            // Be sure to shallow copy, to not disturb the `this` listing.
            rest.items = [...this.items];

            // Perform initial shift of item into a variable.
            let current_item = rest.items.shift();

            // Keep looping while there are still items left.
            // (Replaced at the end of the loop)
            while (current_item !== undefined) {
                // Add the new item to `sized` tentatively.
                sized.items.push(current_item);

                if (sized.size() > desired_size) {
                    // If we went over the limit, return the last item and return the results
                    rest.items.unshift(sized.items.pop()!)

                    if (sized.items.length > 0) {
                        return {sized, rest};
                    } else {
                        // If this was the first item, `sized` is empty, return null.
                        return {sized: null, rest}
                    }
                }

                current_item = rest.items.shift();
            }

            // ??? We somehow did not go over the size limit when testing it per item?
            // This is a weird state, as we should have already caught this with the
            // `this.size() <= desired_size` conditional.
            LogService.warn("ListMessageSplitter", `encountered end of while loop, required max ${desired_size} size, current item is ${sized.size()}`)

            return {sized, rest: null}
        }
    }

    public size(): number {
        let with_header = this.header !== null ? this.header.size() + "\n".length + "<br>".length : 0;

        return with_header
            + (this.items.length > 0 ? UL_TAG_WRAP_SIZE : 0)
            + this.items.reduce((prev, curr, _idx, _arr) => prev + curr.size(), 0);
    }

    // Render this listing into a messagesnippet.
    public render(): MessageSnippet {
        let current: MessageSnippet = {
            html: "",
            text: ""
        };

        for (let item of this.items) {
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

// A class that allows splitting items and headers into multiple messages.
export class ListMessageSplitter {
    private items: (MessageListItem | MessageListHeader)[] = [];

    constructor() {
    }

    public add_header(html: string, text: string) {
        this.add(new MessageListHeader(html, text))
    }

    public add_paragraph(html: string, text: string) {
        this.add(new MessageListItem(html, text))
    }

    public add(paragraph: MessageListItem | MessageListHeader) {
        this.items.push(paragraph)
    }

    // Convert this.items into listings.
    private get_listings(): MessageListing[] {
        let current_listings: MessageListing[] = [];
        let current_listing = new MessageListing(null);

        for (let item of this.items) {
            if (item instanceof MessageListHeader) {
                if (current_listing.header !== null) {
                    current_listings.push(current_listing);

                    current_listing = new MessageListing(item);
                } else {
                    current_listing.header = item;
                }
            } else {
                current_listing.items.push(item);
            }
        }

        current_listings.push(current_listing);

        return current_listings;
    }

    // Split the listings until they do not hit MAX_SIZE anymore.
    private split_listings(listings: MessageListing[]): MessageListing[][] {
        let result: MessageListing[][] = [];

        let current: MessageListing[] = [];
        let current_size = 0;

        let listing: MessageListing | null;
        for (listing of listings) {
            while (listing !== null) {
                let { sized, rest } = listing.split_at_size(MAX_SIZE - current_size);

                if (sized !== null) {
                    current.push(sized);
                    current_size += sized.size()
                } else {
                    result.push(current);
                    current = [];
                    current_size = 0;
                }

                listing = rest;
            }
        }

        result.push(current);

        return result;
    }

    public render(): MessageSnippet[] {
        let rendered: MessageSnippet[] = [];

        let listings = this.get_listings();
        let chunks = this.split_listings(listings);

        for (let chunk of chunks) {
            let current: MessageSnippet = {
                html: "",
                text: "",
            }

            for (let listing of chunk) {
                let {html, text} = listing.render();
                current.html += html;
                current.text += text;
            }

            rendered.push(current)
        }

        return rendered;
    }

    public async reply(client: MatrixClient, roomId: string, toEvent: any, m_notice: boolean) {
        let rendered = this.render();
        let first = rendered.shift()!;

        const reply = RichReply.createFor(roomId, toEvent, first.text, first.html);
        if (m_notice)
            reply["msgtype"] = "m.notice";

        await client.sendMessage(roomId, reply);

        for (const message of rendered) {
            await client.sendMessage(roomId, {
                msgtype: m_notice ? "m.notice" : "m.text",
                body: message.text,
                format: "org.matrix.custom.html",
                formatted_body: message.html,
            });
        }
    }
}
