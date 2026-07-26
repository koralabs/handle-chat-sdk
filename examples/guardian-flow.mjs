// Working example — the four SSR guardian payloads over chat, created programmatically:
//
//   guardian-invite  →  guardian-consent  →  recovery-notify  →  approval-coordination
//
// Run from the repo root after `npm run build`:   node examples/guardian-flow.mjs
//
// Chat is the MEDIUM: every payload rides an E2E session as application/vnd.handle.<kind>+json,
// and the `shard`/`session` fields are opaque base64 the SDK never interprets. The real Shamir
// shards, session blobs, and threshold crypto come from secrets.handle.me (@koralabs/kora-secrets-*);
// the demo bytes below just prove the transport contract round-trips them verbatim.
import { readFile } from 'node:fs/promises';

import {
  approvalCoordination,
  ChatService,
  deriveSeedFromWallet,
  guardianConsent,
  guardianInvite,
  initSignalWasm,
  MemoryDirectory,
  MemoryHub,
  parseGuardian,
  recoveryNotify
} from '@koralabs/handle-chat-sdk';

await initSignalWasm({ module_or_path: await readFile(new URL('../assets/libsignal_bg.wasm', import.meta.url)) });

const walletSignData = (walletSecret) => async (_addressHex, payloadHex) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${walletSecret}|${payloadHex}`));
  return { signature: Buffer.from(digest).toString('hex'), key: '' };
};

const directory = new MemoryDirectory();
const hub = new MemoryHub();
const owner = new ChatService('$olivia', directory, hub.transport(), null);
await owner.start(await deriveSeedFromWallet(walletSignData('olivia-wallet'), 'e0' + '33'.repeat(28)));
const guardian = new ChatService('$gwen', directory, hub.transport(), null);
await guardian.start(await deriveSeedFromWallet(walletSignData('gwen-wallet'), 'e0' + '44'.repeat(28)));

// Route every inbound guardian payload to a promise queue, keyed by arrival order.
const guardianPayloads = (service) => {
  const queue = [];
  const waiters = [];
  service.onMessage((m) => {
    const p = parseGuardian(m.content);
    if (!p) return;
    const item = { from: m.from, ...p };
    const w = waiters.shift();
    if (w) w(item);
    else queue.push(item);
  });
  return () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r)));
};
const atGuardian = guardianPayloads(guardian);
const atOwner = guardianPayloads(owner);

owner.openChat('$gwen');

// 1. guardian-invite — the ask, then (after consent, in the real flow) the encrypted shard.
const secretRef = 'f0f06f776e6572'; // secrets.handle.me's policy id; the SDK just routes it
const shard = Buffer.from('demo-shard: in production this is an encrypted Shamir share').toString('base64');
owner.sendContent('$gwen', guardianInvite({ secretRef, label: 'Wallet seed', shard }));
const invite = await atGuardian();
console.log(`[$gwen] ${invite.kind} from ${invite.from}: guard “${invite.value.label}”`);

// 2. guardian-consent — accepting hands back the guardian's wallet-rooted identity key
//    ("the key is handed over the medium"): SSR encrypts her real shard to exactly this key.
const gekPub = Buffer.from(guardian.myIdentityKey()).toString('base64');
guardian.sendContent('$olivia', guardianConsent({ secretRef, accept: true, label: invite.value.label, gekPub }));
const consent = await atOwner();
console.log(`[$olivia] ${consent.kind}: accept=${consent.value.accept}, gekPub ${Buffer.from(consent.value.gekPub, 'base64').length} bytes`);

// 3. recovery-notify — later, the owner starts a recovery; `session` carries the opaque
//    recovery-session context the guardian's approval crypto needs.
const session = Buffer.from(JSON.stringify({ demo: 'session blob — policy ref + session id + session pub' })).toString('base64');
owner.sendContent('$gwen', recoveryNotify({ secretRef, label: 'Wallet seed', session }));
const notify = await atGuardian();
console.log(`[$gwen] ${notify.kind}: recovery of “${notify.value.label}” (session ${notify.value.session.length} b64 chars)`);

// 4. approval-coordination — the guardian approves and returns the (re-encrypted) piece.
guardian.sendContent('$olivia', approvalCoordination({ secretRef, approve: true, label: notify.value.label, shard: invite.value.shard }));
const approval = await atOwner();
const roundTripped = Buffer.from(approval.value.shard, 'base64').toString();
console.log(`[$olivia] ${approval.kind}: approve=${approval.value.approve}, shard intact=${roundTripped.startsWith('demo-shard')}`);

owner.stop();
guardian.stop();
console.log('✓ guardian flow complete — all four payloads round-tripped over the medium');
