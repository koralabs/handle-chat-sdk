# @koralabs/handle-chat-sdk

The programmatic client for **handle-to-handle end-to-end-encrypted chat** — the messaging layer
behind [chat.handle.me](../chat.handle.me), consumable from any app or tool. v1 replaces the legacy
0.0.x SDK (which used an outdated libsignal port) with the modern stack: the **latest official
libsignal compiled to WASM** (X3DH + Double Ratchet + PQXDH), **wallet-rooted identities**
(sign-to-derive: one CIP-30 signature, stored nowhere), and the **SSR guardian payloads** that make
chat the delivery medium for [secrets.handle.me](../secrets.handle.me).

Built **from chat.handle.me's source** — that repo is the single source of truth; `npm run build`
compiles its client core (`src/chat`, `src/signal`, the libsignal WASM) into `lib/` + `assets/`.

## Working examples (run them)

```bash
npm install && npm run build
node examples/quickstart.mjs      # two handles, one E2E round trip, zero infrastructure
node examples/guardian-flow.mjs   # the four SSR guardian payloads over the medium
```

Both run in plain Node and are executed by `npm test` — the examples can't rot.

## Quickstart (what quickstart.mjs does)

```js
import { readFile } from 'node:fs/promises';
import {
  ChatService, deriveSeedFromWallet, initSignalWasm, MemoryDirectory, MemoryHub
} from '@koralabs/handle-chat-sdk';

// Node has no origin to fetch the WASM from — hand it the bytes. Browsers skip this:
// the default fetches /public/libsignal_bg.wasm from the serving origin (ship assets/libsignal_bg.wasm there).
await initSignalWasm({ module_or_path: await readFile(new URL('../assets/libsignal_bg.wasm', import.meta.url)) });

// Identity = sign-to-derive: seed is the wallet's signature over a fixed message; nothing is stored.
// In an app, signData is the connected CIP-30 wallet's api.signData.
const seed = await deriveSeedFromWallet(signData, stakeAddressHex);

const directory = new MemoryDirectory();          // app: LocalStorageDirectory / on-chain anchors
const hub = new MemoryHub();                      // app: BroadcastChannelTransport / MeshTransport
const alice = new ChatService('$alice', directory, hub.transport(), null); // null = no at-rest vault (Node)
await alice.start(seed);                          // derives identity, provisions Signal, publishes bundle

bob.openChat('$alice');                           // outbound session from her published bundle
bob.send('$alice', 'hey — sealed all the way');   // E2E; relays only ever see ciphertext
alice.onMessage((m) => console.log(m.from, m.text));
```

Handles are canonically `$`-prefixed (`$alice`); one wallet signature covers every handle the
wallet controls, and each handle gets a distinct key (HKDF, info = handle).

## Programmatic messages & the guardian payloads

Typed messages are `ContentMessage`s (`{ mime, body, meta }`) sent with `sendContent`. The four
SSR payloads ride the vendor MIME tree (`application/vnd.handle.<kind>+json`) and their
`shard`/`session` fields are **opaque** to chat:

```js
import { guardianInvite, guardianConsent, recoveryNotify, approvalCoordination, parseGuardian } from '@koralabs/handle-chat-sdk';

owner.sendContent('$gwen', guardianInvite({ secretRef, label: 'Wallet seed', shard }));   // encrypted piece
gwen.sendContent('$olivia', guardianConsent({ secretRef, accept: true,                     // "the key is
  gekPub: Buffer.from(gwen.myIdentityKey()).toString('base64') }));                        //  handed over the medium"
owner.sendContent('$gwen', recoveryNotify({ secretRef, session }));                        // recovery starts
gwen.sendContent('$olivia', approvalCoordination({ secretRef, approve: true, shard }));    // piece comes back

service.onMessage((m) => { const p = parseGuardian(m.content); if (p) handle(p.kind, p.value); });
```

The real Shamir shards, session blobs, and threshold crypto live in `@koralabs/kora-secrets-crypto`
/ secrets.handle.me — see its `lib/chat-medium.ts` for the production payload contents.

## In the browser

- Serve `assets/libsignal_bg.wasm` at exactly **`/public/libsignal_bg.wasm`** on your origin
  (and allow `'wasm-unsafe-eval'` in `script-src` if you set a CSP).
- Same-origin tabs: `new ChatService(handle, new LocalStorageDirectory(), new BroadcastChannelTransport())`.
- Cross-origin / cross-device: `new MeshTransport(helperMultiaddr)` against chat.handle.me's mesh
  helper (`node --import tsx mesh-helper/server.ts <port>` there); first contact travels by invite
  link — `inviteUrl(origin, handle, service.myBundle())` on one side, `openChatWithBundle(parseInviteUrl(url))`
  on the other. `qrSvg(url)` renders the QR.
- Persistence: omit the vault argument to get the encrypted-at-rest IndexedDB vault keyed by the
  identity seed; pass `null` (tests/Node) to disable.

Living integrations: chat.handle.me (the full UI) and secrets.handle.me (`src/chat-client.ts` —
provisioning, invite links, guardian flows against this exact surface).

## License

AGPL-3.0-only — the SDK embeds [libsignal](https://github.com/signalapp/libsignal) (AGPLv3) via
chat.handle.me's `libsignal-wasm` build.
