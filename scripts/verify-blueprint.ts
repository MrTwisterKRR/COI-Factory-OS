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
  assert.ok(generated.gridPlan.inputStoragesCount > 0, `Expected input storages in ${preset.name}`);
  assert.ok(generated.gridPlan.outputStoragesCount > 0, `Expected output storages in ${preset.name}`);
  assert.ok(generated.gridPlan.transportCount > 0, `Expected transport routes in ${preset.name}`);
  assert.equal(roundTrip.gridPlan.routes.length, generated.gridPlan.routes.length);
  console.log(
    `  ✓ Round-trip decoded: ${roundTrip.totalEntities} entities (in=${generated.gridPlan.inputStoragesCount}, out=${generated.gridPlan.outputStoragesCount}, routes=${generated.gridPlan.routes.length}, trailer=${trailerHex})`,
  );

  if (outDir) {
    fs.writeFileSync(`${outDir}/${preset.id}.txt`, generated.code, 'utf8');
  }
}

console.log('\n=== 2b. Decoding compact B1648 Плавильня 1 blueprint (v7 + transports) ===');
const b1648 =
  'B1648:H4sIAAAAAAAACo1WwWsjVRz+venLZPq2SbPp7PgcSwgljCGUkIZQx1ICUlQKLVtsT17KkM52R7IzYTIVe/TmQfCqIPgfiOhFXITNIrKIaHYRQQ8i4mFZFg+LqKAs/t5LmozudNLynd683/u+933fTJr9QSGZRv25+vN/EUUffjC8Ofxo+PHw0+HNu28PP7/7TnltDvYpLVwNvWPPd7ov+pEXnW4f3blFMsWd4NjrR16nv+33TqLd4MgFdWmyePUkOlvNLr7s+m7odPdCLwjxgCIQbX4vDKIgOu2585f3b7jdyPOPXzoJfafjHqwRln3F7Xg9t69cKm6HgX+242BtK3C6C0v/XdvvhE6P5OYPQsfvXwvCGxnGAIDSr1AnqJAVhPnc1TdOj11/TEIYWcztR67bPTuH5DJlTY59HRsrLGw5/cgNt4Kg6x7h1OWinBKrODRezmWaDBRQinmpoReE0VbQDcI3//n7z8UlfbL4Qqfj+qNHj7997xMVCfTibtCNXH/XjZzu1nXH990ukCsMZ15zO1EQnuYIqiKg6Aw4shRHh07mcbPYoSB0DQwNCL13i+ATw9r1fO9Vr3e4Hewh+f51p+ceJrHlMlzcnNDv5OBT1R3vWhQf2gmCvrvroA8ejgX+6+5pEB4erolRYEBx9Hs5yp+92GhTTBp5JP3/fZ5W9zD4gzVQrhTw1nizOSsPVl41Edk9r9t1wn5GsfJm/olRnFkSZilAdQo6VTliQTUzik45JfRXqfEZnuSLYJVO5NUnRQmTz06ualBDUGhS7Mr9WFfmCVMuLeAZzJQ9ehCvnyicqBiXjx7GKyZaJSpkygolxysLYAI30wvAweAYxqNRAeR9uEz291GyMjBTBvbHKDAZRCkpiHgCJbBKqlkSVlols0To45GVkqE0yzEONYQOTT2RJQdSvsINlS8LCm7w5bRwzYJmIYoIwO1mwSokn6tI37iu8aJmzhGuJ20zpHWAyaMbmoVQEGDOU57nlIOFZr0/mF63oCWbNVXHbISOEIcIdXbBTqSeKmS8yC6gkHFgNoIiwMypZwptsLHfn8VVsmSVE8plxg0mzF7mRvpGjRvaeCOlXwySCl+Trf5ykFD4qnx0Z5BQ+NqswteA19ILXwWjivl8M5gWvioLPxxMC1+Thb83mBa+PqvwdbDqqlmXha+bdUJ/jHlbn1X4KtQQFWhW8Oo/JTq2IW35OckxWz76JcmxjVmObQDfSHfMBsNGN+7HHLOlYw9ijm1Ixx7GHGvPcqwNVls129KxttnGT07MsfYsx2yoIVrQbKV/ItZVvik/Eet8M/UlbGgWoomQn4iG1UgteUvjTfmJaBH61u2p8Masl73BbEQLIV925LEbdiudi/EmG3O9G+ea9cpuMr4uX9lNvp6+UePrWurGsZ1lla+oQko5MdtRZ+b0CugV1aiInXol9UBL5avywFVCP4zdrZJQADHIRpIJL0n3S6nXqmt8RTOzc7zOV3mijkksZc1CrCBE/Mtlq0zo7Zie8jm5TvWwC+hhfIVdUA+zERWEqInQY5ftCn5W4prOyX8SQwv0lmq0ZAznVGwcQ0PlTRlDA//riVG0zolhQqGDrquGLinO+ckaUxRUXpQUBUJ/i1HoSHH29y8gI88iYQwAAA==';
const dec1648 = decodeGameBlueprint(b1648);
assert.equal(dec1648.name, 'Плавильня 1');
assert.equal(dec1648.totalEntities, 83);
assert.ok(dec1648.gridPlan.buildings.length > 0);
assert.ok(dec1648.gridPlan.routes.length > 0);
console.log(
  `  ✓ B1648 decoded: ${dec1648.gridPlan.buildings.length} buildings/junctions, ${dec1648.gridPlan.routes.length} transport segments`,
);

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
