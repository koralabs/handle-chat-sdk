import { KeyPairType, PreKeyPairType, SignedPreKeyPairType } from "@privacyresearch/libsignal-protocol-typescript";

export interface StoreEntry {
      registrationId: number;
      identityKey: KeyPairType;
      preKey: PreKeyPairType;
      signedPreKey: SignedPreKeyPairType;
}

export interface SerializedStoreEntry {
    registrationId: number;
    identityKey: {
        pubKey: string;
        privKey: string;
    };
    preKey: {
        keyId: number;
        keyPair: {
            pubKey: string;
            privKey: string;
        };
    };
    signedPreKey: {
        keyId: number;
        keyPair: {
            pubKey: string;
            privKey: string;
        };
        signature: string;
    };
}