import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeInvite,
  decodeMessage,
  encodeInvite,
  encodeMessage,
  inviteUrl,
  isJson,
  isText,
  jsonMessage,
  mediaLabel,
  mediaMessage,
  MemoryDirectory,
  MemoryHub,
  messageJson,
  messageText,
  parseInviteUrl,
  previewText,
  textMessage,
  topType
} from '@koralabs/handle-chat-sdk';

const bytes = (...values) => new Uint8Array(values);
const b64url = (values) => Buffer.from(values).toString('base64url');

test('typed message helpers classify, preview, and round-trip content', () => {
  const text = decodeMessage(encodeMessage(textMessage('hello $bob')));
  assert.equal(text.mime, 'text/plain');
  assert.deepEqual([...text.body], [...new TextEncoder().encode('hello $bob')]);
  assert.equal(isText(text), true);
  assert.equal(isJson(text), false);
  assert.equal(topType(text), 'text');
  assert.equal(messageText(text), 'hello $bob');
  assert.equal(previewText(text), 'hello $bob');
  assert.equal(messageJson(text), null);

  const json = decodeMessage(encodeMessage(jsonMessage('widget', { ok: true, count: 3 }, { name: 'payload.json' })));
  assert.equal(json.mime, 'application/vnd.handle.widget+json');
  assert.deepEqual(json.meta, { name: 'payload.json' });
  assert.equal(isText(json), false);
  assert.equal(isJson(json), true);
  assert.deepEqual(messageJson(json), { ok: true, count: 3 });
  assert.equal(messageText(json), '');
  assert.equal(previewText(json).endsWith(' widget'), true);

  const image = decodeMessage(encodeMessage(mediaMessage('image/png', bytes(1, 2, 255), { width: '4' })));
  assert.equal(topType(image), 'image');
  assert.deepEqual([...image.body], [1, 2, 255]);
  assert.deepEqual(image.meta, { width: '4' });
  assert.match(mediaLabel(image), /Image$/);
  assert.equal(previewText(image), mediaLabel(image));

  assert.equal(mediaLabel(mediaMessage('application/pdf', bytes(9), { name: 'paper.pdf' })).endsWith(' paper.pdf'), true);
  assert.equal(mediaLabel(mediaMessage('application/octet-stream', bytes(9))).endsWith(' File'), true);
});

test('invite helpers round-trip share URLs and reject malformed payloads', () => {
  const bundle = bytes(0, 1, 2, 253, 254, 255);
  const payload = encodeInvite('$alice.handle', bundle);

  assert.match(payload, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeInvite(payload), { handle: '$alice.handle', bundle });
  assert.deepEqual(parseInviteUrl(`https://chat.handle.me/#i=${payload}`), { handle: '$alice.handle', bundle });
  assert.deepEqual(parseInviteUrl(`https://chat.handle.me/thread?x=1&i=${payload}`), {
    handle: '$alice.handle',
    bundle
  });
  assert.equal(inviteUrl('https://chat.handle.me', '$alice.handle', bundle), `https://chat.handle.me/#i=${payload}`);

  assert.equal(parseInviteUrl('https://chat.handle.me/#x=1'), null);
  assert.equal(parseInviteUrl('https://chat.handle.me/#i=@@@'), null);
  assert.throws(() => decodeInvite(b64url([1])), /invite too short/);
  assert.throws(() => decodeInvite(b64url([0, 5, 97])), /invite truncated/);
  assert.equal(parseInviteUrl(`https://chat.handle.me/#i=${b64url([0, 5, 97])}`), null);
  assert.throws(() => encodeInvite('x'.repeat(0x10000), bytes()), /handle too long/);
});

test('memory directory and hub route only active subscriptions', async () => {
  const directory = new MemoryDirectory();
  const bundle = bytes(3, 4, 5);
  directory.publish('$alice', bundle);
  assert.equal(directory.resolve('$missing'), null);
  assert.deepEqual(directory.resolve('$alice'), bundle);

  const hub = new MemoryHub();
  const alice = hub.transport();
  const bob = hub.transport();
  const carol = hub.transport();
  const seen = [];

  bob.subscribe(['$bob'], (envelope) => seen.push(['bob', envelope]));
  carol.subscribe(['$carol'], (envelope) => seen.push(['carol', envelope]));

  const first = { to: '$bob', body: bytes(7), ts: 1, slot: 'pairwise' };
  const sent = alice.send(first);
  assert.equal(seen.length, 0);
  assert.equal(await sent, true);
  assert.deepEqual(seen, [['bob', first]]);

  bob.subscribe(['$alice'], (envelope) => seen.push(['bob-rekeyed', envelope]));
  await alice.send({ to: '$bob', body: bytes(8), ts: 2 });
  await Promise.resolve();
  assert.equal(seen.length, 1);

  const rekeyed = { to: '$alice', body: bytes(9), ts: 3 };
  await alice.send(rekeyed);
  await Promise.resolve();
  assert.deepEqual(seen.at(-1), ['bob-rekeyed', rekeyed]);

  bob.stop();
  await alice.send({ to: '$alice', body: bytes(10), ts: 4 });
  await Promise.resolve();
  assert.equal(seen.length, 2);

  carol.stop();
  alice.stop();
});
