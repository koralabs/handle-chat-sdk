import assert from 'node:assert/strict';
import test from 'node:test';

import { presenceEpoch, presenceMessage, publicSlotTopic, verifyPresence } from '../lib/src/chat/mesh/presenceAuth.js';

const DAY = 24 * 60 * 60 * 1000;

async function registrant(epoch, addr) {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
  const topic = await publicSlotTopic(pub, epoch);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, presenceMessage(topic, addr, epoch)));
  return { pub, topic, sig };
}

test('presence epochs rotate daily and the signed message is topic || addr || epoch (u32 little-endian)', () => {
  assert.equal(presenceEpoch(0), 0);
  assert.equal(presenceEpoch(DAY - 1), 0);
  assert.equal(presenceEpoch(DAY), 1);
  const msg = presenceMessage(new Uint8Array([9, 9]), 'ab', 0x01020304);
  assert.deepEqual([...msg], [9, 9, 97, 98, 4, 3, 2, 1]);
});

test('only the key owner can register its public slot: wrong topic, epoch, address or signature is rejected', async () => {
  const { pub, topic, sig } = await registrant(7, '/ip4/1.2.3.4/p2p/x');
  assert.equal(await verifyPresence(pub, topic, '/ip4/1.2.3.4/p2p/x', 7, sig), true);
  assert.equal((await publicSlotTopic(pub, 7)).length, 32);
  assert.notDeepEqual([...(await publicSlotTopic(pub, 8))], [...topic]);

  assert.equal(await verifyPresence(pub, topic, '/ip4/6.6.6.6/p2p/x', 7, sig), false, 'address is bound by the signature');
  assert.equal(await verifyPresence(pub, topic, '/ip4/1.2.3.4/p2p/x', 8, sig), false, 'epoch mismatch breaks the topic binding');
  const forged = topic.map((b) => b ^ 1);
  assert.equal(await verifyPresence(pub, forged, '/ip4/1.2.3.4/p2p/x', 7, sig), false);

  // An attacker who knows the public key can derive the topic but cannot sign for it.
  const attacker = await registrant(7, '/ip4/1.2.3.4/p2p/x');
  assert.equal(await verifyPresence(pub, topic, '/ip4/1.2.3.4/p2p/x', 7, attacker.sig), false);
});
