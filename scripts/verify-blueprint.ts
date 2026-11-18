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

  // 1. Assert NO WasteDump exists anywhere in generated blueprint (must use StorageFluid tank instead)
  const wasteDumps = generated.gridPlan.buildings.filter((b) => b.prototype === 'WasteDump');
  assert.equal(wasteDumps.length, 0, `Found forbidden WasteDump in ${preset.name}`);

  // 2. Assert STRICT material separation: no port is shared by two different productIds
  const portProducts = new Map<string, Set<string>>();
  for (const rt of generated.gridPlan.routes) {
    if (!rt.productId) continue;
    if (rt.fromBuildingId && rt.fromPortName) {
      const k = `${rt.fromBuildingId}:${rt.fromPortName}`;
      const s = portProducts.get(k) ?? new Set<string>();
      s.add(rt.productId);
      portProducts.set(k, s);
    }
    if (rt.toBuildingId && rt.toPortName) {
      const k = `${rt.toBuildingId}:${rt.toPortName}`;
      const s = portProducts.get(k) ?? new Set<string>();
      s.add(rt.productId);
      portProducts.set(k, s);
    }
  }
  for (const [pk, prods] of portProducts.entries()) {
    assert.equal(
      prods.size,
      1,
      `Mixed materials on port ${pk} in ${preset.name}: ${[...prods].join(', ')}`,
    );
  }

  // 3. Assert ZERO tile overlap between ground-level entities (buildings + lifts + ground MiniZips)
  const tileOwner = new Map<string, string>();
  const bMap = new Map(generated.gridPlan.buildings.map((b) => [b.id, b]));
  for (const b of generated.gridPlan.buildings) {
    for (let x = b.minX; x < b.minX + b.width; x++) {
      for (let y = b.minY; y < b.minY + b.height; y++) {
        const tk = `${x},${y},${b.tz}`;
        const prev = tileOwner.get(tk);
        assert.equal(prev, undefined, `Overlap at ${tk} in ${preset.name}: ${prev} vs ${b.id} (${b.prototype})`);
        tileOwner.set(tk, `${b.id}(${b.prototype})`);
      }
    }
  }

  // 4. Assert exact Z-elevation consistency for every route vs attached port (and flat Z on non-pipe belts)
  for (const rt of generated.gridPlan.routes) {
    const sb = rt.fromBuildingId ? bMap.get(rt.fromBuildingId) : undefined;
    const db = rt.toBuildingId ? bMap.get(rt.toBuildingId) : undefined;
    const sp = sb?.ports.find((x) => x.name === rt.fromPortName);
    const dp = db?.ports.find((x) => x.name === rt.toPortName);
    assert.ok(sp && dp, `Missing port metadata for ${rt.id} in ${preset.name}`);
    const p0 = rt.pivots[0];
    const pLast = rt.pivots[rt.pivots.length - 1];
    assert.equal(p0[2], sp.connZ, `Start Z mismatch on ${rt.id} (${rt.protoId}) in ${preset.name}: p0[2]=${p0[2]} vs sp.connZ=${sp.connZ}`);
    assert.equal(pLast[2], dp.connZ, `End Z mismatch on ${rt.id} (${rt.protoId}) in ${preset.name}: pLast[2]=${pLast[2]} vs dp.connZ=${dp.connZ}`);
    if (rt.kind !== 'fluid') {
      assert.ok(
        rt.pivots.every((pt) => pt[2] === p0[2]),
        `Non-fluid belt ${rt.id} (${rt.protoId}) must stay at constant Z in ${preset.name}`,
      );
    }
  }

  const liftCount = generated.gridPlan.buildings.filter((b) => b.role === 'lift').length;
  const miniZipCount = generated.gridPlan.buildings.filter((b) => b.role === 'junction').length;
  const elevatedRoutes = generated.gridPlan.routes.filter((rt) => rt.zLevel > 0).length;
  const dumpTanks = generated.gridPlan.buildings.filter(
    (b) => b.role === 'disposal' && b.prototype.startsWith('StorageFluid'),
  ).length;
  if (preset.id === 'preset-petrochem') {
    assert.ok(dumpTanks > 0, 'Expected StorageFluid dump tank in Petrochem preset');
  }
  assert.ok(elevatedRoutes > 0, `Expected multi-level routes (zLevel > 0) in ${preset.name}`);
  console.log(
    `  ✓ Round-trip decoded: ${roundTrip.totalEntities} entities (in=${generated.gridPlan.inputStoragesCount}, out=${generated.gridPlan.outputStoragesCount}, lifts=${liftCount}, miniZip=${miniZipCount}, dumpTanks=${dumpTanks}, elevated=${elevatedRoutes}/${generated.gridPlan.routes.length}, trailer=${trailerHex})`,
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
