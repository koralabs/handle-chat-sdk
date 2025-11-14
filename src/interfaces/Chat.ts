import { MessageType } from "@privacyresearch/libsignal-protocol-typescript";

import { SerializableFullDirectoryEntry } from "./Directory.js";
import { SerializedStoreEntry } from "./Store.js";

export interface ChatUser {
  address: string;
  name: string;
  accepted: boolean;
  active: boolean;
  chats: ProcessedChatMessage[];
  waitingForSession?: boolean;
  hasPendingChats?: boolean;
  deviceId?: number;
  image?: string;
  bundle?: SerializableFullDirectoryEntry;
  store?: SerializedStoreEntry;
}

export interface ProcessedChatMessage {
  id: number;
  to: string;
  from: string;
  messageText: string;
  timestamp: number;
  failed?: boolean;
}

export interface ChatMessage {
  id: number;
  to: string;
  from: string;
  message: MessageType;
  delivered: boolean;
  timestamp: number;
  session_init?: boolean;
}