import assert from 'node:assert/strict';
import test from 'node:test';

import { ANCHOR_METADATA_LABEL, decodeAnchorMetadata, encodeAnchorMetadata } from '../lib/src/chat/anchor.js';
import { ChainAnchorStore } from '../lib/src/chat/chainDirectory.js';
import { publishAnchor } from '../lib/src/chat/publish.js';
import { readFrame, sendFrame } from '../lib/src/chat/mesh/wire.js';

const bundle = Uint8Array.from({ length: 100 }, (_, i) => i);

test('anchor metadata splits the bundle into 64-char hex chunks and round-trips', () => {
  const md = encodeAnchorMetadata('$alice', bundle);
  assert.equal(md[0], '$alice');
  assert.deepEqual(md.slice(1).map((c) => c.length), [64, 64, 64, 8]);
  assert.deepEqual(decodeAnchorMetadata(md), { handle: '$alice', bundle });
});

test('decodeAnchorMetadata rejects malformed anchors', () => {
  assert.equal(decodeAnchorMetadata('nope'), null);
  assert.equal(decodeAnchorMetadata(['$a']), null);
  assert.equal(decodeAnchorMetadata(['$a', 5]), null);
  assert.equal(decodeAnchorMetadata(['$a', 'zz']), null);
  assert.equal(decodeAnchorMetadata(['$a', '']), null);
});

function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const hit = Object.entries(routes).find(([k]) => url.endsWith(k));
    if (!hit) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => hit[1] };
  };
}

test('ChainAnchorStore resolves the newest anchor for the handle, skipping others', async () => {
  const calls = [];
  const store = new ChainAnchorStore({
    env: 'preview',
    blockfrostApiKey: 'KEY',
    fetchImpl: fakeFetch(
      {
        '/handles/alice': { resolved_addresses: { ada: 'addr_test1x' } },
        'addr_test1x/transactions?order=desc&count=25': [{ tx_hash: 't1' }, { tx_hash: 't2' }, { tx_hash: 't3' }],
        '/txs/t1/metadata': [{ label: '1', json_metadata: {} }],
        '/txs/t2/metadata': [{ label: String(ANCHOR_METADATA_LABEL), json_metadata: encodeAnchorMetadata('$mallory', Uint8Array.of(9)) }],
        '/txs/t3/metadata': [{ label: String(ANCHOR_METADATA_LABEL), json_metadata: encodeAnchorMetadata('$alice', Uint8Array.of(1, 2)) }]
      },
      calls
    )
  });
  assert.deepEqual(await store.resolve('$alice'), Uint8Array.of(1, 2));
  assert.equal(calls[0].url, 'https://preview.api.handle.me/handles/alice');
  assert.equal(calls[1].init.headers.project_id, 'KEY');
  assert.match(calls[1].url, /^https:\/\/cardano-preview\.blockfrost\.io\/api\/v0\//);
});

test('ChainAnchorStore returns null for unknown handle or no anchor, and throws on Blockfrost errors', async () => {
  const mk = (routes) => new ChainAnchorStore({ env: 'mainnet', blockfrostApiKey: 'k', fetchImpl: fakeFetch(routes) });
  assert.equal(await mk({}).resolve('$ghost'), null);
  assert.equal(await mk({ '/handles/bob': { resolved_addresses: {} } }).resolve('$bob'), null);
  const none = mk({ '/handles/bob': { resolved_addresses: { ada: 'a1' } }, 'a1/transactions?order=desc&count=25': [] });
  assert.equal(await none.resolve('$bob'), null);
  assert.equal(none.apiBase, 'https://api.handle.me');
  await assert.rejects(mk({ '/handles/bob': { resolved_addresses: { ada: 'a1' } } }).resolve('$bob'), /Blockfrost .*404/);
});

test('publishAnchor builds, wallet-signs, assembles and submits in order', async () => {
  const log = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    log.push([url, body]);
    return { ok: true, json: async () => (url.endsWith('/build') ? { unsigned: 'UNS' } : { signed: 'SIG' }) };
  };
  try {
    const hash = await publishAnchor('$alice', Uint8Array.of(0xab, 0x01), 'addr1', {
      bffUrl: 'https://bff',
      signTx: async (tx, partial) => `W(${tx},${partial})`,
      submitTx: async (s) => `hash:${s}`
    });
    assert.equal(hash, 'hash:SIG');
    assert.deepEqual(log, [
      ['https://bff/anchor/build', { handle: '$alice', bundle: 'ab01', address: 'addr1' }],
      ['https://bff/anchor/assemble', { unsigned: 'UNS', witness: 'W(UNS,true)' }]
    ]);
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    await assert.rejects(publishAnchor('$a', Uint8Array.of(1), 'x', { bffUrl: 'https://bff', signTx: async () => '', submitTx: async () => '' }), /500/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('wire frames are length-prefixed and reassembled across split chunks', async () => {
  const sent = [];
  sendFrame({ send: (b) => sent.push(b) }, Uint8Array.of(7, 8, 9));
  assert.deepEqual(sent[0], Uint8Array.of(0, 0, 0, 3));
  const all = Uint8Array.of(...sent[0], ...sent[1], 99);
  async function* split() {
    yield all.subarray(0, 2);
    yield all.subarray(2, 5);
    yield all.subarray(5);
  }
  assert.deepEqual(await readFrame(split()), Uint8Array.of(7, 8, 9));
  async function* truncated() {
    yield all.subarray(0, 5);
  }
  await assert.rejects(readFrame(truncated()), /before a full frame/);
});
