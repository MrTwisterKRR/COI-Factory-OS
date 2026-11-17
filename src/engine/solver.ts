import {
  CONTRACTS_BY_ID,
  CONTRACTS_FOR_PRODUCT,
  MACHINES,
  NATURAL_RAW_PRODUCT_IDS,
  POLLUTION_PRODUCT_IDS,
  PRODUCTS,
  RECIPES,
  VIRTUAL_PRODUCT_IDS,
  computeLogistics,
  getCategoryLabel,
  getMachineLabel,
  getProductLabel,
  getRecipeLabel,
} from '../data';
import type {
  FactoryPlanConfig,
  FactorySummary,
  Product,
  Recipe,
  SolvedEdge,
  SolvedStep,
  SolvedStepIO,
  SolveResult,
  UnlockedGameFilter,
} from '../types/coi';

const EXCLUDED_PRODUCER_MACHINES = new Set([
  'liquid_dump',
  'waste_dump',
  'flare',
  'smoke_stack',
  'smoke_stack_large',
  'burner',
  'incineration_plant',
  'thermal_storage',
  'waste_sorting_plant',
]);

// Secondary waste/exhaust feeds that shouldn't auto-expand random furnaces if needed as an input
const NON_EXPANDABLE_FEEDS = new Set([
  'exhaust',
  'carbon_dioxide',
  'waste_water',
  'sludge',
  'toxic_slurry',
  'red_mud',
  'slag',
  'slag_crushed',
  'air_pollution',
  'water_pollution',
  'recyclables',
  'recyclables_pressed',
  'waste',
  'trash',
]);

// Curated sane default recipes for common Captain of Industry products
export const PREFERRED_DEFAULT_RECIPES: Record<string, string> = {
  water: 'water_pumping',
  seawater: 'ocean_water_pumping',
  crude_oil: 'oil_pumping',
  oxygen: 'air_separation',
  nitrogen: 'air_separation',
  hydrogen: 'water_electrolysis',
  chlorine: 'brine_electrolysis',
  brine: 'thermal_desalination_2',
  acid: 'acid_mixing',
  sulfur: 'sour_water_stripping_recovery',
  ammonia: 'ammonia_synthesis',
  steam_high: 'steam_generation',
  steam_low: 'turbinehighpress',
  chilled_water: 'water_cooling',
  molten_iron: 'iron_smelting',
  iron: 'iron_casting',
  molten_steel: 'steel_smelting',
  steel: 'steel_casting_cooled',
  molten_copper: 'copper_smelting',
  impure_copper: 'copper_casting',
  copper: 'copper_purification_acid',
  glass_mix: 'glass_mix_mixing',
  molten_glass: 'glass_smelting_5',
  glass: 'glass_casting',
  molten_silicon: 'silicon_smelting_arc',
  silicon_poly: 'silicon_treatment',
  silicon_wafer: 'silicon_crystallization',
  gold: 'gold_smelting',
  gold_ore_concentrate: 'gold_settling',
  gold_ore_powder: 'gold_ore_milling',
  cement: 'cement_production_3',
  concrete_slab: 'concrete_mixing_2',
  construction_parts: 'cp_assembly_t2',
  construction_parts_ii: 'cp2_assembly_t2',
  construction_parts_iii: 'cp3_assembly_t2',
  construction_parts_iv: 'cp4_assembly_t3',
  mechanical_parts: 'mech._parts_assembly_t2',
  electronics: 'electronics_assembly_t2',
  electronics_ii: 'electronics_2_assembly_t2',
  electronics_iii: 'electronics_3_assembly_t2',
  pcb: 'pcb_assembly_t2',
  rubber: 'rubber_production',
  plastic: 'plastic_making',
  graphite: 'graphite_production',
  medium_oil: 'crude_oil_refining',
  heavy_oil: 'crude_oil_refining',
  sour_water: 'crude_oil_refining',
  diesel: 'crude_oil_refining_2',
  light_oil: 'crude_oil_refining_2',
  naphtha: 'heavy_distillate_refining',
  fuel_gas: 'heavy_distillate_refining',
  microchips: 'microchip_manufacturing_final_stage',
  microchips_stage_1_a: 'microchip_manufacturing_stage_1a',
  microchips_stage_2_a: 'microchip_manufacturing_stage_1b',
  microchips_stage_3_a: 'microchip_manufacturing_stage_1c',
  microchips_stage_4_a: 'microchip_manufacturing_stage_1d',
  microchips_stage_4_b: 'microchip_manufacturing_stage_2d',
  maintenance_i: 'maintenance_i',
  maintenance_ii: 'maintenance_ii',
  maintenance_iii: 'maintenance_iii',
  lab_equipment: 'lab_equipment_1_assembly_t2',
  lab_equipment_ii: 'lab_equipment_2_assembly_t2',
  lab_equipment_iii: 'lab_equipment_3_assembly_t2',
  lab_equipment_iv: 'lab_equipment_4_assembly_t2',
  computing: 'basic_rack',
};

export function isValidProducingRecipe(recipe: Recipe, productId: string): boolean {
  if (!recipe || recipe.duration <= 0) return false;
  const machine = MACHINES[recipe.machine];
  if (!machine) return false;
  if (machine.isStorage || machine.isMine) return false;
  if (EXCLUDED_PRODUCER_MACHINES.has(machine.id)) return false;

  // Data center only produces computing legitimately; ignore its water output for water sourcing
  if (machine.id === 'data_center' && productId !== 'computing') return false;

  const outItem = recipe.outputs.find((o) => o.id === productId);
  if (!outItem || outItem.quantity <= 0) return false;

  // Exclude pass-through / lossy recycling of the same product
  const inItem = recipe.inputs.find((i) => i.id === productId);
  if (inItem && inItem.quantity >= outItem.quantity) return false;

  return true;
}

export function getProducingRecipes(productId: string): Recipe[] {
  const product = PRODUCTS[productId];
  if (!product) return [];

  const valid: Recipe[] = [];
  for (const rid of product.recipes.output) {
    const r = RECIPES[rid];
    if (r && isValidProducingRecipe(r, productId)) {
      valid.push(r);
    }
  }

  // Sort: preferred default first, then primary outputs, then alphabetical
  const preferredId = PREFERRED_DEFAULT_RECIPES[productId];
  return valid.sort((a, b) => {
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    const aPrimary = a.outputs[0]?.id === productId ? 1 : 0;
    const bPrimary = b.outputs[0]?.id === productId ? 1 : 0;
    if (aPrimary !== bPrimary) return bPrimary - aPrimary;
    return a.name.localeCompare(b.name);
  });
}

function scoreFallbackRecipe(recipe: Recipe, productId: string): number {
  let score = 0;
  if (recipe.outputs[0]?.id === productId) score += 50;
  if (recipe.inputs.length === 0) score += 30;
  if (/scrap|broken|nuclear|breeder|reprocess/i.test(recipe.id)) score -= 40;
  if (/ammonia_electrolysis/i.test(recipe.id)) score -= 35;
  if (recipe.machine === 'data_center') score -= 80;
  if (/arc_furnace/i.test(recipe.machine)) score -= 10;
  // Prefer recipes with fewer total inputs (simpler chains)
  score -= recipe.inputs.length * 3;
  return score;
}

export function pickDefaultRecipe(
  productId: string,
  unlockedFilter?: UnlockedGameFilter,
): string | null {
  const preferred = PREFERRED_DEFAULT_RECIPES[productId];
  const candidates = getProducingRecipes(productId);
  if (candidates.length === 0) return null;

  if (unlockedFilter?.enabled) {
    const unlockedCandidates = candidates.filter((r) =>
      unlockedFilter.unlockedRecipeIds.has(r.id),
    );
    const pool =
      unlockedCandidates.length > 0 ? unlockedCandidates : candidates;

    const stagePref = unlockedFilter.stagePreferredRecipes?.[productId];
    if (
      stagePref &&
      unlockedFilter.unlockedRecipeIds.has(stagePref) &&
      pool.some((r) => r.id === stagePref) &&
      unlockedFilter.stageMode !== 'game_sync'
    ) {
      return stagePref;
    }

    const scored = [...pool].sort((a, b) => {
      const activeBonusA =
        unlockedFilter.stageMode === 'game_sync' &&
        unlockedFilter.activeRecipeIds.has(a.id)
          ? 180
          : 0;
      const activeBonusB =
        unlockedFilter.stageMode === 'game_sync' &&
        unlockedFilter.activeRecipeIds.has(b.id)
          ? 180
          : 0;
      const stageBonusA = a.id === stagePref ? 140 : 0;
      const stageBonusB = b.id === stagePref ? 140 : 0;
      const prefBonusA = a.id === preferred ? 80 : 0;
      const prefBonusB = b.id === preferred ? 80 : 0;
      return (
        activeBonusB +
        stageBonusB +
        prefBonusB +
        scoreFallbackRecipe(b, productId) -
        (activeBonusA + stageBonusA + prefBonusA + scoreFallbackRecipe(a, productId))
      );
    });
    return scored[0].id;
  }

  if (preferred) {
    const r = RECIPES[preferred];
    if (r && isValidProducingRecipe(r, productId)) {
      return preferred;
    }
  }

  const sorted = [...candidates].sort(
    (a, b) => scoreFallbackRecipe(b, productId) - scoreFallbackRecipe(a, productId),
  );
  return sorted[0].id;
}

type ProviderResolution =
  | { kind: 'raw' }
  | { kind: 'contract'; contractId: string }
  | { kind: 'recipe'; recipeId: string };

function resolveProviderForProduct(
  productId: string,
  config: FactoryPlanConfig,
  rawSet: Set<string>,
  targetRecipeByProduct: Map<string, string>,
  isExplicitTarget: boolean,
  unlockedFilter?: UnlockedGameFilter,
): ProviderResolution {
  if (VIRTUAL_PRODUCT_IDS.has(productId)) {
    return { kind: 'raw' };
  }
  if (!isExplicitTarget && rawSet.has(productId)) {
    return { kind: 'raw' };
  }
  if (!isExplicitTarget && NON_EXPANDABLE_FEEDS.has(productId)) {
    return { kind: 'raw' };
  }

  const contractId = config.contractOverrides[productId];
  if (contractId && CONTRACTS_BY_ID[contractId]) {
    return { kind: 'contract', contractId };
  }

  const explicitTargetRecipe = targetRecipeByProduct.get(productId);
  const overrideRecipe = config.recipeOverrides[productId];

  // Natural mined/quarry resources (like Coal, Sand, Gravel, Iron Ore) default to raw mining
  // unless the user explicitly overrides them with a manufacturing recipe (e.g. Charcoal Kiln / Quartz Milling).
  if (!isExplicitTarget && !overrideRecipe && NATURAL_RAW_PRODUCT_IDS.has(productId)) {
    return { kind: 'raw' };
  }

  let candidateId =
    explicitTargetRecipe ||
    overrideRecipe ||
    pickDefaultRecipe(productId, unlockedFilter);

  // When a tech stage or game sync filter is active, adapt locked overrides to a valid unlocked recipe if one exists
  if (
    unlockedFilter?.enabled &&
    candidateId &&
    !unlockedFilter.unlockedRecipeIds.has(candidateId)
  ) {
    const fallbackUnlocked = pickDefaultRecipe(productId, unlockedFilter);
    if (
      fallbackUnlocked &&
      unlockedFilter.unlockedRecipeIds.has(fallbackUnlocked)
    ) {
      candidateId = fallbackUnlocked;
    }
  }

  if (candidateId) {
    const r = RECIPES[candidateId];
    if (r && isValidProducingRecipe(r, productId)) {
      return { kind: 'recipe', recipeId: candidateId };
    }
  }

  return { kind: 'raw' };
}

export function solveProductionChain(
  config: FactoryPlanConfig,
  unlockedFilter?: UnlockedGameFilter,
): SolveResult {
  const boost = config.productionBoost > 0 ? config.productionBoost : 1;
  const rawSet = new Set(config.rawResources);
  const targetProductIds = new Set(config.targets.map((t) => t.productId));

  // Map target-level recipe overrides & compute effective target rates per 60s
  const targetRecipeByProduct = new Map<string, string>();
  for (const t of config.targets) {
    if (t.recipeId && RECIPES[t.recipeId] && isValidProducingRecipe(RECIPES[t.recipeId], t.productId)) {
      targetRecipeByProduct.set(t.productId, t.recipeId);
    }
  }

  const targetRateByProduct = new Map<string, number>();
  const forcedMachinesByRecipe = new Map<string, number>();
  const targetDiagnostics: SolveResult['targetDiagnostics'] = [];

  for (const t of config.targets) {
    const prod = PRODUCTS[t.productId];
    if (!prod) continue;

    const provider = resolveProviderForProduct(
      t.productId,
      config,
      rawSet,
      targetRecipeByProduct,
      true,
      unlockedFilter,
    );

    let actualRatePer60 = Math.max(0, t.ratePer60);
    let usedRecipeId: string | null = null;
    let machinesUsed = 0;

    if (provider.kind === 'recipe') {
      usedRecipeId = provider.recipeId;
      const recipe = RECIPES[provider.recipeId];
      const outItem = recipe.outputs.find((o) => o.id === t.productId);
      const perMachine60 = outItem ? (outItem.quantity * 60 * boost) / recipe.duration : 0;

      if (t.mode === 'machines' && perMachine60 > 0) {
        const mCount = Math.max(0.01, t.fixedMachines);
        actualRatePer60 = mCount * perMachine60;
        machinesUsed = mCount;
        forcedMachinesByRecipe.set(
          provider.recipeId,
          (forcedMachinesByRecipe.get(provider.recipeId) ?? 0) + mCount,
        );
      } else if (perMachine60 > 0) {
        machinesUsed = actualRatePer60 / perMachine60;
      }
    } else if (provider.kind === 'contract') {
      const c = CONTRACTS_BY_ID[provider.contractId];
      if (t.mode === 'machines' && c) {
        const mCount = Math.max(0.01, t.fixedMachines);
        actualRatePer60 = mCount * c.product_to_buy_quantity;
        machinesUsed = mCount;
      } else if (c && c.product_to_buy_quantity > 0) {
        machinesUsed = actualRatePer60 / c.product_to_buy_quantity;
      }
    }

    targetRateByProduct.set(
      t.productId,
      (targetRateByProduct.get(t.productId) ?? 0) + actualRatePer60,
    );
    targetDiagnostics.push({
      targetId: t.id,
      productId: t.productId,
      actualRatePer60,
      recipeId: usedRecipeId,
      machinesUsed,
    });
  }

  // Phase 1: Discover active steps (steps keyed by stepId: "recipe:<id>" or "contract:<id>")
  interface GraphStepMeta {
    stepId: string;
    kind: 'recipe' | 'contract';
    recipeId?: string;
    contractId?: string;
    primaryProductId: string;
    producedProductIds: Set<string>;
    depth: number;
    hasCycleInput: boolean;
  }

  const stepMetas = new Map<string, GraphStepMeta>();
  const productToStepId = new Map<string, string>();
  const consumerEdges = new Map<string, { sourceStepId: string; targetStepId: string; productId: string; isCycle: boolean }>();
  const cyclesDetected: { fromProductId: string; toProductId: string }[] = [];

  // 0/unseen, 1/visiting, 2/done by stepId
  const visitState = new Map<string, 1 | 2>();

  function discoverFromProduct(
    productId: string,
    depth: number,
    activeProductStack: Set<string>,
    consumerStepId: string | null,
  ): string | null {
    const isExplicitTarget = consumerStepId === null;
    const provider = resolveProviderForProduct(
      productId,
      config,
      rawSet,
      targetRecipeByProduct,
      isExplicitTarget,
      unlockedFilter,
    );

    if (provider.kind === 'raw') {
      return null;
    }

    const stepId =
      provider.kind === 'recipe'
        ? `recipe:${provider.recipeId}`
        : `contract:${provider.contractId}`;

    // Check cycle
    if (activeProductStack.has(productId) || visitState.get(stepId) === 1) {
      if (consumerStepId) {
        const edgeKey = `${stepId}->${consumerStepId}:${productId}`;
        consumerEdges.set(edgeKey, {
          sourceStepId: stepId,
          targetStepId: consumerStepId,
          productId,
          isCycle: true,
        });
        const consumerMeta = stepMetas.get(consumerStepId);
        if (consumerMeta) consumerMeta.hasCycleInput = true;
      }
      cyclesDetected.push({ fromProductId: productId, toProductId: productId });
      return stepId;
    }

    // Create or update step metadata
    let meta = stepMetas.get(stepId);
    if (!meta) {
      meta = {
        stepId,
        kind: provider.kind,
        recipeId: provider.kind === 'recipe' ? provider.recipeId : undefined,
        contractId: provider.kind === 'contract' ? provider.contractId : undefined,
        primaryProductId: productId,
        producedProductIds: new Set([productId]),
        depth,
        hasCycleInput: false,
      };
      stepMetas.set(stepId, meta);
    } else {
      meta.producedProductIds.add(productId);
      meta.depth = Math.max(meta.depth, depth);
    }

    productToStepId.set(productId, stepId);

    if (consumerStepId) {
      const edgeKey = `${stepId}->${consumerStepId}:${productId}`;
      if (!consumerEdges.has(edgeKey)) {
        consumerEdges.set(edgeKey, {
          sourceStepId: stepId,
          targetStepId: consumerStepId,
          productId,
          isCycle: false,
        });
      }
    }

    if (visitState.get(stepId) === 2) {
      // Already expanded upstream; ensure depths propagate downstream -> upstream
      return stepId;
    }

    visitState.set(stepId, 1);
    const nextStack = new Set(activeProductStack);
    nextStack.add(productId);

    if (provider.kind === 'recipe') {
      const recipe = RECIPES[provider.recipeId];
      for (const inp of recipe.inputs) {
        discoverFromProduct(inp.id, depth + 1, nextStack, stepId);
      }
    } else {
      const contract = CONTRACTS_BY_ID[provider.contractId];
      if (contract?.payProductId) {
        discoverFromProduct(contract.payProductId, depth + 1, nextStack, stepId);
      }
    }

    visitState.set(stepId, 2);
    return stepId;
  }

  for (const [pid, rate] of targetRateByProduct.entries()) {
    if (rate > 0 || targetRecipeByProduct.has(pid)) {
      discoverFromProduct(pid, 0, new Set(), null);
    }
  }

  // Phase 2: Topological sort of steps from consumers (targets) -> upstream producers
  // Note: edges in consumerEdges go sourceStepId (producer) -> targetStepId (consumer).
  // For demand propagation, consumers run BEFORE producers!
  const inDegree = new Map<string, number>(); // number of non-cycle consumers waiting on this producer
  const producersOfConsumer = new Map<string, string[]>();
  for (const sid of stepMetas.keys()) {
    inDegree.set(sid, 0);
    producersOfConsumer.set(sid, []);
  }
  const seenConsumerProducerPairs = new Set<string>();
  for (const edge of consumerEdges.values()) {
    if (edge.isCycle) continue;
    const pairKey = `${edge.targetStepId}=>${edge.sourceStepId}`;
    if (seenConsumerProducerPairs.has(pairKey)) continue;
    seenConsumerProducerPairs.add(pairKey);
    producersOfConsumer.get(edge.targetStepId)?.push(edge.sourceStepId);
    inDegree.set(edge.sourceStepId, (inDegree.get(edge.sourceStepId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [sid, deg] of inDegree.entries()) {
    if (deg === 0) queue.push(sid);
  }
  const topoOrder: string[] = [];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    topoOrder.push(curr);
    for (const prodSid of producersOfConsumer.get(curr) ?? []) {
      const nextDeg = (inDegree.get(prodSid) ?? 1) - 1;
      inDegree.set(prodSid, nextDeg);
      if (nextDeg === 0) queue.push(prodSid);
    }
  }
  // Safety: append any remaining nodes if complex multi-step cycle existed
  for (const sid of stepMetas.keys()) {
    if (!topoOrder.includes(sid)) topoOrder.push(sid);
  }

  // Compute clean topological depths (0 = target / root consumer, +1 per upstream hop)
  const topoDepth = new Map<string, number>();
  for (const sid of topoOrder) {
    const currDepth = topoDepth.get(sid) ?? 0;
    for (const prodSid of producersOfConsumer.get(sid) ?? []) {
      topoDepth.set(prodSid, Math.max(topoDepth.get(prodSid) ?? 0, currDepth + 1));
    }
  }

  // Phase 3: Propagate demands in topological order (consumers -> producers)
  const productDemand = new Map<string, number>();
  for (const [pid, rate] of targetRateByProduct.entries()) {
    productDemand.set(pid, rate);
  }

  const stepExactMachines = new Map<string, number>();
  const rawDemands = new Map<string, number>();
  const cycleDemands = new Map<string, number>();
  const solvedEdges: SolvedEdge[] = [];

  for (const sid of topoOrder) {
    const meta = stepMetas.get(sid)!;

    if (meta.kind === 'recipe' && meta.recipeId) {
      const recipe = RECIPES[meta.recipeId];
      let maxMachines = forcedMachinesByRecipe.get(meta.recipeId) ?? 0;

      for (const out of recipe.outputs) {
        if (productToStepId.get(out.id) === sid) {
          const demand = productDemand.get(out.id) ?? 0;
          const outPerMachine60 = (out.quantity * 60 * boost) / recipe.duration;
          if (outPerMachine60 > 0) {
            maxMachines = Math.max(maxMachines, demand / outPerMachine60);
          }
        }
      }

      stepExactMachines.set(sid, maxMachines);

      // Propagate input requirements upstream
      for (const inp of recipe.inputs) {
        const inpRate60 = (inp.quantity * 60 * boost * maxMachines) / recipe.duration;
        const prodStepId = productToStepId.get(inp.id);
        const edgeKey = prodStepId ? `${prodStepId}->${sid}:${inp.id}` : null;
        const edgeMeta = edgeKey ? consumerEdges.get(edgeKey) : undefined;

        if (!prodStepId) {
          rawDemands.set(inp.id, (rawDemands.get(inp.id) ?? 0) + inpRate60);
        } else if (edgeMeta?.isCycle) {
          cycleDemands.set(inp.id, (cycleDemands.get(inp.id) ?? 0) + inpRate60);
          solvedEdges.push({
            id: `${prodStepId}-${sid}-${inp.id}`,
            sourceStepId: prodStepId,
            targetStepId: sid,
            productId: inp.id,
            ratePer60: inpRate60,
            isCycle: true,
          });
        } else {
          productDemand.set(inp.id, (productDemand.get(inp.id) ?? 0) + inpRate60);
          solvedEdges.push({
            id: `${prodStepId}-${sid}-${inp.id}`,
            sourceStepId: prodStepId,
            targetStepId: sid,
            productId: inp.id,
            ratePer60: inpRate60,
            isCycle: false,
          });
        }
      }
    } else if (meta.kind === 'contract' && meta.contractId) {
      const contract = CONTRACTS_BY_ID[meta.contractId];
      const demand = productDemand.get(meta.primaryProductId) ?? 0;
      const buyQty = contract.product_to_buy_quantity || 1;
      const exactTrades = demand / buyQty;
      stepExactMachines.set(sid, exactTrades);

      if (contract.payProductId) {
        const payRate60 = exactTrades * contract.product_to_pay_with_quantity;
        const prodStepId = productToStepId.get(contract.payProductId);
        const edgeKey = prodStepId
          ? `${prodStepId}->${sid}:${contract.payProductId}`
          : null;
        const edgeMeta = edgeKey ? consumerEdges.get(edgeKey) : undefined;

        if (!prodStepId) {
          rawDemands.set(
            contract.payProductId,
            (rawDemands.get(contract.payProductId) ?? 0) + payRate60,
          );
        } else if (edgeMeta?.isCycle) {
          cycleDemands.set(
            contract.payProductId,
            (cycleDemands.get(contract.payProductId) ?? 0) + payRate60,
          );
          solvedEdges.push({
            id: `${prodStepId}-${sid}-${contract.payProductId}`,
            sourceStepId: prodStepId,
            targetStepId: sid,
            productId: contract.payProductId,
            ratePer60: payRate60,
            isCycle: true,
          });
        } else {
          productDemand.set(
            contract.payProductId,
            (productDemand.get(contract.payProductId) ?? 0) + payRate60,
          );
          solvedEdges.push({
            id: `${prodStepId}-${sid}-${contract.payProductId}`,
            sourceStepId: prodStepId,
            targetStepId: sid,
            productId: contract.payProductId,
            ratePer60: payRate60,
            isCycle: false,
          });
        }
      }
    }
  }

  // Phase 4: Build SolvedStep objects & FactorySummary
  const solvedSteps: SolvedStep[] = [];
  let totalWorkers = 0;
  let electricityConsumedKw = 0;
  let electricityGeneratedKw = 0;
  const maintenanceTotals = {
    maintenance_i: 0,
    maintenance_ii: 0,
    maintenance_iii: 0,
  };
  let computingTFlops = 0;
  let unityConsumed = 0;
  let totalMachinesExact = 0;
  let totalMachinesCeil = 0;
  const buildCostMap = new Map<string, number>();
  const totalProducedByProduct = new Map<string, number>();

  for (const sid of topoOrder) {
    const meta = stepMetas.get(sid)!;
    const exactMachines = stepExactMachines.get(sid) ?? 0;

    if (meta.kind === 'recipe' && meta.recipeId) {
      const recipe = RECIPES[meta.recipeId];
      const machine = MACHINES[recipe.machine];
      const ceilMachines = Math.ceil(exactMachines - 1e-9);
      const effectiveMachines = config.roundMachinesUp ? ceilMachines : exactMachines;

      const inputs: SolvedStepIO[] = recipe.inputs.map((inp) => {
        const ratePerMachine60 = (inp.quantity * 60 * boost) / recipe.duration;
        const ratePer60 = ratePerMachine60 * exactMachines;
        const p = PRODUCTS[inp.id];
        const prodStepId = productToStepId.get(inp.id);
        const edgeMeta = prodStepId ? consumerEdges.get(`${prodStepId}->${sid}:${inp.id}`) : undefined;
        let sourceType: SolvedStepIO['sourceType'] = 'raw';
        if (prodStepId) {
          if (edgeMeta?.isCycle) sourceType = 'cycle';
          else if (prodStepId.startsWith('contract:')) sourceType = 'contract';
          else sourceType = 'step';
        }
        const prodLbl = getProductLabel(inp.id);
        return {
          productId: inp.id,
          name: prodLbl.ru ?? prodLbl.en,
          icon: p?.icon ?? 'Iron.png',
          ratePer60,
          ratePerMachine60,
          sourceType,
          isCycle: edgeMeta?.isCycle,
          beltInfo: computeLogistics(inp.id, ratePer60),
        };
      });

      const surplusOutputs: { productId: string; ratePer60: number }[] = [];
      const outputs: SolvedStepIO[] = recipe.outputs.map((out) => {
        const ratePerMachine60 = (out.quantity * 60 * boost) / recipe.duration;
        const ratePer60 = ratePerMachine60 * exactMachines;
        totalProducedByProduct.set(
          out.id,
          (totalProducedByProduct.get(out.id) ?? 0) + ratePer60,
        );
        const demanded = productDemand.get(out.id) ?? 0;
        if (ratePer60 - demanded > 0.01) {
          surplusOutputs.push({
            productId: out.id,
            ratePer60: ratePer60 - demanded,
          });
        }
        const p = PRODUCTS[out.id];
        const prodLbl = getProductLabel(out.id);
        return {
          productId: out.id,
          name: prodLbl.ru ?? prodLbl.en,
          icon: p?.icon ?? 'Iron.png',
          ratePer60,
          ratePerMachine60,
          sourceType: targetProductIds.has(out.id) ? 'target' : 'step',
          beltInfo: computeLogistics(out.id, ratePer60),
        };
      });

      const workers = machine.workers * effectiveMachines;
      const elecConsumed = machine.electricity_consumed * effectiveMachines;
      const elecGen = machine.electricity_generated * effectiveMachines;
      const comp = machine.computing_consumed * effectiveMachines;
      const unity = machine.unity_cost * effectiveMachines;
      const maintUnit = machine.maintenance_cost_units || '';
      const maintQty = machine.maintenance_cost_quantity * effectiveMachines;

      totalWorkers += workers;
      electricityConsumedKw += elecConsumed;
      electricityGeneratedKw += elecGen;
      computingTFlops += comp;
      unityConsumed += unity;
      totalMachinesExact += exactMachines;
      totalMachinesCeil += ceilMachines;

      if (
        maintUnit === 'maintenance_i' ||
        maintUnit === 'maintenance_ii' ||
        maintUnit === 'maintenance_iii'
      ) {
        maintenanceTotals[maintUnit] += maintQty;
      }

      // Build costs always use ceilMachines (cannot build half a building)
      for (const bc of machine.build_costs ?? []) {
        buildCostMap.set(bc.id, (buildCostMap.get(bc.id) ?? 0) + bc.quantity * ceilMachines);
      }

      const altRecipes = getProducingRecipes(meta.primaryProductId).map((r) => r.id);
      const altContracts = (CONTRACTS_FOR_PRODUCT[meta.primaryProductId] ?? []).map((c) => c.id);

      solvedSteps.push({
        stepId: sid,
        kind: 'recipe',
        primaryProductId: meta.primaryProductId,
        recipeId: recipe.id,
        recipeName: getRecipeLabel(recipe.id).ru,
        machineId: machine.id,
        machineName: getMachineLabel(machine.id).ru,
        machineIcon: machine.icon,
        categoryId: machine.category_id,
        categoryName: getCategoryLabel(machine.category_id),
        duration: recipe.duration,
        exactMachines,
        ceilMachines,
        effectiveMachines,
        isTarget: [...meta.producedProductIds].some((id) => targetProductIds.has(id)),
        hasCycleInput: meta.hasCycleInput,
        depth: topoDepth.get(sid) ?? meta.depth,
        inputs,
        outputs,
        surplusOutputs,
        workers,
        electricityConsumedKw: elecConsumed,
        electricityGeneratedKw: elecGen,
        computingTFlops: comp,
        unityCost: unity,
        maintenanceUnit: maintUnit,
        maintenanceQuantity: maintQty,
        alternativeRecipeIds: altRecipes,
        alternativeContractIds: altContracts,
      });
    } else if (meta.kind === 'contract' && meta.contractId) {
      const contract = CONTRACTS_BY_ID[meta.contractId];
      const buyProd = PRODUCTS[meta.primaryProductId];
      const payProd = contract.payProductId ? PRODUCTS[contract.payProductId] : undefined;
      const ceilTrades = Math.ceil(exactMachines - 1e-9);
      const effectiveTrades = config.roundMachinesUp ? ceilTrades : exactMachines;

      const payRate60 = exactMachines * contract.product_to_pay_with_quantity;
      const buyRate60 = exactMachines * contract.product_to_buy_quantity;
      totalProducedByProduct.set(
        meta.primaryProductId,
        (totalProducedByProduct.get(meta.primaryProductId) ?? 0) + buyRate60,
      );

      // Unity cost: monthly base + per 100 bought
      const unityCost =
        contract.unity_per_month +
        (buyRate60 / 100) * contract.unity_per_100_bought;
      unityConsumed += unityCost;

      const inputs: SolvedStepIO[] = payProd
        ? [
            {
              productId: payProd.id,
              name: payProd.name,
              icon: payProd.icon,
              ratePer60: payRate60,
              ratePerMachine60: contract.product_to_pay_with_quantity,
              sourceType: productToStepId.has(payProd.id) ? 'step' : 'raw',
              beltInfo: computeLogistics(payProd.id, payRate60),
            },
          ]
        : [];

      const outputs: SolvedStepIO[] = buyProd
        ? [
            {
              productId: buyProd.id,
              name: buyProd.name,
              icon: buyProd.icon,
              ratePer60: buyRate60,
              ratePerMachine60: contract.product_to_buy_quantity,
              sourceType: targetProductIds.has(buyProd.id) ? 'target' : 'step',
              beltInfo: computeLogistics(buyProd.id, buyRate60),
            },
          ]
        : [];

      const altRecipes = getProducingRecipes(meta.primaryProductId).map((r) => r.id);
      const altContracts = (CONTRACTS_FOR_PRODUCT[meta.primaryProductId] ?? []).map((c) => c.id);

      const buyLbl = getProductLabel(meta.primaryProductId);
      const payLbl = contract.payProductId
        ? getProductLabel(contract.payProductId)
        : null;

      solvedSteps.push({
        stepId: sid,
        kind: 'contract',
        primaryProductId: meta.primaryProductId,
        contractId: contract.id,
        recipeName: `Контракт: ${buyLbl.ru ?? contract.product_to_buy_name} ⇄ ${payLbl?.ru ?? contract.product_to_pay_with_name}`,
        machineId: 'cargo_depot_4',
        machineName: 'Грузовой порт (Контракт)',
        machineIcon: MACHINES['cargo_depot_4']?.icon ?? 'CargoDepot4.png',
        categoryId: 'cargo_docks',
        categoryName: getCategoryLabel('cargo_docks'),
        duration: 60,
        exactMachines,
        ceilMachines: ceilTrades,
        effectiveMachines: effectiveTrades,
        isTarget: targetProductIds.has(meta.primaryProductId),
        hasCycleInput: meta.hasCycleInput,
        depth: topoDepth.get(sid) ?? meta.depth,
        inputs,
        outputs,
        surplusOutputs: [],
        workers: 0,
        electricityConsumedKw: 0,
        electricityGeneratedKw: 0,
        computingTFlops: 0,
        unityCost,
        maintenanceUnit: '',
        maintenanceQuantity: 0,
        alternativeRecipeIds: altRecipes,
        alternativeContractIds: altContracts,
      });
    }
  }

  // Sort steps: targets (depth 0) first, then deeper upstream stages
  solvedSteps.sort((a, b) => a.depth - b.depth || b.exactMachines - a.exactMachines);

  // Build Raw Inputs list
  const rawInputs: FactorySummary['rawInputs'] = [];
  for (const [pid, rate] of rawDemands.entries()) {
    if (rate <= 1e-6) continue;
    const p = PRODUCTS[pid];
    const lbl = getProductLabel(pid);
    rawInputs.push({
      productId: pid,
      name: lbl.ru ?? lbl.en,
      icon: p?.icon ?? 'Iron.png',
      ratePer60: rate,
      beltInfo: computeLogistics(pid, rate),
    });
  }
  rawInputs.sort((a, b) => b.ratePer60 - a.ratePer60);

  // Build Net Outputs & Byproducts list
  const netOutputs: FactorySummary['netOutputs'] = [];
  const allOutputIds = new Set<string>([
    ...totalProducedByProduct.keys(),
    ...targetRateByProduct.keys(),
  ]);
  for (const pid of allOutputIds) {
    const produced = totalProducedByProduct.get(pid) ?? 0;
    const consumedInternally = (productDemand.get(pid) ?? 0) - (targetRateByProduct.get(pid) ?? 0);
    const targetAmt = targetRateByProduct.get(pid) ?? 0;
    const net = produced - Math.max(0, consumedInternally);
    if (net <= 0.01 && !targetProductIds.has(pid)) continue;
    const p = PRODUCTS[pid];
    const lbl = getProductLabel(pid);
    netOutputs.push({
      productId: pid,
      name: lbl.ru ?? lbl.en,
      icon: p?.icon ?? 'Iron.png',
      ratePer60: Math.max(0, net),
      isTarget: targetProductIds.has(pid),
      isPollution: POLLUTION_PRODUCT_IDS.has(pid),
      isSurplus: !targetProductIds.has(pid) && net > 0.01,
    });
  }
  netOutputs.sort((a, b) => {
    if (a.isTarget !== b.isTarget) return a.isTarget ? -1 : 1;
    if (a.isPollution !== b.isPollution) return a.isPollution ? 1 : -1;
    return b.ratePer60 - a.ratePer60;
  });

  // Build costs sorted
  const buildCosts: FactorySummary['buildCosts'] = [];
  for (const [pid, qty] of buildCostMap.entries()) {
    const p = PRODUCTS[pid];
    const lbl = getProductLabel(pid);
    buildCosts.push({
      productId: pid,
      name: lbl.ru ?? lbl.en,
      icon: p?.icon ?? 'ConstructionParts.png',
      quantity: Math.ceil(qty),
    });
  }
  buildCosts.sort((a, b) => b.quantity - a.quantity);

  // Also check if electricity is consumed as a recipe input (e.g. data_center -> basic_rack)
  const extraElecDemand = rawDemands.get('electricity') ?? 0;
  electricityConsumedKw += extraElecDemand;

  return {
    steps: solvedSteps,
    edges: solvedEdges,
    summary: {
      totalWorkers,
      electricityConsumedKw,
      electricityGeneratedKw,
      netElectricityKw: electricityGeneratedKw - electricityConsumedKw,
      maintenance: maintenanceTotals,
      computingTFlops,
      unityConsumed,
      totalMachinesExact,
      totalMachinesCeil,
      buildCosts,
      rawInputs,
      netOutputs,
    },
    targetDiagnostics,
    cyclesDetected,
  };
}

export function isNaturalRawProduct(productId: string): boolean {
  return NATURAL_RAW_PRODUCT_IDS.has(productId) || VIRTUAL_PRODUCT_IDS.has(productId);
}

export function getProductInfo(productId: string): Product | undefined {
  return PRODUCTS[productId];
}
