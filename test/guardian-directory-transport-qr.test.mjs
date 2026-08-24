import assert from 'node:assert/strict';
import test from 'node:test';
import { BroadcastChannel as NodeBroadcastChannel } from 'node:worker_threads';

import {
  BroadcastChannelTransport,
  GUARDIAN_KINDS,
  LocalStorageDirectory,
  approvalCoordination,
  decodeMessage,
  encodeMessage,
  guardianConsent,
  guardianInvite,
  isGuardian,
  jsonMessage,
  parseGuardian,
  qrSvg,
  recoveryNotify,
  textMessage
} from '@koralabs/handle-chat-sdk';

const bytes = (...values) => new Uint8Array(values);
const delay = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(predicate, label) {
  for (let i = 0; i < 30; i += 1) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail(`timed out waiting for ${label}`);
}

function withGlobalProperty(name, value, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try {
    return fn();
  } finally {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  }
}

test('guardian helpers build and parse every guardian payload kind', () => {
  assert.deepEqual(GUARDIAN_KINDS, [
    'guardian-invite',
    'guardian-consent',
    'recovery-notify',
    'approval-coordination'
  ]);

  const cases = [
    [
      'guardian-invite',
      guardianInvite({ secretRef: 'policy-7', label: 'Seed phrase', shard: 'AAEC' }),
      { secretRef: 'policy-7', label: 'Seed phrase', shard: 'AAEC' }
    ],
    ['guardian-consent', guardianConsent({ secretRef: 'policy-7', accepted: true }), { secretRef: 'policy-7', accepted: true }],
    ['recovery-notify', recoveryNotify({ secretRef: 'policy-7', requestId: 'recovery-1' }), { secretRef: 'policy-7', requestId: 'recovery-1' }],
    [
      'approval-coordination',
      approvalCoordination({ secretRef: 'policy-7', requestId: 'recovery-1', shard: 'AAEC' }),
      { secretRef: 'policy-7', requestId: 'recovery-1', shard: 'AAEC' }
    ]
  ];

  for (const [kind, message, value] of cases) {
    assert.equal(isGuardian(message), true);
    assert.deepEqual(parseGuardian(decodeMessage(encodeMessage(message))), { kind, value });
  }
});

test('guardian parser ignores non-guardian and non-object guardian payloads', () => {
  assert.equal(isGuardian(textMessage('hello')), false);
  assert.equal(parseGuardian(textMessage('hello')), null);
  assert.equal(parseGuardian(jsonMessage('receipt', { ref: 'm1', state: 'read' })), null);
  assert.equal(parseGuardian(jsonMessage('guardian-invite', 'not an object')), null);
  assert.equal(parseGuardian(jsonMessage('guardian-consent', null)), null);
});

test('local storage directory stores bundles under handle-specific hex keys', () => {
  const storage = new Map();
  const localStorage = {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value))
  };

  withGlobalProperty('localStorage', localStorage, () => {
    const directory = new LocalStorageDirectory();
    directory.publish('$alice', bytes(0, 15, 16, 255));

    assert.equal(storage.get('handlechat:bundle:$alice'), '000f10ff');
    assert.deepEqual(directory.resolve('$missing'), null);
    assert.deepEqual([...directory.resolve('$alice')], [0, 15, 16, 255]);

    storage.set('handlechat:bundle:$bob', 'aabbcc');
    assert.deepEqual([...directory.resolve('$bob')], [170, 187, 204]);
  });
});

test('broadcast channel transport delivers only to current subscriptions', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  if (typeof globalThis.BroadcastChannel !== 'function') {
    Object.defineProperty(globalThis, 'BroadcastChannel', {
      configurable: true,
      writable: true,
      value: NodeBroadcastChannel
    });
  }
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'BroadcastChannel', previous);
    else delete globalThis.BroadcastChannel;
  });

  const alice = new BroadcastChannelTransport();
  const bob = new BroadcastChannelTransport();
  const carol = new BroadcastChannelTransport();
  t.after(() => {
    alice.stop();
    bob.stop();
    carol.stop();
  });

  const seen = [];
  bob.subscribe(['$bob'], (envelope) => seen.push(['bob', envelope]));
  carol.subscribe(['$carol'], (envelope) => seen.push(['carol', envelope]));

  const first = { to: '$bob', body: bytes(1, 2, 3), ts: 1, slot: 'public' };
  assert.equal(await alice.send(first), true);
  await waitFor(() => seen.length === 1, 'first broadcast delivery');
  assert.deepEqual(seen, [['bob', first]]);

  bob.subscribe(['$alice'], (envelope) => seen.push(['bob-rekeyed', envelope]));
  await alice.send({ to: '$bob', body: bytes(4), ts: 2 });
  await delay(25);
  assert.equal(seen.length, 1);

  const rekeyed = { to: '$alice', body: bytes(5), ts: 3 };
  await alice.send(rekeyed);
  await waitFor(() => seen.length === 2, 're-subscribed broadcast delivery');
  assert.deepEqual(seen.at(-1), ['bob-rekeyed', rekeyed]);

  bob.stop();
  await alice.send({ to: '$alice', body: bytes(6), ts: 4 });
  await delay(25);
  assert.equal(seen.length, 2);
});

test('qr svg honors size and margin options', () => {
  const svg = qrSvg('https://chat.handle.me/#i=test', { size: 128, margin: 4 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /width="128" height="128"/);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/><path fill="#000" d="M/);
  assert.doesNotMatch(svg, /NaN|undefined/);

  const dim = (value) => Number(value.match(/viewBox="0 0 (\d+) \d+"/)[1]);
  assert.equal(dim(qrSvg('same invite', { size: 64, margin: 4 })), dim(qrSvg('same invite', { size: 64, margin: 0 })) + 8);
  assert.match(qrSvg('default size'), /width="220" height="220"/);
});
