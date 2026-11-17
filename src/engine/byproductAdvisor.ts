import {
  MACHINES,
  PRODUCTS,
  RECIPES,
  VIRTUAL_PRODUCT_IDS,
  getMachineLabel,
  getProductLabel,
  getProductLogisticsKind,
  getRecipeLabel,
} from '../data';
import type { Machine, Recipe, SolveResult } from '../types/coi';

export type ByproductVerdict =
  | 'store_mandatory'
  | 'burn'
  | 'vent'
  | 'dump'
  | 'store_buffer';

export interface DisposalPlan {
  machineId: string;
  machineGameId: string;
  machineName: string;
  machineIcon: string;
  recipeId: string;
  recipeName: string;
  perMachineRate60: number;
  exactMachines: number;
  ceilMachines: number;
  pollutionProductId?: string;
  pollutionRate60: number;
}

export interface StoragePlan {
  machineId: string;
  machineGameId: string;
  machineName: string;
  machineIcon: string;
  capacityPerUnit: number;
  minutesToFillOne: number;
  unitsFor30MinBuffer: number;
}

export interface RecycleOption {
  recipeId: string;
  recipeName: string;
  machineName: string;
  primaryOutputId: string;
  primaryOutputName: string;
  outputRateIfConsumedAll60: number;
}

export interface ByproductAdvice {
  productId: string;
  name: string;
  icon: string;
  ratePer60: number;
  isTarget: boolean;
  isSurplus: boolean;
  isPollution: boolean;
  verdict: ByproductVerdict;
  verdictTitle: string;
  verdictReason: string;
  disposal: DisposalPlan | null;
  storage: StoragePlan | null;
  recycleOptions: RecycleOption[];
}

const RADIOACTIVE_IDS = new Set([
  'spent_fuel',
  'spent_mox',
  'fission_product',
  'depleted_uranium',
  'yellowcake',
  'plutonium',
  'blanket_fuel',
  'blanket_fuel_enriched',
  'uranium_rod',
  'mox_rod',
]);

const BURNABLE_DISPOSAL_MACHINES = new Set([
  'flare',
  'burner_solid',
  'incineration_plant',
]);
const VENT_DISPOSAL_MACHINES = new Set(['smoke_stack', 'smoke_stack_large']);
const DUMP_DISPOSAL_MACHINES = new Set(['liquid_dump']);

const PRIORITY_RECYCLE_MACHINES = new Set([
  'exhaust_scrubber',
  'sour_water_stripper',
  'wastewater_treatment',
  'cooling_tower',
  'cooling_tower_large',
  'cracking_unit',
  'chemical_plant',
  'chemical_plant_ii',
  'crusher',
  'crusher_large',
  'anaerobic_digester',
  'compactor',
]);

function pickDisposalRecipe(productId: string): {
  machine: Machine;
  recipe: Recipe;
  kind: 'burn' | 'vent' | 'dump';
} | null {
  const prod = PRODUCTS[productId];
  if (!prod) return null;

  const candidates: {
    machine: Machine;
    recipe: Recipe;
    kind: 'burn' | 'vent' | 'dump';
    score: number;
  }[] = [];

  for (const rid of prod.recipes.input) {
    const r = RECIPES[rid];
    if (!r || r.duration <= 0) continue;
    const m = MACHINES[r.machine];
    if (!m) continue;

    // Only match recipes where this product is the primary disposed input (not auxiliary coolant water/fuel)
    if (r.inputs[0]?.id !== productId) continue;

    if (BURNABLE_DISPOSAL_MACHINES.has(m.id)) {
      candidates.push({
        machine: m,
        recipe: r,
        kind: 'burn',
        score: m.id === 'flare' ? 100 : m.id === 'burner_solid' ? 90 : 80,
      });
    } else if (VENT_DISPOSAL_MACHINES.has(m.id)) {
      candidates.push({
        machine: m,
        recipe: r,
        kind: 'vent',
        score: m.id === 'smoke_stack_large' ? 75 : 70,
      });
    } else if (DUMP_DISPOSAL_MACHINES.has(m.id)) {
      candidates.push({
        machine: m,
        recipe: r,
        kind: 'dump',
        score: 60,
      });
    }
  }

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function pickStoragePlan(productId: string, ratePer60: number): StoragePlan | null {
  if (VIRTUAL_PRODUCT_IDS.has(productId)) return null;

  let machineId = 'unit_storage_iii';
  if (RADIOACTIVE_IDS.has(productId)) {
    machineId = 'radioactive_waste_storage';
  } else {
    const kind = getProductLogisticsKind(productId);
    if (kind === 'fluid') machineId = 'fluid_storage_iii';
    else if (kind === 'loose') machineId = 'loose_storage_iii';
    else if (kind === 'molten') return null; // Molten cannot be stored in standard storage
    else machineId = 'unit_storage_iii';
  }

  const m = MACHINES[machineId];
  if (!m || m.storage_capacity <= 0) return null;

  const cap = m.storage_capacity;
  const minutesToFillOne = ratePer60 > 0 ? cap / ratePer60 : Infinity;
  const needed30m = ratePer60 * 30;
  const unitsFor30MinBuffer = Math.max(1, Math.ceil(needed30m / cap));

  return {
    machineId: m.id,
    machineGameId: m.game_id ?? m.id,
    machineName: getMachineLabel(m.id).ru,
    machineIcon: m.icon,
    capacityPerUnit: cap,
    minutesToFillOne,
    unitsFor30MinBuffer,
  };
}

function findRecycleOptions(
  productId: string,
  availableRate60: number,
): RecycleOption[] {
  const prod = PRODUCTS[productId];
  if (!prod) return [];

  const options: RecycleOption[] = [];
  for (const rid of prod.recipes.input) {
    const r = RECIPES[rid];
    if (!r || r.duration <= 0) continue;
    const m = MACHINES[r.machine];
    if (!m || m.isStorage || m.isMine) continue;
    if (
      BURNABLE_DISPOSAL_MACHINES.has(m.id) ||
      VENT_DISPOSAL_MACHINES.has(m.id) ||
      DUMP_DISPOSAL_MACHINES.has(m.id)
    ) {
      continue;
    }

    const inp = r.inputs.find((i) => i.id === productId);
    const out = r.outputs.find(
      (o) => o.id !== productId && !VIRTUAL_PRODUCT_IDS.has(o.id) && o.quantity > 0,
    );
    if (!inp || inp.quantity <= 0 || !out) continue;
    if (!PRIORITY_RECYCLE_MACHINES.has(m.id) && r.inputs.length > 3) continue;

    const outRate = (availableRate60 * out.quantity) / inp.quantity;
    const outLbl = getProductLabel(out.id);

    options.push({
      recipeId: r.id,
      recipeName: getRecipeLabel(r.id).ru,
      machineName: getMachineLabel(m.id).ru,
      primaryOutputId: out.id,
      primaryOutputName: outLbl.ru ?? outLbl.en,
      outputRateIfConsumedAll60: outRate,
    });
  }

  return options.slice(0, 4);
}

export function analyzeByproductsAndStorage(
  solveResult: SolveResult,
): ByproductAdvice[] {
  const result: ByproductAdvice[] = [];

  for (const out of solveResult.summary.netOutputs) {
    if (out.ratePer60 <= 0.01) continue;
    // Skip virtual air_pollution/water_pollution metrics (they aren't items to store/burn)
    if (VIRTUAL_PRODUCT_IDS.has(out.productId)) continue;

    const lbl = getProductLabel(out.productId);
    const dispMatch = out.isTarget ? null : pickDisposalRecipe(out.productId);
    const storage = pickStoragePlan(out.productId, out.ratePer60);
    const recycleOptions = out.isTarget
      ? []
      : findRecycleOptions(out.productId, out.ratePer60);

    let disposal: DisposalPlan | null = null;
    if (dispMatch) {
      const inp = dispMatch.recipe.inputs.find((i) => i.id === out.productId);
      const perMach60 = inp
        ? (inp.quantity * 60) / dispMatch.recipe.duration
        : 60;
      const exactM = perMach60 > 0 ? out.ratePer60 / perMach60 : 1;
      const pollOut = dispMatch.recipe.outputs.find(
        (o) => o.id === 'air_pollution' || o.id === 'water_pollution',
      );
      const pollRate60 = pollOut
        ? ((pollOut.quantity * 60) / dispMatch.recipe.duration) * exactM
        : 0;

      disposal = {
        machineId: dispMatch.machine.id,
        machineGameId: dispMatch.machine.game_id ?? dispMatch.machine.id,
        machineName: getMachineLabel(dispMatch.machine.id).ru,
        machineIcon: dispMatch.machine.icon,
        recipeId: dispMatch.recipe.id,
        recipeName: getRecipeLabel(dispMatch.recipe.id).ru,
        perMachineRate60: perMach60,
        exactMachines: exactM,
        ceilMachines: Math.max(1, Math.ceil(exactM - 1e-9)),
        pollutionProductId: pollOut?.id,
        pollutionRate60: pollRate60,
      };
    }

    let verdict: ByproductVerdict = 'store_buffer';
    let verdictTitle = 'Хранить на складе (Буфер)';
    let verdictReason =
      'Целевой или полезный продукт: поставьте склад-буфер с отгрузкой.';

    if (RADIOACTIVE_IDS.has(out.productId)) {
      verdict = 'store_mandatory';
      verdictTitle = 'Хранить строго (Нельзя сжигать)';
      verdictReason =
        'Радиоактивный ресурс: сжигать или сливать нельзя, необходимо спецхранилище.';
    } else if (!out.isTarget && dispMatch) {
      if (dispMatch.kind === 'burn') {
        verdict = 'burn';
        verdictTitle = 'Сжигать излишек (Факел / Печь)';
        verdictReason =
          'Если склад переполнится, встанет вся линия. Сжигайте лишний поток в факеле или используйте в котлах/энергетике.';
      } else if (dispMatch.kind === 'vent') {
        verdict = 'vent';
        verdictTitle = 'Сбрасывать в трубу / Конденсировать';
        verdictReason =
          'Газообразный или паровой отход: отведите в дымовую трубу, скруббер (за серой) или градирню.';
      } else {
        verdict = 'dump';
        verdictTitle = 'Слив / Очистка (Не копить)';
        verdictReason =
          'Жидкий отход: сбрасывайте через жидкостный слив или перерабатывайте на водоочистке.';
      }
    } else if (!out.isTarget && out.isSurplus) {
      verdict = 'store_buffer';
      verdictTitle = 'Хранить излишек / Отвал';
      verdictReason =
        'Твёрдый попутный продукт (шлак/компост/излишек): складируйте, дробите или вывозите на отсыпку.';
    }

    result.push({
      productId: out.productId,
      name: lbl.ru ?? lbl.en,
      icon: out.icon,
      ratePer60: out.ratePer60,
      isTarget: out.isTarget,
      isSurplus: out.isSurplus,
      isPollution: out.isPollution,
      verdict,
      verdictTitle,
      verdictReason,
      disposal,
      storage,
      recycleOptions,
    });
  }

  // Put action-required items (burn / vent / dump / mandatory store) before target buffers
  const order: Record<ByproductVerdict, number> = {
    store_mandatory: 0,
    burn: 1,
    dump: 2,
    vent: 3,
    store_buffer: 4,
  };
  result.sort((a, b) => order[a.verdict] - order[b.verdict] || b.ratePer60 - a.ratePer60);

  return result;
}
