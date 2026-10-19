// Copyright 2026 Impo. SPDX-License-Identifier: Apache-2.0
import { spawnSync } from 'node:child_process';
import { mkdir, cp, rename, rm, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited with ${result.status}`);
}
run('emcmake', ['cmake', '-S', 'platforms/web', '-B', 'platforms/web/build', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build', 'platforms/web/build', '--target', 'agenui', '-j', process.env.CMAKE_BUILD_PARALLEL_LEVEL ?? '4']);
const directory = join(root, 'platforms/web');
const staging = join(directory, 'dist-next');
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
await cp(join(directory, 'src'), staging, { recursive: true });
for (const name of ['agenui.mjs', 'agenui.wasm']) await cp(join(directory, 'build', name), join(staging, name));
await writeFile(join(staging, 'THIRD_PARTY_NOTICES.txt'),
  await readFile(join(root, 'NOTICE'), 'utf8') + '\n\nYoga 2.0.0 — MIT\n' +
  await readFile(join(directory, 'build/_deps/yoga-src/LICENSE'), 'utf8'));
const config = spawnSync('em-config', ['EMSCRIPTEN_ROOT'], { encoding: 'utf8' });
if (config.error || config.status !== 0) throw new Error('Cannot locate Emscripten runtime notices');
let notices = await readFile(join(staging, 'THIRD_PARTY_NOTICES.txt'), 'utf8');
for (const path of ['LICENSE', 'system/lib/libc/musl/COPYRIGHT',
  'system/lib/libcxx/LICENSE.TXT', 'system/lib/libcxxabi/LICENSE.TXT',
  'system/lib/compiler-rt/LICENSE.TXT']) {
  notices += `\n\nEmscripten runtime: ${path}\n` + await readFile(join(config.stdout.trim(), path), 'utf8');
}
await writeFile(join(staging, 'THIRD_PARTY_NOTICES.txt'), notices);
for (const name of ['LICENSE', 'NOTICE']) await cp(join(root, name), join(directory, name));
await cp(join(staging, 'THIRD_PARTY_NOTICES.txt'), join(directory, 'THIRD_PARTY_NOTICES.txt'));
// Keep the last complete distribution until the new one is fully staged.
const previous = join(directory, 'dist-previous');
await rm(previous, { recursive: true, force: true });
await rename(join(directory, 'dist'), previous).catch(error => { if (error.code !== 'ENOENT') throw error; });
await rename(staging, join(directory, 'dist'));
await rm(previous, { recursive: true, force: true });
console.log('Built platforms/web/dist (C++ core + Yoga + Web adapter)');
