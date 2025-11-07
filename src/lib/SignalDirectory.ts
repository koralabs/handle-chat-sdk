import {
    DeviceType,
    KeyHelper,
    PreKeyType,
    SignedPublicPreKeyType
} from "@privacyresearch/libsignal-protocol-typescript";
import {
    FullDirectoryEntry,
    SerializableFullDirectoryEntry,
} from "../interfaces/Directory.js";
import { SerializedStoreEntry, StoreEntry } from "../interfaces/Store.js";
import { SignalProtocolStore } from "./SignalProtocolStore.js";
import { arrayBufferToBase64, base64ToArrayBuffer } from "./helper.js";

export class SignalDirectory {
  private _data: { [address: string]: FullDirectoryEntry } = {};

  storeKeyBundle(address: string, bundle: FullDirectoryEntry): void {
    this._data[address] = bundle;
  }

  addOneTimePreKeys(address: string, keys: PreKeyType[]): void {
    this._data[address].oneTimePreKeys.unshift(...keys);
  }

  getPreKeyBundle(address: string): DeviceType | undefined {
    const bundle = this._data[address];
    if (!bundle) {
      return undefined;
    }
    const oneTimePreKey = bundle.oneTimePreKeys.pop();
    const { identityPubKey, signedPreKey, registrationId } = bundle;
    return {
      identityKey: identityPubKey,
      signedPreKey,
      preKey: oneTimePreKey,
      registrationId,
    };
  }
}

// Serialize ArrayBuffer to base64 for storage
export const serializeBundle = (
  bundle: FullDirectoryEntry
): SerializableFullDirectoryEntry => {
  return {
    registrationId: bundle.registrationId,
    identityPubKey: arrayBufferToBase64(bundle.identityPubKey),
    signedPreKey: {
      keyId: bundle.signedPreKey.keyId,
      publicKey: arrayBufferToBase64(bundle.signedPreKey.publicKey),
      signature: arrayBufferToBase64(bundle.signedPreKey.signature),
    },
    oneTimePreKeys: bundle.oneTimePreKeys.map((key) => ({
      keyId: key.keyId,
      publicKey: arrayBufferToBase64(key.publicKey),
    })),
  };
};

// Deserialize base64 back to ArrayBuffer
export const deserializeBundle = (
  serializable: SerializableFullDirectoryEntry
): DeviceType => {
  const deserializedBundle: FullDirectoryEntry = {
    registrationId: serializable.registrationId,
    identityPubKey: base64ToArrayBuffer(serializable.identityPubKey),
    signedPreKey: {
      keyId: serializable.signedPreKey.keyId,
      publicKey: base64ToArrayBuffer(serializable.signedPreKey.publicKey),
      signature: base64ToArrayBuffer(serializable.signedPreKey.signature),
    },
    oneTimePreKeys: serializable.oneTimePreKeys.map((key) => ({
      keyId: key.keyId,
      publicKey: base64ToArrayBuffer(key.publicKey),
    })),
  };

  const oneTimePreKey = deserializedBundle.oneTimePreKeys.pop();
  const { identityPubKey, signedPreKey, registrationId } = deserializedBundle;
  return {
    identityKey: identityPubKey,
    signedPreKey,
    preKey: oneTimePreKey,
    registrationId,
  };
};

export const serializeStore = (entry: StoreEntry): SerializedStoreEntry => {
  return {
    registrationId: entry.registrationId,
    identityKey: {
		pubKey: arrayBufferToBase64(entry.identityKey.pubKey),
    	privKey: arrayBufferToBase64(entry.identityKey.privKey)
	  },
    preKey: {
      keyId: entry.preKey.keyId,
      keyPair: {
		pubKey: arrayBufferToBase64(entry.preKey.keyPair.pubKey),
      	privKey: arrayBufferToBase64(entry.preKey.keyPair.privKey),
	  }
    },
    signedPreKey: {
      keyId: entry.signedPreKey.keyId,
      keyPair: {
		pubKey: arrayBufferToBase64(entry.signedPreKey.keyPair.pubKey),
      	privKey: arrayBufferToBase64(entry.signedPreKey.keyPair.privKey),
	  },
	  signature: arrayBufferToBase64(entry.signedPreKey.signature)
    }
  };
};

export const deserializeStore = (serializedEntry: SerializedStoreEntry): StoreEntry => {
  return {
    registrationId: serializedEntry.registrationId,
    identityKey: {
		pubKey: base64ToArrayBuffer(serializedEntry.identityKey.pubKey),
    	privKey: base64ToArrayBuffer(serializedEntry.identityKey.privKey)
	},
    preKey: {
      keyId: serializedEntry.preKey.keyId,
	  keyPair: {
		pubKey: base64ToArrayBuffer(serializedEntry.preKey.keyPair.pubKey),
		privKey: base64ToArrayBuffer(serializedEntry.preKey.keyPair.privKey),
	  }
    },
    signedPreKey: {
      keyId: serializedEntry.signedPreKey.keyId,
      keyPair: {
		pubKey: base64ToArrayBuffer(serializedEntry.signedPreKey.keyPair.pubKey),
      	privKey: base64ToArrayBuffer(serializedEntry.signedPreKey.keyPair.privKey),
	  },
	  signature: base64ToArrayBuffer(serializedEntry.signedPreKey.signature)
    }
  };
};

export const populateStore = (store: SignalProtocolStore, storeEntry: StoreEntry) => {
	const { registrationId, identityKey: identityKeyPair, preKey, signedPreKey } = storeEntry;
	store.storeRegistrationId(registrationId);
	store.storeIdentityKey(identityKeyPair);
	store.storePreKey(`${preKey.keyId}`, preKey.keyPair);
	store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);
}

export const createStoreBundle = async () => {
  const registrationId = KeyHelper.generateRegistrationId();

  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();

  const baseKeyId = Math.floor(10000 * Math.random());
  const preKey = await KeyHelper.generatePreKey(baseKeyId);

  const signedPreKeyId = Math.floor(10000 * Math.random());
  const signedPreKey = await KeyHelper.generateSignedPreKey(
    identityKeyPair,
    signedPreKeyId
  );

  const storeEntry: StoreEntry = {
	registrationId,
	identityKey: identityKeyPair,
	preKey,
	signedPreKey,
  }

  const publicSignedPreKey: SignedPublicPreKeyType = {
    keyId: signedPreKeyId,
    publicKey: signedPreKey.keyPair.pubKey,
    signature: signedPreKey.signature,
  };

  // Now we register this with the server so all users can see them
  const publicPreKey: PreKeyType = {
    keyId: preKey.keyId,
    publicKey: preKey.keyPair.pubKey,
  };

  const bundle: FullDirectoryEntry = {
    registrationId,
    identityPubKey: identityKeyPair.pubKey,
    signedPreKey: publicSignedPreKey,
    oneTimePreKeys: [publicPreKey],
  };

  return { bundle, storeEntry };
};

export const createID = async (
  directory: SignalDirectory,
  name: string,
  store: SignalProtocolStore
) => {
  const { bundle, storeEntry } = await createStoreBundle();
  populateStore(store, storeEntry);
  directory.storeKeyBundle(name, bundle);

  return {bundle, storeEntry};
};
