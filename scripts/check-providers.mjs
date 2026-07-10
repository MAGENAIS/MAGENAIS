#!/usr/bin/env node
// Sanity check: every adapterId referenced by defaultProviders.ts must be
// registered in Kernel.ts's registerAdapters(). Run: node scripts/check-providers.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const providersSrc = readFileSync(join(root, 'src/providers/defaultProviders.ts'), 'utf8');
const kernelSrc = readFileSync(join(root, 'src/core/Kernel.ts'), 'utf8');

const referenced = new Set(
  [...providersSrc.matchAll(/adapterId:\s*'([a-zA-Z0-9_.-]+)'/g)].map(m => m[1])
);

const registered = new Set(
  [...kernelSrc.matchAll(/registerAdapter\('([a-zA-Z0-9_.-]+)'/g)].map(m => m[1])
);
// also catch the array-based bulk registration pattern used for the shared
// OpenAI-compatible adapter: ['id1','id2',...].forEach(id => ...registerAdapter...)
for (const m of kernelSrc.matchAll(/\[([\s\S]*?)\]\.forEach\(id => this\.providerRegistry\.registerAdapter/g)) {
  for (const idMatch of m[1].matchAll(/'([a-zA-Z0-9_.-]+)'/g)) {
    registered.add(idMatch[1]);
  }
}

const missing = [...referenced].filter(id => !registered.has(id));

if (missing.length > 0) {
  console.error(`✗ ${missing.length} adapterId(s) referenced by defaultProviders.ts have no adapter registered in Kernel.ts:`);
  missing.forEach(id => console.error(`  - ${id}`));
  process.exit(1);
} else {
  console.log(`✓ All ${referenced.size} adapterId(s) referenced by defaultProviders.ts are registered in Kernel.ts.`);
}
