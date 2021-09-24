/*
Copyright 2019 - 2021 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { FirstMessageIsImage } from "./FirstMessageIsImage";
import { IProtection } from "./IProtection";
import { BasicFlooding, MAX_PER_MINUTE } from "./BasicFlooding";
import { WordList } from "./WordList";
import { MessageIsVoice } from "./MessageIsVoice";
import { MessageIsMedia } from "./MessageIsMedia";

export const PROTECTIONS: PossibleProtections = {
    [new FirstMessageIsImage().name]: {
        description: "If the first thing a user does after joining is to post an image or video, " +
            "they'll be banned for spam. This does not publish the ban to any of your ban lists.",
        factory: () => new FirstMessageIsImage(),
    },
    [new BasicFlooding().name]: {
        description: "If a user posts more than " + MAX_PER_MINUTE + " messages in 60s they'll be " +
            "banned for spam. This does not publish the ban to any of your ban lists.",
        factory: () => new BasicFlooding(),
    },
    [new WordList().name]: {
        description: "If a user posts a monitored word a set amount of time after joining, they " +
            "will be banned from that room.  This will not publish the ban to a ban list.",
        factory: () => new WordList(),
    },
    [new MessageIsVoice().name]: {
        description: "If a user posts a voice message, that message will be redacted. No bans are issued.",
        factory: () => new MessageIsVoice(),
    },
    [new MessageIsMedia().name]: {
        description: "If a user posts an image or video, that message will be redacted. No bans are issued.",
        factory: () => new MessageIsMedia(),
    }
};

export interface PossibleProtections {
    [name: string]: {
        description: string;
        factory: () => IProtection;
    };
}
