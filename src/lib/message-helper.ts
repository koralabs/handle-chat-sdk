import { MessageType, SessionCipher, SignalProtocolAddress } from "@privacyresearch/libsignal-protocol-typescript";

import { ChatMessage, ChatUser, ProcessedChatMessage } from "../interfaces/Chat.js";
import { SignalProtocolStore } from "./SignalProtocolStore.js";

export const readMessage = async (msg: ChatMessage, cipher: SessionCipher) => {
    try {
        let plaintext: ArrayBuffer = new Uint8Array().buffer;

        if (msg.message.type === 3) {
            console.log('Decrypting PreKey message');
            plaintext = await cipher.decryptPreKeyWhisperMessage(
                msg.message.body!,
                "binary"
            );
        } else if (msg.message.type === 1) {
            console.log('Decrypting Whisper message');
            plaintext = await cipher.decryptWhisperMessage(
                msg.message.body!,
                "binary"
            );
        } else {
            throw new Error(`Unsupported message type: ${msg.message.type}`);
        }

        const stringPlaintext = new TextDecoder().decode(new Uint8Array(plaintext));
        const { id, to, from, timestamp } = msg;

        return { id, to, from, timestamp, messageText: stringPlaintext };
    } catch (error) {
        console.error('Failed to decrypt message:', {
            messageId: msg.id,
            messageType: msg.message.type,
            error: error instanceof Error ? error.message : String(error)
        });

        // Return a placeholder for failed decryption rather than throwing
        return {
            id: msg.id,
            to: msg.to,
            from: msg.from,
            timestamp: msg.timestamp,
            messageText: '[Failed to decrypt message] Error: ' + (error instanceof Error ? error.message : String(error))
        };
    }
};

const buildMessage = async ({ encryptedMessage, decryptedMessage, recipientAddress, senderAddress, sessionInit }: { encryptedMessage: MessageType; decryptedMessage: string;recipientAddress: string; senderAddress: string; sessionInit?: boolean }) => {
        const timestamp = Date.now();
        const id = Math.floor(Math.random() * 1e9);
        const to = recipientAddress;
        const from = senderAddress;
        
        const msg: ChatMessage = { to, from, message: encryptedMessage, timestamp, delivered: false, id };
        if (sessionInit) msg.session_init = true;

        const processedMsg: ProcessedChatMessage = { id, to, from, timestamp, messageText: decryptedMessage };
        return { msg, processedMsg };
    };

export const encryptAndBuildMessage = async ({ message, senderUser, senderStore, recipientUser, sessionInit }: { message: string | ArrayBuffer, senderUser: ChatUser, senderStore: SignalProtocolStore, recipientUser: ChatUser, sessionInit?: boolean }) => {
    const recipientProtocolAddress = new SignalProtocolAddress(recipientUser.address, recipientUser.deviceId!);
    
    const cipher = new SessionCipher(senderStore, recipientProtocolAddress);

    const ciphertext = await cipher.encrypt(
        typeof message === "string" ? new TextEncoder().encode(message).buffer : message
    );
    const processedMessage = await buildMessage({ encryptedMessage: ciphertext, decryptedMessage: typeof message === "string" ? message : new TextDecoder().decode(new Uint8Array(message)), recipientAddress: recipientProtocolAddress.name, senderAddress: senderUser.address, sessionInit });
    return processedMessage;
}