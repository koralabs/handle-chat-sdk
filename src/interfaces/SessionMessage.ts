import { SerializableFullDirectoryEntry } from "./Directory.js";
import { SerializedStoreEntry } from "./Store.js";

export type SessionMessageType = 'session_create' | 'session_accept' | 'session_deny' | 'session_failed' | 'session_ended';

export interface SessionMessage {
    recipientAddress: string;
    senderAddress: string;
    senderDeviceId: number;
    senderBundle: SerializableFullDirectoryEntry;
    senderStore: SerializedStoreEntry;
    senderName: string;
    senderImage: string;
    type: SessionMessageType;
    timestamp: number;
    failedMessageId?: string;
}
