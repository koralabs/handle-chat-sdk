// Build the SDK from chat.handle.me's client core — the single source of truth. The sibling repo's
// src/chat + src/signal (minus tests and browser-test entries) are staged into build-src/ together
// with this repo's sdk/ entry modules, compiled by tsc with declarations into lib/, and the
// libsignal WASM artifact is staged into assets/. Relative imports in the emitted .js are given
// explicit .js extensions so the package loads under plain Node ESM as well as bundlers.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chat = path.resolve(root, '..', 'chat.handle.me');
const wasmPkg = path.join(chat, 'libsignal-wasm', 'pkg');
const wasmBin = path.join(wasmPkg, 'handle_libsignal_wasm_bg.wasm');

if (!existsSync(chat)) {
  console.error(`chat.handle.me not found at ${chat} — the SDK builds from that repo's source.`);
  process.exit(1);
}
if (!existsSync(wasmBin)) {
  console.error(`libsignal WASM not built (${wasmBin}) — run: (cd ${chat} && node build.mjs)`);
  process.exit(1);
}

const buildSrc = path.join(root, 'build-src');
const lib = path.join(root, 'lib');
const assets = path.join(root, 'assets');
for (const dir of [buildSrc, lib, assets]) rmSync(dir, { recursive: true, force: true });

const isCore = (name) =>
  name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('Entry.ts');

function stage(fromDir, toDir) {
  mkdirSync(toDir, { recursive: true });
  let n = 0;
  for (const name of readdirSync(fromDir, { withFileTypes: true })) {
    if (name.isDirectory()) {
      n += stage(path.join(fromDir, name.name), path.join(toDir, name.name));
    } else if (isCore(name.name)) {
      copyFileSync(path.join(fromDir, name.name), path.join(toDir, name.name));
      n += 1;
    }
  }
  return n;
}

// Mirror chat's layout (src/** with libsignal-wasm/ at the root) so relative imports like
// src/signal → ../../libsignal-wasm keep resolving in the staged tree and the emitted lib/.
const staged =
  stage(path.join(chat, 'src', 'chat'), path.join(buildSrc, 'src', 'chat')) +
  stage(path.join(chat, 'src', 'signal'), path.join(buildSrc, 'src', 'signal')) +
  stage(path.join(root, 'sdk'), path.join(buildSrc, 'src'));

// The WASM glue: its .d.ts types the imports during compile; the .js ships verbatim in lib/.
const pkgDir = path.join(buildSrc, 'libsignal-wasm', 'pkg');
mkdirSync(pkgDir, { recursive: true });
for (const f of ['handle_libsignal_wasm.js', 'handle_libsignal_wasm.d.ts']) {
  copyFileSync(path.join(wasmPkg, f), path.join(pkgDir, f));
}

const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
  cwd: root,
  stdio: 'inherit'
});
if (tsc.status !== 0) process.exit(tsc.status ?? 1);

// Ship the glue alongside the compiled output (tsc types it but does not emit .js it didn't compile).
const libPkgDir = path.join(lib, 'libsignal-wasm', 'pkg');
mkdirSync(libPkgDir, { recursive: true });
for (const f of ['handle_libsignal_wasm.js', 'handle_libsignal_wasm.d.ts']) {
  copyFileSync(path.join(wasmPkg, f), path.join(libPkgDir, f));
}

// chat's sources use extensionless relative imports (its tsconfig forbids .ts extensions); Node ESM
// needs explicit ones. Rewrite specifiers in the emitted .js only — bundlers accept either form.
function rewrite(dir) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name);
    if (name.isDirectory()) rewrite(full);
    else if (name.name.endsWith('.js') && !full.includes(`libsignal-wasm${path.sep}`)) {
      const src = readFileSync(full, 'utf8');
      const out = src.replace(/(from\s*|import\s*\(\s*)(["'])(\.\.?\/[^"']+?)\2/g, (m, pre, q, spec) =>
        spec.endsWith('.js') || spec.endsWith('.json') ? m : `${pre}${q}${spec}.js${q}`
      );
      if (out !== src) writeFileSync(full, out);
    }
  }
}
rewrite(lib);

mkdirSync(assets, { recursive: true });
copyFileSync(wasmBin, path.join(assets, 'libsignal_bg.wasm'));

console.log(`built lib/ from ${staged} staged sources (+ libsignal WASM asset)`);
