import rawProducts from './raw/products.json';
import rawRecipes from './raw/recipes.json';
import rawMachines from './raw/machines.json';
import rawCategories from './raw/categories.json';
import rawContracts from './raw/contracts.json';
import rawTransports from './raw/transports.json';
import rawRecipeGameIds from './raw/recipe_game_ids.json';
import type {
  Category,
  Contract,
  LogisticsSummary,
  Machine,
  Product,
  RawContract,
  Recipe,
  TransportRaw,
  TransportTier,
} from '../types/coi';
import {
  getCategoryRu,
  getMachineDescRu,
  getMachineRu,
  getProductRu,
  getRecipeRu,
} from './ruDict';

export const PRODUCTS = rawProducts as Record<string, Product>;
export const RECIPES = rawRecipes as Record<string, Recipe>;
export const MACHINES = rawMachines as Record<string, Machine>;
export const CATEGORIES = rawCategories as Record<string, Category>;

const recipeGameIdsPayload = rawRecipeGameIds as {
  recipeToGameId: Record<string, string>;
  gameIdToRecipe: Record<string, string>;
  productToGameId: Record<string, string>;
  gameIdToProduct: Record<string, string>;
};
export const RECIPE_GAME_IDS: Record<string, string> =
  recipeGameIdsPayload.recipeToGameId;
export const GAME_ID_TO_RECIPE_ID: Record<string, string> =
  recipeGameIdsPayload.gameIdToRecipe;
export const PRODUCT_GAME_IDS: Record<string, string> =
  recipeGameIdsPayload.productToGameId;
export const GAME_ID_TO_PRODUCT_ID: Record<string, string> =
  recipeGameIdsPayload.gameIdToProduct;

export const MACHINE_BY_GAME_ID: Record<string, Machine> = {};
for (const m of Object.values(MACHINES)) {
  if (m.game_id && (!MACHINE_BY_GAME_ID[m.game_id] || !m.isMine)) {
    MACHINE_BY_GAME_ID[m.game_id] = m;
  }
}

export const PRODUCTS_LIST: Product[] = Object.values(PRODUCTS).sort((a, b) =>
  (getProductRu(a.id) ?? a.name).localeCompare(getProductRu(b.id) ?? b.name, 'ru'),
);
export const MACHINES_LIST: Machine[] = Object.values(MACHINES).sort((a, b) =>
  (getMachineRu(a.id) ?? a.name).localeCompare(getMachineRu(b.id) ?? b.name, 'ru'),
);
export const RECIPES_LIST: Recipe[] = Object.values(RECIPES).sort((a, b) =>
  (getRecipeRu(a.id) ?? a.name).localeCompare(getRecipeRu(b.id) ?? b.name, 'ru'),
);
export const CATEGORIES_LIST: Category[] = Object.values(CATEGORIES).sort((a, b) =>
  getCategoryRu(a.id, a.name).localeCompare(getCategoryRu(b.id, b.name), 'ru'),
);

const productsByLowerName = new Map<string, string>();
for (const p of PRODUCTS_LIST) {
  productsByLowerName.set(p.name.toLowerCase(), p.id);
}

export const CONTRACTS: Contract[] = (
  (rawContracts as { contracts: RawContract[] }).contracts ?? []
).map((c) => ({
  ...c,
  buyProductId: productsByLowerName.get(c.product_to_buy_name.toLowerCase()) ?? null,
  payProductId: productsByLowerName.get(c.product_to_pay_with_name.toLowerCase()) ?? null,
}));

export const CONTRACTS_BY_ID: Record<string, Contract> = Object.fromEntries(
  CONTRACTS.map((c) => [c.id, c]),
);

export const CONTRACTS_FOR_PRODUCT: Record<string, Contract[]> = {};
for (const c of CONTRACTS) {
  if (c.buyProductId) {
    if (!CONTRACTS_FOR_PRODUCT[c.buyProductId]) {
      CONTRACTS_FOR_PRODUCT[c.buyProductId] = [];
    }
    CONTRACTS_FOR_PRODUCT[c.buyProductId].push(c);
  }
}

export const TRANSPORTS_RAW: TransportRaw[] =
  (rawTransports as { transports: TransportRaw[] }).transports ?? [];

export const TRANSPORT_TIERS: TransportTier[] = [
  {
    id: 'FlatConveyorT1',
    name: 'Flat conveyor I',
    ruName: 'Плоский конвейер I',
    kind: 'flat',
    throughputPer60: 60,
    throughputPerSec: 1,
    electricityKw: 20,
    icon: '/assets/transport/FlatConveyorT1.png',
  },
  {
    id: 'FlatConveyorT2',
    name: 'Flat conveyor II',
    ruName: 'Плоский конвейер II',
    kind: 'flat',
    throughputPer60: 200,
    throughputPerSec: 3.33,
    electricityKw: 40,
    icon: '/assets/transport/FlatConveyorT2.png',
  },
  {
    id: 'FlatConveyorT3',
    name: 'Flat conveyor III',
    ruName: 'Плоский конвейер III',
    kind: 'flat',
    throughputPer60: 450,
    throughputPerSec: 7.5,
    electricityKw: 80,
    icon: '/assets/transport/FlatConveyorT3.png',
  },
  {
    id: 'LooseMaterialConveyor',
    name: 'U-shape conveyor I',
    ruName: 'U-конвейер I (сыпучие)',
    kind: 'loose',
    throughputPer60: 60,
    throughputPerSec: 1,
    electricityKw: 20,
    icon: '/assets/transport/LooseMaterialConveyor.png',
  },
  {
    id: 'LooseMaterialConveyorT2',
    name: 'U-shape conveyor II',
    ruName: 'U-конвейер II (сыпучие)',
    kind: 'loose',
    throughputPer60: 200,
    throughputPerSec: 3.33,
    electricityKw: 40,
    icon: '/assets/transport/LooseMaterialConveyorT2.png',
  },
  {
    id: 'LooseMaterialConveyorT3',
    name: 'U-shape conveyor III',
    ruName: 'U-конвейер III (сыпучие)',
    kind: 'loose',
    throughputPer60: 450,
    throughputPerSec: 7.5,
    electricityKw: 80,
    icon: '/assets/transport/LooseMaterialConveyorT3.png',
  },
  {
    id: 'PipeT1',
    name: 'Pipe I',
    ruName: 'Труба I',
    kind: 'fluid',
    throughputPer60: 60,
    throughputPerSec: 1,
    electricityKw: 0,
    icon: '/assets/transport/PipeT1.png',
  },
  {
    id: 'PipeT2',
    name: 'Pipe II',
    ruName: 'Труба II',
    kind: 'fluid',
    throughputPer60: 200,
    throughputPerSec: 3.33,
    electricityKw: 0,
    icon: '/assets/transport/PipeT2.png',
  },
  {
    id: 'PipeT3',
    name: 'Pipe III',
    ruName: 'Труба III',
    kind: 'fluid',
    throughputPer60: 450,
    throughputPerSec: 7.5,
    electricityKw: 0,
    icon: '/assets/transport/PipeT3.png',
  },
  {
    id: 'PipeT4',
    name: 'Pipe IV',
    ruName: 'Труба IV',
    kind: 'fluid',
    throughputPer60: 900,
    throughputPerSec: 15,
    electricityKw: 0,
    icon: '/assets/transport/PipeT4.png',
  },
  {
    id: 'MoltenMetalChannel',
    name: 'Molten channel',
    ruName: 'Желоб расплава',
    kind: 'molten',
    throughputPer60: 120,
    throughputPerSec: 2,
    electricityKw: 0,
    icon: '/assets/transport/MoltenMetalChannel.png',
  },
];

export const VIRTUAL_PRODUCT_IDS = new Set([
  'electricity',
  'mechanical_power',
  'computing',
  'heat',
  'air_pollution',
  'water_pollution',
]);

export const POLLUTION_PRODUCT_IDS = new Set([
  'air_pollution',
  'water_pollution',
  'exhaust',
  'carbon_dioxide',
  'toxic_slurry',
  'red_mud',
  'waste_water',
  'sludge',
  'slag',
]);

// Natural raw / mined / environmental resources
export const NATURAL_RAW_PRODUCT_IDS = new Set([
  'iron_ore',
  'copper_ore',
  'coal',
  'limestone',
  'sand',
  'quartz',
  'bauxite',
  'gold_ore',
  'uranium_ore',
  'titanium_ore',
  'rock',
  'gravel',
  'dirt',
  'wood',
  'salt',
  'raw_minerals',
]);

export function getProductIconUrl(icon?: string): string {
  return icon ? `/assets/products/${icon}` : '/assets/products/Iron.png';
}

export function getMachineIconUrl(icon?: string): string {
  return icon ? `/assets/buildings/${icon}` : '/assets/buildings/AssemblyManual.png';
}

export function getProductLabel(id: string): { en: string; ru?: string } {
  const p = PRODUCTS[id];
  const en = p?.name ?? id;
  const ru = getProductRu(id);
  return { en, ru };
}

export function getMachineLabel(id: string): {
  en: string;
  ru: string;
  descRu?: string;
} {
  const m = MACHINES[id];
  const en = m?.name ?? id;
  const ru = getMachineRu(id) ?? en;
  const descRu = getMachineDescRu(id);
  return { en, ru, descRu };
}

export function getRecipeLabel(id: string): { en: string; ru: string } {
  const r = RECIPES[id];
  const en = r?.name ?? id;
  const ru = getRecipeRu(id) ?? en;
  return { en, ru };
}

export function getCategoryLabel(id: string): string {
  const c = CATEGORIES[id];
  return getCategoryRu(id, c?.name ?? id);
}

export function getTransportIconForKind(
  kind: LogisticsSummary['kind'],
  ratePer60 = 60,
): string {
  switch (kind) {
    case 'molten':
      return '/assets/transport/MoltenMetalChannel.png';
    case 'fluid':
      if (ratePer60 > 450) return '/assets/transport/PipeT4.png';
      if (ratePer60 > 200) return '/assets/transport/PipeT3.png';
      if (ratePer60 > 60) return '/assets/transport/PipeT2.png';
      return '/assets/transport/PipeT1.png';
    case 'loose':
      if (ratePer60 > 200) return '/assets/transport/LooseMaterialConveyorT3.png';
      if (ratePer60 > 60) return '/assets/transport/LooseMaterialConveyorT2.png';
      return '/assets/transport/LooseMaterialConveyor.png';
    case 'flat':
    default:
      if (ratePer60 > 200) return '/assets/transport/FlatConveyorT3.png';
      if (ratePer60 > 60) return '/assets/transport/FlatConveyorT2.png';
      return '/assets/transport/FlatConveyorT1.png';
  }
}

export function getProductLogisticsKind(
  productId: string,
): LogisticsSummary['kind'] {
  if (VIRTUAL_PRODUCT_IDS.has(productId)) return 'virtual';
  if (productId.startsWith('molten_')) return 'molten';
  const p = PRODUCTS[productId];
  if (!p) return 'flat';
  const storages = p.machines.input;
  if (storages.some((m) => m.startsWith('fluid_storage'))) return 'fluid';
  if (storages.some((m) => m.startsWith('loose_storage'))) return 'loose';
  if (storages.some((m) => m.startsWith('unit_storage'))) return 'flat';
  return 'virtual';
}

export function computeLogistics(
  productId: string,
  ratePer60: number,
): LogisticsSummary | null {
  const kind = getProductLogisticsKind(productId);
  if (kind === 'virtual' || ratePer60 <= 0) return null;

  if (kind === 'molten') {
    const t1 = ratePer60 / 120;
    return {
      kind,
      tier1Count: t1,
      tier2Count: t1,
      tier3Count: t1,
      recommendedLabel: `${t1 < 10 ? t1.toFixed(1) : Math.ceil(t1)}× Желоб`,
    };
  }

  const tier1Count = ratePer60 / 60;
  const tier2Count = ratePer60 / 200;
  const tier3Count = ratePer60 / 450;
  const tier4Count = kind === 'fluid' ? ratePer60 / 900 : undefined;

  const prefix = kind === 'fluid' ? 'Тр.' : kind === 'loose' ? 'U-лента' : 'Лента';

  let recommendedLabel = '';
  if (tier1Count <= 1.01) {
    recommendedLabel = `${tier1Count.toFixed(2).replace(/\.?0+$/, '')}× ${prefix} I`;
  } else if (tier2Count <= 1.01) {
    recommendedLabel = `${tier2Count.toFixed(2).replace(/\.?0+$/, '')}× ${prefix} II`;
  } else if (tier3Count <= 1.01 || kind !== 'fluid') {
    recommendedLabel = `${tier3Count.toFixed(2).replace(/\.?0+$/, '')}× ${prefix} III`;
  } else {
    recommendedLabel = `${(tier4Count ?? tier3Count).toFixed(2).replace(/\.?0+$/, '')}× Тр. IV`;
  }

  return {
    kind,
    tier1Count,
    tier2Count,
    tier3Count,
    tier4Count,
    recommendedLabel,
  };
}

export function matchesProductQuery(p: Product, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) {
    return true;
  }
  const ru = getProductRu(p.id);
  if (ru && ru.toLowerCase().includes(q)) return true;
  return false;
}

export function matchesMachineQuery(m: Machine, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (
    m.name.toLowerCase().includes(q) ||
    m.id.toLowerCase().includes(q) ||
    m.category_name.toLowerCase().includes(q)
  ) {
    return true;
  }
  const ru = getMachineRu(m.id);
  if (ru && ru.toLowerCase().includes(q)) return true;
  const catRu = getCategoryLabel(m.category_id);
  if (catRu.toLowerCase().includes(q)) return true;
  return false;
}

export function matchesRecipeQuery(r: Recipe, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const rRu = getRecipeRu(r.id);
  const mRu = getMachineRu(r.machine);
  if (
    r.name.toLowerCase().includes(q) ||
    r.id.toLowerCase().includes(q) ||
    (rRu && rRu.toLowerCase().includes(q)) ||
    r.machine.toLowerCase().includes(q) ||
    (mRu && mRu.toLowerCase().includes(q))
  ) {
    return true;
  }
  return (
    r.inputs.some((i) => {
      const pRu = getProductRu(i.id);
      return i.name.toLowerCase().includes(q) || (pRu && pRu.toLowerCase().includes(q));
    }) ||
    r.outputs.some((o) => {
      const pRu = getProductRu(o.id);
      return o.name.toLowerCase().includes(q) || (pRu && pRu.toLowerCase().includes(q));
    })
  );
}

export interface DownstreamExtension {
  recipe: Recipe;
  machine: Machine;
  primaryOutputId: string;
  inputPerCycle: number;
  outputPerCycle: number;
}

export function getDownstreamExtensions(productId: string): DownstreamExtension[] {
  const p = PRODUCTS[productId];
  if (!p) return [];
  const results: DownstreamExtension[] = [];
  for (const rid of p.recipes.input) {
    const r = RECIPES[rid];
    if (!r || r.duration <= 0) continue;
    const m = MACHINES[r.machine];
    if (!m || m.isStorage) continue;
    const primaryOut = r.outputs.find((o) => o.id !== productId && o.quantity > 0);
    if (!primaryOut) continue;
    const inp = r.inputs.find((i) => i.id === productId);
    if (!inp || inp.quantity <= 0) continue;
    results.push({
      recipe: r,
      machine: m,
      primaryOutputId: primaryOut.id,
      inputPerCycle: inp.quantity,
      outputPerCycle: primaryOut.quantity,
    });
  }
  return results;
}
