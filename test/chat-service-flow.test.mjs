import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ChatService,
  deriveSeedFromWallet,
  initSignalWasm,
  MemoryDirectory,
  MemoryHub,
  textMessage
} from '@koralabs/handle-chat-sdk';
import { MeshTransport } from '../lib/src/chat/transport.js';
import { UNVERIFIED_FIRST_CONTACT_LIMIT } from '../lib/src/chat/ChatService.js';

await initSignalWasm({ module_or_path: await readFile(new URL('../assets/libsignal_bg.wasm', import.meta.url)) });

const walletSignData = (secret) => async (_addr, payloadHex) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}|${payloadHex}`));
  return { signature: Buffer.from(digest).toString('hex'), key: '' };
};
const seedFor = (secret, n) => deriveSeedFromWallet(walletSignData(secret), 'e0' + String(n).repeat(56));
const until = async (cond, ms = 2000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** Map-backed vault so persistence/restore is exercised without IndexedDB. */
const memoryVault = () => {
  const m = new Map();
  return {
    load: async (h) => m.get(`s:${h}`) ?? null,
    save: async (h, s) => void m.set(`s:${h}`, s),
    loadQueue: async (h) => m.get(`q:${h}`) ?? null,
    saveQueue: async (h, q) => void m.set(`q:${h}`, q),
    loadHistory: async (h, r) => m.get(`h:${h}:${r}`) ?? null,
    saveHistory: async (h, r, msgs) => void m.set(`h:${h}:${r}`, msgs)
  };
};

/** Wraps a hub transport so a test can make the network refuse sends, and can inject raw envelopes. */
const gate = (inner) => {
  const g = { up: true, sent: [], cb: null };
  g.send = (env) => {
    g.sent.push(env);
    return g.up ? inner.send(env) : Promise.resolve(false);
  };
  g.subscribe = (keys, cb, signer) => {
    g.cb = cb;
    inner.subscribe(keys, cb, signer);
  };
  g.stop = () => inner.stop();
  return g;
};

const track = (svc) => {
  const got = [];
  svc.onMessage((m) => got.push(m));
  return got;
};

test('offline sends queue, flush in order once the network returns, and receipts only ever advance status', async () => {
  const directory = new MemoryDirectory();
  const hub = new MemoryHub();
  const aliceNet = gate(hub.transport());
  const alice = new ChatService('$alice', directory, aliceNet, memoryVault());
  const bob = new ChatService('$bob', directory, hub.transport(), null);
  await alice.start(await seedFor('a', 1));
  await bob.start(await seedFor('b', 2));
  const bobGot = track(bob);
  const receipts = [];
  alice.onReceipt((r) => receipts.push(r));
  let updates = 0;
  alice.onSendUpdate(() => updates++);

  assert.throws(() => new ChatService('$x', directory, hub.transport(), null).myBundle(), /not started/);
  assert.equal(alice.openChat('$nobody'), false);
  assert.ok(alice.openChat('$bob'));

  aliceNet.up = false;
  const id1 = alice.sendContent('$bob', textMessage('first'));
  const id2 = alice.sendContent('$bob', textMessage('second'));
  await until(() => aliceNet.sent.length === 2); // both refused, then enqueued
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(alice.sentState(id1), 'queued');
  assert.equal(alice.sentState(id2), 'queued');
  assert.equal(bobGot.length, 0);

  aliceNet.up = true;
  await alice.flushQueue();
  assert.equal(alice.sentState(id1) === 'sent' || alice.sentState(id1) === 'delivered', true);
  await until(() => bobGot.length === 2);
  assert.deepEqual(bobGot.map((m) => m.text), ['first', 'second']);
  await until(() => alice.sentState(id2) === 'delivered');
  assert.ok(updates > 0);
  assert.deepEqual(receipts.map((r) => r.state).filter((s) => s === 'delivered').length, 2);

  bob.markRead('$alice', id1);
  await until(() => alice.sentState(id1) === 'read');
  // a late "delivered" for an already-read message must not regress it
  bob.markRead('$alice', id2);
  await until(() => alice.sentState(id2) === 'read');
  assert.equal(alice.sentState('never-sent'), undefined);

  alice.stop();
  bob.stop();
});

test('a restarted ChatService restores its bundle, contacts, history and unsent queue from the vault', async () => {
  const directory = new MemoryDirectory();
  const hub = new MemoryHub();
  const vault = memoryVault();
  const aliceSeed = await seedFor('a', 1);
  const net = gate(hub.transport());
  const alice = new ChatService('$alice', directory, net, vault);
  const bob = new ChatService('$bob', directory, hub.transport(), null);
  await alice.start(aliceSeed);
  await bob.start(await seedFor('b', 2));
  alice.openChat('$bob');
  net.up = false;
  const queuedId = alice.sendContent('$bob', textMessage('pending while offline'));
  await until(() => alice.sentState(queuedId) === 'queued' && net.sent.length > 0);
  await alice.flush();
  const bundleBefore = Buffer.from(alice.myBundle()).toString('hex');
  const identityBefore = Buffer.from(alice.myIdentityKey()).toString('hex');
  alice.stop();

  const alice2 = new ChatService('$alice', directory, gate(hub.transport()), vault);
  await alice2.start(aliceSeed);
  assert.equal(Buffer.from(alice2.myBundle()).toString('hex'), bundleBefore);
  assert.equal(Buffer.from(alice2.myIdentityKey()).toString('hex'), identityBefore);
  assert.equal(alice2.sentState(queuedId), 'queued');
  const thread = alice2.loadedHistory().get('$bob');
  assert.equal(thread.length, 1);
  assert.equal(new TextDecoder().decode(thread[0].content.body), 'pending while offline');

  // restored queue is delivered after restart
  const bobGot = track(bob);
  await alice2.flushQueue();
  await until(() => bobGot.length === 1);
  assert.equal(bobGot[0].text, 'pending while offline');
  alice2.stop();
  bob.stop();
});

test('impostors never surface, and a re-anchored handle warns while the established conversation keeps working', async () => {
  const directory = new MemoryDirectory();
  const hub = new MemoryHub();
  const bob = new ChatService('$bob', directory, hub.transport(), null);
  const alice = new ChatService('$alice', directory, hub.transport(), null);
  await bob.start(await seedFor('b', 2));
  await alice.start(await seedFor('a', 1));
  const bobGot = track(bob);
  const changes = [];
  bob.onKeyChange((c) => changes.push(c));
  bob.openChat('$alice'); // bob now trusts alice's real key

  // an impostor with a different wallet claims the handle $alice and addresses bob: never surfaced
  const impostor = new ChatService('$alice', new MemoryDirectory(), hub.transport(), null);
  await impostor.start(await seedFor('evil', 9));
  impostor.openChatWithBundle('$bob', bob.myBundle());
  impostor.send('$bob', 'it is really me');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(bobGot.length, 0);

  // the real alice is re-anchored (directory now points at a different bundle): warn, but keep accepting
  alice.openChat('$bob');
  alice.send('$bob', 'before re-anchor');
  await until(() => bobGot.length === 1);
  assert.equal(changes.length, 0);
  const other = new ChatService('$alice', new MemoryDirectory(), hub.transport(), null);
  await other.start(await seedFor('someone-else', 7));
  directory.publish('$alice', other.myBundle());
  alice.send('$bob', 'after re-anchor');
  await until(() => bobGot.length === 2);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].handle, '$alice');
  assert.equal(changes[0].anchorDiverged, true);
  assert.notDeepEqual([...changes[0].knownKey], [...changes[0].newKey]);
  [bob, alice, impostor, other].forEach((s) => s.stop());
});

test('inbound hardening: duplicates, oversized envelopes and forged handles never surface; cold unanchored senders are rate limited', async () => {
  const directory = new MemoryDirectory();
  const hub = new MemoryHub();
  const bob = new ChatService('$bob', directory, hub.transport(), null);
  await bob.start(await seedFor('b', 2));
  const bobGot = track(bob);

  const spawned = [];
  const spawn = async (handle, n) => {
    const svc = new ChatService(handle, new MemoryDirectory(), gate(hub.transport()), null);
    await svc.start(await seedFor(`s${n}`, 3));
    svc.openChatWithBundle('$bob', bob.myBundle());
    spawned.push(svc);
    return svc;
  };

  // duplicate delivery of one envelope is processed once
  const carol = await spawn('$carol', 1);
  carol.send('$bob', 'hi');
  await until(() => bobGot.length === 1);
  const env = carol.transport.sent[0];
  bob.receive(env);
  bob.receive(env);
  // oversized envelope is dropped before decryption
  bob.receive({ ...env, body: new Uint8Array(256 * 1024 + 1) });
  // a handle containing HTML-special chars is dropped
  const forged = await spawn('$<img src=x>', 2);
  forged.send('$bob', 'xss');
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(bobGot.length, 1);

  // un-anchored cold first-contacts: only the first UNVERIFIED_FIRST_CONTACT_LIMIT (incl. carol) get through
  const total = UNVERIFIED_FIRST_CONTACT_LIMIT + 2;
  for (let i = 0; i < total; i++) (await spawn(`$cold${i}`, 10 + i)).send('$bob', `cold ${i}`);
  await until(() => bobGot.length >= UNVERIFIED_FIRST_CONTACT_LIMIT);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(bobGot.length, UNVERIFIED_FIRST_CONTACT_LIMIT);
  [bob, ...spawned].forEach((x) => x.stop());
});

test('sendBlob streams a multi-chunk blob that the peer reassembles byte-for-byte', async () => {
  const directory = new MemoryDirectory();
  const hub = new MemoryHub();
  const alice = new ChatService('$alice', directory, hub.transport(), null);
  const bob = new ChatService('$bob', directory, hub.transport(), null);
  await alice.start(await seedFor('a', 1));
  await bob.start(await seedFor('b', 2));
  const bobGot = track(bob);
  alice.openChat('$bob');
  const bytes = Uint8Array.from({ length: 40_000 }, (_, i) => (i * 31 + 7) % 256);
  const id = await alice.sendBlob('$bob', 'image/png', bytes, 'p.png');
  await until(() => bobGot.length === 1, 5000);
  assert.equal(bobGot[0].content.mime, 'image/png');
  assert.equal(bobGot[0].content.meta.id, id);
  assert.deepEqual([...bobGot[0].content.body], [...bytes]);
  await until(() => alice.sentState(id) === 'delivered', 5000);
  alice.stop();
  bob.stop();
});

test('MeshTransport reports an unreachable helper as a refused send (so the caller queues) and rejects readiness', async () => {
  const t = new MeshTransport('not-a-multiaddr', 50);
  assert.equal(await t.send({ to: 'ab', body: new Uint8Array([1, 2]), ts: 1, slot: 'public' }), false);
  await assert.rejects(t.whenReady());
  t.stop();
});
