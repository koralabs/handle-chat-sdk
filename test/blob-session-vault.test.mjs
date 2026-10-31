import assert from 'node:assert/strict';
import test from 'node:test';

import { mediaMessage } from '@koralabs/handle-chat-sdk';
import {
  BLOB_CHUNK_MIME,
  BlobAssembler,
  buildBlobMessages,
  CHUNK_SIZE,
  isBlobChunk,
  isBlobPart,
  isBlobRef,
  MAX_BLOB_SIZE,
  parseBlobRef
} from '../lib/src/chat/blob.js';
import { EncryptedIdbVault } from '../lib/src/chat/sessionStore.js';

const payload = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + 3) % 256);

test('a multi-chunk blob is encrypted, chunked, and reassembled identically in any chunk order', async () => {
  const plain = payload(CHUNK_SIZE * 2 + 100);
  const { ref, chunks } = await buildBlobMessages('m1', 'image/png', plain, 'pic.png');
  assert.equal(chunks.length, 3);
  assert.equal(isBlobRef(ref), true);
  assert.equal(isBlobPart(chunks[0]) && isBlobChunk(chunks[0]), true);
  assert.equal(parseBlobRef(chunks[0]), null);
  assert.equal(parseBlobRef(ref).size, plain.length);
  // Ciphertext on the wire must not contain the plaintext.
  assert.notDeepEqual([...chunks[0].body.subarray(0, 64)], [...plain.subarray(0, 64)]);

  const asm = new BlobAssembler();
  assert.equal(await asm.accept(chunks[2]), null);
  assert.equal(await asm.accept(chunks[0]), null);
  assert.equal(await asm.accept(ref), null);
  const done = await asm.accept(chunks[1]);
  assert.equal(done.mime, 'image/png');
  assert.equal(done.meta.name, 'pic.png');
  assert.equal(done.meta.id, 'm1');
  assert.deepEqual([...done.body], [...plain]);
});

test('assembler rejects implausible refs, bad chunks, tampered ciphertext, and non-blob content', async () => {
  const { ref, chunks } = await buildBlobMessages('m2', 'audio/ogg', payload(500), 'a.ogg');
  const meta = parseBlobRef(ref);
  const withMeta = (patch) => ({ ...ref, body: new TextEncoder().encode(JSON.stringify({ ...meta, ...patch })) });

  const asm = new BlobAssembler();
  assert.equal(await asm.accept(withMeta({ chunks: 0 })), null);
  assert.equal(await asm.accept(withMeta({ chunks: 1.5 })), null);
  assert.equal(await asm.accept(withMeta({ size: MAX_BLOB_SIZE + 1 })), null);
  assert.equal(await asm.accept(withMeta({ size: -1 })), null);
  assert.equal(await asm.accept(mediaMessage('text/plain', payload(3))), null);
  assert.equal(await asm.accept(mediaMessage(BLOB_CHUNK_MIME, payload(3), { i: '0' })), null); // no ref
  assert.equal(await asm.accept(mediaMessage(BLOB_CHUNK_MIME, payload(3), { ref: 'x', i: '-1' })), null);
  assert.equal(await asm.accept(mediaMessage(BLOB_CHUNK_MIME, payload(CHUNK_SIZE + 1), { ref: 'x', i: '0' })), null);

  // chunk index past the declared count is refused once the ref is known
  await asm.accept(ref);
  assert.equal(await asm.accept(mediaMessage(BLOB_CHUNK_MIME, payload(3), { ref: meta.ref, i: '5' })), null);

  // tampered ciphertext fails the content-address check and yields nothing
  const bad = new Uint8Array(chunks[0].body);
  bad[0] ^= 0xff;
  assert.equal(await asm.accept(mediaMessage(BLOB_CHUNK_MIME, bad, chunks[0].meta)), null);
  // the failed blob was dropped, so the genuine chunk alone can't complete it without a ref
  assert.equal(await new BlobAssembler().accept(chunks[0]), null);
});

test('assembler evicts the oldest in-flight blob past the concurrency cap (control: completes without the flood)', async () => {
  const { ref, chunks } = await buildBlobMessages('e', 'x/y', payload(CHUNK_SIZE + 10), 'n');

  const calm = new BlobAssembler();
  await calm.accept(chunks[0]);
  await calm.accept(ref);
  assert.ok(await calm.accept(chunks[1]), 'control: completes when nothing evicts it');

  const flooded = new BlobAssembler();
  await flooded.accept(chunks[0]);
  for (let k = 0; k < 25; k++) await flooded.accept(mediaMessage(BLOB_CHUNK_MIME, payload(4), { ref: `r${k}`, i: '0' }));
  await flooded.accept(ref);
  assert.equal(await flooded.accept(chunks[1]), null, 'chunk 0 was evicted, so the blob cannot complete');
});

// Minimal in-memory IndexedDB covering only what the vault uses (open/createObjectStore/transaction/put/get).
function fakeIndexedDB() {
  const store = new Map();
  const request = (run) => {
    const req = {};
    queueMicrotask(() => { req.result = run(); req.onsuccess?.(); });
    return req;
  };
  const db = { transaction: () => ({ objectStore: () => ({ put: (v, k) => request(() => (store.set(k, v), k)), get: (k) => request(() => store.get(k)) }) }) };
  return {
    store,
    open: () => {
      const req = { result: { ...db, createObjectStore() {} } };
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    }
  };
}

test('session vault stores snapshots, history and queues encrypted at rest, and only the same seed can read them', async () => {
  const fake = fakeIndexedDB();
  globalThis.indexedDB = fake.open ? fake : undefined;
  try {
    const vault = await EncryptedIdbVault.create(payload(32));
    const snap = { state: payload(40), bundle: payload(9), contacts: ['$alice', '$bob'] };
    assert.equal(await vault.load('$me'), null);
    await vault.save('$me', snap);
    const back = await vault.load('$me');
    assert.deepEqual([...back.state], [...snap.state]);
    assert.deepEqual([...back.bundle], [...snap.bundle]);
    assert.deepEqual(back.contacts, snap.contacts);

    const msgs = [{ id: '1', text: 'secret-history-text' }];
    await vault.saveHistory('$me', '$bob', msgs);
    assert.deepEqual(await vault.loadHistory('$me', '$bob'), msgs);
    assert.equal(await vault.loadHistory('$me', '$nobody'), null);
    await vault.saveQueue('$me', [{ to: '$bob' }]);
    assert.deepEqual(await vault.loadQueue('$me'), [{ to: '$bob' }]);
    assert.equal(await vault.loadQueue('$other'), null);

    // At rest: the stored blob is ciphertext (no plaintext JSON) and a different seed cannot open it.
    const stored = fake.store.get('h:$me:$bob');
    assert.equal(Buffer.from(stored).includes('secret-history-text'), false);
    const other = await EncryptedIdbVault.create(payload(32).map((x) => x ^ 1));
    await assert.rejects(other.open(stored));
  } finally {
    delete globalThis.indexedDB;
  }
});
