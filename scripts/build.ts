// Compiles src/*.ts to lib/ (ES modules + .d.ts) with tsc, then builds script-tag files in dist/ from lib/.
//
//   dist/photocopier-ui.js   window.PhotocopierUI.Overlay and window.PhotocopierUI.Sheets
//   dist/overlay.js          window.PhotocopierUI.Overlay only
//   dist/sheets.js           window.PhotocopierUI.Sheets only
//
// lib/ holds the ES modules and type declarations that package.json "exports" points at.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(root, 'lib'), { recursive: true, force: true });
for (const project of [root, join(root, 'demo'), join(root, 'scripts')]) {
  execFileSync(process.execPath, [join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', project], { stdio: 'inherit' });
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function wrap(file: string, name: string): string {
  let code = readFileSync(join(root, 'lib', file), 'utf8');
  if (/^\s*import\s/m.test(code)) throw new Error(file + ': imports are not supported by this build');
  const names: string[] = [];
  code = code.replace(/^export\s+(const|let|var|function)\s+([A-Za-z_$][\w$]*)/gm, (_m, kind: string, id: string) => {
    names.push(id);
    return kind + ' ' + id;
  });
  if (/^\s*export\s/m.test(code)) throw new Error(file + ': unsupported export form');
  const body = code.trim().split('\n').map((l) => (l ? '  ' + l : l)).join('\n');
  return [
    '(function (global) {',
    "  'use strict';",
    body,
    '',
    '  var ns = global.PhotocopierUI = global.PhotocopierUI || {};',
    '  ns.' + name + ' = { ' + names.map((n) => n + ': ' + n).join(', ') + ' };',
    "})(typeof window !== 'undefined' ? window : globalThis);",
    ''
  ].join('\n');
}

const banner = (what: string) => '/*! photocopier-ui v' + pkg.version + ' | ' + what + ' | script-tag build, generated from src/*.ts */\n';
const overlay = wrap('overlay.js', 'Overlay');
const sheets = wrap('sheets.js', 'Sheets');

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist', 'overlay.js'), banner('Overlay') + overlay);
writeFileSync(join(root, 'dist', 'sheets.js'), banner('Sheets') + sheets);
writeFileSync(join(root, 'dist', 'photocopier-ui.js'), banner('Overlay + Sheets') + overlay + '\n' + sheets);
console.log('Built dist/photocopier-ui.js, dist/overlay.js, dist/sheets.js (v' + pkg.version + ')');
