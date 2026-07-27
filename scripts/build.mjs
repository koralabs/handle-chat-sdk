// Build the SDK from chat.handle.me's client core — the single source of truth. The sibling repo's
// src/chat + src/signal (minus tests and browser-test entries) are staged into build-src/ together
// with this repo's sdk/ entry modules, compiled by tsc with declarations into lib/, and the
// libsignal WASM artifact is staged into assets/. Relative imports in the emitted .js are given
// explicit .js extensions so the package loads under plain Node ESM as well as bundlers.
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const chatCheckout = path.resolve(root, '..', 'chat.handle.me');
const chatArchivePaths = ['src/chat', 'src/signal', 'libsignal-wasm'];
const requiredChatPaths = [
  path.join('src', 'chat'),
  path.join('src', 'signal'),
  path.join('libsignal-wasm', 'build.sh')
];
const wasmRel = path.join('libsignal-wasm', 'pkg', 'handle_libsignal_wasm_bg.wasm');
const toolPath = [path.join(homedir(), '.local', 'bin'), path.join(homedir(), '.cargo', 'bin'), process.env.PATH]
  .filter(Boolean)
  .join(path.delimiter);
let tempChat = null;
let chat = chatCheckout;

function cleanupTempChat() {
  if (tempChat) {
    rmSync(tempChat, { recursive: true, force: true });
    tempChat = null;
  }
}
process.on('exit', cleanupTempChat);

function fail(message, status = 1) {
  console.error(message);
  cleanupTempChat();
  process.exit(status);
}

function hasRequiredChatSource(dir) {
  return requiredChatPaths.every((name) => existsSync(path.join(dir, name)));
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    ...opts,
    env: { ...process.env, PATH: toolPath, ...opts.env }
  });
  if (result.error) fail(`${cmd} ${args.join(' ')} failed: ${result.error.message}`);
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} failed`, result.status ?? 1);
  return result;
}

function copyChatSourceToTemp(sourceDir, reason) {
  tempChat = mkdtempSync(path.join(tmpdir(), 'handle-chat-sdk-chat-'));
  for (const rel of chatArchivePaths) {
    const from = path.join(sourceDir, ...rel.split('/'));
    const to = path.join(tempChat, ...rel.split('/'));
    mkdirSync(path.dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  if (!hasRequiredChatSource(tempChat)) {
    fail('temporary chat.handle.me source is missing src/chat, src/signal, or libsignal-wasm/build.sh.');
  }
  console.log(`using temporary chat.handle.me source because ${reason}`);
  return tempChat;
}

function materializeOriginHead() {
  const originHead = spawnSync('git', ['-C', chatCheckout, 'rev-parse', '--verify', 'origin/HEAD'], {
    encoding: 'utf8'
  });
  if (originHead.status !== 0) {
    fail(
      `chat.handle.me checkout at ${chatCheckout} is missing src/chat, src/signal, or libsignal-wasm/build.sh, ` +
        'and origin/HEAD is not available. Fetch the sibling repo default branch and retry.'
    );
  }

  tempChat = mkdtempSync(path.join(tmpdir(), 'handle-chat-sdk-chat-'));
  const archive = spawnSync(
    'git',
    ['-C', chatCheckout, 'archive', '--format=tar', 'origin/HEAD', ...chatArchivePaths],
    { cwd: root, encoding: null, maxBuffer: 1024 * 1024 * 1024 }
  );
  if (archive.error) fail(`git archive origin/HEAD failed: ${archive.error.message}`);
  if (archive.status !== 0) {
    const stderr = archive.stderr ? archive.stderr.toString('utf8').trim() : '';
    fail(`git archive origin/HEAD failed${stderr ? `: ${stderr}` : ''}`, archive.status ?? 1);
  }

  const extract = spawnSync('tar', ['-xf', '-', '-C', tempChat], {
    input: archive.stdout,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  if (extract.error) fail(`tar extract failed: ${extract.error.message}`);
  if (extract.status !== 0) fail('tar extract failed', extract.status ?? 1);
  if (!hasRequiredChatSource(tempChat)) {
    fail('chat.handle.me origin/HEAD is missing src/chat, src/signal, or libsignal-wasm/build.sh.');
  }
  console.log(`using chat.handle.me origin/HEAD snapshot because ${chatCheckout} lacks build source`);
  return tempChat;
}

function resolveUsableChatSource() {
  if (!existsSync(chatCheckout)) {
    fail(`chat.handle.me not found at ${chatCheckout} — the SDK builds from that repo's source.`);
  }
  if (!hasRequiredChatSource(chatCheckout)) return materializeOriginHead();
  if (existsSync(path.join(chatCheckout, wasmRel))) return chatCheckout;
  return copyChatSourceToTemp(chatCheckout, `${chatCheckout} has source but no built libsignal WASM`);
}

chat = resolveUsableChatSource();
const wasmPkg = path.join(chat, 'libsignal-wasm', 'pkg');
const wasmBin = path.join(chat, wasmRel);

if (!existsSync(wasmBin)) {
  console.log('libsignal WASM not built — building from source (libsignal-wasm/build.sh)...');
  run('bash', ['build.sh'], { cwd: path.join(chat, 'libsignal-wasm') });
}
if (!existsSync(wasmBin)) {
  fail(`libsignal WASM still missing after build (${wasmBin}).`);
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

run(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json'], {
  cwd: root
});

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
cleanupTempChat();

console.log(`built lib/ from ${staged} staged sources (+ libsignal WASM asset)`);
