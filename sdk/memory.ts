/**
 * In-process seams for tests, examples, and Node tools: a Directory and a Transport that need no
 * browser, no relay, and no network. Production apps use LocalStorageDirectory/BroadcastChannel
 * (same origin) or MeshTransport (cross-origin) — these mirror those contracts exactly.
 */
import type { Directory } from './chat/directory';
import type { Envelope, RegistrationSigner, Transport } from './chat/transport';

/** A Map-backed prekey-bundle directory shared by every party constructed with it. */
export class MemoryDirectory implements Directory {
  readonly #bundles = new Map<string, Uint8Array>();

  publish(handle: string, bundle: Uint8Array): void {
    this.#bundles.set(handle, bundle);
  }

  resolve(handle: string): Uint8Array | null {
    return this.#bundles.get(handle) ?? null;
  }
}

/** An in-process message bus: every transport minted by one hub delivers to the others. */
export class MemoryHub {
  readonly #peers = new Set<MemoryTransport>();

  transport(): Transport {
    const t = new MemoryTransport(this.#peers);
    this.#peers.add(t);
    return t;
  }
}

class MemoryTransport implements Transport {
  readonly #peers: Set<MemoryTransport>;
  #keys = new Set<string>();
  #onEnvelope: ((e: Envelope) => void) | null = null;

  constructor(peers: Set<MemoryTransport>) {
    this.#peers = peers;
  }

  send(envelope: Envelope): Promise<boolean> {
    for (const peer of this.#peers) {
      if (peer === this || !peer.#keys.has(envelope.to)) continue;
      // Deliver async (like every real transport) so senders never re-enter receivers mid-call.
      queueMicrotask(() => peer.#onEnvelope?.(envelope));
    }
    return Promise.resolve(true);
  }

  subscribe(keys: string[], onEnvelope: (e: Envelope) => void, _signer?: RegistrationSigner): void {
    this.#keys = new Set(keys);
    this.#onEnvelope = onEnvelope;
  }

  stop(): void {
    this.#peers.delete(this);
    this.#onEnvelope = null;
  }
}
