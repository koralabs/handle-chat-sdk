import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  deserializeBundle,
  deserializeStore,
  serializeBundle,
  serializeStore,
  SignalDirectory,
} from './SignalDirectory.js';
import {
  arrayBufferToString,
  isKeyPairType,
  isPreKeyType,
  isSignedPreKeyType,
  SignalProtocolStore,
} from './SignalProtocolStore.js';
import { arrayBufferToBase64, base64ToArrayBuffer } from './helper.js';

const buffer = (...bytes: number[]) => new Uint8Array(bytes).buffer;
const bytes = (value: ArrayBuffer) => Array.from(new Uint8Array(value));

describe('array buffer helpers', () => {
  it('round trips arbitrary bytes through base64', () => {
    const original = buffer(0, 1, 2, 127, 128, 255);
    const encoded = arrayBufferToBase64(original);

    assert.equal(encoded, 'AAECf4D/');
    assert.deepEqual(bytes(base64ToArrayBuffer(encoded)), bytes(original));
  });

  it('preserves empty buffers and string conversion', () => {
    assert.equal(arrayBufferToBase64(buffer()), '');
    assert.equal(bytes(base64ToArrayBuffer('')).length, 0);
    assert.equal(arrayBufferToString(buffer(72, 105)), 'Hi');
  });
});

describe('SignalDirectory', () => {
  const makeBundle = () => ({
    registrationId: 42,
    identityPubKey: buffer(1, 2, 3),
    signedPreKey: {
      keyId: 7,
      publicKey: buffer(4, 5, 6),
      signature: buffer(7, 8, 9),
    },
    oneTimePreKeys: [
      { keyId: 1, publicKey: buffer(10) },
      { keyId: 2, publicKey: buffer(20) },
    ],
  });

  it('stores bundles and consumes one-time prekeys in LIFO order', () => {
    const directory = new SignalDirectory();
    const bundle = makeBundle();

    directory.storeKeyBundle('alice', bundle);

    assert.equal(directory.getPreKeyBundle('unknown'), undefined);
    assert.equal(directory.getPreKeyBundle('alice')?.preKey?.keyId, 2);
    assert.equal(directory.getPreKeyBundle('alice')?.preKey?.keyId, 1);
    assert.equal(directory.getPreKeyBundle('alice')?.preKey, undefined);
  });

  it('prepends added one-time prekeys before consuming', () => {
    const directory = new SignalDirectory();
    directory.storeKeyBundle('alice', makeBundle());

    directory.addOneTimePreKeys('alice', [
      { keyId: 3, publicKey: buffer(30) },
      { keyId: 4, publicKey: buffer(40) },
    ]);

    assert.equal(directory.getPreKeyBundle('alice')?.preKey?.keyId, 2);
    assert.equal(directory.getPreKeyBundle('alice')?.preKey?.keyId, 1);
    assert.equal(directory.getPreKeyBundle('alice')?.preKey?.keyId, 4);
    assert.equal(directory.getPreKeyBundle('alice')?.preKey?.keyId, 3);
  });

  it('serializes and deserializes public bundle keys without mutating the input', () => {
    const bundle = makeBundle();
    const serialized = serializeBundle(bundle);
    const deserialized = deserializeBundle(serialized);

    assert.deepEqual(serialized, {
      registrationId: 42,
      identityPubKey: 'AQID',
      signedPreKey: { keyId: 7, publicKey: 'BAUG', signature: 'BwgJ' },
      oneTimePreKeys: [
        { keyId: 1, publicKey: 'Cg==' },
        { keyId: 2, publicKey: 'FA==' },
      ],
    });
    assert.equal(bundle.oneTimePreKeys.length, 2);
    assert.equal(deserialized.registrationId, 42);
    assert.deepEqual(bytes(deserialized.identityKey), [1, 2, 3]);
    assert.equal(deserialized.preKey?.keyId, 2);
  });
});

describe('SignalProtocolStore', () => {
  const keyPair = (pub: number, priv: number) => ({
    pubKey: buffer(pub),
    privKey: buffer(priv),
  });

  it('stores, loads, and removes core key and session entries', async () => {
    const store = new SignalProtocolStore();
    const identity = keyPair(1, 2);
    const preKey = keyPair(3, 4);
    const signedPreKey = keyPair(5, 6);

    await store.storeIdentityKey(identity);
    await store.storePreKey(11, preKey);
    await store.storeSignedPreKey('12', signedPreKey);
    await store.storeSession('alice.1', 'session-record');

    assert.equal(await store.getIdentityKeyPair(), identity);
    assert.deepEqual(await store.loadPreKey(11), preKey);
    assert.deepEqual(await store.loadSignedPreKey('12'), signedPreKey);
    assert.equal(await store.loadSession('alice.1'), 'session-record');

    await store.removePreKey(11);
    await store.removeSignedPreKey('12');
    await store.removeSession('alice.1');

    assert.equal(await store.loadPreKey(11), undefined);
    assert.equal(await store.loadSignedPreKey('12'), undefined);
    assert.equal(await store.loadSession('alice.1'), undefined);
  });

  it('tracks identity trust and whether an identity changed', async () => {
    const store = new SignalProtocolStore();

    assert.equal(await store.isTrustedIdentity('alice.1', buffer(1), 1), true);
    assert.equal(await store.saveIdentity('alice.1', buffer(1)), false);
    assert.deepEqual(bytes((await store.loadIdentityKey('alice'))!), [1]);
    assert.equal(await store.isTrustedIdentity('alice', buffer(1), 1), true);
    assert.equal(await store.saveIdentity('alice.1', buffer(2)), true);
    assert.equal(await store.isTrustedIdentity('alice', buffer(1), 1), false);
  });

  it('rejects undefined keys, undefined values, and wrong stored types', async () => {
    const store = new SignalProtocolStore();

    assert.throws(() => store.get(undefined as unknown as string, undefined), /undefined\/null key/);
    assert.throws(() => store.put('bad', undefined), /undefined\/null/);

    store.put('registrationId', 'not-a-number');
    await assert.rejects(store.getLocalRegistrationId(), /not a number/);

    store.put('25519KeypreKeybad', 'not-a-key');
    await assert.rejects(store.loadPreKey('bad'), /wrong type/);

    store.put('sessionbad', buffer(1));
    await assert.rejects(store.loadSession('bad'), /session record is not an ArrayBuffer/);
  });

  it('removes sessions and identities for a matching identifier only', async () => {
    const store = new SignalProtocolStore();

    await store.storeSession('alice.1', 'alice-session');
    await store.storeSession('bob.1', 'bob-session');
    await store.saveIdentity('alice.1', buffer(1));
    await store.saveIdentity('bob.1', buffer(2));

    await store.removeKeysWithIdentifier('alice');

    assert.equal(await store.loadSession('alice.1'), undefined);
    assert.equal(await store.loadIdentityKey('alice'), undefined);
    assert.equal(await store.loadSession('bob.1'), 'bob-session');
    assert.deepEqual(bytes((await store.loadIdentityKey('bob'))!), [2]);
  });

  it('identifies supported key shapes', () => {
    const pair = keyPair(1, 2);
    const preKey = { keyId: 1, keyPair: pair };
    const signedPreKey = { ...preKey, signature: buffer(3) };

    assert.equal(isKeyPairType(pair), true);
    assert.equal(isKeyPairType({ pubKey: buffer(1) }), false);
    assert.equal(isPreKeyType(preKey), true);
    assert.equal(isPreKeyType({ keyId: '1', keyPair: pair }), false);
    assert.equal(isSignedPreKeyType(signedPreKey), true);
    assert.equal(Boolean(isSignedPreKeyType(preKey)), false);
  });
});

describe('store serialization helpers', () => {
  it('round trips private store entries through base64', () => {
    const entry = {
      registrationId: 99,
      identityKey: { pubKey: buffer(1), privKey: buffer(2) },
      preKey: { keyId: 3, keyPair: { pubKey: buffer(4), privKey: buffer(5) } },
      signedPreKey: {
        keyId: 6,
        keyPair: { pubKey: buffer(7), privKey: buffer(8) },
        signature: buffer(9),
      },
    };

    const serialized = serializeStore(entry);
    const deserialized = deserializeStore(serialized);

    assert.deepEqual(serialized, {
      registrationId: 99,
      identityKey: { pubKey: 'AQ==', privKey: 'Ag==' },
      preKey: { keyId: 3, keyPair: { pubKey: 'BA==', privKey: 'BQ==' } },
      signedPreKey: {
        keyId: 6,
        keyPair: { pubKey: 'Bw==', privKey: 'CA==' },
        signature: 'CQ==',
      },
    });
    assert.equal(deserialized.registrationId, entry.registrationId);
    assert.deepEqual(bytes(deserialized.signedPreKey.signature), [9]);
    assert.deepEqual(bytes(deserialized.preKey.keyPair.pubKey), [4]);
  });
});
