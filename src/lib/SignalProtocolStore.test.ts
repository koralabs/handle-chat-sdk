import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { arrayBufferToString, SignalProtocolStore } from './SignalProtocolStore.js';

const buffer = (...bytes: number[]) => new Uint8Array(bytes).buffer;
const bytes = (value: ArrayBuffer | undefined) =>
  value === undefined ? undefined : Array.from(new Uint8Array(value));

describe('SignalProtocolStore session and identity cleanup', () => {
  it('removes every session for an identifier without touching other sessions', async () => {
    const store = new SignalProtocolStore();

    await store.storeSession('alice.1', 'alice-phone');
    await store.storeSession('alice.2', 'alice-tablet');
    await store.storeSession('bob.1', 'bob-phone');

    await store.removeAllSessions('alice');

    assert.equal(await store.loadSession('alice.1'), undefined);
    assert.equal(await store.loadSession('alice.2'), undefined);
    assert.equal(await store.loadSession('bob.1'), 'bob-phone');
  });

  it('removes a saved identity without touching similarly named identities', async () => {
    const store = new SignalProtocolStore();

    await store.saveIdentity('alice.1', buffer(1));
    await store.saveIdentity('alice2.1', buffer(2));

    await store.removeSessionIdentity('alice');

    assert.equal(await store.loadIdentityKey('alice'), undefined);
    assert.deepEqual(bytes(await store.loadIdentityKey('alice2')), [2]);
  });
});

describe('SignalProtocolStore validation helpers', () => {
  it('rejects null identifiers for trust and identity reads', async () => {
    const store = new SignalProtocolStore();

    assert.throws(
      () => store.isTrustedIdentity(null as unknown as string, buffer(1), 1),
      /undefined\/null/
    );
    await assert.rejects(
      store.loadIdentityKey(null as unknown as string),
      /undefined\/null/
    );
  });

  it('rejects non-buffer values loaded as identities', async () => {
    const store = new SignalProtocolStore();

    store.put('identityKeyalice', 'not-a-buffer');

    await assert.rejects(store.loadIdentityKey('alice'), /Identity key has wrong type/);
  });

  it('converts buffers larger than the internal chunk size', () => {
    const expected = 'a'.repeat(1030);
    const source = new Uint8Array(expected.length);
    source.fill('a'.charCodeAt(0));

    assert.equal(arrayBufferToString(source.buffer), expected);
  });
});
