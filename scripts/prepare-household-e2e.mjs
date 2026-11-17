import { readFile, writeFile } from 'node:fs/promises';

// Local browser automation submits far faster than a person. Keep production settings intact.
const config = (await readFile('wrangler.jsonc', 'utf8'))
  .replace(/"limit":\s*(120|30|10),/g, '"limit": 100000,');
await writeFile('.wrangler-household-e2e.jsonc', config);
