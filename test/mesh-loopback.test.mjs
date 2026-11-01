// Real-network coverage for the mesh layer: a loopback relay+mailbox+presence "helper" (WebSocket on
// 127.0.0.1, circuit-relay v2 server) and real MeshClient / b2b / node code talking to it.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';

import { MeshClient } from '../lib/src/chat/mesh/client.js';
import { B2B_PROTOCOL, dialDirect, startDirectListener } from '../lib/src/chat/mesh/b2b.js';
import { createNode, handleRequests, request } from '../lib/src/chat/mesh/node.js';
import { MAILBOX_PROTOCOL, PRESENCE_PROTOCOL } from '../lib/src/chat/mesh/protocol.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const until = async (cond, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 50));
  }
};

async function startHelper() {
  const node = await createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] },
    transports: [webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: { identify: identify(), relay: circuitRelayServer() },
    connectionGater: { denyDialMultiaddr: () => false },
  });
  const mailbox = new Map();
  const presence = new Map();
  const reg = [];
  await handleRequests(node, MAILBOX_PROTOCOL, (raw) => {
    const r = JSON.parse(dec.decode(raw));
    if (r.op === 'store') {
      const q = mailbox.get(r.envelope.to) ?? [];
      q.push(r.envelope);
      mailbox.set(r.envelope.to, q);
      return enc.encode(JSON.stringify({ ok: true }));
    }
    const q = mailbox.get(r.to) ?? [];
    mailbox.delete(r.to);
    return enc.encode(JSON.stringify({ envelopes: q }));
  });
  await handleRequests(node, PRESENCE_PROTOCOL, (raw) => {
    const r = JSON.parse(dec.decode(raw));
    if (r.op === 'register') {
      reg.push(r);
      presence.set(r.key, r.addr);
      return enc.encode(JSON.stringify({ ok: true }));
    }
    return enc.encode(JSON.stringify({ addr: presence.get(r.key) ?? null }));
  });
  const addr = node.getMultiaddrs().map(String).find((a) => a.includes('/ws'));
  return { node, addr, mailbox, presence, reg };
}

test('node.js request/handleRequests round-trip, and a handler error aborts the stream', async () => {
  const server = await createNode(['/ip4/127.0.0.1/tcp/0/ws']);
  const client = await createNode();
  await handleRequests(server, '/t/echo/1', (b) => enc.encode(`echo:${dec.decode(b)}`));
  await handleRequests(server, '/t/boom/1', () => { throw new Error('nope'); });
  const addr = server.getMultiaddrs().map(String).find((a) => a.includes('/ws'));
  try {
    assert.equal(dec.decode(await request(client, addr, '/t/echo/1', enc.encode('hi'))), 'echo:hi');
    await assert.rejects(request(client, addr, '/t/boom/1', enc.encode('x')));
  } finally {
    await client.stop();
    await server.stop();
  }
});

test('MeshClient: registers presence, delivers via mailbox when peer offline, direct when online', async () => {
  const helper = await startHelper();
  const got = [];
  let a;
  let b;
  try {
    b = await MeshClient.start(helper.addr, ['kb'], (e) => got.push(e), 100, (key, addr) => (key === 'kb'
      ? { epoch: 1, pub: new Uint8Array([1, 2]), sig: new Uint8Array([3]) } : null));
    assert.equal(helper.reg[0].slot, 'public', 'signer-vouched label registers in the public slot');
    assert.equal(helper.presence.get('kb') !== undefined, true);

    a = await MeshClient.start(helper.addr, ['ka'], () => {}, 100);
    assert.equal(helper.reg.find((r) => r.key === 'ka').slot, 'pairwise');

    // Direct-first: b is online with a /webrtc address, so a dials it peer-to-peer.
    const direct = { to: 'kb', slot: 'public', body: 'direct' };
    const sent = await a.send(direct);
    assert.equal(sent, true);
    // Whether the WebRTC dial succeeded or fell back to the mailbox, b receives it exactly once.
    await until(() => got.length >= 1);
    assert.deepEqual(got[0], direct);

    // Offline recipient: stored in the mailbox, then drained by the poller after it comes online.
    const mail = { to: 'kc', body: 'mailbox' };
    assert.equal(await a.send(mail), true);
    assert.deepEqual(helper.mailbox.get('kc'), [mail]);
    const c = await MeshClient.start(helper.addr, ['kc'], (e) => got.push(e), 100);
    try {
      await until(() => got.some((e) => e.body === 'mailbox'));
      assert.equal(helper.mailbox.has('kc'), false, 'mailbox drained');
      // setKeys re-registers the new label set.
      c.setKeys(['kd']);
      await until(() => helper.presence.has('kd'));
    } finally {
      await c.stop();
    }
  } finally {
    await a?.stop();
    await b?.stop();
    await helper.node.stop();
  }
});

test('MeshClient.send returns false when the helper is unreachable', async () => {
  const helper = await startHelper();
  const a = await MeshClient.start(helper.addr, ['ka'], () => {}, 100);
  try {
    await helper.node.stop();
    assert.equal(await a.send({ to: 'zz', body: 'x' }), false);
  } finally {
    await a.stop();
  }
});

test('b2b: startDirectListener gets a /webrtc address and dialDirect delivers a message', async () => {
  const helper = await startHelper();
  const msgs = [];
  const listener = await startDirectListener(helper.addr, (m) => msgs.push(m));
  const dialer = await startDirectListener(helper.addr, () => {});
  try {
    assert.match(listener.addr, /\/webrtc/);
    assert.ok(listener.node.getProtocols().includes(B2B_PROTOCOL));
    await dialDirect(dialer.node, listener.addr, 'hello peer');
    await until(() => msgs.length === 1);
    assert.deepEqual(msgs, ['hello peer']);
  } finally {
    await listener.node.stop();
    await dialer.node.stop();
    await helper.node.stop();
  }
});
