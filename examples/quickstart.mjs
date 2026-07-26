// Working example — two handles talk end-to-end encrypted in ONE Node process: wallet-rooted
// identities (sign-to-derive), libsignal WASM sessions, and an in-memory transport/directory.
// No browser, no relay, no network. Run from the repo root after `npm run build`:
//
//   node examples/quickstart.mjs
//
// In an app you swap the two Memory* seams for the real ones: LocalStorageDirectory +
// BroadcastChannelTransport (same-origin tabs) or MeshTransport (cross-origin, via the relay),
// and the signData stub for the connected CIP-30 wallet's `api.signData`.
import { readFile } from 'node:fs/promises';

import {
  ChatService,
  deriveSeedFromWallet,
  initSignalWasm,
  MemoryDirectory,
  MemoryHub
} from '@koralabs/handle-chat-sdk';

// Node has no origin to fetch the WASM from — hand it the bytes. (Browsers skip this line;
// the default fetches /public/libsignal_bg.wasm from the serving origin.)
await initSignalWasm({ module_or_path: await readFile(new URL('../assets/libsignal_bg.wasm', import.meta.url)) });

// A deterministic stand-in for a CIP-30 wallet's signData: same "wallet", same signature, so the
// identity re-derives forever and is stored nowhere. Real apps pass the wallet API's signData.
const walletSignData = (walletSecret) => async (_addressHex, payloadHex) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${walletSecret}|${payloadHex}`));
  return { signature: Buffer.from(digest).toString('hex'), key: '' };
};

const directory = new MemoryDirectory();
const hub = new MemoryHub();

// One wallet signature each → seed → per-handle identity. `null` disables the IndexedDB vault
// (Node has none); apps omit the argument to get encrypted-at-rest persistence for free.
const aliceSeed = await deriveSeedFromWallet(walletSignData('alice-demo-wallet'), 'e0' + '11'.repeat(28));
const bobSeed = await deriveSeedFromWallet(walletSignData('bob-demo-wallet'), 'e0' + '22'.repeat(28));

const alice = new ChatService('$alice', directory, hub.transport(), null);
await alice.start(aliceSeed); // publishes her prekey bundle to the directory

const bob = new ChatService('$bob', directory, hub.transport(), null);
await bob.start(bobSeed);

// A tiny promise inbox so the example reads top-to-bottom.
const inbox = (service) => {
  const queue = [];
  const waiters = [];
  service.onMessage((m) => {
    const w = waiters.shift();
    if (w) w(m);
    else queue.push(m);
  });
  return () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)));
};
const aliceNext = inbox(alice);
const bobNext = inbox(bob);

// Bob opens the session by resolving Alice's published bundle (cold lookup). Across origins you'd
// use an invite link instead: inviteUrl(...) on one side, openChatWithBundle(parseInviteUrl(...)) on the other.
if (!bob.openChat('$alice')) throw new Error('directory lookup failed');

bob.send('$alice', 'hey $alice — sealed all the way');
const got = await aliceNext();
console.log(`[$alice] ${got.from}: ${got.text}`);

// Alice's reply needs no lookup — decrypting Bob's first message gave her a return session.
alice.send('$bob', 'sealed right back at you');
const reply = await bobNext();
console.log(`[$bob] ${reply.from}: ${reply.text}`);

alice.stop();
bob.stop();
console.log('✓ quickstart complete — two identities, one E2E round trip, zero infrastructure');
