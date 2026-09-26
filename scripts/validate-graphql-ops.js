// Guard against frontend/backend schema drift.
//
// Every gql document the web app ships is validated against the real schema, so
// a bad field name fails here instead of showing up as a blank screen in the
// kitchen. The schema comes from the app's own typeDefs module, not a copy, so
// this cannot fall out of step with what the server actually serves.

import { readFileSync } from 'node:fs';
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
if (bad) {
  console.log('Broken: ' + failures.join(', '));
  process.exit(1);
}
