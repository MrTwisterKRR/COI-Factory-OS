import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { STARTER_PRESETS } from '../src/data/presets';
import { solveProductionChain } from '../src/engine/solver';
import { analyzeByproductsAndStorage } from '../src/engine/byproductAdvisor';
import {
  decodeGameBlueprint,
  decodedBlueprintToFactoryPlan,
  encodePlanToGameBlueprint,
} from '../src/engine/gameBlueprint';

console.log('=== 1. Decoding real game blueprint: Сталь на дуговых.txt ===');
const bpPath = 'c:\\Users\\info\\Downloads\\Telegram Desktop\\Сталь на дуговых.txt';
const rawText = fs.readFileSync(bpPath, 'utf8');
const decodedReal = decodeGameBlueprint(rawText);

console.log('Name:', decodedReal.name);
console.log('GameVersion:', decodedReal.gameVersion, '| SaveVer:', decodedReal.saveVersion, '| LibVer:', decodedReal.libraryVersion);
console.log('Total Entities:', decodedReal.totalEntities, '| Transport pieces:', decodedReal.transportCount);
for (const g of decodedReal.machineGroups) {
  console.log(`  ${g.count}x ${g.machineNameRu} (${g.protoId}) | Recipe: ${g.recipeNameRu ?? '—'} (${g.recipeGameIds.join(',')})`);
}

assert.equal(decodedReal.totalEntities, 1309);
assert.ok(decodedReal.machineGroups.some((g) => g.protoId === 'ArcFurnace2' && g.count === 20));
assert.ok(decodedReal.machineGroups.some((g) => g.protoId === 'OxygenFurnaceT2' && g.count === 20));
assert.ok(decodedReal.machineGroups.some((g) => g.protoId === 'CasterCooledT2' && g.count === 20));

const importedPlan = decodedBlueprintToFactoryPlan(decodedReal);
const importedSolved = solveProductionChain(importedPlan);
console.log('Imported Plan targets:', importedPlan.targets.map((t) => `${t.productId} (${t.fixedMachines}x)`));
console.log('Imported Solved Steps:', importedSolved.steps.length, '| Workers:', importedSolved.summary.totalWorkers);
assert.ok(importedSolved.steps.length > 0);

function readGeneratedTrailerHex(code: string): string {
  const b64 = code.slice(code.indexOf(':') + 1);
  const bytes = gunzipSync(Buffer.from(b64, 'base64'));
  let pos = 0;
  const strTable: (string | null)[] = [null];
  const rb = () => bytes[pos++];
  const ru = () => {
    let r = 0, s = 0;
    for (;;) {
      const b = rb();
      r |= (b & 0x7f) << s;
      if ((b & 0x80) === 0) break;
      s += 7;
    }
    return r >>> 0;
  };
  const ri = () => {
    const n = ru();
    return (n >>> 1) ^ -(n & 1);
  };
  const rs = () => {
    const ref = ru();
    if (ref === strTable.length) {
      const l = ru();
      const s = Buffer.from(bytes.subarray(pos, pos + l)).toString('utf8');
      pos += l;
      strTable.push(s);
      return s;
    }
    return strTable[ref];
  };

  const libVer = ru();
  if (libVer >= 7) ru();
  rs(); // gameVersion
  ru(); // saveVersion
  rs(); // name
  rs(); // description
  const count = ru();
  for (let i = 0; i < count; i++) {
    let n = ru(); for (let j = 0; j < n; j++) { rs(); ri(); }
    n = ru(); for (let j = 0; j < n; j++) { rs(); rb(); }
    n = ru(); for (let j = 0; j < n; j++) { rs(); rs(); }
    n = ru(); for (let j = 0; j < n; j++) { rs(); const l = ru(); for (let m = 0; m < l; m++) rs(); }
    n = ru(); for (let j = 0; j < n; j++) { rs(); const l = ru(); pos += l; }
  }
  return Buffer.from(bytes.subarray(pos)).toString('hex');
}

console.log('\n=== 2. Encoding & Round-trip verifying all Starter Presets ===');
const outDir = process.env.VERIFY_BP_OUT_DIR;
if (outDir) fs.mkdirSync(outDir, { recursive: true });
for (const preset of STARTER_PRESETS) {
  const solved = solveProductionChain(preset);
  const generated = encodePlanToGameBlueprint(solved, preset.name, {
    includeDisposalBuildings: true,
    includeBufferStorages: true,
  });

  console.log(`\nPreset: ${preset.name}`);
  console.log(`  Prefix: ${generated.code.slice(0, 24)}... | Entities: ${generated.entityCount} | Unmapped recipes: ${generated.unmappedRecipes.length}`);
  assert.equal(generated.unmappedRecipes.length, 0, `Unmapped recipes in ${preset.name}: ${generated.unmappedRecipes.join(', ')}`);
  assert.match(generated.code, /^B\d+:H4sI/);

  const trailerHex = readGeneratedTrailerHex(generated.code);
  assert.equal(trailerHex, '0000000000', `Expected 5-byte v4 trailer 0000000000 for ${preset.name}, got ${trailerHex}`);

  const roundTrip = decodeGameBlueprint(generated.code);
  assert.equal(roundTrip.name, preset.name);
  assert.equal(roundTrip.totalEntities, generated.entityCount);
  console.log(`  ✓ Round-trip decoded: ${roundTrip.totalEntities} entities across ${roundTrip.machineGroups.length} building groups (trailer=${trailerHex})`);

  if (outDir) {
    fs.writeFileSync(`${outDir}/${preset.id}.txt`, generated.code, 'utf8');
  }
  if (preset.name === 'Стройдетали I–III') {
    console.log(`  [Стройдетали I–III CODE]: ${generated.code}`);
  }
}

console.log('\n=== 3. Verifying Byproduct & Storage Advisor (Нефтехим и Дизель) ===');
const petroPreset =
  STARTER_PRESETS.find((p) => p.id === 'preset-petrochem') ?? STARTER_PRESETS[1];
const petroSolved = solveProductionChain(petroPreset);
const advice = analyzeByproductsAndStorage(petroSolved);
for (const a of advice) {
  console.log(
    `  ${a.name} (${a.ratePer60.toFixed(1)}/60s) -> [${a.verdict}] ${a.verdictTitle}` +
      (a.disposal ? ` | ${a.disposal.ceilMachines}x ${a.disposal.machineName}` : '') +
      (a.storage ? ` | ${a.storage.machineName} (заполнится за ${a.storage.minutesToFillOne.toFixed(1)} мин)` : '') +
      (a.recycleOptions.length ? ` | Переработка: ${a.recycleOptions.map((o) => o.recipeName).join(', ')}` : ''),
  );
}
assert.ok(advice.length > 0);
console.log('\nALL BLUEPRINT & BYPRODUCT ADVISOR CHECKS PASSED!');
