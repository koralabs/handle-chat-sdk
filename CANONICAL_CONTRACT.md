# handle-chat-sdk canonical contract

I am `@koralabs/handle-chat-sdk`, the published npm form of chat.handle.me's client core (chat client, wallet identity, libsignal WASM sessions, transports, guardian payloads). `scripts/build.mjs` compiles chat.handle.me's `src/chat`, `src/signal` and `libsignal-wasm` into `lib/` and `assets/`.

1. **A private key or plaintext never goes to a server.** Transports carry sealed ciphertext only; the key stays in the caller's process.
2. **The wallet-derived identity never forks.** `deriveIdentity` returns the pinned private key and registration id for the pinned seed, and `IDENTITY_MESSAGE` stays `koralabs:handle-identity:derive:v1`, identical in chat.handle.me and secrets.handle.me.
3. **I add no source beyond `sdk/`.** Client code comes from chat.handle.me; `lib/` and `build-src/` are build output, and the build fails if the chat checkout is missing and records which chat revision it used.
4. **The published surface is deliberate.** `sdk/index.ts` is the whole export list; adding or removing an export is a public API change.
