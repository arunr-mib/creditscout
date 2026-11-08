// Guards the workspace against the retired teal/dark-shell tokens (model, sunken, night).
// app/welcome, app/login and components/Logo.tsx keep the brand surface and are exempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const RETIRED = /\b(bg|text|border(-[a-z])?|ring|from|to|fill|stroke|outline|decoration|divide)-(model|sunken|night)(-[a-z-]+)?\b/;
const EXEMPT = ['app/welcome/', 'app/login/', 'components/Logo.tsx'];

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

test('no retired model/sunken/night tokens in workspace files', () => {
  const hits = [];
  for (const top of ['app', 'components']) {
    for (const file of walk(join(ROOT, top))) {
      const rel = relative(ROOT, file).split(sep).join('/');
      if (!/\.tsx?$/.test(rel) || EXEMPT.some((e) => rel.startsWith(e))) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        const m = line.match(RETIRED);
        if (m) hits.push(`${rel}:${i + 1}  ${m[0]}`);
      });
    }
  }
  assert.deepEqual(hits, [], `retired tokens found:\n${hits.join('\n')}`);
});
