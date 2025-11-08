import { SerializableFullDirectoryEntry } from "./Directory.js";
import { SerializedStoreEntry } from "./Store.js";

export interface SessionMessage {
    recipientAddress: string;
    senderAddress: string;
    senderDeviceId: number;
    senderBundle: SerializableFullDirectoryEntry;
    senderStore: SerializedStoreEntry;
    senderName: string;
    senderImage: string;
    type: 'session_request' | 'session_response';
    timestamp: string;
}
