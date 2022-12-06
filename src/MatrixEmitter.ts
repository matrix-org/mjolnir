/*
Copyright 2019-2022 The Matrix.org Foundation C.I.C.

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

import EventEmitter from "events";
import { MatrixClient } from "matrix-bot-sdk";

/**
 * This is an interface created in order to keep the event listener
 * Mjolnir uses for new events generic.
 * Used to provide a unified API for messages received from matrix-bot-sdk (using GET /sync)
 * when we're in single bot mode and messages received from matrix-appservice-bridge (using pushed /transaction)
 * when we're in appservice mode.
 */
export declare interface MatrixEmitter extends EventEmitter {
    on(event: 'room.event', listener: (roomId: string, mxEvent: any) => void ): this
    emit(event: 'room.event', roomId: string, mxEvent: any): boolean

    on(event: 'room.message', listener: (roomId: string, mxEvent: any) => void ): this
    emit(event: 'room.message', roomId: string, mxEvent: any): boolean

    on(event: 'room.invite', listener: (roomId: string, mxEvent: any) => void ): this
    emit(event: 'room.invite', roomId: string, mxEvent: any): boolean

    on(event: 'room.join', listener: (roomId: string, mxEvent: any) => void ): this
    emit(event: 'room.join', roomId: string, mxEvent: any): boolean

    on(event: 'room.leave', listener: (roomId: string, mxEvent: any) => void ): this
    emit(event: 'room.leave', roomId: string, mxEvent: any): boolean

    on(event: 'room.archived', listener: (roomId: string, mxEvent: any) => void ): this
    emit(event: 'room.archived', roomId: string, mxEvent: any): boolean

    start(): Promise<void>;
    stop(): void;
}

/**
 * A `MatrixClient` without the properties of `MatrixEmitter`.
 * This is in order to enforce listeners are added to `MatrixEmitter`s
 * rather than on the matrix-bot-sdk version of the matrix client.
 */
export type MatrixSendClient = Omit<MatrixClient, keyof MatrixEmitter>;
