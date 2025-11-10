# Handle Chat SDK

[![npm version](https://badge.fury.io/js/@koralabs%2Fhandle-chat-sdk.svg)](https://badge.fury.io/js/@koralabs%2Fhandle-chat-sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A TypeScript SDK for building secure, end-to-end encrypted chat applications using the Signal Protocol. This SDK provides a high-level interface for managing encrypted messaging, user identities, and secure sessions.

## Features

- 🔐 **End-to-End Encryption**: Built on Signal Protocol for maximum security
- 👥 **Multi-User Support**: Handle multiple chat participants
- 🔑 **Key Management**: Automatic key generation and bundle management
- 💾 **Persistent Storage**: Serialize/deserialize cryptographic state
- 📱 **Session Management**: Handle encrypted sessions between users
- 🛡️ **Type Safety**: Full TypeScript support with comprehensive type definitions

## Installation

```bash
npm install @koralabs/handle-chat-sdk
```

## Quick Start

### 1. Basic Setup

```typescript
import { 
  SignalDirectory, 
  SignalProtocolStore, 
  createID, 
  encryptAndBuildMessage,
  readMessage 
} from '@koralabs/handle-chat-sdk';

// Create a directory to manage user bundles
const directory = new SignalDirectory();

// Create stores for two users
const aliceStore = new SignalProtocolStore();
const bobStore = new SignalProtocolStore();
```

### 2. Create User Identities

```typescript
// Create Alice's identity
const aliceResult = await createStoreBundle();
const aliceUser = {
  address: 'alice',
  name: 'Alice',
  accepted: true,
  chats: [],
  deviceId: 1,
  bundle: bobResult.bundle,
  store: bobResult.storeEntry
};

// Create Bob's identity
const bobResult = await createStoreBundle();
const bobUser = {
  address: 'bob',
  name: 'Bob',
  accepted: true,
  chats: [],
  deviceId: 1,
  bundle: bobResult.bundle,
  store: bobResult.storeEntry
};
```

### 3. Send Encrypted Messages

```typescript
import { SessionBuilder, SignalProtocolAddress } from '@privacyresearch/libsignal-protocol-typescript';

// Alice wants to send a message to Bob
const message = "Hello Bob! This is an encrypted message.";

// Get Bob's pre-key bundle for session establishment
const bobBundle = directory.getPreKeyBundle('bob');

if (bobBundle) {
  // Build a session with Bob
  const bobAddress = new SignalProtocolAddress('bob', 1);
  const sessionBuilder = new SessionBuilder(aliceStore, bobAddress);
  await sessionBuilder.processPreKey(bobBundle);

  // Encrypt and build the message
  const { msg, processedMsg } = await encryptAndBuildMessage({
    message,
    senderUser: aliceUser,
    senderStore: aliceStore,
    recipientUser: bobUser,
    sessionInit: true
  });

  console.log('Encrypted message:', msg);
  console.log('Processed message:', processedMsg);
}
```

### 4. Receive and Decrypt Messages

```typescript
import { SessionCipher } from '@privacyresearch/libsignal-protocol-typescript';

// Bob receives Alice's message
const aliceAddress = new SignalProtocolAddress('alice', 1);
const cipher = new SessionCipher(bobStore, aliceAddress);

// Decrypt the message
const decryptedMessage = await readMessage(msg, cipher);
console.log('Decrypted message:', decryptedMessage.messageText);
// Output: "Hello Bob! This is an encrypted message."
```

## Advanced Usage

### Serialization for Persistent Storage

The SDK provides utilities to serialize cryptographic data for storage:

```typescript
import { 
  serializeBundle, 
  deserializeBundle, 
  serializeStore, 
  deserializeStore 
} from '@koralabs/handle-chat-sdk';

// Serialize user bundle for storage
const serializedBundle = serializeBundle(aliceResult.bundle);
localStorage.setItem('alice_bundle', JSON.stringify(serializedBundle));

// Serialize user store for storage
const serializedStore = serializeStore(aliceResult.storeEntry);
localStorage.setItem('alice_store', JSON.stringify(serializedStore));

// Later, deserialize from storage
const storedBundle = JSON.parse(localStorage.getItem('alice_bundle'));
const deserializedBundle = deserializeBundle(storedBundle);

const storedStore = JSON.parse(localStorage.getItem('alice_store'));
const deserializedStore = deserializeStore(storedStore);
```

### Working with Chat Users

```typescript
import { ChatUser, ProcessedChatMessage } from '@koralabs/handle-chat-sdk';

// Complete chat user example
const chatUser: ChatUser = {
  address: 'user123',
  name: 'John Doe',
  accepted: true,
  chats: [],
  waitingForSession: false,
  hasPendingChats: false,
  deviceId: 1,
  image: 'https://example.com/avatar.jpg',
  bundle: serializeBundle(userBundle),
  store: serializeStore(userStore)
};

// Add a processed message to the user's chat history
const processedMessage: ProcessedChatMessage = {
  id: Date.now(),
  to: 'user123',
  from: 'currentUser',
  messageText: 'Hello there!',
  timestamp: Date.now()
};

chatUser.chats.push(processedMessage);
```

### Helper Functions

The SDK includes utility functions for data conversion:

```typescript
import { arrayBufferToBase64, base64ToArrayBuffer } from '@koralabs/handle-chat-sdk';

// Convert ArrayBuffer to base64 string
const buffer = new TextEncoder().encode('Hello World');
const base64String = arrayBufferToBase64(buffer.buffer);

// Convert base64 string back to ArrayBuffer
const reconstructedBuffer = base64ToArrayBuffer(base64String);
const text = new TextDecoder().decode(reconstructedBuffer);
console.log(text); // "Hello World"
```

### Error Handling

The SDK includes robust error handling for message decryption:

```typescript
// The readMessage function handles decryption errors gracefully
const result = await readMessage(corruptedMessage, cipher);

if (result.messageText.startsWith('[Failed to decrypt message]')) {
  console.error('Message decryption failed:', result.messageText);
  // Handle the error appropriately in your application
}
```

## Complete Example: Two-User Chat

```typescript
import {
  SignalDirectory,
  SignalProtocolStore,
  createID,
  encryptAndBuildMessage,
  readMessage,
  serializeBundle,
  serializeStore
} from '@koralabs/handle-chat-sdk';

import { 
  SessionBuilder, 
  SessionCipher, 
  SignalProtocolAddress 
} from '@privacyresearch/libsignal-protocol-typescript';

async function createSecureChat() {
  // Setup
  const directory = new SignalDirectory();
  const aliceStore = new SignalProtocolStore();
  const bobStore = new SignalProtocolStore();

  // Create identities
  const aliceResult = await createID(directory, 'alice', aliceStore);
  const bobResult = await createID(directory, 'bob', bobStore);

  // Create user objects
  const aliceUser = {
    address: 'alice',
    name: 'Alice',
    accepted: true,
    chats: [],
    deviceId: 1,
    bundle: serializeBundle(aliceResult.bundle),
    store: serializeStore(aliceResult.storeEntry)
  };

  const bobUser = {
    address: 'bob',
    name: 'Bob',
    accepted: true,
    chats: [],
    deviceId: 1,
    bundle: serializeBundle(bobResult.bundle),
    store: serializeStore(bobResult.storeEntry)
  };

  // Alice sends a message to Bob
  const bobBundle = directory.getPreKeyBundle('bob');
  if (bobBundle) {
    const bobAddress = new SignalProtocolAddress('bob', 1);
    const sessionBuilder = new SessionBuilder(aliceStore, bobAddress);
    await sessionBuilder.processPreKey(bobBundle);

    const { msg } = await encryptAndBuildMessage({
      message: "Hello Bob! How are you?",
      senderUser: aliceUser,
      senderStore: aliceStore,
      recipientUser: bobUser,
      sessionInit: true
    });

    // Bob receives and decrypts the message
    const aliceAddress = new SignalProtocolAddress('alice', 1);
    const cipher = new SessionCipher(bobStore, aliceAddress);
    const decryptedMessage = await readMessage(msg, cipher);
    
    console.log('Bob received:', decryptedMessage.messageText);
    // Output: "Hello Bob! How are you?"

    // Bob replies to Alice
    const aliceBundle = directory.getPreKeyBundle('alice');
    if (aliceBundle) {
      const aliceSessionBuilder = new SessionBuilder(bobStore, aliceAddress);
      await aliceSessionBuilder.processPreKey(aliceBundle);

      const { msg: replyMsg } = await encryptAndBuildMessage({
        message: "Hi Alice! I'm doing great, thanks!",
        senderUser: bobUser,
        senderStore: bobStore,
        recipientUser: aliceUser
      });

      // Alice receives Bob's reply
      const aliceCipher = new SessionCipher(aliceStore, bobAddress);
      const decryptedReply = await readMessage(replyMsg, aliceCipher);
      
      console.log('Alice received:', decryptedReply.messageText);
      // Output: "Hi Alice! I'm doing great, thanks!"
    }
  }
}

createSecureChat().catch(console.error);
```

## API Reference

### Interfaces

#### `ChatUser`
Represents a chat participant with their cryptographic identity and message history.

#### `ChatMessage` 
Represents an encrypted message between users.

#### `ProcessedChatMessage`
Represents a decrypted, human-readable message.

#### `FullDirectoryEntry`
Contains the complete cryptographic bundle for a user.

#### `SerializableFullDirectoryEntry`
Serializable version of `FullDirectoryEntry` for storage.

### Classes

#### `SignalDirectory`
Manages user key bundles and pre-key distribution.

#### `SignalProtocolStore` 
Implements the Signal Protocol storage interface for cryptographic state.

### Functions

#### `createID(directory, name, store)`
Creates a new user identity with cryptographic keys.

#### `encryptAndBuildMessage(options)`
Encrypts a message and builds both encrypted and processed message objects.

#### `readMessage(msg, cipher)`
Decrypts an encrypted message using the provided cipher.

#### `serializeBundle(bundle)` / `deserializeBundle(serialized)`
Convert key bundles to/from serializable format.

#### `serializeStore(store)` / `deserializeStore(serialized)`
Convert protocol stores to/from serializable format.

## Requirements

- Node.js 16+
- TypeScript 4.5+

## Dependencies

- `@privacyresearch/libsignal-protocol-typescript`: Signal Protocol implementation
- `@signalapp/libsignal-client`: Signal client library
- `uuid`: UUID generation

## License

MIT

## Contributing

Contributions are welcome! Please read our contributing guidelines and submit pull requests to our repository.

## Support

For issues and questions, please use the GitHub issue tracker.