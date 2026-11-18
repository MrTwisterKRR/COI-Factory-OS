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
  BUILDING_LAYOUTS,
  type WorldPort,
  getBuildingOccupiedBox,
  getBuildingWorldPorts,
  getRawBuildingLayout,
  minCornerToTransformCenter,
  normalizeRotIndex,
} from '../data/buildingLayouts';
import type { LogisticsSummary, SolveResult } from '../types/coi';
import { analyzeByproductsAndStorage } from './byproductAdvisor';

export type PlacedBuildingRole =
  | 'input_storage'
  | 'production'
  | 'output_storage'
  | 'buffer_storage'
  | 'disposal'
  | 'junction'
  | 'lift'
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
  zLevel: number;
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

export function getLiftProtoForKind(
  kind: 'flat' | 'loose',
  zLevel: number,
  isDown: boolean,
): string {
  const z = Math.max(1, Math.min(6, Math.round(zLevel)));
  const sep = isDown ? '__' : '_';
  return kind === 'loose'
    ? `LiftIoPortShape_LooseMaterialConveyor${sep}${z}`
    : `LiftIoPortShape_FlatConveyor${sep}${z}`;
}

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

interface TileBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function countBoxCollisions(pts: Vec3[], boxes: TileBox[]): number {
  if (boxes.length === 0) return 0;
  let hits = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    // Purely vertical segment (only occurs on Pipe outside building walls) doesn't sweep horizontal tiles
    if (a[0] === b[0] && a[1] === b[1]) continue;
    const minX = Math.min(a[0], b[0]);
    const maxX = Math.max(a[0], b[0]);
    const minY = Math.min(a[1], b[1]);
    const maxY = Math.max(a[1], b[1]);
    for (const box of boxes) {
      if (
        maxX >= box.minX &&
        minX <= box.maxX &&
        maxY >= box.minY &&
        minY <= box.maxY
      ) {
        hits++;
      }
    }
  }
  return hits;
}

/**
 * Computes a guaranteed valid orthogonal COI transport trajectory connecting
 * source WorldPort (`sp`) to destination WorldPort (`dp`), supporting elevated `zLevel`.
 * Pipes (`kind === 'fluid'`) bend vertically from `sp.connZ` -> `zLevel` -> `dp.connZ`,
 * whereas conveyors/molten run horizontally at `z = sp.connZ` (`=== dp.connZ === zLevel`).
 */
export function routePortToPort(
  sp: WorldPort,
  dp: WorldPort,
  corridorX: number,
  detourY: number | number[],
  zLevel = 0,
  kind: Exclude<LogisticsSummary['kind'], 'virtual'> = 'flat',
  blockedBoxes: TileBox[] = [],
): { startDir: Vec3; endDir: Vec3; pivots: Vec3[]; zLevel: number } | null {
  const startDir: Vec3 = [-sign(sp.dirX), -sign(sp.dirY), 0];
  const endDir: Vec3 = [-sign(dp.dirX), -sign(dp.dirY), 0];

  const sz = sp.connZ ?? 0;
  const dz = dp.connZ ?? 0;
  if (kind !== 'fluid' && sz !== dz) {
    // Non-fluid conveyors/molten channels cannot bend vertically mid-span without a Lift
    return null;
  }
  const targetZ =
    kind === 'fluid' ? Math.max(zLevel, sz, dz) : sz;

  const p0: Vec3 = [sp.connX, sp.connY, sz];
  const q0: Vec3 = [dp.connX, dp.connY, dz];

  const candidates: Vec3[][] = [];
  const detourList = Array.isArray(detourY) ? detourY : [detourY];

  if (kind === 'fluid' && (sz !== targetZ || dz !== targetZ)) {
    const p0z: Vec3 = [p0[0], p0[1], targetZ];
    const p1z: Vec3 = [
      sp.connX + sign(sp.dirX),
      sp.connY + sign(sp.dirY),
      targetZ,
    ];
    const q1z: Vec3 = [
      dp.connX + sign(dp.dirX),
      dp.connY + sign(dp.dirY),
      targetZ,
    ];
    const q0z: Vec3 = [q0[0], q0[1], targetZ];

    const wrap = (mid: Vec3[]): Vec3[] => {
      const res: Vec3[] = [p0];
      if (sz !== targetZ) res.push(p0z);
      res.push(...mid);
      if (dz !== targetZ) res.push(q0z);
      res.push(q0);
      return res;
    };

    // Direct at elevated targetZ
    candidates.push(wrap([]));
    candidates.push(wrap([[q0z[0], p0z[1], targetZ]]));
    candidates.push(wrap([[p0z[0], q0z[1], targetZ]]));

    // Via corridorX at targetZ (direct & stepped)
    candidates.push(
      wrap([
        [corridorX, p0z[1], targetZ],
        [corridorX, q0z[1], targetZ],
      ]),
    );
    candidates.push(
      wrap([
        p1z,
        [corridorX, p1z[1], targetZ],
        [corridorX, q1z[1], targetZ],
        q1z,
      ]),
    );
    candidates.push(wrap([p1z, [p1z[0], q1z[1], targetZ], q1z]));
    candidates.push(wrap([p1z, [q1z[0], p1z[1], targetZ], q1z]));

    // Alley / bypass detours avoiding buildings
    const xs = [
      corridorX,
      Math.min(p1z[0], q1z[0]) - 2,
      Math.max(p1z[0], q1z[0]) + 2,
    ];
    const ys = [
      ...detourList,
      Math.min(p1z[1], q1z[1]) - 3,
      Math.max(p1z[1], q1z[1]) + 3,
    ];
    for (const mx of xs) {
      for (const my of ys) {
        candidates.push(
          wrap([
            p1z,
            [p1z[0], my, targetZ],
            [mx, my, targetZ],
            [mx, q1z[1], targetZ],
            q1z,
          ]),
        );
        candidates.push(
          wrap([
            p1z,
            [mx, p1z[1], targetZ],
            [mx, my, targetZ],
            [q1z[0], my, targetZ],
            q1z,
          ]),
        );
        candidates.push(
          wrap([
            [p0z[0], my, targetZ],
            [q0z[0], my, targetZ],
          ]),
        );
      }
    }
  } else {
    const z = sz;
    const p1: Vec3 = [sp.connX + sign(sp.dirX), sp.connY + sign(sp.dirY), z];
    const q1: Vec3 = [dp.connX + sign(dp.dirX), dp.connY + sign(dp.dirY), z];

    // 1. Direct orthogonal 2 or 3 pivot connection
    candidates.push([p0, q0]);
    candidates.push([p0, [q0[0], p0[1], z], q0]);
    candidates.push([p0, [p0[0], q0[1], z], q0]);

    // 2. Stepped 1-tile out + corridorX + step into port
    candidates.push([
      p0,
      p1,
      [corridorX, p1[1], z],
      [corridorX, q1[1], z],
      q1,
      q0,
    ]);
    candidates.push([p0, p1, [p1[0], q1[1], z], q1, q0]);
    candidates.push([p0, p1, [q1[0], p1[1], z], q1, q0]);

    // 3. Corridor via Y alleys (avoids building bounding boxes & handles N/S/reversed ports)
    const leftClearX = Math.min(p1[0], q1[0]) - 2;
    const rightClearX = Math.max(p1[0], q1[0]) + 2;
    const lowY = Math.min(p1[1], q1[1]) - 3;
    const highY = Math.max(p1[1], q1[1]) + 3;
    const xs = [corridorX, leftClearX, rightClearX];
    const ys = [...detourList, lowY, highY];
    for (const mx of xs) {
      for (const my of ys) {
        candidates.push([
          p0,
          p1,
          [p1[0], my, z],
          [mx, my, z],
          [mx, q1[1], z],
          q1,
          q0,
        ]);
        candidates.push([
          p0,
          p1,
          [mx, p1[1], z],
          [mx, my, z],
          [q1[0], my, z],
          q1,
          q0,
        ]);
      }
    }
  }

  let best: Vec3[] | null = null;
  let bestScore = Infinity;

  for (const cand of candidates) {
    const valid = simplifyAndValidatePivots(cand, startDir, endDir);
    if (!valid) continue;
    const collisions = countBoxCollisions(valid, blockedBoxes);
    const score = collisions * 10000 + manhattanLen(valid) + valid.length * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = valid;
    }
  }

  if (!best) return null;
  const maxZ = best.reduce((m, pt) => Math.max(m, pt[2]), 0);
  return { startDir, endDir, pivots: best, zLevel: maxZ };
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
  tz = 0,
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
  const ports = getBuildingWorldPorts(
    opts.prototype,
    tx,
    ty,
    rotIndex,
    false,
    tz,
  );
  return {
    ...opts,
    tx,
    ty,
    tz,
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
  building: PlacedGridBuilding,
  wantInput: boolean,
  kind: Exclude<LogisticsSummary['kind'], 'virtual'>,
  productId: string,
  portProductMap: Map<string, string>,
  usageCount: Map<string, number>,
  preferY?: number,
): WorldPort | null {
  const hasRealLayout = Boolean(BUILDING_LAYOUTS[building.prototype]);
  const strictMatches = building.ports.filter(
    (p) => p.isInput === wantInput && p.kind === kind,
  );
  // Only fall back across transport kinds if building uses synthetic FALLBACK_LAYOUT
  const pool =
    strictMatches.length > 0
      ? strictMatches
      : !hasRealLayout
        ? building.ports.filter(
            (p) =>
              p.isInput === wantInput &&
              (p.kind === 'flat' || p.kind === 'loose' || p.kind === 'fluid'),
          )
        : [];
  const candidatePool =
    pool.length > 0
      ? pool
      : !hasRealLayout
        ? building.ports.filter((p) => p.isInput === wantInput)
        : [];

  // Strict per-port material separation: NEVER assign two different productIds to the same port!
  const unmixed = candidatePool.filter((p) => {
    const bound = portProductMap.get(`${building.id}:${p.name}`);
    return bound === undefined || bound === productId;
  });
  if (unmixed.length === 0) return null;

  const isStorage = building.prototype.startsWith('Storage');

  return [...unmixed].sort((a, b) => {
    const ka = `${building.id}:${a.name}`;
    const kb = `${building.id}:${b.name}`;
    const alreadyA = portProductMap.get(ka) === productId ? 1 : 0;
    const alreadyB = portProductMap.get(kb) === productId ? 1 : 0;
    const ua = usageCount.get(ka) ?? 0;
    const ub = usageCount.get(kb) ?? 0;

    if (!isStorage && alreadyA !== alreadyB) {
      // On production machines, reuse the port ALREADY bound to the exact same productId
      // so unassigned ports stay reserved for other distinct ingredients!
      return alreadyB - alreadyA;
    }
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

  const GAP_Y = 5; // 5-tile alley between stacked buildings (supports N/S lifts + cross-column bypasses)
  const CORRIDOR_X = 14; // corridor width: 5 tiles left (lift+lead) + >=5 center lanes + 5 tiles right (lift+lead)
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
      const primaryOut =
        step.outputs.find((o) => o.productId === step.primaryProductId) ?? step.outputs[0];
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
          storedProductNameRu: primaryOut
            ? (getProductLabel(primaryOut.productId).ru ?? primaryOut.name)
            : undefined,
          storedProductIcon: primaryOut?.icon,
          flowRatePer60: perMachineOutRate,
        });
      }
      stepBuildingIds.set(step.stepId, ids);
    }

    if (col.length > 0) stageColumns.push(col);
  }

  // 3. Rightmost column: ALWAYS Output Storages for target outputs + disposal/dump tanks/buffers
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
  // IMPORTANT: Liquid dump ('WasteDump' / 'Сливная труба') only builds on a shoreline in COI,
  // so liquid disposals become Fluid Storage Tanks ('StorageFluid' / 'StorageFluidT2') on the blueprint.
  const disposalBuildingByProduct = new Map<string, string[]>();
  const adviceList = analyzeByproductsAndStorage(solveResult);
  for (const adv of adviceList) {
    if (
      options.includeDisposalBuildings &&
      adv.disposal &&
      (adv.verdict === 'burn' || adv.verdict === 'vent' || adv.verdict === 'dump')
    ) {
      const d = adv.disposal;
      if (adv.verdict === 'dump' || d.machineGameId === 'WasteDump') {
        const st = getStorageForProductKind('fluid', adv.ratePer60);
        const stMachine = MACHINES[st.machineId];
        const prod = PRODUCTS[adv.productId];
        const bid = `disp-tank-${adv.productId}`;
        const rateStr = adv.ratePer60.toFixed(1).replace(/\.0$/, '');
        const stLabel = stMachine ? getMachineLabel(stMachine.id).ru : 'Цистерна';
        outputStorageProductIds.add(adv.productId);
        outputColumn.push({
          id: bid,
          role: 'disposal',
          prototype: st.gameId,
          machineId: st.machineId,
          machineNameRu: `Цистерна под слив (${stLabel})`,
          machineIcon: stMachine?.icon ?? `${st.gameId}.png`,
          storedProductId: adv.productId,
          storedProductGameId: PRODUCT_GAME_IDS[adv.productId],
          storedProductNameRu: adv.name,
          storedProductIcon: prod?.icon ?? adv.icon,
          flowRatePer60: adv.ratePer60,
          customTitle: `Цистерна под слив: ${adv.name} (${rateStr}/60с)`,
        });
        disposalBuildingByProduct.set(adv.productId, [bid]);
      } else {
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
  const buildingColIdx = new Map<string, number>();
  const colRanges: { startX: number; endX: number }[] = [];

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

    const colStartX = curX;
    let curY = START_Y + Math.max(0, Math.floor((maxColHeight - colHeights[c]) / 2));

    for (const item of col) {
      const placed = makePlacedBuilding(
        item,
        curX,
        curY,
        customPlacements[item.id],
      );
      buildings.push(placed);
      buildingColIdx.set(placed.id, c);
      curY += placed.height + GAP_Y;
    }

    colRanges.push({ startX: colStartX, endX: colStartX + colMaxW - 1 });
    curX += colMaxW + CORRIDOR_X;
  }

  // Track occupied ground tiles (to place Lifts safely without collisions) and building AABBs
  const occupiedGroundTiles = new Set<string>();
  const occupied3dTiles = new Set<string>();
  const blockedBoxes: TileBox[] = [];
  let globalMinY = START_Y;
  let globalMaxY = START_Y + maxColHeight;

  for (const b of buildings) {
    const maxX = b.minX + b.width - 1;
    const maxY = b.minY + b.height - 1;
    blockedBoxes.push({ minX: b.minX, minY: b.minY, maxX, maxY });
    if (b.minY < globalMinY) globalMinY = b.minY;
    if (maxY > globalMaxY) globalMaxY = maxY;
    for (let x = b.minX; x <= maxX; x++) {
      for (let y = b.minY; y <= maxY; y++) {
        occupiedGroundTiles.add(`${x},${y}`);
        occupied3dTiles.add(`${x},${y},0`);
      }
    }
  }

  // Collect horizontal Y-alleys between stacked buildings + global top/bottom bypass lanes
  const alleyYSet = new Set<number>([globalMinY - 3, globalMaxY + 3]);
  for (let c = 0; c < allColumns.length; c++) {
    const colBlds = allColumns[c]
      .map((item) => buildings.find((b) => b.id === item.id))
      .filter((b): b is PlacedGridBuilding => Boolean(b))
      .sort((a, b) => a.minY - b.minY);
    for (let i = 1; i < colBlds.length; i++) {
      const prevTop = colBlds[i - 1].minY + colBlds[i - 1].height - 1;
      const curBot = colBlds[i].minY;
      if (curBot - prevTop > 2) {
        alleyYSet.add(Math.floor((prevTop + curBot) / 2));
      }
    }
  }
  const detourAlleyYs = [...alleyYSet].sort((a, b) => a - b);

  // Pass 1: Plan logical connections while strictly preventing DIFFERENT productIds from sharing a port
  interface PlannedConn {
    src: PlacedGridBuilding;
    sp: WorldPort;
    dst: PlacedGridBuilding;
    dp: WorldPort;
    productId: string;
    kind: Exclude<LogisticsSummary['kind'], 'virtual'>;
    ratePer60: number;
    corridorIdx: number;
  }

  const buildingById = new Map(buildings.map((b) => [b.id, b]));
  const portProductMap = new Map<string, string>();
  const portUsage = new Map<string, number>();
  const plannedConns: PlannedConn[] = [];

  const queuePair = (
    src: PlacedGridBuilding,
    dst: PlacedGridBuilding,
    productId: string,
    ratePer60: number,
  ) => {
    const kind = getProductLogisticsKind(productId);
    if (kind === 'virtual') return;

    const sp = pickBestPort(
      src,
      false,
      kind,
      productId,
      portProductMap,
      portUsage,
      dst.minY + Math.floor(dst.height / 2),
    );
    const dp = pickBestPort(
      dst,
      true,
      kind,
      productId,
      portProductMap,
      portUsage,
      src.minY + Math.floor(src.height / 2),
    );
    if (!sp || !dp) return;

    const sk = `${src.id}:${sp.name}`;
    const dk = `${dst.id}:${dp.name}`;
    portProductMap.set(sk, productId);
    portProductMap.set(dk, productId);
    portUsage.set(sk, (portUsage.get(sk) ?? 0) + 1);
    portUsage.set(dk, (portUsage.get(dk) ?? 0) + 1);

    const sc = buildingColIdx.get(src.id) ?? 0;
    const dc = buildingColIdx.get(dst.id) ?? 0;
    // Anchor corridor immediately upstream of destination (guaranteed building-free)
    const corridorIdx = dc > sc ? dc - 1 : Math.max(0, Math.min(sc, colRanges.length - 1));

    plannedConns.push({
      src,
      sp,
      dst,
      dp,
      productId,
      kind,
      ratePer60,
      corridorIdx,
    });
  };

  // 4. Input Storages -> Raw-consuming Machine instances
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
        if (dstBld) queuePair(srcStorage, dstBld, inp.productId, perMachineRate);
      }
    }
  }

  // 5. Machine -> Downstream Machine edges
  for (const edge of solveResult.edges) {
    if (edge.isCycle || VIRTUAL_PRODUCT_IDS.has(edge.productId)) continue;
    const srcIds = stepBuildingIds.get(edge.sourceStepId) ?? [];
    const dstIds = stepBuildingIds.get(edge.targetStepId) ?? [];
    if (srcIds.length === 0 || dstIds.length === 0) continue;

    const lanes = Math.max(srcIds.length, dstIds.length);
    const perLaneRate = edge.ratePer60 / lanes;
    for (let i = 0; i < lanes; i++) {
      const sBld = buildingById.get(srcIds[i % srcIds.length]);
      const dBld = buildingById.get(dstIds[i % dstIds.length]);
      if (sBld && dBld) queuePair(sBld, dBld, edge.productId, perLaneRate);
    }
  }

  // 6. Target Machine -> Output Storages & Byproducts -> Disposal Tanks / Buffers
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
          if (sBld) queuePair(sBld, dstOut, step.primaryProductId, perUnit);
        }
      }
    }

    for (const sup of step.surplusOutputs) {
      if (sup.ratePer60 <= 0.01 || VIRTUAL_PRODUCT_IDS.has(sup.productId)) continue;
      const dispIds = disposalBuildingByProduct.get(sup.productId);
      if (dispIds && dispIds.length > 0) {
        const lanes = Math.max(srcIds.length, dispIds.length);
        for (let i = 0; i < lanes; i++) {
          const sBld = buildingById.get(srcIds[i % srcIds.length]);
          const dBld = buildingById.get(dispIds[i % dispIds.length]);
          if (sBld && dBld) queuePair(sBld, dBld, sup.productId, sup.ratePer60 / lanes);
        }
        continue;
      }

      const bufBld = buildingById.get(`buf-storage-${sup.productId}`);
      if (bufBld) {
        const perUnit = sup.ratePer60 / srcIds.length;
        for (const sId of srcIds) {
          const sBld = buildingById.get(sId);
          if (sBld) queuePair(sBld, bufBld, sup.productId, perUnit);
        }
      }
    }
  }

  // Pass 2: Group connections into material-isolated corridor streams with dedicated (laneX, zLevel)
  interface MaterialStream {
    key: string;
    corridorIdx: number;
    productId: string;
    kind: Exclude<LogisticsSummary['kind'], 'virtual'>;
    conns: PlannedConn[];
    laneX: number;
    zLevel: number;
  }

  const streamMap = new Map<string, MaterialStream>();
  const streamsByCorridor = new Map<number, MaterialStream[]>();

  for (const conn of plannedConns) {
    const sKey = `${conn.corridorIdx}::${conn.productId}`;
    let stream = streamMap.get(sKey);
    if (!stream) {
      stream = {
        key: sKey,
        corridorIdx: conn.corridorIdx,
        productId: conn.productId,
        kind: conn.kind,
        conns: [],
        laneX: 0,
        zLevel: 0,
      };
      streamMap.set(sKey, stream);
      const list = streamsByCorridor.get(conn.corridorIdx) ?? [];
      list.push(stream);
      streamsByCorridor.set(conn.corridorIdx, list);
    }
    stream.conns.push(conn);
  }

  // Assign distinct (laneX, zLevel) per stream within each corridor
  for (const [cIdx, list] of streamsByCorridor.entries()) {
    // Stable sort: molten first (z=0), then flat/loose solids (z=0..4), then fluids above (z=2..5)
    list.sort((a, b) => {
      const rank = (k: MaterialStream['kind']) =>
        k === 'molten' ? 0 : k === 'fluid' ? 2 : 1;
      const dr = rank(a.kind) - rank(b.kind);
      return dr !== 0 ? dr : a.productId.localeCompare(b.productId);
    });

    const leftEndX = colRanges[cIdx]?.endX ?? START_X;
    const rightStartX = colRanges[cIdx + 1]?.startX ?? leftEndX + CORRIDOR_X + 1;
    const laneStart = leftEndX + 5;
    const laneEnd = Math.max(laneStart, rightStartX - 5);
    const laneSpan = Math.max(1, laneEnd - laneStart + 1);

    let solidZCursor = list.some((s) => s.kind === 'molten') ? 1 : 0;
    const usedSolidZs = new Set<number>(solidZCursor === 1 ? [0] : []);
    let nextFluidZ = 2;

    for (let idx = 0; idx < list.length; idx++) {
      const s = list[idx];
      s.laneX = laneStart + (idx % laneSpan);

      if (s.kind === 'molten') {
        s.zLevel = 0;
      } else if (s.kind === 'flat' || s.kind === 'loose') {
        const z = solidZCursor <= 5 ? solidZCursor : 1 + ((solidZCursor - 1) % 5);
        solidZCursor++;
        s.zLevel = z;
        usedSolidZs.add(z);
      } else {
        // Assign fluids elevated pipe rack levels above solid levels where possible
        while (usedSolidZs.has(nextFluidZ) && nextFluidZ <= 5) nextFluidZ++;
        s.zLevel = nextFluidZ > 6 ? 2 + ((idx) % 4) : nextFluidZ;
        nextFluidZ++;
      }
    }
  }

  // Helper: check if 2 ground tiles for a Conveyor Lift next to `port` are completely free
  const canPlaceLiftAtPort = (port: WorldPort): boolean => {
    const t1x = port.connX;
    const t1y = port.connY;
    const t2x = port.connX + sign(port.dirX);
    const t2y = port.connY + sign(port.dirY);
    return (
      !occupiedGroundTiles.has(`${t1x},${t1y}`) &&
      !occupiedGroundTiles.has(`${t2x},${t2y}`)
    );
  };

  // Unify zLevel across solid (flat/loose) streams that share any (buildingId, portName) endpoint
  // so no solid conveyor ever connects two Lifts or MiniZips of different heights.
  {
    const solidStreams = [...streamMap.values()].filter(
      (s) => s.kind === 'flat' || s.kind === 'loose',
    );
    const portToStreams = new Map<string, MaterialStream[]>();
    for (const s of solidStreams) {
      for (const c of s.conns) {
        for (const pk of [`${c.src.id}:${c.sp.name}`, `${c.dst.id}:${c.dp.name}`]) {
          const arr = portToStreams.get(pk) ?? [];
          if (!arr.includes(s)) arr.push(s);
          portToStreams.set(pk, arr);
        }
      }
    }
    const visited = new Set<MaterialStream>();
    for (const seed of solidStreams) {
      if (visited.has(seed)) continue;
      const comp: MaterialStream[] = [];
      const queue: MaterialStream[] = [seed];
      visited.add(seed);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        comp.push(cur);
        for (const c of cur.conns) {
          for (const pk of [`${c.src.id}:${c.sp.name}`, `${c.dst.id}:${c.dp.name}`]) {
            for (const nxt of portToStreams.get(pk) ?? []) {
              if (!visited.has(nxt)) {
                visited.add(nxt);
                queue.push(nxt);
              }
            }
          }
        }
      }

      // Pick the unified Z for this connected solid component and verify all ports can place Lifts if Z > 0
      let unifiedZ = comp[0].zLevel;
      if (unifiedZ > 0) {
        for (const s of comp) {
          for (const c of s.conns) {
            if (!canPlaceLiftAtPort(c.sp) || !canPlaceLiftAtPort(c.dp)) {
              unifiedZ = 0;
              break;
            }
          }
          if (unifiedZ === 0) break;
        }
      }
      for (const s of comp) {
        s.zLevel = unifiedZ;
      }
    }
  }

  // Cache attached Lifts per (buildingId, portName) so each port owns at most 1 Lift
  const liftByPortKey = new Map<
    string,
    { lift: PlacedGridBuilding; elevatedPort: WorldPort; zLevel: number }
  >();

  const attachOrGetLift = (
    bld: PlacedGridBuilding,
    port: WorldPort,
    kind: 'flat' | 'loose',
    zLevel: number,
    isDown: boolean,
    productId: string,
  ): WorldPort => {
    const pk = `${bld.id}:${port.name}`;
    const existing = liftByPortKey.get(pk);
    if (existing) return existing.elevatedPort;

    const dx = sign(port.dirX);
    const dy = sign(port.dirY);
    const t1x = port.connX;
    const t1y = port.connY;

    let minX = t1x;
    let minY = t1y;
    let rotIndex: 0 | 1 | 2 | 3 = 0;
    if (dx === 1 && dy === 0) {
      minX = t1x;
      minY = t1y;
      rotIndex = 0;
    } else if (dx === -1 && dy === 0) {
      minX = t1x - 1;
      minY = t1y;
      rotIndex = 2;
    } else if (dx === 0 && dy === 1) {
      minX = t1x;
      minY = t1y;
      rotIndex = 1;
    } else {
      minX = t1x;
      minY = t1y - 1;
      rotIndex = 3;
    }

    const liftProto = getLiftProtoForKind(kind, zLevel, isDown);
    const prod = PRODUCTS[productId];
    const prodRu = getProductLabel(productId).ru ?? prod?.name ?? productId;
    const liftId = `lift-${isDown ? 'dn' : 'up'}-${bld.id}-${port.name}-z${zLevel}`;

    const lift = makePlacedBuilding(
      {
        id: liftId,
        role: 'lift',
        prototype: liftProto,
        machineNameRu: isDown
          ? `Спуск конвейера Z${zLevel}→0`
          : `Подъёмник конвейера 0→Z${zLevel}`,
        machineIcon: getTransportIconForKind(kind, 60),
        storedProductId: productId,
        storedProductNameRu: prodRu,
        storedProductIcon: prod?.icon,
      },
      minX,
      minY,
      { minX, minY, rotIndex },
      0,
    );

    buildings.push(lift);
    for (let x = lift.minX; x < lift.minX + lift.width; x++) {
      for (let y = lift.minY; y < lift.minY + lift.height; y++) {
        occupiedGroundTiles.add(`${x},${y}`);
        occupied3dTiles.add(`${x},${y},0`);
        occupied3dTiles.add(`${x},${y},${zLevel}`);
      }
    }

    const elevatedPort = lift.ports.find((p) => p.name === 'X') ?? port;
    liftByPortKey.set(pk, { lift, elevatedPort, zLevel });
    return elevatedPort;
  };

  let routeCounter = 0;
  let junctionCounter = 0;

  const pushRoute = (
    kind: Exclude<LogisticsSummary['kind'], 'virtual'>,
    productId: string,
    ratePer60: number,
    fromId: string,
    fromPort: string,
    toId: string,
    toPort: string,
    routed: { startDir: Vec3; endDir: Vec3; pivots: Vec3[]; zLevel: number },
  ) => {
    const prod = PRODUCTS[productId];
    const prodRu = getProductLabel(productId).ru ?? prod?.name ?? productId;
    const protoId = getTransportProtoForFlow(kind, ratePer60);
    routes.push({
      id: `route-${routeCounter++}`,
      protoId,
      iconUrl: getTransportIconForKind(kind, ratePer60),
      kind,
      zLevel: routed.zLevel,
      productId,
      productNameRu: prodRu,
      productIcon: prod?.icon,
      ratePer60,
      fromBuildingId: fromId,
      fromPortName: fromPort,
      toBuildingId: toId,
      toPortName: toPort,
      startDir: routed.startDir,
      endDir: routed.endDir,
      pivots: routed.pivots,
      color: kind === 'fluid' ? PIPE_MAIN_COLOR : BELT_MAIN_COLOR,
      accentColor: kind === 'fluid' ? PIPE_ACCENT_COLOR : BELT_ACCENT_COLOR,
    });
  };

  // Emit Lifts, MiniZip Manifolds (when a port splits/merges), and Routes per stream
  for (const stream of streamMap.values()) {
    let effZ = stream.zLevel;

    // For elevated solid belts (flat/loose with effZ > 0), verify all port ground tiles fit 2x1 Lifts;
    // otherwise safely drop that stream to ground level z = 0
    if ((stream.kind === 'flat' || stream.kind === 'loose') && effZ > 0) {
      const uniquePortKeys = new Set<string>();
      let allFit = true;
      for (const c of stream.conns) {
        const sk = `${c.src.id}:${c.sp.name}`;
        const dk = `${c.dst.id}:${c.dp.name}`;
        if (!uniquePortKeys.has(sk)) {
          uniquePortKeys.add(sk);
          if (!liftByPortKey.has(sk) && !canPlaceLiftAtPort(c.sp)) {
            allFit = false;
            break;
          }
        }
        if (!uniquePortKeys.has(dk)) {
          uniquePortKeys.add(dk);
          if (!liftByPortKey.has(dk) && !canPlaceLiftAtPort(c.dp)) {
            allFit = false;
            break;
          }
        }
      }
      if (!allFit) {
        effZ = 0;
      }
    }

    // Build effective endpoint list (with Up-Lift / Down-Lift attached when effZ > 0 for solids)
    interface EffConn {
      srcId: string;
      srcPortName: string;
      spEff: WorldPort;
      dstId: string;
      dstPortName: string;
      dpEff: WorldPort;
      ratePer60: number;
    }

    const effConns: EffConn[] = [];
    const srcEndpointCounts = new Map<string, number>();
    const dstEndpointCounts = new Map<string, number>();

    for (const c of stream.conns) {
      let spEff = c.sp;
      let dpEff = c.dp;
      let srcId = c.src.id;
      let srcPortName = c.sp.name;
      let dstId = c.dst.id;
      let dstPortName = c.dp.name;

      if ((stream.kind === 'flat' || stream.kind === 'loose') && effZ > 0) {
        spEff = attachOrGetLift(c.src, c.sp, stream.kind, effZ, false, stream.productId);
        const upLift = liftByPortKey.get(`${c.src.id}:${c.sp.name}`)?.lift;
        if (upLift) {
          srcId = upLift.id;
          srcPortName = spEff.name;
        }
        dpEff = attachOrGetLift(c.dst, c.dp, stream.kind, effZ, true, stream.productId);
        const dnLift = liftByPortKey.get(`${c.dst.id}:${c.dp.name}`)?.lift;
        if (dnLift) {
          dstId = dnLift.id;
          dstPortName = dpEff.name;
        }
      }

      const sk = `${srcId}:${srcPortName}`;
      const dk = `${dstId}:${dstPortName}`;
      srcEndpointCounts.set(sk, (srcEndpointCounts.get(sk) ?? 0) + 1);
      dstEndpointCounts.set(dk, (dstEndpointCounts.get(dk) ?? 0) + 1);

      effConns.push({
        srcId,
        srcPortName,
        spEff,
        dstId,
        dstPortName,
        dpEff,
        ratePer60: c.ratePer60,
      });
    }

    const hasSharedEndpoint =
      [...srcEndpointCounts.values()].some((v) => v > 1) ||
      [...dstEndpointCounts.values()].some((v) => v > 1);

    if (!hasSharedEndpoint) {
      // Clean 1-to-1 point-to-point connections
      for (const ec of effConns) {
        const routed = routePortToPort(
          ec.spEff,
          ec.dpEff,
          stream.laneX,
          detourAlleyYs,
          effZ,
          stream.kind,
          blockedBoxes,
        );
        if (routed) {
          pushRoute(
            stream.kind,
            stream.productId,
            ec.ratePer60,
            ec.srcId,
            ec.srcPortName,
            ec.dstId,
            ec.dstPortName,
            routed,
          );
        }
      }
      continue;
    }

    // 1-to-N / N-to-1 / M-to-N within same material:
    // Construct a dedicated MiniZip_IoPortShape_* vertical manifold spine along (laneX, effZ)
    const uniqueSrcMap = new Map<
      string,
      { id: string; portName: string; port: WorldPort; rate: number }
    >();
    const uniqueDstMap = new Map<
      string,
      { id: string; portName: string; port: WorldPort; rate: number }
    >();
    let totalStreamRate = 0;

    for (const ec of effConns) {
      totalStreamRate += ec.ratePer60;
      const sk = `${ec.srcId}:${ec.srcPortName}`;
      const existingSrc = uniqueSrcMap.get(sk);
      if (existingSrc) existingSrc.rate += ec.ratePer60;
      else {
        uniqueSrcMap.set(sk, {
          id: ec.srcId,
          portName: ec.srcPortName,
          port: ec.spEff,
          rate: ec.ratePer60,
        });
      }

      const dk = `${ec.dstId}:${ec.dstPortName}`;
      const existingDst = uniqueDstMap.get(dk);
      if (existingDst) existingDst.rate += ec.ratePer60;
      else {
        uniqueDstMap.set(dk, {
          id: ec.dstId,
          portName: ec.dstPortName,
          port: ec.dpEff,
          rate: ec.ratePer60,
        });
      }
    }

    interface TrunkSlot {
      y: number;
      westUsed: boolean; // Port C (x - 1)
      eastUsed: boolean; // Port A (x + 1)
      mz?: PlacedGridBuilding;
    }

    const trunkSlots: TrunkSlot[] = [];
    const mzProto = getMiniZipProtoForKind(stream.kind);
    const prod = PRODUCTS[stream.productId];
    const prodRu = getProductLabel(stream.productId).ru ?? prod?.name ?? stream.productId;

    const isSlotTileClear = (x: number, y: number): boolean => {
      if (occupied3dTiles.has(`${x},${y},${effZ}`)) return false;
      return !blockedBoxes.some(
        (box) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY,
      );
    };

    const allocSlotForEndpoint = (targetY: number, useWest: boolean): TrunkSlot => {
      // Reuse existing slot if its horizontal side is still free and close to targetY
      const reusable = trunkSlots.find(
        (s) =>
          (useWest ? !s.westUsed : !s.eastUsed) && Math.abs(s.y - targetY) <= 1,
      );
      if (reusable) {
        if (useWest) reusable.westUsed = true;
        else reusable.eastUsed = true;
        return reusable;
      }

      // Otherwise allocate a fresh y separated by >= 3 tiles from any existing trunk MiniZip
      let candY = targetY;
      for (let step = 0; step < 80; step++) {
        const offset = step === 0 ? 0 : (step % 2 === 1 ? 1 : -1) * Math.ceil(step / 2);
        const tryY = targetY + offset * 3;
        const spaced = trunkSlots.every((s) => Math.abs(s.y - tryY) >= 3);
        if (spaced && isSlotTileClear(stream.laneX, tryY)) {
          candY = tryY;
          break;
        }
      }

      const slot: TrunkSlot = {
        y: candY,
        westUsed: useWest,
        eastUsed: !useWest,
      };
      trunkSlots.push(slot);
      return slot;
    };

    const srcAssignments = [...uniqueSrcMap.values()].map((srcItem) => {
      const useWest = srcItem.port.connX <= stream.laneX;
      const slot = allocSlotForEndpoint(srcItem.port.connY, useWest);
      return { srcItem, useWest, slot };
    });

    const dstAssignments = [...uniqueDstMap.values()].map((dstItem) => {
      const useWest = dstItem.port.connX < stream.laneX;
      const slot = allocSlotForEndpoint(dstItem.port.connY, useWest);
      return { dstItem, useWest, slot };
    });

    // Instantiate MiniZip entities on sorted trunk slots
    trunkSlots.sort((a, b) => a.y - b.y);
    for (const slot of trunkSlots) {
      const mzId = `mz-${junctionCounter++}`;
      const mz = makePlacedBuilding(
        {
          id: mzId,
          role: 'junction',
          prototype: mzProto,
          machineNameRu: `Разделитель Z${effZ} (${prodRu})`,
          machineIcon: getTransportIconForKind(stream.kind, totalStreamRate),
          storedProductId: stream.productId,
          storedProductNameRu: prodRu,
          storedProductIcon: prod?.icon,
        },
        stream.laneX,
        slot.y,
        { minX: stream.laneX, minY: slot.y, rotIndex: 0 },
        effZ,
      );
      slot.mz = mz;
      buildings.push(mz);
      occupied3dTiles.add(`${stream.laneX},${slot.y},${effZ}`);
      if (effZ === 0) occupiedGroundTiles.add(`${stream.laneX},${slot.y}`);
    }

    // Connect consecutive MiniZips vertically along the trunk spine (Port B North -> Port D South)
    for (let i = 0; i + 1 < trunkSlots.length; i++) {
      const lo = trunkSlots[i].mz!;
      const hi = trunkSlots[i + 1].mz!;
      const loNorth = lo.ports.find((p) => p.name === 'B')!;
      const hiSouth = hi.ports.find((p) => p.name === 'D')!;
      const spine = routePortToPort(
        loNorth,
        hiSouth,
        stream.laneX,
        detourAlleyYs,
        effZ,
        stream.kind,
        [],
      );
      if (spine) {
        pushRoute(
          stream.kind,
          stream.productId,
          totalStreamRate,
          lo.id,
          'B',
          hi.id,
          'D',
          spine,
        );
      }
    }

    // Connect each unique source -> its assigned MiniZip side port
    for (const { srcItem, useWest, slot } of srcAssignments) {
      const mz = slot.mz!;
      const portName = useWest ? 'C' : 'A';
      const mzPort = mz.ports.find((p) => p.name === portName)!;
      const midX = Math.round((srcItem.port.connX + mzPort.connX) / 2);
      const routed = routePortToPort(
        srcItem.port,
        mzPort,
        midX,
        detourAlleyYs,
        effZ,
        stream.kind,
        blockedBoxes,
      );
      if (routed) {
        pushRoute(
          stream.kind,
          stream.productId,
          srcItem.rate,
          srcItem.id,
          srcItem.portName,
          mz.id,
          portName,
          routed,
        );
      }
    }

    // Connect each MiniZip side port -> its unique destination
    for (const { dstItem, useWest, slot } of dstAssignments) {
      const mz = slot.mz!;
      const portName = useWest ? 'C' : 'A';
      const mzPort = mz.ports.find((p) => p.name === portName)!;
      const midX = Math.round((mzPort.connX + dstItem.port.connX) / 2);
      const routed = routePortToPort(
        mzPort,
        dstItem.port,
        midX,
        detourAlleyYs,
        effZ,
        stream.kind,
        blockedBoxes,
      );
      if (routed) {
        pushRoute(
          stream.kind,
          stream.productId,
          dstItem.rate,
          mz.id,
          portName,
          dstItem.id,
          dstItem.portName,
          routed,
        );
      }
    }
  }

  // Compute grid bounds including all buildings, lifts, junctions, and transport pivots
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
