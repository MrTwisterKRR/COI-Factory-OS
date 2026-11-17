import {
  GAME_ID_TO_PRODUCT_ID,
  GAME_ID_TO_RECIPE_ID,
  MACHINES,
  MACHINE_BY_GAME_ID,
  NATURAL_RAW_PRODUCT_IDS,
  PRODUCT_GAME_IDS,
  PRODUCTS,
  RECIPES,
  RECIPE_GAME_IDS,
  VIRTUAL_PRODUCT_IDS,
  getMachineLabel,
  getProductLabel,
  getRecipeLabel,
} from '../data';
import type { Machine, TechStageMode, UnlockedGameFilter } from '../types/coi';

export interface TechStageOption {
  id: TechStageMode;
  shortLabel: string;
  label: string;
  description: string;
  badgeColor: 'violet' | 'emerald' | 'amber' | 'sky' | 'zinc';
}

export const TECH_STAGE_OPTIONS: TechStageOption[] = [
  {
    id: 'game_sync',
    shortLabel: '⚡ Из игры',
    label: '⚡ Из игры (Синхр. с базой)',
    description: 'Живая синхронизация открытых технологий и построенных цехов с активным сохранением',
    badgeColor: 'violet',
  },
  {
    id: 'stage_1',
    shortLabel: 'Этап I · Старт',
    label: 'Этап I · Старт (Стройдетали I)',
    description: 'Доменные печи I, литейные I, дистилляторы, очистка меди водой, сборочные I',
    badgeColor: 'amber',
  },
  {
    id: 'stage_2',
    shortLabel: 'Этап II · Сталь',
    label: 'Этап II · Сталь и Нефть (Стройдетали II)',
    description: 'Кислородные печи, сталь, колонны нефти I–II, бетоносмесители I, сборочные II',
    badgeColor: 'sky',
  },
  {
    id: 'stage_3',
    shortLabel: 'Этап III · Химия',
    label: 'Этап III · Химия и Автоматика (Стройдетали III)',
    description: 'Электролиз меди кислотой, химзаводы, колонна III, дуговые I, сборочные III',
    badgeColor: 'emerald',
  },
  {
    id: 'stage_4',
    shortLabel: 'Этап IV · Микрочипы',
    label: 'Этап IV · Роботы и Микрочипы (Стройдетали IV)',
    description: 'Дуговые II, роботизированные сборочные IV–V, кремний, микрочипы, АЭС',
    badgeColor: 'violet',
  },
  {
    id: 'all',
    shortLabel: 'Все технологии',
    label: 'Этап V · Все технологии (Без ограничений)',
    description: 'Все здания и рецепты доступны без фильтров',
    badgeColor: 'zinc',
  },
];

export const DEFAULT_GAME_API_URL = 'http://127.0.0.1:3073';

export type GameConnectionMode = 'live' | 'demo' | 'offline';
export type SourcesPeriod =
  | 'thisMonth'
  | 'lastMonth'
  | 'thisYear'
  | 'lastYear'
  | 'lifetime';

export interface GameInfoResponse {
  date: string;
  tick: number;
  isPaused: boolean;
  speed: number;
  gameId: string;
  sessionId: string;
}

export interface ServerInfoResponse {
  date: string;
  tick: number;
  port: number;
  otherOrigins: 'none' | 'get' | 'getAndPost' | string;
}

export interface CatalogProduct {
  id: string;
  name: string;
  kind: 'countable' | 'loose' | 'fluid' | 'molten' | 'virtual' | string;
  isUnlocked: boolean;
}

export interface ProductCatalogResponse {
  date: string;
  tick: number;
  products: CatalogProduct[];
  unknownIds?: string[];
}

export interface ProductStatEntry {
  quantity: number;
  stored: number;
  storageCapacity: number;
  // [thisMonth, lastMonth, thisYear, lastYear, lifetime]
  produced: number[];
  consumed: number[];
}

export interface ProductStatsResponse {
  date: string;
  tick: number;
  products: Record<string, ProductStatEntry>;
}

export interface SourceRow {
  type: string;
  quantity: number;
  recipe?: string | null;
  machine?: string | null;
  entity?: string | null;
}

export interface SourcesSide {
  total: number;
  rows: SourceRow[];
}

export interface ProductSourcesEntry {
  produced: SourcesSide;
  consumed: SourcesSide;
}

export interface ProductSourcesResponse {
  date: string;
  tick: number;
  period: SourcesPeriod | string;
  products: Record<string, ProductSourcesEntry>;
  names: Record<string, string>;
}

export interface ProductHistoryEntry {
  produced?: number[];
  consumed?: number[];
  quantity?: number[];
  stored?: number[];
}

export interface ProductHistoryResponse {
  date: string;
  tick: number;
  resolution: 'day' | 'month' | 'year' | 'quarterCentury';
  start: string;
  products: Record<string, ProductHistoryEntry>;
}

export interface GameCapabilities {
  unlockedProductIds: Set<string>;
  unlockedGameProductIds: Set<string>;
  unlockedMachineIds: Set<string>;
  unlockedRecipeIds: Set<string>;
  builtMachineIds: Set<string>;
  activeRecipeIds: Set<string>;
  machineMonthlyActivity: Record<
    string,
    {
      recipes: { recipeId: string; producedPer60: number; productId: string }[];
    }
  >;
  unlockedProductsCount: number;
  totalProductsCount: number;
  unlockedMachinesCount: number;
  builtMachinesCount: number;
  toSolverFilter: (enabled: boolean) => UnlockedGameFilter;
}

export interface GameLiveBundle {
  gameInfo: GameInfoResponse;
  serverInfo: ServerInfoResponse;
  catalog: CatalogProduct[];
  pinnedIds: Set<string>;
  stats: Record<string, ProductStatEntry>;
  sources: ProductSourcesResponse;
  latencyMs: number;
}

function normalizeBaseUrl(rawUrl: string): string {
  return (rawUrl || DEFAULT_GAME_API_URL).trim().replace(/\/+$/, '');
}

function resolveRequestUrl(baseUrl: string, apiPath: string): string {
  const norm = normalizeBaseUrl(baseUrl);
  const isDefaultLocal =
    norm === 'http://127.0.0.1:3073' || norm === 'http://localhost:3073';
  if (
    isDefaultLocal &&
    typeof window !== 'undefined' &&
    window.location.port === '5173'
  ) {
    return `/coi-live-api${apiPath}`;
  }
  return `${norm}${apiPath}`;
}

export async function apiFetchJson<T>(
  baseUrl: string,
  apiPath: string,
  options?: { method?: string; body?: unknown; timeoutMs?: number },
): Promise<{ data: T; latencyMs: number }> {
  const t0 = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options?.timeoutMs ?? 3500,
  );
  try {
    const url = resolveRequestUrl(baseUrl, apiPath);
    const res = await fetch(url, {
      method: options?.method ?? 'GET',
      signal: controller.signal,
      headers:
        options?.body !== undefined
          ? { 'Content-Type': 'application/json' }
          : undefined,
      body:
        options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      const txt = await res.text().catch(() => String(res.status));
      throw new Error(`HTTP ${res.status}: ${txt.slice(0, 160)}`);
    }
    if (!ct.includes('application/json')) {
      throw new Error('Ответ сервера не является JSON (возможно, игра не запущена)');
    }
    const data = (await res.json()) as T & { __coiOffline?: boolean; message?: string };
    if (data && typeof data === 'object' && data.__coiOffline) {
      throw new Error(
        `Локальный сервер игры не отвечает на ${normalizeBaseUrl(baseUrl)} (${data.message || 'оффлайн'})`,
      );
    }
    return { data, latencyMs: Math.round(performance.now() - t0) };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchLiveGameBundle(
  baseUrl: string,
  period: SourcesPeriod,
): Promise<GameLiveBundle> {
  const t0 = performance.now();
  // First check game-info quickly to verify server is up
  const { data: gameInfo } = await apiFetchJson<GameInfoResponse>(
    baseUrl,
    '/api/v1/game-info',
    { timeoutMs: 2500 },
  );

  const [serverRes, catalogRes, pinnedRes, statsRes, sourcesRes] =
    await Promise.all([
      apiFetchJson<ServerInfoResponse>(baseUrl, '/api/v1/server-info'),
      apiFetchJson<ProductCatalogResponse>(
        baseUrl,
        '/api/v1/products?includeLocked=true',
      ),
      apiFetchJson<ProductCatalogResponse>(baseUrl, '/api/v1/products?pinned=true'),
      apiFetchJson<ProductStatsResponse>(baseUrl, '/api/v1/products/stats'),
      apiFetchJson<ProductSourcesResponse>(
        baseUrl,
        `/api/v1/products/sources?period=${encodeURIComponent(period)}`,
      ),
    ]);

  return {
    gameInfo,
    serverInfo: serverRes.data,
    catalog: catalogRes.data.products ?? [],
    pinnedIds: new Set((pinnedRes.data.products ?? []).map((p) => p.id)),
    stats: statsRes.data.products ?? {},
    sources: sourcesRes.data,
    latencyMs: Math.round(performance.now() - t0),
  };
}

export async function fetchProductHistory(
  baseUrl: string,
  gameProductId: string,
  resolution: 'day' | 'month' | 'year' | 'quarterCentury',
  count = 24,
  demoBundle?: GameLiveBundle | null,
): Promise<ProductHistoryResponse> {
  if (demoBundle) {
    return buildDemoProductHistory(demoBundle, gameProductId, resolution, count);
  }
  const series =
    resolution === 'day' ? 'quantity,stored' : 'produced,consumed,quantity';
  const { data } = await apiFetchJson<ProductHistoryResponse>(
    baseUrl,
    `/api/v1/products/history?ids=${encodeURIComponent(gameProductId)}&resolution=${resolution}&series=${series}&count=${count}`,
  );
  return data;
}

export async function fetchScreenshotBlobUrl(
  baseUrl: string,
  width = 960,
  height = 540,
): Promise<{ url: string; sizeKb: number; ms: number }> {
  const t0 = performance.now();
  const url = resolveRequestUrl(
    baseUrl,
    `/screenshot?width=${width}&height=${height}&_ts=${Date.now()}`,
  );
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} при получении скриншота`);
  }
  const blob = await res.blob();
  return {
    url: URL.createObjectURL(blob),
    sizeKb: Math.round(blob.size / 1024),
    ms: Math.round(performance.now() - t0),
  };
}

export async function sendGameCommand(
  baseUrl: string,
  type: 'SetSimPauseStateCmd' | 'GameSpeedChangeCmd',
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data } = await apiFetchJson<unknown>(baseUrl, '/command', {
    method: 'POST',
    body: { type, args },
  });
  return data;
}

function cleanGameMachineId(raw: string): string {
  return raw.replace(/^Machine_/, '');
}

/**
 * Computes unlocked products, machines, and recipes from live (or demo) game telemetry
 * plus optional manual user overrides.
 */
export function computeUnlockedCapabilities(
  catalog: CatalogProduct[],
  sources: ProductSourcesResponse | null,
  manualUnlockedMachines: Set<string>,
  manualLockedMachines: Set<string>,
): GameCapabilities {
  const unlockedGameProductIds = new Set<string>();
  const unlockedProductIds = new Set<string>();
  const catalogMappedProductIds = new Set<string>();

  for (const item of catalog) {
    const pid = GAME_ID_TO_PRODUCT_ID[item.id];
    if (pid) {
      catalogMappedProductIds.add(pid);
    }
    if (item.isUnlocked) {
      unlockedGameProductIds.add(item.id);
      if (pid) {
        unlockedProductIds.add(pid);
      }
    }
  }

  const builtMachineIds = new Set<string>();
  const activeRecipeIds = new Set<string>();
  const machineMonthlyActivity: GameCapabilities['machineMonthlyActivity'] = {};

  if (sources?.products) {
    for (const [gameProdId, entry] of Object.entries(sources.products)) {
      const calcProdId = GAME_ID_TO_PRODUCT_ID[gameProdId] ?? gameProdId;
      for (const row of entry.produced?.rows ?? []) {
        if (row.machine) {
          const mObj = MACHINE_BY_GAME_ID[cleanGameMachineId(row.machine)];
          if (mObj) {
            builtMachineIds.add(mObj.id);
            if (row.recipe) {
              const rId = GAME_ID_TO_RECIPE_ID[row.recipe];
              if (rId) {
                activeRecipeIds.add(rId);
                if (!machineMonthlyActivity[mObj.id]) {
                  machineMonthlyActivity[mObj.id] = { recipes: [] };
                }
                if (
                  !machineMonthlyActivity[mObj.id].recipes.some(
                    (x) => x.recipeId === rId && x.productId === calcProdId,
                  )
                ) {
                  machineMonthlyActivity[mObj.id].recipes.push({
                    recipeId: rId,
                    producedPer60: row.quantity,
                    productId: calcProdId,
                  });
                }
              }
            }
          }
        }
      }
      for (const row of entry.consumed?.rows ?? []) {
        if (row.machine) {
          const mObj = MACHINE_BY_GAME_ID[cleanGameMachineId(row.machine)];
          if (mObj) {
            builtMachineIds.add(mObj.id);
            if (row.recipe) {
              const rId = GAME_ID_TO_RECIPE_ID[row.recipe];
              if (rId) activeRecipeIds.add(rId);
            }
          }
        }
      }
    }
  }

  const unlockedMachineIds = new Set<string>();
  const unlockedRecipeIds = new Set<string>();
  const hasCatalogData = unlockedProductIds.size > 0;

  // Step 1: evaluate machine-level unlockability via build_costs & built presence
  for (const m of Object.values(MACHINES)) {
    if (manualLockedMachines.has(m.id)) continue;
    if (manualUnlockedMachines.has(m.id) || builtMachineIds.has(m.id)) {
      unlockedMachineIds.add(m.id);
      continue;
    }
    if (!hasCatalogData) {
      unlockedMachineIds.add(m.id);
      continue;
    }
    const buildOk = (m.build_costs ?? []).every((bc) => {
      if (VIRTUAL_PRODUCT_IDS.has(bc.id)) return true;
      if (!catalogMappedProductIds.has(bc.id)) return true;
      return unlockedProductIds.has(bc.id);
    });
    const maintOk =
      !m.maintenance_cost_units ||
      !catalogMappedProductIds.has(m.maintenance_cost_units) ||
      unlockedProductIds.has(m.maintenance_cost_units);
    const compOk =
      m.computing_consumed <= 0 ||
      !catalogMappedProductIds.has('computing') ||
      unlockedProductIds.has('computing');

    if (buildOk && maintOk && compOk) {
      unlockedMachineIds.add(m.id);
    }
  }

  // Step 2: evaluate recipe-level unlockability
  for (const r of Object.values(RECIPES)) {
    if (manualLockedMachines.has(r.machine)) continue;
    if (manualUnlockedMachines.has(r.machine) || activeRecipeIds.has(r.id)) {
      unlockedRecipeIds.add(r.id);
      continue;
    }
    if (!hasCatalogData) {
      unlockedRecipeIds.add(r.id);
      continue;
    }
    if (!unlockedMachineIds.has(r.machine)) continue;

    const ioOk = [...r.inputs, ...r.outputs].every((io) => {
      if (VIRTUAL_PRODUCT_IDS.has(io.id)) return true;
      if (!catalogMappedProductIds.has(io.id)) return true;
      return unlockedProductIds.has(io.id);
    });

    if (ioOk) {
      unlockedRecipeIds.add(r.id);
    }
  }

  const productionMachines = Object.values(MACHINES).filter(
    (m) => !m.isStorage,
  );
  const unlockedMachinesCount = productionMachines.filter((m) =>
    unlockedMachineIds.has(m.id),
  ).length;

  return {
    unlockedProductIds,
    unlockedGameProductIds,
    unlockedMachineIds,
    unlockedRecipeIds,
    builtMachineIds,
    activeRecipeIds,
    machineMonthlyActivity,
    unlockedProductsCount: catalog.filter((c) => c.isUnlocked).length,
    totalProductsCount: catalog.length,
    unlockedMachinesCount,
    builtMachinesCount: builtMachineIds.size,
    toSolverFilter: (enabled: boolean): UnlockedGameFilter => ({
      enabled,
      stageMode: enabled ? 'game_sync' : 'all',
      stagePreferredRecipes: STAGE_PREFERRED_RECIPES.game_sync,
      unlockedRecipeIds,
      activeRecipeIds,
      unlockedProductIds,
      unlockedMachineIds,
      builtMachineIds,
    }),
  };
}

const STAGE_1_EXTRA_MACHINES = new Set(['groundwater_pump']);

export function getMachineProgressionTier(m: Machine): 1 | 2 | 3 | 4 | 5 {
  if (!m || m.isStorage || m.isMine) return 1;
  if (STAGE_1_EXTRA_MACHINES.has(m.id)) return 1;
  const bc = new Set((m.build_costs ?? []).map((x) => x.id));
  if (m.maintenance_cost_units === 'maintenance_iii' || m.computing_consumed > 3) {
    return 5;
  }
  if (
    bc.has('construction_parts_iv') ||
    m.maintenance_cost_units === 'maintenance_ii' ||
    m.computing_consumed > 0
  ) {
    return 4;
  }
  if (bc.has('construction_parts_iii')) return 3;
  if (bc.has('construction_parts_ii') || bc.has('steel')) return 2;
  return 1;
}

export const STAGE_PREFERRED_RECIPES: Record<TechStageMode, Record<string, string>> = {
  stage_1: {
    water: 'water_pumping',
    crude_oil: 'oil_pumping',
    molten_iron: 'iron_smelting',
    iron: 'iron_casting_2',
    molten_copper: 'copper_smelting',
    impure_copper: 'copper_casting_2',
    copper: 'copper_purification_water',
    diesel: 'diesel_distillation_basic',
    rubber: 'rubber_production_coal_alt',
    concrete_slab: 'simple_concrete_making',
    construction_parts: 'cp_assembly_t1',
    construction_parts_ii: 'cp2_assembly_t1_2',
    mechanical_parts: 'mech._parts_assembly_t1',
    electronics: 'electronics_assembly_t1',
    maintenance_i: 'maintenance_i',
    lab_equipment: 'lab_equipment_1_assembly_t1',
  },
  stage_2: {
    water: 'water_pumping',
    seawater: 'ocean_water_pumping',
    crude_oil: 'oil_pumping',
    oxygen: 'air_separation',
    nitrogen: 'air_separation',
    steam_high: 'steam_generation',
    molten_iron: 'iron_smelting',
    iron: 'iron_casting',
    molten_steel: 'steel_smelting_2',
    steel: 'steel_casting_cooled_2',
    molten_copper: 'copper_smelting',
    impure_copper: 'copper_casting',
    copper: 'copper_purification_water',
    medium_oil: 'crude_oil_refining',
    heavy_oil: 'crude_oil_refining',
    sour_water: 'crude_oil_refining',
    diesel: 'crude_oil_refining_2',
    light_oil: 'crude_oil_refining_2',
    rubber: 'rubber_production_coal_alt',
    cement: 'cement_production_3',
    concrete_slab: 'concrete_mixing_10',
    construction_parts: 'cp_assembly_t2',
    construction_parts_ii: 'cp2_assembly_t1',
    construction_parts_iii: 'cp3_assembly_t1',
    mechanical_parts: 'mech._parts_assembly_t2',
    electronics: 'electronics_assembly_t2',
    maintenance_i: 'maintenance_i',
    lab_equipment: 'lab_equipment_1_assembly_t2',
  },
  stage_3: {
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
    molten_iron: 'iron_smelting',
    iron: 'iron_casting',
    molten_steel: 'steel_smelting',
    steel: 'steel_casting_cooled',
    molten_copper: 'copper_smelting',
    impure_copper: 'copper_casting',
    copper: 'copper_purification_acid',
    cement: 'cement_production_3',
    concrete_slab: 'concrete_mixing_6',
    construction_parts: 'cp_assembly_t3',
    construction_parts_ii: 'cp2_assembly_t2',
    construction_parts_iii: 'cp3_assembly_t2',
    mechanical_parts: 'mech._parts_assembly_t3-2',
    electronics: 'electronics_assembly_t3',
    pcb: 'pcb_assembly_t2',
    rubber: 'rubber_production',
    plastic: 'plastic_making',
    graphite: 'graphite_production',
  },
  game_sync: {
    molten_iron: 'iron_smelting',
    iron: 'iron_casting',
    molten_steel: 'steel_smelting',
    steel: 'steel_casting_cooled',
    copper: 'copper_purification_acid',
    concrete_slab: 'concrete_mixing_6',
    construction_parts_ii: 'cp2_assembly_t2',
    construction_parts_iii: 'cp3_assembly_t2',
  },
  stage_4: {},
  all: {},
};

const STAGE_INITIAL_PRODUCTS = new Set<string>([
  ...NATURAL_RAW_PRODUCT_IDS,
  ...VIRTUAL_PRODUCT_IDS,
  'water',
  'seawater',
  'brine',
  'crude_oil',
  'iron_scrap',
  'copper_scrap',
  'slag',
  'slag_crushed',
  'waste',
  'recyclables',
]);

/**
 * Computes machine/recipe/product capabilities for either Live Game Sync ('game_sync'),
 * unrestricted mode ('all'), or progression stages ('stage_1'..'stage_4').
 */
export function computeCapabilitiesForStage(
  stageMode: TechStageMode,
  catalog: CatalogProduct[],
  sources: ProductSourcesResponse | null,
  manualUnlockedMachines: Set<string>,
  manualLockedMachines: Set<string>,
): GameCapabilities {
  const gameCaps = computeUnlockedCapabilities(
    catalog,
    sources,
    manualUnlockedMachines,
    manualLockedMachines,
  );

  if (stageMode === 'game_sync') {
    return {
      ...gameCaps,
      toSolverFilter: (enabled: boolean): UnlockedGameFilter => ({
        enabled,
        stageMode,
        stagePreferredRecipes: STAGE_PREFERRED_RECIPES.game_sync,
        unlockedRecipeIds: gameCaps.unlockedRecipeIds,
        activeRecipeIds: gameCaps.activeRecipeIds,
        unlockedProductIds: gameCaps.unlockedProductIds,
        unlockedMachineIds: gameCaps.unlockedMachineIds,
        builtMachineIds: gameCaps.builtMachineIds,
      }),
    };
  }

  if (stageMode === 'all') {
    const allMachines = new Set<string>();
    const allRecipes = new Set<string>();
    const allProducts = new Set<string>(Object.keys(PRODUCTS));
    for (const m of Object.values(MACHINES)) {
      if (!manualLockedMachines.has(m.id)) allMachines.add(m.id);
    }
    for (const r of Object.values(RECIPES)) {
      if (!manualLockedMachines.has(r.machine)) allRecipes.add(r.id);
    }
    const prodCount = Object.values(MACHINES).filter(
      (m) => !m.isStorage && allMachines.has(m.id),
    ).length;

    return {
      ...gameCaps,
      unlockedMachineIds: allMachines,
      unlockedRecipeIds: allRecipes,
      unlockedProductIds: allProducts,
      unlockedMachinesCount: prodCount,
      toSolverFilter: (): UnlockedGameFilter => ({
        enabled: false,
        stageMode: 'all',
        stagePreferredRecipes: {},
        unlockedRecipeIds: allRecipes,
        activeRecipeIds: gameCaps.activeRecipeIds,
        unlockedProductIds: allProducts,
        unlockedMachineIds: allMachines,
        builtMachineIds: gameCaps.builtMachineIds,
      }),
    };
  }

  const maxTier =
    stageMode === 'stage_1'
      ? 1
      : stageMode === 'stage_2'
        ? 2
        : stageMode === 'stage_3'
          ? 3
          : 5;

  const unlockedMachineIds = new Set<string>();
  for (const m of Object.values(MACHINES)) {
    if (manualLockedMachines.has(m.id)) continue;
    if (manualUnlockedMachines.has(m.id) || getMachineProgressionTier(m) <= maxTier) {
      unlockedMachineIds.add(m.id);
    }
  }

  // Iterative fixed-point reachability of products & recipes at this progression tier
  const unlockedProductIds = new Set<string>(STAGE_INITIAL_PRODUCTS);
  const unlockedRecipeIds = new Set<string>();

  for (let pass = 0; pass < 8; pass++) {
    let added = false;
    for (const r of Object.values(RECIPES)) {
      if (unlockedRecipeIds.has(r.id)) continue;
      if (!unlockedMachineIds.has(r.machine)) continue;
      const m = MACHINES[r.machine];
      if (!m || m.isStorage) continue;

      const inputsReady = r.inputs.every(
        (io) =>
          unlockedProductIds.has(io.id) ||
          NATURAL_RAW_PRODUCT_IDS.has(io.id) ||
          VIRTUAL_PRODUCT_IDS.has(io.id),
      );
      if (inputsReady) {
        unlockedRecipeIds.add(r.id);
        for (const out of r.outputs) {
          if (!unlockedProductIds.has(out.id)) {
            unlockedProductIds.add(out.id);
            added = true;
          }
        }
      }
    }
    if (!added) break;
  }

  const productionMachines = Object.values(MACHINES).filter((m) => !m.isStorage);
  const unlockedMachinesCount = productionMachines.filter((m) =>
    unlockedMachineIds.has(m.id),
  ).length;

  return {
    ...gameCaps,
    unlockedProductIds,
    unlockedMachineIds,
    unlockedRecipeIds,
    unlockedProductsCount: unlockedProductIds.size,
    unlockedMachinesCount,
    toSolverFilter: (enabled: boolean): UnlockedGameFilter => ({
      enabled,
      stageMode,
      stagePreferredRecipes: STAGE_PREFERRED_RECIPES[stageMode] ?? {},
      unlockedRecipeIds,
      activeRecipeIds: gameCaps.activeRecipeIds,
      unlockedProductIds,
      unlockedMachineIds,
      builtMachineIds: gameCaps.builtMachineIds,
    }),
  };
}

// ============================================================================
// Realistic Mid-Game Demo Snapshot ("Остров Эволюции · Год 145")
// Mirrors exact Captain of Industry Web API payloads in /60s units (= 1 game month)
// ============================================================================

const DEMO_UNLOCKED_PRODUCT_IDS = new Set<string>([
  'iron_ore',
  'iron_ore_crushed',
  'copper_ore',
  'copper_ore_crushed',
  'coal',
  'limestone',
  'sand',
  'gravel',
  'rock',
  'dirt',
  'wood',
  'water',
  'seawater',
  'crude_oil',
  'molten_iron',
  'iron',
  'molten_steel',
  'steel',
  'molten_copper',
  'impure_copper',
  'copper',
  'glass_mix',
  'molten_glass',
  'glass',
  'slag',
  'slag_crushed',
  'cement',
  'concrete_slab',
  'bricks',
  'iron_scrap',
  'copper_scrap',
  'heavy_oil',
  'medium_oil',
  'diesel',
  'light_oil',
  'sour_water',
  'naphtha',
  'fuel_gas',
  'acid',
  'sulfur',
  'ammonia',
  'chlorine',
  'hydrogen',
  'nitrogen',
  'oxygen',
  'plastic',
  'rubber',
  'graphite',
  'exhaust',
  'carbon_dioxide',
  'waste_water',
  'sludge',
  'mechanical_parts',
  'electronics',
  'pcb',
  'construction_parts',
  'construction_parts_ii',
  'construction_parts_iii',
  'vehicle_parts_i',
  'vehicle_parts_ii',
  'lab_equipment',
  'lab_equipment_ii',
  'lab_equipment_iii',
  'steam_high',
  'steam_low',
  'steam_depleted',
  'electricity',
  'mechanical_power',
  'maintenance_i',
  'maintenance_ii',
  'potato',
  'wheat',
  'bread',
  'vegetables',
  'meat',
]);

interface DemoMetricsSpec {
  qty: number;
  stored: number;
  cap: number;
  prodM: number; // per game month (= per 60s)
  consM: number;
  pinned?: boolean;
  sourcesProd?: { recipe?: string; machine: string; qty: number }[];
  sourcesCons?: { recipe?: string; machine: string; qty: number }[];
}

const DEMO_METRICS: Record<string, DemoMetricsSpec> = {
  iron_ore: {
    qty: 1420,
    stored: 1420,
    cap: 2400,
    prodM: 144,
    consM: 144,
    sourcesProd: [{ machine: 'MineTower', qty: 144 }],
    sourcesCons: [
      { machine: 'SmeltingFurnaceT2', recipe: 'iron_smelting', qty: 144 },
    ],
  },
  copper_ore: {
    qty: 520,
    stored: 520,
    cap: 1800,
    prodM: 96,
    consM: 96,
    sourcesProd: [{ machine: 'MineTower', qty: 96 }],
    sourcesCons: [
      { machine: 'SmeltingFurnaceT1', recipe: 'copper_smelting', qty: 96 },
    ],
  },
  coal: {
    qty: 86,
    stored: 86,
    cap: 1800,
    prodM: 96,
    consM: 114,
    pinned: true,
    sourcesProd: [{ machine: 'MineTower', qty: 96 }],
    sourcesCons: [
      { machine: 'BoilerCoal', recipe: 'steam_generation', qty: 54 },
      { machine: 'SmeltingFurnaceT2', recipe: 'iron_smelting', qty: 36 },
      { machine: 'RotaryKiln', recipe: 'graphite_production', qty: 24 },
    ],
  },
  crude_oil: {
    qty: 680,
    stored: 680,
    cap: 1500,
    prodM: 108,
    consM: 108,
    sourcesProd: [{ machine: 'OilPump', qty: 108 }],
    sourcesCons: [
      { machine: 'DistillationTowerT1', recipe: 'crude_oil_refining', qty: 108 },
    ],
  },
  diesel: {
    qty: 42,
    stored: 42,
    cap: 1500,
    prodM: 72,
    consM: 90,
    pinned: true,
    sourcesProd: [
      { machine: 'DistillationTowerT2', recipe: 'crude_oil_refining_2', qty: 48 },
      { machine: 'DistillationTowerT1', recipe: 'crude_oil_refining', qty: 24 },
    ],
    sourcesCons: [
      { machine: 'DieselGenerator', recipe: 'diesel_generator', qty: 36 },
      { machine: 'LogisticsTruck', qty: 54 },
    ],
  },
  iron: {
    qty: 940,
    stored: 940,
    cap: 1500,
    prodM: 96,
    consM: 84,
    pinned: true,
    sourcesProd: [
      { machine: 'CasterCooled', recipe: 'iron_casting', qty: 96 },
    ],
    sourcesCons: [
      { machine: 'SmeltingFurnaceT2', recipe: 'steel_smelting', qty: 48 },
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp_assembly_t2', qty: 24 },
      { machine: 'AssemblyElectrifiedT2', recipe: 'mech._parts_assembly_t2', qty: 12 },
    ],
  },
  steel: {
    qty: 410,
    stored: 410,
    cap: 1200,
    prodM: 48,
    consM: 42,
    pinned: true,
    sourcesProd: [
      { machine: 'CasterCooled', recipe: 'steel_casting_cooled', qty: 48 },
    ],
    sourcesCons: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp2_assembly_t2', qty: 24 },
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp3_assembly_t2', qty: 18 },
    ],
  },
  copper: {
    qty: 0,
    stored: 0,
    cap: 900,
    prodM: 48,
    consM: 60,
    pinned: true,
    sourcesProd: [
      { machine: 'CopperElectrolysis', recipe: 'copper_purification_acid', qty: 48 },
    ],
    sourcesCons: [
      { machine: 'AssemblyElectrified', recipe: 'electronics_assembly_t2', qty: 36 },
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp3_assembly_t2', qty: 24 },
    ],
  },
  construction_parts: {
    qty: 760,
    stored: 760,
    cap: 1200,
    prodM: 36,
    consM: 30,
    sourcesProd: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp_assembly_t2', qty: 36 },
    ],
    sourcesCons: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp2_assembly_t2', qty: 24 },
      { machine: 'MaintenanceDepotT1', recipe: 'maintenance_i', qty: 6 },
    ],
  },
  construction_parts_ii: {
    qty: 51,
    stored: 51,
    cap: 1200,
    prodM: 18,
    consM: 24,
    pinned: true,
    sourcesProd: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp2_assembly_t2', qty: 18 },
    ],
    sourcesCons: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp3_assembly_t2', qty: 18 },
      { machine: 'MaintenanceDepotT2', recipe: 'maintenance_ii', qty: 6 },
    ],
  },
  construction_parts_iii: {
    qty: 190,
    stored: 190,
    cap: 600,
    prodM: 12,
    consM: 8,
    sourcesProd: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp3_assembly_t2', qty: 12 },
    ],
    sourcesCons: [{ machine: 'ConstructionZone', qty: 8 }],
  },
  concrete_slab: {
    qty: 640,
    stored: 640,
    cap: 1500,
    prodM: 48,
    consM: 40,
    sourcesProd: [
      { machine: 'ConcreteMixerT2', recipe: 'concrete_mixing_2', qty: 48 },
    ],
    sourcesCons: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp_assembly_t2', qty: 24 },
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp3_assembly_t2', qty: 16 },
    ],
  },
  electronics: {
    qty: 145,
    stored: 145,
    cap: 600,
    prodM: 24,
    consM: 28,
    sourcesProd: [
      { machine: 'AssemblyElectrified', recipe: 'electronics_assembly_t2', qty: 24 },
    ],
    sourcesCons: [
      { machine: 'MaintenanceDepotT2', recipe: 'maintenance_ii', qty: 12 },
      { machine: 'AssemblyElectrifiedT2', recipe: 'cp3_assembly_t2', qty: 16 },
    ],
  },
  mechanical_parts: {
    qty: 280,
    stored: 280,
    cap: 600,
    prodM: 36,
    consM: 24,
    sourcesProd: [
      { machine: 'AssemblyElectrifiedT2', recipe: 'mech._parts_assembly_t2', qty: 36 },
    ],
    sourcesCons: [
      { machine: 'MaintenanceDepotT1', recipe: 'maintenance_i', qty: 18 },
      { machine: 'MaintenanceDepotT2', recipe: 'maintenance_ii', qty: 6 },
    ],
  },
  glass: {
    qty: 310,
    stored: 310,
    cap: 600,
    prodM: 24,
    consM: 18,
    sourcesProd: [
      { machine: 'CasterT2', recipe: 'glass_casting', qty: 24 },
    ],
    sourcesCons: [
      { machine: 'AssemblyElectrified', recipe: 'lab_equipment_2_assembly_t2', qty: 18 },
    ],
  },
  acid: {
    qty: 420,
    stored: 420,
    cap: 900,
    prodM: 24,
    consM: 20,
    sourcesProd: [
      { machine: 'IndustrialMixerT2', recipe: 'acid_mixing', qty: 24 },
    ],
    sourcesCons: [
      { machine: 'CopperElectrolysis', recipe: 'copper_purification_acid', qty: 20 },
    ],
  },
  water: {
    qty: 1100,
    stored: 1100,
    cap: 1500,
    prodM: 180,
    consM: 174,
    sourcesProd: [
      { machine: 'LandWaterPump', recipe: 'water_pumping', qty: 120 },
      { machine: 'CoolingTowerT1', qty: 60 },
    ],
    sourcesCons: [
      { machine: 'BoilerCoal', recipe: 'steam_generation', qty: 108 },
      { machine: 'BoilerGas', qty: 36 },
      { machine: 'CopperElectrolysis', recipe: 'copper_purification_acid', qty: 30 },
    ],
  },
  steam_high: {
    qty: 120,
    stored: 120,
    cap: 200,
    prodM: 144,
    consM: 144,
    sourcesProd: [
      { machine: 'BoilerCoal', recipe: 'steam_generation', qty: 108 },
      { machine: 'BoilerGas', qty: 36 },
    ],
    sourcesCons: [
      { machine: 'TurbineHighPress', recipe: 'turbinehighpress', qty: 132 },
      { machine: 'DistillationTowerT1', recipe: 'crude_oil_refining', qty: 12 },
    ],
  },
  steam_low: {
    qty: 95,
    stored: 95,
    cap: 200,
    prodM: 132,
    consM: 132,
    sourcesProd: [
      { machine: 'TurbineHighPress', recipe: 'turbinehighpress', qty: 132 },
    ],
    sourcesCons: [
      { machine: 'TurbineLowPress', recipe: 'turbinelowpress', qty: 96 },
      { machine: 'CoolingTowerT1', qty: 24 },
      { machine: 'SmokeStack', qty: 12 },
    ],
  },
  steam_depleted: {
    qty: 40,
    stored: 40,
    cap: 200,
    prodM: 96,
    consM: 96,
    sourcesProd: [
      { machine: 'TurbineLowPress', recipe: 'turbinelowpress', qty: 96 },
    ],
    sourcesCons: [
      { machine: 'CoolingTowerT1', qty: 78 },
      { machine: 'SmokeStack', qty: 18 },
    ],
  },
  exhaust: {
    qty: 194,
    stored: 194,
    cap: 200,
    prodM: 180,
    consM: 175,
    sourcesProd: [
      { machine: 'BoilerCoal', recipe: 'steam_generation', qty: 90 },
      { machine: 'SmeltingFurnaceT2', recipe: 'iron_smelting', qty: 90 },
    ],
    sourcesCons: [{ machine: 'SmokeStack', qty: 175 }],
  },
  slag: {
    qty: 1160,
    stored: 1160,
    cap: 1200,
    prodM: 48,
    consM: 42,
    sourcesProd: [
      { machine: 'SmeltingFurnaceT2', recipe: 'iron_smelting', qty: 48 },
    ],
    sourcesCons: [{ machine: 'ConcreteMixerT2', qty: 42 }],
  },
};

export function buildDemoSnapshot(period: SourcesPeriod = 'lastMonth'): GameLiveBundle {
  const periodFactor =
    period === 'thisMonth'
      ? 0.45
      : period === 'lastMonth'
        ? 1
        : period === 'thisYear'
          ? 6
          : period === 'lastYear'
            ? 12
            : 110;

  const catalog: CatalogProduct[] = [];
  const stats: Record<string, ProductStatEntry> = {};
  const pinnedIds = new Set<string>();
  const sourcesProducts: Record<string, ProductSourcesEntry> = {};
  const names: Record<string, string> = {};

  for (const prod of Object.values(PRODUCTS)) {
    const gameProdId = PRODUCT_GAME_IDS[prod.id];
    if (!gameProdId) continue;

    const lbl = getProductLabel(prod.id);
    const ruName = lbl.ru ?? prod.name;
    const isUnlocked = DEMO_UNLOCKED_PRODUCT_IDS.has(prod.id);
    const kind =
      VIRTUAL_PRODUCT_IDS.has(prod.id)
        ? 'virtual'
        : prod.id.startsWith('molten_')
          ? 'molten'
          : prod.machines.input.some((m) => m.startsWith('fluid_storage'))
            ? 'fluid'
            : prod.machines.input.some((m) => m.startsWith('loose_storage'))
              ? 'loose'
              : 'countable';

    catalog.push({
      id: gameProdId,
      name: ruName,
      kind,
      isUnlocked,
    });
    names[gameProdId] = ruName;

    const spec = DEMO_METRICS[prod.id];
    if (spec) {
      if (spec.pinned) pinnedIds.add(gameProdId);
      stats[gameProdId] = {
        quantity: spec.qty,
        stored: spec.stored,
        storageCapacity: spec.cap,
        produced: [
          Math.round(spec.prodM * 0.45),
          spec.prodM,
          spec.prodM * 6,
          spec.prodM * 12,
          spec.prodM * 110,
        ],
        consumed: [
          Math.round(spec.consM * 0.45),
          spec.consM,
          spec.consM * 6,
          spec.consM * 12,
          spec.consM * 110,
        ],
      };

      const prodRows: SourceRow[] = (spec.sourcesProd ?? []).map((s) => {
        const machineObj = MACHINE_BY_GAME_ID[s.machine];
        const gameRecipeId = s.recipe ? RECIPE_GAME_IDS[s.recipe] : undefined;
        if (machineObj) {
          names[s.machine] = getMachineLabel(machineObj.id).ru;
        }
        if (s.recipe && gameRecipeId && !names[gameRecipeId]) {
          names[gameRecipeId] = getRecipeLabel(s.recipe).ru;
        }
        return {
          type: gameRecipeId ? 'recipe' : 'entity',
          quantity: Math.round(s.qty * periodFactor),
          machine: s.machine,
          recipe: gameRecipeId ?? null,
          entity: gameRecipeId ? null : s.machine,
        };
      });

      const consRows: SourceRow[] = (spec.sourcesCons ?? []).map((s) => {
        const machineObj = MACHINE_BY_GAME_ID[s.machine];
        const gameRecipeId = s.recipe ? RECIPE_GAME_IDS[s.recipe] : undefined;
        if (machineObj) {
          names[s.machine] = getMachineLabel(machineObj.id).ru;
        } else if (s.machine === 'LogisticsTruck') {
          names[s.machine] = 'Грузовой транспорт';
        } else if (s.machine === 'ConstructionZone') {
          names[s.machine] = 'Строительство';
        }
        if (s.recipe && gameRecipeId && !names[gameRecipeId]) {
          names[gameRecipeId] = getRecipeLabel(s.recipe).ru;
        }
        return {
          type: gameRecipeId ? 'recipe' : 'entity',
          quantity: Math.round(s.qty * periodFactor),
          machine: s.machine,
          recipe: gameRecipeId ?? null,
          entity: gameRecipeId ? null : s.machine,
        };
      });

      sourcesProducts[gameProdId] = {
        produced: {
          total: prodRows.reduce((a, b) => a + b.quantity, 0),
          rows: prodRows,
        },
        consumed: {
          total: consRows.reduce((a, b) => a + b.quantity, 0),
          rows: consRows,
        },
      };
    } else if (isUnlocked) {
      stats[gameProdId] = {
        quantity: 120,
        stored: 120,
        storageCapacity: 600,
        produced: [0, 0, 0, 0, 0],
        consumed: [0, 0, 0, 0, 0],
      };
    }
  }

  // Register extra built maintenance / power machines in names & sources
  names.DieselGenerator = 'Дизельный генератор';

  return {
    gameInfo: {
      date: '145-6-14',
      tick: 874240,
      isPaused: false,
      speed: 2,
      gameId: 'demo-island-145',
      sessionId: 'demo-session',
    },
    serverInfo: {
      date: '145-6-14',
      tick: 874240,
      port: 3073,
      otherOrigins: 'getAndPost',
    },
    catalog: catalog.sort((a, b) => a.name.localeCompare(b.name, 'ru')),
    pinnedIds,
    stats,
    sources: {
      date: '145-6-14',
      tick: 874240,
      period,
      products: sourcesProducts,
      names,
    },
    latencyMs: 4,
  };
}

function buildDemoProductHistory(
  demoBundle: GameLiveBundle,
  gameProductId: string,
  resolution: 'day' | 'month' | 'year' | 'quarterCentury',
  count: number,
): ProductHistoryResponse {
  const st = demoBundle.stats[gameProductId];
  const baseProd = st?.produced?.[1] ?? 24;
  const baseCons = st?.consumed?.[1] ?? 20;
  const baseQty = st?.quantity ?? 120;
  const n = Math.min(48, Math.max(6, count));

  const produced: number[] = [];
  const consumed: number[] = [];
  const quantity: number[] = [];
  const stored: number[] = [];

  let q = Math.max(0, baseQty - (baseProd - baseCons) * (n * 0.4));
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i * 0.65) * 0.12 + 1;
    const waveC = Math.cos(i * 0.45) * 0.1 + 1;
    const pVal = Math.round(baseProd * wave);
    const cVal = Math.round(baseCons * waveC);
    q = Math.max(0, Math.round(q + (pVal - cVal) * 0.5));
    produced.push(pVal);
    consumed.push(cVal);
    quantity.push(i === n - 1 ? baseQty : q);
    stored.push(i === n - 1 ? st?.stored ?? q : q);
  }

  return {
    date: demoBundle.gameInfo.date,
    tick: demoBundle.gameInfo.tick,
    resolution,
    start: resolution === 'day' ? '145-5-20' : resolution === 'month' ? '143-7-1' : '125-1-1',
    products: {
      [gameProductId]:
        resolution === 'day'
          ? { quantity, stored }
          : { produced, consumed, quantity },
    },
  };
}
