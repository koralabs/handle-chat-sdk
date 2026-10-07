import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertDeterministicSigning,
  deriveIdentity,
  deriveSeedFromWallet,
  IDENTITY_MESSAGE,
  initSignalWasm,
  SignalEngine
} from '@koralabs/handle-chat-sdk';

await initSignalWasm({ module_or_path: await readFile(new URL('../assets/libsignal_bg.wasm', import.meta.url)) });

const seed = new Uint8Array(32).fill(7);
const day = 24 * 60 * 60 * 1000;

async function engine(handle) {
  const { priv, registrationId } = await deriveIdentity(seed, handle);
  return SignalEngine.create(handle, priv, registrationId);
}

async function pair() {
  const alice = await engine('$alice');
  const bob = await engine('$bob');
  alice.processBundle('$bob', bob.createBundle());
  return { alice, bob };
}

// Sign-in reproduces the wallet seed and enrollment rejects signatures that cannot reproduce it.
// Catch a changed signing payload, an empty seed, or a wallet silently orphaning sessions.
// Negative controls use empty/randomized signatures; removing their guards makes these assertions fail.
test('wallet sign-to-derive preserves its payload and rejects unusable signatures', async () => {
  const address = 'e0' + '11'.repeat(28);
  const signature = '000102fdfeff';
  const calls = [];
  const wallet = async (stakeAddress, payload) => {
    calls.push([stakeAddress, payload]);
    return { signature, key: '' };
  };

  const first = await deriveSeedFromWallet(wallet, address);
  assert.deepEqual(first, new Uint8Array([0, 1, 2, 253, 254, 255]));
  assert.deepEqual(await deriveSeedFromWallet(wallet, address), first);
  await assertDeterministicSigning(wallet, address);
  assert.deepEqual(calls, Array.from({ length: 4 }, () => [address, Buffer.from(IDENTITY_MESSAGE).toString('hex')]));

  await assert.rejects(() => deriveSeedFromWallet(async () => ({ signature: '', key: '' }), address), /empty signature/);
  let signingAttempt = 0;
  await assert.rejects(
    () => assertDeterministicSigning(async () => ({ signature: ++signingAttempt === 1 ? '00' : '01', key: '' }), address),
    /different signature each time/
  );
  await assert.rejects(() => deriveSeedFromWallet(async () => { throw new Error('wallet locked'); }, address), /wallet locked/);
});

// A published bundle opens a bidirectional session that preserves Unicode and empty text.
// Catch broken prekey processing or lossy string/byte conversion in the SDK crypto wrapper.
// Replacing the UTF-8 encoder with ASCII, or dropping empty messages, breaks the exact text assertions.
test('signal sessions preserve Unicode and empty text in both directions', async () => {
  const { alice, bob } = await pair();
  const greeting = 'hello $bob — café 🦉';
  assert.equal(bob.decrypt('$alice', alice.encrypt('$bob', greeting)), greeting);
  assert.equal(alice.decrypt('$bob', bob.encrypt('$alice', 'reply: こんにちは')), 'reply: こんにちは');
  assert.equal(bob.decrypt('$alice', alice.encrypt('$bob', '')), '');
  assert.throws(() => alice.encrypt('$missing', 'no session'));
});

// Sealed messages preserve arbitrary bytes and authenticate the sender to the intended recipient.
// Catch acceptance of tampered, misaddressed, malformed, or replayed ciphertext.
// Each rejected input is a negative control, and a later valid message must still decrypt.
test('sealed sender rejects invalid envelopes while preserving binary content', async () => {
  const { alice, bob } = await pair();
  const carol = await engine('$carol');
  const body = new Uint8Array([0, 1, 127, 128, 254, 255]);
  const ciphertext = alice.sealedSend('$bob', body);
  const tampered = ciphertext.slice();
  tampered[tampered.length - 1] ^= 1;

  assert.throws(() => bob.sealedReceive(new Uint8Array([0, 1, 2])));
  assert.throws(() => bob.sealedReceive(tampered));
  assert.throws(() => carol.sealedReceive(ciphertext));

  const received = bob.sealedReceive(ciphertext);
  assert.equal(received.sender, '$alice');
  assert.deepEqual(received.body, body);
  assert.deepEqual(received.identityKey, bob.peerIdentityKey('$alice'));
  assert.throws(() => bob.sealedReceive(ciphertext));
  assert.deepEqual(bob.sealedReceive(alice.sealedSend('$bob', new Uint8Array())).body, new Uint8Array());
});

// A same-wallet restart restores the ratchet and trusted peer key without losing pending messages.
// Catch state serialization that omits sessions, peer identities, or receive-chain progress.
// The fresh engine cannot send before import; skipping import breaks the resumed exchanges.
test('exported signal state resumes an existing conversation after a restart', async () => {
  const { alice, bob } = await pair();
  assert.equal(bob.decrypt('$alice', alice.encrypt('$bob', 'before restart')), 'before restart');
  assert.equal(alice.decrypt('$bob', bob.encrypt('$alice', 'ack before restart')), 'ack before restart');

  const state = alice.exportState(['$bob']);
  const trustedKey = alice.peerIdentityKey('$bob');
  const pending = bob.encrypt('$alice', 'arrived during restart');
  const restored = await engine('$alice');
  assert.equal(restored.peerIdentityKey('$bob'), null);
  assert.throws(() => restored.encrypt('$bob', 'not restored yet'));
  assert.throws(() => restored.importState(new Uint8Array([0, 1, 2])));

  restored.importState(state);
  assert.deepEqual(restored.peerIdentityKey('$bob'), trustedKey);
  assert.equal(restored.decrypt('$bob', pending), 'arrived during restart');
  assert.equal(bob.decrypt('$alice', restored.encrypt('$bob', 'after restart')), 'after restart');
  assert.equal(restored.decrypt('$bob', bob.encrypt('$alice', 'reply after restart')), 'reply after restart');
});

// Public and pairwise routing labels agree between peers and cover a daily rollover.
// Catch off-by-one epoch addressing that drops messages at the rotation boundary.
// A missing neighbor or a send/receive key mismatch breaks overlap and destination assertions.
test('routing labels match peer subscriptions across an epoch boundary', async () => {
  const { alice, bob } = await pair();
  assert.equal(bob.sealedReceive(alice.sealedSend('$bob', new Uint8Array([42]))).sender, '$alice');
  const boundary = 20_000 * day;

  for (const now of [boundary - 1, boundary]) {
    assert.equal(alice.peerTopic('$bob', now), bob.myTopics(now)[1]);
    assert.equal(alice.publicSlotTopicFor(bob.presenceAuthPub(), now), bob.publicSlotTopics(now)[1]);
    assert.equal(alice.convSendTopic('$bob', now), bob.convRecvTopics('$alice', now)[1]);
    assert.equal(bob.convSendTopic('$alice', now), alice.convRecvTopics('$bob', now)[1]);
    assert.notEqual(alice.publicSlotTopicFor(alice.presenceAuthPub(), now), bob.publicSlotTopics(now)[1]);
  }

  for (const topicsAt of [
    (now) => bob.myTopics(now),
    (now) => bob.publicSlotTopics(now),
    (now) => bob.convRecvTopics('$alice', now)
  ]) {
    const before = topicsAt(boundary - 1);
    const after = topicsAt(boundary);
    assert.equal(before.length, 3);
    assert.equal(new Set(before).size, 3);
    for (const topic of before) assert.match(topic, /^[0-9a-f]{64}$/);
    assert.deepEqual(before.slice(1), after.slice(0, 2));
    assert.notEqual(before[1], after[1]);
  }
});
