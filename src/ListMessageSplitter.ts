import {LogService} from "matrix-bot-sdk";

export type MessageSnippet = { html: string, text: string };

// The max size a message can be, with 24_000 picked at random to accommodate for overhead.
const OVERHEAD = 24_000
const MAX_SIZE = 65_536 - OVERHEAD;

// The extra bits that a <ul> tag wrapping would add to a message
const UL_TAG_WRAP_SIZE = "<ul></ul>".length;
const HTML_LIST_ITEM_EXTRA_SIZE = "<li></li>".length;
const TEXT_LIST_ITEM_EXTRA_SIZE = " * \n".length;

export class MessageListItem {
    public html: string;
    public text: string;

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

export class MessageListHeader extends MessageListItem {
    public size(): number {
        return this.html.length + this.text.length
    }
}

class MessageListing {
    public items: MessageListItem[] = [];

    constructor(public header: MessageListHeader | null) {
    }

    public split_at_size(desired_size: number): {sized: MessageListing | null, rest: MessageListing | null} {
        if (this.size() <= desired_size) {
            return {sized: this, rest: null};
        } else {
            let sized = new MessageListing(this.header);
            if (sized.size() > desired_size) {
                // If the header alone is too much, just give up.
                return {sized: null, rest: this}
            }

            let rest = new MessageListing(null);
            rest.items = [...this.items];

            let current_item = rest.items.shift();

            while (current_item !== undefined) {
                // Add the new item tentatively
                sized.items.push(current_item);

                if (sized.size() > desired_size) {
                    // If we went over the limit, return the last item and return the results
                    rest.items.unshift(sized.items.pop()!)

                    if (sized.items.length > 0) {
                        return {sized, rest};
                    } else {
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

/// A class that allows splitting items and headers into multiple messages.
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

    public render(): { html: string, text: string }[] {
        let rendered: { html: string, text: string }[] = [];

        let listings = this.get_listings();
        let chunks = this.split_listings(listings);

        for (let chunk of chunks) {
            let current = {
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
}
