import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  arrayBufferToBase64,
  arrayBufferToString,
  base64ToArrayBuffer,
  createID,
  createStoreBundle,
  deserializeBundle,
  deserializeStore,
  encryptAndBuildMessage,
  isKeyPairType,
  isPreKeyType,
  isSignedPreKeyType,
  populateStore,
  readMessage,
  serializeBundle,
  serializeStore,
  SignalDirectory,
  SignalProtocolStore,
} from './index.js';

describe('public SDK entrypoint', () => {
  it('re-exports runtime helpers from source modules', () => {
    const runtimeExports = [
      arrayBufferToBase64,
      arrayBufferToString,
      base64ToArrayBuffer,
      createID,
      createStoreBundle,
      deserializeBundle,
      deserializeStore,
      encryptAndBuildMessage,
      isKeyPairType,
      isPreKeyType,
      isSignedPreKeyType,
      populateStore,
      readMessage,
      serializeBundle,
      serializeStore,
    ];

    for (const exportedValue of runtimeExports) {
      assert.equal(typeof exportedValue, 'function');
    }

    assert.equal(typeof SignalDirectory, 'function');
    assert.equal(typeof SignalProtocolStore, 'function');
  });

  it('exposes usable directory and store constructors', async () => {
    const directory = new SignalDirectory();
    const store = new SignalProtocolStore();

    assert.equal(directory.getPreKeyBundle('missing'), undefined);
    await store.storeRegistrationId(123);
    assert.equal(await store.getLocalRegistrationId(), 123);
  });
});
