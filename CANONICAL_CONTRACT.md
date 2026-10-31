# handle-chat-sdk canonical contract

I am `@koralabs/handle-chat-sdk`, the published npm form of chat.handle.me's client core (handle chat client, wallet identity, libsignal WASM sessions, transports, guardian payloads). I am public, so whatever I publish reaches other people's apps. I write no crypto of my own: `scripts/build.mjs` compiles `src/chat`, `src/signal` and `libsignal-wasm` from the sibling chat.handle.me checkout (its `origin/HEAD`, i.e. `preview`) into `lib/` and `assets/`. The files that carry the rules below are listed in [`.enclave`](./.enclave); a change to them that merges into `master` needs operator approval. Authority: the ecosystem `AGENTS.md` "Critical Correctness" and "Merging" sections, and kora-bot `v3/docs/ecosystem-ownership-plan.md` Phase 5.

## Invariants

1. **I never send a private key or plaintext to a server.** All transports carry sealed ciphertext; the key stays in the caller's process. The rule lives in chat.handle.me's contract; here it means I add no code that sends either. Test: `test/identity-signal.test.mjs`, `test/message-invite-memory.test.mjs`, and the examples run by `npm test`.
2. **The wallet-derived identity never forks.** `deriveIdentity` must return the pinned private key and registration id for the pinned seed, and `IDENTITY_MESSAGE` stays `koralabs:handle-identity:derive:v1`, identical in chat.handle.me and secrets.handle.me. Test: `test/sdk.test.mjs` (cross-repo vector).
3. **I contain no source of my own beyond `sdk/`.** Client fixes land in chat.handle.me and are rebuilt here; `lib/` and `build-src/` are build output and never hand-edited. The build fails if the chat checkout is missing, and records which chat revision it used and whether it was dirty.
4. **A publish happens only from `master` through the `deploy.yml` workflow**, with the token supplied by the deployment secrets. No manual `npm publish`, no token in the repo.
5. **The published surface is deliberate.** `sdk/index.ts` is the whole export list; adding or removing an export is a public API change. Test: `test/sdk.test.mjs` ("the built package exposes the client surface").
6. **No secrets in git.** Keys, tokens and mnemonics live in the box SOPS stores or local `.env.local.*` files, never in the repo or in GitHub secrets copied from them.

## Boundaries and known limits

- **Not enforced by a test:** invariant 1 (nothing scans for outbound key or plaintext; it rests on chat.handle.me's tests), invariant 3's "never hand-edited" (a reviewer must notice), and invariant 4 (a process rule).
- The build reads whatever the neighbouring chat.handle.me `origin/HEAD` is; there is no pin to a reviewed chat commit. A publish therefore carries whatever chat `preview` held at that moment, including unreviewed changes to chat's enclaved files.
- The package is AGPL-3.0-only because of libsignal.

## Refactors needed to enforce this

- Pin the chat.handle.me commit the SDK is built from (and check it contains no enclaved change that was not approved) instead of reading `origin/HEAD`.
- Add a check that fails the build when `lib/` or `build-src/` is committed or edited by hand.
- Move the identity vector into one file shared by chat, the SDK and secrets.handle.me.
- Add a test that fails if any exported transport sends a key or plaintext.
