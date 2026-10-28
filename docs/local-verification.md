# Local verification

The SDK is built from the client source in the private `koralabs/chat.handle.me` repository (see `scripts/build.mjs`). This repository is public and does not contain that source. Tests and coverage run locally only (see the contributor test policy in the README), so this page is the verification path for every change.

## Why there is no GitHub Actions gate

- `npm run build` needs `../chat.handle.me` (`src/chat`, `src/signal`, `libsignal-wasm`). A workflow in this public repository cannot check out the private repository without a credential. The removed `PR Build` workflow failed at that checkout with `Not Found`.
- Tests and coverage are not run in Actions by policy.
- So there is no required check on `master`. A check that skipped the upstream source would not build or test the SDK, so none was added.

## Requirements

- Read access to `koralabs/chat.handle.me`.
- Node.js 22 or newer. The dependency tree needs it (`p-retry@8` requires `>=22`), and `npm test` passes a quoted glob that Node 20's `--test` does not expand. Verified on 22.23.2 and 24.21.0.
- The libsignal WASM toolchain pinned by chat.handle.me. You only need it if `../chat.handle.me/libsignal-wasm/pkg/` has not been built yet:
  - Rust `1.95.0` with target `wasm32-unknown-unknown`. rustup installs it from `libsignal-wasm/rust-toolchain.toml`.
  - `wasm-pack` `0.13.1`
  - `protoc` `29.3`

  `libsignal-wasm/build.sh` refuses other versions. Distribution packages often ship a different `protoc`, so check `protoc --version`.

## Steps

```bash
# 1. Clone both repos into the same parent folder
git clone https://github.com/koralabs/handle-chat-sdk
git clone https://github.com/koralabs/chat.handle.me      # private; default branch: preview

# 2. Build the libsignal WASM once in the chat checkout (a cache miss takes minutes; it is reused afterwards)
(cd chat.handle.me/libsignal-wasm && ./build.sh)

# 3. Install, build and test the SDK
cd handle-chat-sdk
npm ci
npm test            # = npm run build && node --test "test/**/*.test.mjs" (includes both examples)
./test_coverage.sh  # builds, then c8 over the same tests; writes test_coverage.report
```

`test_coverage.sh` measures the built package (`lib/src/**/*.js`, every file, including ones no test loads) against a 90% lines / 90% branches gate. On 2026-10-28 it measured 56.82% lines / 78.04% branches: `src/signal` 98%, `src/chat` 63%, `src/chat/mesh` 8%.

If step 2 is skipped, `npm run build` builds the WASM itself in a temporary copy. That copy is deleted afterwards, so every build compiles it again.

Example sources for the tools, without sudo:

```bash
curl -fsSL https://sh.rustup.rs | sh -s -- -y --default-toolchain none --profile minimal
curl -fsSL https://github.com/rustwasm/wasm-pack/releases/download/v0.13.1/wasm-pack-v0.13.1-x86_64-unknown-linux-musl.tar.gz | tar xz
curl -fsSLO https://github.com/protocolbuffers/protobuf/releases/download/v29.3/protoc-29.3-linux-x86_64.zip
```

Put `wasm-pack` and `protoc` on `PATH` ahead of any system copies.

## What to record as evidence

The last build line names the upstream input, for example:

```
built lib/ from 23 staged sources (+ libsignal WASM asset) — chat.handle.me HEAD <sha>
```

The line ends in `+ uncommitted changes` if the chat checkout has local edits under the built paths, and starts with `origin/HEAD <sha>` when the checkout lacks the source and its fetched default branch was used. The WASM is not byte-identical across checkout paths: the same commit and toolchain gave different `libsignal_bg.wasm` hashes when built in place and in the temporary copy. So record the source commit, not a WASM hash. Record that line, the Node version, and the `node --test` summary (`tests 18 / pass 18 / fail 0` as of 2026-10-28) in the PR.

## What this does and does not prove

It proves that the SDK compiles against the named chat.handle.me commit with the pinned libsignal WASM. It also proves the 18 tests pass: the cross-repo identity vector, Signal sessions and state import, the message, invite, guardian, directory, transport and QR helpers, and both examples run end to end over the in-memory hub.

It does not test the browser, the mesh or relay transport, or a published npm artifact. `1.0.x` has not been published, and the `handle-chat-sdk` publish workflow is disabled.
