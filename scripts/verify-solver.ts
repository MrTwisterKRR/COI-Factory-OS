import assert from 'node:assert/strict';
import { STARTER_PRESETS } from '../src/data/presets';
import { solveProductionChain } from '../src/engine/solver';
import type { FactoryPlanConfig } from '../src/types/coi';

console.log('=== Verifying Captain of Industry Solver ===');

for (const preset of STARTER_PRESETS) {
  const result = solveProductionChain(preset);
  console.log(`\nPreset: ${preset.name} (${preset.id})`);
  console.log(`  Steps: ${result.steps.length}, Edges: ${result.edges.length}, Cycles broken: ${result.cyclesDetected.length}`);
  console.log(`  Workers: ${result.summary.totalWorkers}, Power: ${result.summary.electricityConsumedKw} kW, Machines (ceil): ${result.summary.totalMachinesCeil}`);
  console.log(`  Raw inputs (${result.summary.rawInputs.length}): ${result.summary.rawInputs.map((r) => `${r.name}:${r.ratePer60.toFixed(1)}`).join(', ')}`);

  assert.ok(result.steps.length > 0, `Expected steps > 0 for ${preset.id}`);
  assert.ok(Number.isFinite(result.summary.totalWorkers), 'Workers must be finite');
  assert.ok(Number.isFinite(result.summary.electricityConsumedKw), 'Electricity must be finite');
  assert.ok(Number.isFinite(result.summary.totalMachinesExact) && result.summary.totalMachinesExact > 0, 'Total machines must be > 0');

  for (const step of result.steps) {
    assert.ok(Number.isFinite(step.exactMachines) && step.exactMachines >= 0, `Invalid exactMachines on ${step.stepId}`);
    assert.ok(step.ceilMachines >= 0, `Invalid ceilMachines on ${step.stepId}`);
    for (const io of [...step.inputs, ...step.outputs]) {
      assert.ok(Number.isFinite(io.ratePer60), `NaN ratePer60 on ${step.stepId} -> ${io.productId}`);
    }
  }
}

// Explicit cycle stress test: acid + sulfur + sour_water + steam_high + water + computing
const cycleStressConfig: FactoryPlanConfig = {
  id: 'cycle-stress',
  name: 'Cycle Stress Test',
  targets: [
    { id: 't1', productId: 'acid', ratePer60: 60, mode: 'rate', fixedMachines: 1 },
    { id: 't2', productId: 'steam_high', ratePer60: 96, mode: 'rate', fixedMachines: 2 },
    { id: 't3', productId: 'computing', ratePer60: 192, mode: 'rate', fixedMachines: 1 },
    { id: 't4', productId: 'diesel', ratePer60: 120, mode: 'rate', fixedMachines: 1 },
  ],
  recipeOverrides: {
    sulfur: 'exhaust_filtering',
  },
  rawResources: [],
  contractOverrides: {
    gold: 'Contract_Product_Gold_For_Product_Diesel',
  },
  productionBoost: 1,
  roundMachinesUp: true,
};

const stressRes = solveProductionChain(cycleStressConfig);
console.log(`\nCycle Stress Test -> Steps: ${stressRes.steps.length}, Cycles broken: ${stressRes.cyclesDetected.length}, Workers: ${stressRes.summary.totalWorkers}`);
assert.ok(stressRes.steps.length > 0, 'Stress test must produce steps');

// Contract override test
const contractPlan: FactoryPlanConfig = {
  id: 'contract-test',
  name: 'Contract Test',
  targets: [{ id: 'tc1', productId: 'coal', ratePer60: 55, mode: 'rate', fixedMachines: 1 }],
  recipeOverrides: {},
  rawResources: ['limestone'],
  contractOverrides: {
    coal: 'Contract_Product_Coal_For_Product_Cement',
  },
  productionBoost: 1,
  roundMachinesUp: true,
};

const contractRes = solveProductionChain(contractPlan);
console.log(`Contract Test -> Steps: ${contractRes.steps.length}, Unity: ${contractRes.summary.unityConsumed.toFixed(3)}`);
assert.ok(contractRes.steps.some((s) => s.kind === 'contract'), 'Expected contract step');
assert.ok(contractRes.steps.some((s) => s.primaryProductId === 'cement'), 'Expected cement production for coal contract');

console.log('\nALL SOLVER CHECKS PASSED!');
