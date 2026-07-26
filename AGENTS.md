# AGENTS.md

## Master AGENTS.md
- [REQUIREMENT] Read the AGENTS.md in this project's parent folder for complete instructions and inter-project references

## What this repo is (v1 — 2026-07)
The published form of chat.handle.me's client core. **Do not edit `lib/` or add source here beyond
`sdk/` (entry + Memory seams), `scripts/`, `examples/`, `test/`** — `npm run build` stages
`../chat.handle.me/src/{chat,signal}` (minus tests/entries) + the libsignal WASM and compiles them.
Fix client bugs UPSTREAM in chat.handle.me, then rebuild here. The examples are executed by
`npm test`; keep them passing. The identity vector in `test/sdk.test.mjs` is the cross-repo
contract (also pinned in chat.handle.me and secrets.handle.me) — never change it casually.
The 0.0.x history (old `@privacyresearch` libsignal port) is superseded; do not resurrect it.
License is AGPL-3.0-only (libsignal).
