import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const purchases = JSON.parse(readFileSync(resolve(root, 'data/seed-purchases.json'), 'utf8'));
const commissions = JSON.parse(readFileSync(resolve(root, 'data/seed-commissions.json'), 'utf8'));

function toRows(map, mapper) {
  return Object.entries(map).map(([key, value]) => mapper(key, value));
}

const purchaseRows = toRows(purchases, (art, price) => [String(art), price]);
const commissionRows = toRows(commissions, (art, c) => [String(art), c.fboCategory, c.fbsCategory]);

const out = `// AUTO-GENERATED — node scripts/generate-seed-gs.mjs
const SEED_PURCHASES = ${JSON.stringify(purchaseRows)};
const SEED_COMMISSIONS = ${JSON.stringify(commissionRows)};
`;

writeFileSync(resolve(root, 'apps-script/SeedData.gs'), out);
console.log('SeedData.gs:', purchaseRows.length, 'purchases,', commissionRows.length, 'commissions');
