/**
 * @koralabs/handle-chat-sdk — the programmatic client for handle-to-handle E2E chat.
 *
 * Compiled from chat.handle.me's client core (the single source of truth; see scripts/build.mjs).
 * The surface below is the medium contract SSR (secrets.handle.me) and other apps consume:
 * wallet-rooted identity (sign-to-derive), libsignal WASM sessions, transports/directories,
 * invite links, the typed-message codec, and the four guardian payloads.
 */
export * from './chat/ChatService';
export * from './chat/directory';
export * from './chat/guardian';
export * from './chat/identity';
export * from './chat/invite';
export * from './chat/message';
export * from './chat/qr';
export * from './chat/transport';
export * from './memory';
export * from './signal/SignalEngine';
export type { QueuedEnvelope, SessionSnapshot, SessionVault, StoredMessage } from './chat/sessionStore';
