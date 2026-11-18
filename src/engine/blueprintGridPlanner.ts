import {
  MACHINES,
  PRODUCTS,
  PRODUCT_GAME_IDS,
  RECIPE_GAME_IDS,
  VIRTUAL_PRODUCT_IDS,
  getMachineLabel,
  getProductLabel,
  getProductLogisticsKind,
  getTransportIconForKind,
} from '../data';
import {
  type WorldPort,
  getBuildingOccupiedBox,
  getBuildingWorldPorts,
  getRawBuildingLayout,
  minCornerToTransformCenter,
  normalizeRotIndex,
} from '../data/buildingLayouts';
import type { LogisticsSummary, SolveResult, SolvedStep } from '../types/coi';
import { analyzeByproductsAndStorage } from './byproductAdvisor';

export type PlacedBuildingRole =
  | 'input_storage'
  | 'production'
  | 'output_storage'
  | 'buffer_storage'
  | 'disposal'
  | 'junction'
  | 'imported';

export interface CustomTilePlacement {
  minX: number;
  minY: number;
  rotIndex: 0 | 1 | 2 | 3;
}

export interface PlacedGridBuilding {
  id: string;
  role: PlacedBuildingRole;
  prototype: string;
  machineId?: string;
  machineNameRu: string;
  machineIcon?: string;
  stepId?: string;
  recipeId?: string;
  gameRecipeId?: string;
  recipeNameRu?: string;
  storedProductId?: string;
  storedProductGameId?: string;
  storedProductNameRu?: string;
  storedProductIcon?: string;
  flowRatePer60?: number;
  customTitle?: string;
  tx: number;
  ty: number;
  tz: number;
  rotIndex: 0 | 1 | 2 | 3;
  reflected: boolean;
  minX: number;
  minY: number;
  width: number;
  height: number;
  ports: WorldPort[];
}

export interface GridTransportRoute {
  id: string;
  protoId: string;
  iconUrl: string;
  kind: Exclude<LogisticsSummary['kind'], 'virtual'>;
  productId?: string;
  productNameRu?: string;
  productIcon?: string;
  ratePer60: number;
  fromBuildingId?: string;
  fromPortName?: string;
  toBuildingId?: string;
  toPortName?: string;
  startDir: [number, number, number];
  endDir: [number, number, number];
  pivots: [number, number, number][];
  color: number;
  accentColor: number;
}

export interface CompactGridPlan {
  buildings: PlacedGridBuilding[];
  routes: GridTransportRoute[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  unmappedRecipes: string[];
  inputStoragesCount: number;
  outputStoragesCount: number;
  transportCount: number;
}

export interface GridPlannerOptions {
  includeDisposalBuildings: boolean;
  includeBufferStorages: boolean;
}

const BELT_MAIN_COLOR = -2139062017;
const BELT_ACCENT_COLOR = 858993663;
const PIPE_MAIN_COLOR = 1717987071;
const PIPE_ACCENT_COLOR = -1431655681;

const MAX_MACHINES_PER_STEP = 24;

export function getMiniZipProtoForKind(
  kind: Exclude<LogisticsSummary['kind'], 'virtual'>,
): string {
  switch (kind) {
    case 'loose':
      return 'MiniZip_IoPortShape_LooseMaterialConveyor';
    case 'fluid':
      return 'MiniZip_IoPortShape_Pipe';
    case 'molten':
      return 'MiniZip_IoPortShape_MoltenMetalChannel';
    case 'flat':
    default:
      return 'MiniZip_IoPortShape_FlatConveyor';
  }
}

export function getTransportProtoForFlow(
  kind: Exclude<LogisticsSummary['kind'], 'virtual'>,
  ratePer60: number,
): string {
  switch (kind) {
    case 'molten':
      return 'MoltenMetalChannel';
    case 'fluid':
      if (ratePer60 > 450) return 'PipeT4';
      if (ratePer60 > 200) return 'PipeT3';
      if (ratePer60 > 60) return 'PipeT2';
      return 'PipeT1';
    case 'loose':
      if (ratePer60 > 200) return 'LooseMaterialConveyorT3';
      if (ratePer60 > 60) return 'LooseMaterialConveyorT2';
      return 'LooseMaterialConveyor';
    case 'flat':
    default:
      if (ratePer60 > 200) return 'FlatConveyorT3';
      if (ratePer60 > 60) return 'FlatConveyorT2';
      return 'FlatConveyorT1';
  }
}

export function getStorageForProductKind(
  kind: Exclude<LogisticsSummary['kind'], 'virtual'>,
  ratePer60: number,
): { machineId: string; gameId: string } {
  const highTier = ratePer60 > 180;
  if (kind === 'loose') {
    return highTier
      ? { machineId: 'loose_storage_ii', gameId: 'StorageLooseT2' }
      : { machineId: 'loose_storage', gameId: 'StorageLoose' };
  }
  if (kind === 'fluid') {
    return highTier
      ? { machineId: 'fluid_storage_ii', gameId: 'StorageFluidT2' }
      : { machineId: 'fluid_storage', gameId: 'StorageFluid' };
  }
  return highTier
    ? { machineId: 'unit_storage_ii', gameId: 'StorageUnitT2' }
    : { machineId: 'unit_storage', gameId: 'StorageUnit' };
}

type Vec3 = [number, number, number];

function sign(n: number): number {
  return n > 0 ? 1 : n < 0 ? -1 : 0;
}

/**
 * Collapses repeated or collinear consecutive pivots and validates against
 * Mafi.Core.Factory.Transports.TransportTrajectory.tryCreateCurveFromPivots rules.
 */
export function simplifyAndValidatePivots(
  rawPivots: Vec3[],
  startDir: Vec3,
  endDir: Vec3,
): Vec3[] | null {
  const dedup: Vec3[] = [];
  for (const pt of rawPivots) {
    const prev = dedup[dedup.length - 1];
    if (!prev || prev[0] !== pt[0] || prev[1] !== pt[1] || prev[2] !== pt[2]) {
      dedup.push([Math.round(pt[0]), Math.round(pt[1]), Math.round(pt[2])]);
    }
  }
  if (dedup.length < 2) return null;

  // Merge strictly collinear segments moving in the SAME direction; reject 180° reversals or diagonals
  const clean: Vec3[] = [dedup[0]];
  for (let i = 1; i < dedup.length; i++) {
    const cur = dedup[i];
    const prev = clean[clean.length - 1];
    const dx = cur[0] - prev[0];
    const dy = cur[1] - prev[1];
    const dz = cur[2] - prev[2];
    const nonZeroAxes = (dx !== 0 ? 1 : 0) + (dy !== 0 ? 1 : 0) + (dz !== 0 ? 1 : 0);
    if (nonZeroAxes !== 1) return null; // repeated or diagonal

    if (clean.length >= 2) {
      const prev2 = clean[clean.length - 2];
      const pdx = prev[0] - prev2[0];
      const pdy = prev[1] - prev2[1];
      const pdz = prev[2] - prev2[2];
      const s1: Vec3 = [sign(pdx), sign(pdy), sign(pdz)];
      const s2: Vec3 = [sign(dx), sign(dy), sign(dz)];
      const dot = s1[0] * s2[0] + s1[1] * s2[1] + s1[2] * s2[2];
      if (dot > 0) {
        // Collinear continuation -> extend last pivot
        clean[clean.length - 1] = cur;
        continue;
      }
      if (dot < 0) {
        return null; // 180 degree reversal
      }
    }
    clean.push(cur);
  }

  if (clean.length < 2) return null;

  // Validate startDir and endDir against first and last segments
  const fdx = sign(clean[1][0] - clean[0][0]);
  const fdy = sign(clean[1][1] - clean[0][1]);
  const fdz = sign(clean[1][2] - clean[0][2]);
  if (fdx === startDir[0] && fdy === startDir[1] && fdz === startDir[2]) {
    return null; // startDir pointing into the transport
  }

  const ldx = sign(clean[clean.length - 1][0] - clean[clean.length - 2][0]);
  const ldy = sign(clean[clean.length - 1][1] - clean[clean.length - 2][1]);
  const ldz = sign(clean[clean.length - 1][2] - clean[clean.length - 2][2]);
  if (ldx === -endDir[0] && ldy === -endDir[1] && ldz === -endDir[2]) {
    return null; // endDir pointing into the transport
  }

  if (
    clean.length === 2 &&
    Math.abs(clean[1][0] - clean[0][0]) +
      Math.abs(clean[1][1] - clean[0][1]) +
      Math.abs(clean[1][2] - clean[0][2]) <=
      1 &&
    startDir[0] === endDir[0] &&
    startDir[1] === endDir[1] &&
    startDir[2] === endDir[2]
  ) {
    return null;
  }

  return clean;
}

function manhattanLen(pts: Vec3[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total +=
      Math.abs(pts[i][0] - pts[i - 1][0]) +
      Math.abs(pts[i][1] - pts[i - 1][1]) +
      Math.abs(pts[i][2] - pts[i - 1][2]);
  }
  return total;
}

/**
 * Computes a guaranteed valid orthogonal COI transport trajectory connecting
 * source WorldPort (`sp`) to destination WorldPort (`dp`).
 */
export function routePortToPort(
  sp: WorldPort,
  dp: WorldPort,
  corridorX: number,
  detourY: number,
): { startDir: Vec3; endDir: Vec3; pivots: Vec3[] } | null {
  const startDir: Vec3 = [-sign(sp.dirX), -sign(sp.dirY), 0];
  const endDir: Vec3 = [-sign(dp.dirX), -sign(dp.dirY), 0];

  const p0: Vec3 = [sp.connX, sp.connY, 0];
  const p1: Vec3 = [sp.connX + sign(sp.dirX), sp.connY + sign(sp.dirY), 0];
  const q1: Vec3 = [dp.connX + sign(dp.dirX), dp.connY + sign(dp.dirY), 0];
  const q0: Vec3 = [dp.connX, dp.connY, 0];

  const candidates: Vec3[][] = [];

  // 1. Direct orthogonal 2 or 3 pivot connection (ideal when aligned)
  candidates.push([p0, q0]);
  candidates.push([p0, [q0[0], p0[1], 0], q0]);
  candidates.push([p0, [p0[0], q0[1], 0], q0]);

  // 2. Stepped 1-tile out + vertical corridorX + step into port
  candidates.push([p0, p1, [corridorX, p1[1], 0], [corridorX, q1[1], 0], q1, q0]);
  candidates.push([p0, p1, [p1[0], q1[1], 0], q1, q0]);
  candidates.push([p0, p1, [q1[0], p1[1], 0], q1, q0]);

  // 3. Corridor via Y jog (for North/South ports like OxygenFurnace B/S or rotated machines)
  candidates.push([
    p0,
    p1,
    [p1[0], detourY, 0],
    [corridorX, detourY, 0],
    [corridorX, q1[1], 0],
    q1,
    q0,
  ]);
  candidates.push([
    p0,
    p1,
    [corridorX, p1[1], 0],
    [corridorX, detourY, 0],
    [q1[0], detourY, 0],
    q1,
    q0,
  ]);

  // 4. Universal wrap-around candidates handling reversed buildings
  const leftClearX = Math.min(p1[0], q1[0]) - 2;
  const rightClearX = Math.max(p1[0], q1[0]) + 2;
  const lowY = Math.min(p1[1], q1[1]) - 3;
  const highY = Math.max(p1[1], q1[1]) + 3;
  for (const mx of [corridorX, leftClearX, rightClearX]) {
    for (const my of [detourY, lowY, highY]) {
      candidates.push([p0, p1, [p1[0], my, 0], [mx, my, 0], [mx, q1[1], 0], q1, q0]);
      candidates.push([p0, p1, [mx, p1[1], 0], [mx, my, 0], [q1[0], my, 0], q1, q0]);
    }
  }

  let best: Vec3[] | null = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    const valid = simplifyAndValidatePivots(cand, startDir, endDir);
    if (!valid) continue;
    // Slight tie-breaker favoring fewer bends + shorter Manhattan length
    const score = manhattanLen(valid) + valid.length * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = valid;
    }
  }

  return best ? { startDir, endDir, pivots: best } : null;
}

function makePlacedBuilding(
  opts: {
    id: string;
    role: PlacedBuildingRole;
    prototype: string;
    machineId?: string;
    machineNameRu: string;
    machineIcon?: string;
    stepId?: string;
    recipeId?: string;
    gameRecipeId?: string;
    recipeNameRu?: string;
    storedProductId?: string;
    storedProductGameId?: string;
    storedProductNameRu?: string;
    storedProductIcon?: string;
    flowRatePer60?: number;
    customTitle?: string;
  },
  defaultMinX: number,
  defaultMinY: number,
  custom?: CustomTilePlacement,
): PlacedGridBuilding {
  const rotIndex = normalizeRotIndex(custom?.rotIndex ?? 0);
  const minX = custom ? Math.round(custom.minX) : Math.round(defaultMinX);
  const minY = custom ? Math.round(custom.minY) : Math.round(defaultMinY);
  const { tx, ty } = minCornerToTransformCenter(
    opts.prototype,
    minX,
    minY,
    rotIndex,
    false,
  );
  const box = getBuildingOccupiedBox(opts.prototype, tx, ty, rotIndex, false);
  const ports = getBuildingWorldPorts(opts.prototype, tx, ty, rotIndex, false);
  return {
    ...opts,
    tx,
    ty,
    tz: 0,
    rotIndex,
    reflected: false,
    minX: box.minX,
    minY: box.minY,
    width: box.width,
    height: box.height,
    ports,
  };
}

function pickBestPort(
  ports: WorldPort[],
  wantInput: boolean,
  kind: Exclude<LogisticsSummary['kind'], 'virtual'>,
  usageCount: Map<string, number>,
  buildingId: string,
  preferY?: number,
): WorldPort | null {
  const matching = ports.filter((p) => p.isInput === wantInput && p.kind === kind);
  const pool =
    matching.length > 0
      ? matching
      : ports.filter(
          (p) =>
            p.isInput === wantInput &&
            (p.kind === 'flat' || p.kind === 'loose' || p.kind === 'fluid'),
        );
  const fallbackPool = pool.length > 0 ? pool : ports.filter((p) => p.isInput === wantInput);
  if (fallbackPool.length === 0) return null;

  return [...fallbackPool].sort((a, b) => {
    const ua = usageCount.get(`${buildingId}:${a.name}`) ?? 0;
    const ub = usageCount.get(`${buildingId}:${b.name}`) ?? 0;
    if (ua !== ub) return ua - ub;
    if (preferY !== undefined) {
      return Math.abs(a.connY - preferY) - Math.abs(b.connY - preferY);
    }
    return 0;
  })[0];
}

/**
 * Builds a compact 1:1 Captain of Industry tile layout featuring:
 *  - Column 0 (left): Input storages/tanks for every non-virtual raw input with /60s rates
 *  - Columns 1..K (middle): Compactly stacked production stages connected by corridors
 *  - Column K+1 (right): Output storages/tanks for targets/buffers + optional disposals
 *  - Routed orthogonal conveyors, U-conveyors, pipes & molten channels between ports
 */
export function buildCompactGridLayout(
  solveResult: SolveResult,
  options: GridPlannerOptions,
  customPlacements: Record<string, CustomTilePlacement> = {},
): CompactGridPlan {
  const buildings: PlacedGridBuilding[] = [];
  const routes: GridTransportRoute[] = [];
  const unmappedRecipes: string[] = [];

  const GAP_Y = 3; // compact 3-tile vertical clearance between stacked buildings (supports N/S pipe taps)
  const CORRIDOR_X = 7; // horizontal corridor width for parallel conveyors/pipes
  const START_X = 2;
  const START_Y = 2;

  interface ColumnItem {
    id: string;
    role: PlacedBuildingRole;
    prototype: string;
    machineId?: string;
    machineNameRu: string;
    machineIcon?: string;
    stepId?: string;
    recipeId?: string;
    gameRecipeId?: string;
    recipeNameRu?: string;
    storedProductId?: string;
    storedProductGameId?: string;
    storedProductNameRu?: string;
    storedProductIcon?: string;
    flowRatePer60?: number;
    customTitle?: string;
  }

  // 1. Leftmost column: Input Storages for every non-virtual raw input
  const inputColumn: ColumnItem[] = [];
  for (const raw of solveResult.summary.rawInputs) {
    if (VIRTUAL_PRODUCT_IDS.has(raw.productId)) continue;
    const rawKind = getProductLogisticsKind(raw.productId);
    if (rawKind === 'virtual' || rawKind === 'molten') continue;

    const st = getStorageForProductKind(rawKind, raw.ratePer60);
    const stMachine = MACHINES[st.machineId];
    const prod = PRODUCTS[raw.productId];
    const prodRu = getProductLabel(raw.productId).ru ?? raw.name;
    const rateStr = raw.ratePer60.toFixed(1).replace(/\.0$/, '');

    inputColumn.push({
      id: `in-storage-${raw.productId}`,
      role: 'input_storage',
      prototype: st.gameId,
      machineId: st.machineId,
      machineNameRu: stMachine ? getMachineLabel(stMachine.id).ru : 'Входной склад',
      machineIcon: stMachine?.icon ?? `${st.gameId}.png`,
      storedProductId: raw.productId,
      storedProductGameId: PRODUCT_GAME_IDS[raw.productId],
      storedProductNameRu: prodRu,
      storedProductIcon: prod?.icon ?? raw.icon,
      flowRatePer60: raw.ratePer60,
      customTitle: `Вход: ${prodRu} (${rateStr}/60с)`,
    });
  }

  // 2. Middle columns: Production stages grouped by depth (upstream -> downstream)
  const prodDepths = [...new Set(
    solveResult.steps
      .filter((s) => {
        if (s.kind !== 'recipe') return false;
        const m = MACHINES[s.machineId];
        return Boolean(m?.game_id && !m.isMine && !m.isStorage);
      })
      .map((s) => s.depth),
  )].sort((a, b) => b - a);

  const stageColumns: ColumnItem[][] = [];
  const stepBuildingIds = new Map<string, string[]>();

  for (const depth of prodDepths) {
    const col: ColumnItem[] = [];
    const stepsAtDepth = solveResult.steps.filter(
      (s) => s.kind === 'recipe' && s.depth === depth,
    );

    for (const step of stepsAtDepth) {
      const m = MACHINES[step.machineId];
      if (!m?.game_id || m.isMine || m.isStorage) continue;
      const count = Math.min(MAX_MACHINES_PER_STEP, Math.max(1, step.ceilMachines));
      const gameRecipeId = step.recipeId ? RECIPE_GAME_IDS[step.recipeId] : undefined;
      if (step.recipeId && !gameRecipeId && !unmappedRecipes.includes(step.recipeId)) {
        unmappedRecipes.push(step.recipeId);
      }

      const ids: string[] = [];
      const primaryOut = step.outputs.find((o) => o.productId === step.primaryProductId) ?? step.outputs[0];
      const perMachineOutRate =
        primaryOut && step.ceilMachines > 0 ? primaryOut.ratePer60 / step.ceilMachines : undefined;

      for (let i = 0; i < count; i++) {
        const bid = `step-${step.stepId}-unit-${i}`;
        ids.push(bid);
        col.push({
          id: bid,
          role: 'production',
          prototype: m.game_id,
          machineId: m.id,
          machineNameRu: getMachineLabel(m.id).ru,
          machineIcon: m.icon,
          stepId: step.stepId,
          recipeId: step.recipeId,
          gameRecipeId,
          recipeNameRu: step.recipeName,
          storedProductId: primaryOut?.productId,
          storedProductNameRu: primaryOut ? (getProductLabel(primaryOut.productId).ru ?? primaryOut.name) : undefined,
          storedProductIcon: primaryOut?.icon,
          flowRatePer60: perMachineOutRate,
        });
      }
      stepBuildingIds.set(step.stepId, ids);
    }

    if (col.length > 0) stageColumns.push(col);
  }

  // 3. Rightmost column: ALWAYS Output Storages for target outputs + optional buffer/disposal
  const outputColumn: ColumnItem[] = [];
  const outputStorageProductIds = new Set<string>();

  for (const step of solveResult.steps) {
    if (!step.isTarget) continue;
    const pid = step.primaryProductId;
    if (VIRTUAL_PRODUCT_IDS.has(pid) || outputStorageProductIds.has(pid)) continue;
    const outKind = getProductLogisticsKind(pid);
    if (outKind === 'virtual' || outKind === 'molten') continue;

    const totalOutRate =
      step.outputs.find((o) => o.productId === pid)?.ratePer60 ??
      solveResult.summary.netOutputs.find((o) => o.productId === pid)?.ratePer60 ??
      0;
    if (totalOutRate <= 0) continue;

    outputStorageProductIds.add(pid);
    const st = getStorageForProductKind(outKind, totalOutRate);
    const stMachine = MACHINES[st.machineId];
    const prod = PRODUCTS[pid];
    const prodRu = getProductLabel(pid).ru ?? prod?.name ?? pid;
    const rateStr = totalOutRate.toFixed(1).replace(/\.0$/, '');

    outputColumn.push({
      id: `out-storage-${pid}`,
      role: 'output_storage',
      prototype: st.gameId,
      machineId: st.machineId,
      machineNameRu: stMachine ? getMachineLabel(stMachine.id).ru : 'Выходной склад',
      machineIcon: stMachine?.icon ?? `${st.gameId}.png`,
      storedProductId: pid,
      storedProductGameId: PRODUCT_GAME_IDS[pid],
      storedProductNameRu: prodRu,
      storedProductIcon: prod?.icon,
      flowRatePer60: totalOutRate,
      customTitle: `Выход: ${prodRu} (${rateStr}/60с)`,
    });
  }

  // Optional disposal buildings and surplus buffer storages in right column
  const disposalBuildingByProduct = new Map<string, string[]>();
  const adviceList = analyzeByproductsAndStorage(solveResult);
  for (const adv of adviceList) {
    if (
      options.includeDisposalBuildings &&
      adv.disposal &&
      (adv.verdict === 'burn' || adv.verdict === 'vent' || adv.verdict === 'dump')
    ) {
      const d = adv.disposal;
      const count = Math.min(8, Math.max(1, d.ceilMachines));
      const gameRecipeId = RECIPE_GAME_IDS[d.recipeId];
      const dispIds: string[] = [];
      for (let i = 0; i < count; i++) {
        const bid = `disp-${adv.productId}-${i}`;
        dispIds.push(bid);
        outputColumn.push({
          id: bid,
          role: 'disposal',
          prototype: d.machineGameId,
          machineId: d.machineId,
          machineNameRu: d.machineName,
          machineIcon: MACHINES[d.machineId]?.icon,
          recipeId: d.recipeId,
          gameRecipeId,
          recipeNameRu: d.recipeName,
          storedProductId: adv.productId,
          storedProductNameRu: adv.name,
          storedProductIcon: adv.icon,
          flowRatePer60: adv.ratePer60 / count,
          customTitle: `Утилизация: ${adv.name} (${(adv.ratePer60 / count).toFixed(1)}/60с)`,
        });
      }
      disposalBuildingByProduct.set(adv.productId, dispIds);
    }

    if (
      options.includeBufferStorages &&
      adv.storage &&
      (adv.verdict === 'store_mandatory' || adv.verdict === 'store_buffer') &&
      !outputStorageProductIds.has(adv.productId)
    ) {
      const kind = getProductLogisticsKind(adv.productId);
      if (kind !== 'virtual' && kind !== 'molten') {
        const st = getStorageForProductKind(kind, adv.ratePer60);
        const stMachine = MACHINES[st.machineId];
        const prod = PRODUCTS[adv.productId];
        outputStorageProductIds.add(adv.productId);
        outputColumn.push({
          id: `buf-storage-${adv.productId}`,
          role: 'buffer_storage',
          prototype: st.gameId,
          machineId: st.machineId,
          machineNameRu: `${stMachine ? getMachineLabel(stMachine.id).ru : 'Буфер'}`,
          machineIcon: stMachine?.icon ?? `${st.gameId}.png`,
          storedProductId: adv.productId,
          storedProductGameId: PRODUCT_GAME_IDS[adv.productId],
          storedProductNameRu: adv.name,
          storedProductIcon: prod?.icon ?? adv.icon,
          flowRatePer60: adv.ratePer60,
          customTitle: `Буфер: ${adv.name} (${adv.ratePer60.toFixed(1)}/60с)`,
        });
      }
    }
  }

  // Place all columns left-to-right with vertical centering across columns
  const allColumns: ColumnItem[][] = [
    ...(inputColumn.length > 0 ? [inputColumn] : []),
    ...stageColumns,
    ...(outputColumn.length > 0 ? [outputColumn] : []),
  ];

  const colHeights = allColumns.map((col) => {
    let h = 0;
    for (let i = 0; i < col.length; i++) {
      const raw = getRawBuildingLayout(col[i].prototype);
      const custom = customPlacements[col[i].id];
      const rot = normalizeRotIndex(custom?.rotIndex ?? 0);
      const bh = rot % 2 === 1 ? raw.w : raw.h;
      h += bh + (i > 0 ? GAP_Y : 0);
    }
    return h;
  });
  const maxColHeight = Math.max(0, ...colHeights);

  let curX = START_X;

  for (let c = 0; c < allColumns.length; c++) {
    const col = allColumns[c];
    let colMaxW = 0;
    for (const item of col) {
      const raw = getRawBuildingLayout(item.prototype);
      const custom = customPlacements[item.id];
      const rot = normalizeRotIndex(custom?.rotIndex ?? 0);
      const bw = rot % 2 === 1 ? raw.h : raw.w;
      if (bw > colMaxW) colMaxW = bw;
    }

    // Center shorter columns vertically relative to the tallest column for cleaner manifold routing
    let curY = START_Y + Math.max(0, Math.floor((maxColHeight - colHeights[c]) / 2));

    for (const item of col) {
      const placed = makePlacedBuilding(
        item,
        curX,
        curY,
        customPlacements[item.id],
      );
      buildings.push(placed);
      curY += placed.height + GAP_Y;
    }

    curX += colMaxW + CORRIDOR_X;
  }

  const buildingById = new Map(buildings.map((b) => [b.id, b]));
  const portUsage = new Map<string, number>();
  let routeCounter = 0;

  const connectPair = (
    src: PlacedGridBuilding,
    dst: PlacedGridBuilding,
    productId: string,
    ratePer60: number,
    preferSourceY?: number,
  ) => {
    const kind = getProductLogisticsKind(productId);
    if (kind === 'virtual') return;

    const sp = pickBestPort(src.ports, false, kind, portUsage, src.id, dst.minY + Math.floor(dst.height / 2));
    const dp = pickBestPort(dst.ports, true, kind, portUsage, dst.id, preferSourceY ?? (src.minY + Math.floor(src.height / 2)));
    if (!sp || !dp) return;

    portUsage.set(`${src.id}:${sp.name}`, (portUsage.get(`${src.id}:${sp.name}`) ?? 0) + 1);
    portUsage.set(`${dst.id}:${dp.name}`, (portUsage.get(`${dst.id}:${dp.name}`) ?? 0) + 1);

    // Pick a dedicated vertical lane in the corridor right outside source building
    const laneOffset = 2 + (routeCounter % 5);
    const defaultCorridorX =
      dst.minX > src.minX + src.width
        ? Math.round((src.minX + src.width + dst.minX) / 2) + ((routeCounter % 3) - 1)
        : src.minX + src.width + laneOffset;
    const detourY = Math.min(src.minY, dst.minY) - 2 - (routeCounter % 3);

    const routed = routePortToPort(sp, dp, defaultCorridorX, detourY);
    if (!routed) return;

    const prod = PRODUCTS[productId];
    const prodRu = getProductLabel(productId).ru ?? prod?.name ?? productId;
    const protoId = getTransportProtoForFlow(kind, ratePer60);

    routes.push({
      id: `route-${routeCounter++}`,
      protoId,
      iconUrl: getTransportIconForKind(kind, ratePer60),
      kind,
      productId,
      productNameRu: prodRu,
      productIcon: prod?.icon,
      ratePer60,
      fromBuildingId: src.id,
      fromPortName: sp.name,
      toBuildingId: dst.id,
      toPortName: dp.name,
      startDir: routed.startDir,
      endDir: routed.endDir,
      pivots: routed.pivots,
      color: kind === 'fluid' ? PIPE_MAIN_COLOR : BELT_MAIN_COLOR,
      accentColor: kind === 'fluid' ? PIPE_ACCENT_COLOR : BELT_ACCENT_COLOR,
    });
  };

  // 4. Route Input Storages -> Raw-consuming Machine instances
  for (const step of solveResult.steps) {
    if (step.kind !== 'recipe') continue;
    const dstIds = stepBuildingIds.get(step.stepId) ?? [];
    if (dstIds.length === 0) continue;

    for (const inp of step.inputs) {
      if (inp.sourceType !== 'raw' || VIRTUAL_PRODUCT_IDS.has(inp.productId)) continue;
      const srcStorage = buildingById.get(`in-storage-${inp.productId}`);
      if (!srcStorage) continue;

      const perMachineRate = inp.ratePer60 / dstIds.length;
      for (const dId of dstIds) {
        const dstBld = buildingById.get(dId);
        if (dstBld) {
          connectPair(srcStorage, dstBld, inp.productId, perMachineRate);
        }
      }
    }
  }

  // 5. Route Machine -> Downstream Machine edges from solver DAG
  for (const edge of solveResult.edges) {
    if (edge.isCycle) continue;
    if (VIRTUAL_PRODUCT_IDS.has(edge.productId)) continue;
    const srcIds = stepBuildingIds.get(edge.sourceStepId) ?? [];
    const dstIds = stepBuildingIds.get(edge.targetStepId) ?? [];
    if (srcIds.length === 0 || dstIds.length === 0) continue;

    const lanes = Math.max(srcIds.length, dstIds.length);
    const perLaneRate = edge.ratePer60 / lanes;
    for (let i = 0; i < lanes; i++) {
      const sBld = buildingById.get(srcIds[i % srcIds.length]);
      const dBld = buildingById.get(dstIds[i % dstIds.length]);
      if (sBld && dBld) {
        connectPair(sBld, dBld, edge.productId, perLaneRate);
      }
    }
  }

  // 6. Route Target Machine outputs -> Output Storages (right side) & Byproducts -> Buffer/Disposal
  for (const step of solveResult.steps) {
    if (step.kind !== 'recipe') continue;
    const srcIds = stepBuildingIds.get(step.stepId) ?? [];
    if (srcIds.length === 0) continue;

    if (step.isTarget) {
      const dstOut = buildingById.get(`out-storage-${step.primaryProductId}`);
      const targetOut = step.outputs.find((o) => o.productId === step.primaryProductId);
      if (dstOut && targetOut) {
        const perUnit = targetOut.ratePer60 / srcIds.length;
        for (const sId of srcIds) {
          const sBld = buildingById.get(sId);
          if (sBld) connectPair(sBld, dstOut, step.primaryProductId, perUnit);
        }
      }
    }

    // Connect surplus byproducts to disposal or buffer storages
    for (const sup of step.surplusOutputs) {
      if (sup.ratePer60 <= 0.01 || VIRTUAL_PRODUCT_IDS.has(sup.productId)) continue;
      const dispIds = disposalBuildingByProduct.get(sup.productId);
      if (dispIds && dispIds.length > 0) {
        const lanes = Math.max(srcIds.length, dispIds.length);
        for (let i = 0; i < lanes; i++) {
          const sBld = buildingById.get(srcIds[i % srcIds.length]);
          const dBld = buildingById.get(dispIds[i % dispIds.length]);
          if (sBld && dBld) connectPair(sBld, dBld, sup.productId, sup.ratePer60 / lanes);
        }
        continue;
      }

      const bufBld = buildingById.get(`buf-storage-${sup.productId}`);
      if (bufBld) {
        const perUnit = sup.ratePer60 / srcIds.length;
        for (const sId of srcIds) {
          const sBld = buildingById.get(sId);
          if (sBld) connectPair(sBld, bufBld, sup.productId, perUnit);
        }
      }
    }
  }

  // Compute grid bounds including all buildings and transport pivots
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of buildings) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.minX + b.width - 1 > maxX) maxX = b.minX + b.width - 1;
    if (b.minY + b.height - 1 > maxY) maxY = b.minY + b.height - 1;
  }
  for (const rt of routes) {
    for (const [px, py] of rt.pivots) {
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 20;
    maxY = 20;
  }

  return {
    buildings,
    routes,
    bounds: { minX, minY, maxX, maxY },
    unmappedRecipes,
    inputStoragesCount: buildings.filter((b) => b.role === 'input_storage').length,
    outputStoragesCount: buildings.filter((b) => b.role === 'output_storage').length,
    transportCount: routes.length,
  };
}
