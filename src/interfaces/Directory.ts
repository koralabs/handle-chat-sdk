import { PreKeyType, SignedPublicPreKeyType } from "@privacyresearch/libsignal-protocol-typescript"

export interface PublicDirectoryEntry {
    identityPubKey: ArrayBuffer
    signedPreKey: SignedPublicPreKeyType
    oneTimePreKey?: ArrayBuffer
}

export interface FullDirectoryEntry {
    registrationId: number
    identityPubKey: ArrayBuffer
    signedPreKey: SignedPublicPreKeyType
    oneTimePreKeys: PreKeyType[]
}

export interface SerializablePreKey {
    keyId: number
    publicKey: string // base64
}

// Serializable versions for localStorage
export interface SerializableSignedPublicPreKey {
    keyId: number
    publicKey: string // base64
    signature: string // base64
}

export interface SerializableFullDirectoryEntry {
    registrationId: number
    identityPubKey: string // base64
    signedPreKey: SerializableSignedPublicPreKey
    oneTimePreKeys: SerializablePreKey[]
}