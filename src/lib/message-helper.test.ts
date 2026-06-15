import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from '@privacyresearch/libsignal-protocol-typescript';

import type { ChatMessage, ChatUser } from '../interfaces/Chat.js';
import { encryptAndBuildMessage, readMessage } from './message-helper.js';
import { createID, SignalDirectory } from './SignalDirectory.js';
import { SignalProtocolStore } from './SignalProtocolStore.js';

const textBuffer = (value: string) => new TextEncoder().encode(value).buffer;

const makeMessage = (type: number): ChatMessage => ({
  id: 123,
  to: 'bob',
  from: 'alice',
  message: { type, body: 'ciphertext' },
  delivered: false,
  timestamp: 1710000000000,
});

const fakeCipher = (
  handlers: Partial<Pick<SessionCipher, 'decryptPreKeyWhisperMessage' | 'decryptWhisperMessage'>>
) => handlers as unknown as SessionCipher;

const makeUser = (address: string, deviceId?: number): ChatUser => ({
  address,
  name: address,
  accepted: true,
  active: true,
  chats: [],
  ...(deviceId === undefined ? {} : { deviceId }),
});

const createOutboundSession = async () => {
  const directory = new SignalDirectory();
  const senderStore = new SignalProtocolStore();
  const recipientStore = new SignalProtocolStore();

  await createID(directory, 'alice', senderStore);
  await createID(directory, 'bob', recipientStore);

  const recipientAddress = new SignalProtocolAddress('bob', 1);
  const recipientBundle = directory.getPreKeyBundle('bob');
  assert.ok(recipientBundle);

  await new SessionBuilder(senderStore, recipientAddress).processPreKey(recipientBundle);

  return { senderStore, recipientStore };
};

describe('readMessage', () => {
  it('decrypts pre-key messages and keeps chat metadata', async () => {
    const decrypted = await readMessage(
      makeMessage(3),
      fakeCipher({
        decryptPreKeyWhisperMessage: async (body, encoding) => {
          assert.equal(body, 'ciphertext');
          assert.equal(encoding, 'binary');
          return textBuffer('pre-key plaintext');
        },
      })
    );

    assert.deepEqual(decrypted, {
      id: 123,
      to: 'bob',
      from: 'alice',
      timestamp: 1710000000000,
      messageText: 'pre-key plaintext',
    });
  });

  it('decrypts established whisper messages', async () => {
    const decrypted = await readMessage(
      makeMessage(1),
      fakeCipher({
        decryptWhisperMessage: async (body, encoding) => {
          assert.equal(body, 'ciphertext');
          assert.equal(encoding, 'binary');
          return textBuffer('whisper plaintext');
        },
      })
    );

    assert.equal(decrypted.messageText, 'whisper plaintext');
  });

  it('returns a failed-decryption placeholder for unsupported message types', async () => {
    const originalError = console.error;
    const errors: unknown[][] = [];
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      const decrypted = await readMessage(makeMessage(99), fakeCipher({}));

      assert.equal(decrypted.id, 123);
      assert.equal(decrypted.to, 'bob');
      assert.equal(decrypted.from, 'alice');
      assert.equal(decrypted.timestamp, 1710000000000);
      assert.match(decrypted.messageText, /^\[Failed to decrypt message\] Error: Unsupported message type: 99$/);
      assert.equal(errors.length, 1);
    } finally {
      console.error = originalError;
    }
  });

  it('returns a failed-decryption placeholder when the cipher rejects', async () => {
    const originalError = console.error;
    console.error = () => {};

    try {
      const decrypted = await readMessage(
        makeMessage(1),
        fakeCipher({
          decryptWhisperMessage: async () => {
            throw new Error('bad decrypt');
          },
        })
      );

      assert.equal(decrypted.messageText, '[Failed to decrypt message] Error: bad decrypt');
    } finally {
      console.error = originalError;
    }
  });
});

describe('encryptAndBuildMessage', () => {
  it('encrypts string payloads into transport and local processed envelopes', async () => {
    const { senderStore, recipientStore } = await createOutboundSession();
    const before = Date.now();

    const { msg, processedMsg } = await encryptAndBuildMessage({
      message: 'hello bob',
      senderUser: makeUser('alice'),
      senderStore,
      recipientUser: makeUser('bob', 1),
      sessionInit: true,
    });

    const after = Date.now();

    assert.equal(msg.to, 'bob');
    assert.equal(msg.from, 'alice');
    assert.equal(msg.delivered, false);
    assert.equal(msg.session_init, true);
    assert.equal(typeof msg.message.body, 'string');
    assert.equal(msg.message.type, 3);
    assert.ok(msg.id >= 0 && msg.id < 1e9);
    assert.ok(msg.timestamp >= before && msg.timestamp <= after);

    assert.deepEqual(processedMsg, {
      id: msg.id,
      to: 'bob',
      from: 'alice',
      timestamp: msg.timestamp,
      messageText: 'hello bob',
    });

    const decrypted = await readMessage(
      msg,
      new SessionCipher(recipientStore, new SignalProtocolAddress('alice', 1))
    );
    assert.equal(decrypted.messageText, 'hello bob');
  });

  it('preserves ArrayBuffer payload text in the processed message', async () => {
    const { senderStore } = await createOutboundSession();
    const payload = textBuffer('buffer payload');

    const { msg, processedMsg } = await encryptAndBuildMessage({
      message: payload,
      senderUser: makeUser('alice'),
      senderStore,
      recipientUser: makeUser('bob', 1),
    });

    assert.equal(msg.session_init, undefined);
    assert.equal(processedMsg.messageText, 'buffer payload');
    assert.equal(processedMsg.id, msg.id);
    assert.equal(processedMsg.timestamp, msg.timestamp);
  });
});
