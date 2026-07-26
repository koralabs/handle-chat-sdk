import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  ChatService,
  decodeMessage,
  deriveIdentity,
  encodeMessage,
  guardianInvite,
  IDENTITY_MESSAGE,
  MemoryDirectory,
  MemoryHub,
  parseGuardian
} from '@koralabs/handle-chat-sdk';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => new Uint8Array(hex.match(/../g).map((b) => parseInt(b, 16)));

test('the built package exposes the client surface', () => {
  assert.equal(typeof ChatService, 'function');
  assert.equal(typeof MemoryHub, 'function');
  assert.equal(typeof MemoryDirectory, 'function');
  assert.equal(IDENTITY_MESSAGE, 'koralabs:handle-identity:derive:v1');
});

test('identity derivation matches the cross-repo vector (chat.handle.me + secrets.handle.me)', async () => {
  // The same vector is pinned in chat.handle.me/src/chat/identity.test.ts and
  // secrets.handle.me/lib/identity-compat.test.ts — the wallet-rooted key must never fork.
  const seed = fromHex('9f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c2b1a0');
  const { priv, registrationId } = await deriveIdentity(seed, '$alice');
  assert.equal(toHex(priv), 'a1ac5149baf1c3cc819967b28ceb139e7ce0fdeb31c5dec3977033af918ce918');
  assert.equal(registrationId, 16031);
});

test('guardian payloads round-trip the typed-message codec', () => {
  const c = guardianInvite({ secretRef: 'policy-7', label: 'Seed phrase', shard: 'AAEC' });
  assert.equal(c.mime, 'application/vnd.handle.guardian-invite+json');
  assert.deepEqual(parseGuardian(decodeMessage(encodeMessage(c))), {
    kind: 'guardian-invite',
    value: { secretRef: 'policy-7', label: 'Seed phrase', shard: 'AAEC' }
  });
});

for (const [example, marker] of [
  ['quickstart.mjs', /✓ quickstart complete/],
  ['guardian-flow.mjs', /✓ guardian flow complete/]
]) {
  test(`example ${example} runs end to end`, () => {
    // The examples are the documentation — this keeps them working, not aspirational.
    const run = spawnSync(process.execPath, [path.join(root, 'examples', example)], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(run.status, 0, `stderr: ${run.stderr}`);
    assert.match(run.stdout, marker);
  });
}
