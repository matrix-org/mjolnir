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
import { Protection } from "./IProtection";
import { BasicFlooding } from "./BasicFlooding";
import { DetectFederationLag } from "./DetectFederationLag";
import { WordList } from "./WordList";
import { MessageIsVoice } from "./MessageIsVoice";
import { MessageIsMedia } from "./MessageIsMedia";
import { TrustedReporters } from "./TrustedReporters";

export const PROTECTIONS: Protection[] = [
    new FirstMessageIsImage(),
    new BasicFlooding(),
    new WordList(),
    new MessageIsVoice(),
    new MessageIsMedia(),
    new TrustedReporters(),
    new DetectFederationLag(),
];
