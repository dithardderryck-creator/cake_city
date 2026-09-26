// Guard against frontend/backend schema drift.
//
// Every gql document the web app ships is validated against the real schema, so
// a bad field name fails here instead of showing up as a blank screen in the
// kitchen. The schema comes from the app's own typeDefs module, not a copy, so
// this cannot fall out of step with what the server actually serves.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { buildSchema, parse, validate, specifiedRules } from 'graphql';

const require = createRequire(import.meta.url);

const typeDefs = require('../src/graphql/typeDefs.js');
const schema = buildSchema(typeDefs.loc.source.body);

const files = [
  'web/src/graphql/queries.js',
  'web/src/graphql/mutations.js',
];

let total = 0;
let bad = 0;
const failures = [];

for (const f of files) {
  const src = readFileSync(f, 'utf8');
  // Each exported document is a gql`...` template literal.
  const docs = [...src.matchAll(/gql`([\s\S]*?)`/g)].map((m) => m[1]);
  console.log(`\n${f}  (${docs.length} operations)`);

  for (const d of docs) {
    total += 1;
    const name = (d.match(/(?:query|mutation)\s+(\w+)/) || [, '(unnamed)'])[1];
    try {
      const errs = validate(schema, parse(d), specifiedRules);
      if (errs.length) {
        bad += 1;
        failures.push(`${f} ${name}`);
        console.log(`  FAIL ${name}`);
        for (const e of errs) console.log(`       ${e.message}`);
      } else {
        console.log(`  ok   ${name}`);
      }
    } catch (e) {
      bad += 1;
      failures.push(`${f} ${name} (parse)`);
      console.log(`  PARSE ERROR near ${name}: ${e.message}`);
    }
  }
}

console.log(`\n${total} operations checked, ${bad} invalid`);

// A document can be perfectly valid and still never run, if a screen imports
// it under a name the module does not export. Apollo then gets undefined as
// its document and React throws: a white screen, on a green build. So resolve
// every named import of these two modules across the whole web app.
const importProblems = [];
const exportsOf = Object.fromEntries(
  files.map((f) => [
    f,
    new Set([...readFileSync(f, 'utf8').matchAll(/export const (\w+)/g)].map((m) => m[1])),
  ])
);

const screens = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) screens.push(p);
  }
})('web/src');

for (const screen of screens) {
  const src = readFileSync(screen, 'utf8');
  for (const mod of files) {
    const base = mod.split('/').pop().replace(/\.js$/, '');
    const re = new RegExp(
      String.raw`import\s*\{([^}]+)\}\s*from\s*'[^']*graphql/${base}'`,
      'g'
    );
    for (const m of src.matchAll(re)) {
      for (const name of m[1].split(',').map((n) => n.trim()).filter(Boolean)) {
        if (!exportsOf[mod].has(name)) {
          importProblems.push(`${screen} imports ${name}, which ${mod} does not export`);
        }
      }
    }
  }
}

if (importProblems.length) {
  bad += importProblems.length;
  console.log(`\n  ${importProblems.length} unresolved import(s) across ${screens.length} files:`);
  for (const p of importProblems) console.log(`   FAIL ${p}`);
}

if (bad) {
  console.log('\nBroken: ' + [...failures, ...importProblems].join(', '));
  process.exit(1);
}
