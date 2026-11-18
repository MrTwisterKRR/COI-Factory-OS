import { gzip, ungzip } from 'pako';
import {
  GAME_ID_TO_PRODUCT_ID,
  GAME_ID_TO_RECIPE_ID,
  MACHINES,
  MACHINE_BY_GAME_ID,
  PRODUCTS,
  RECIPES,
  getMachineLabel,
  getProductLabel,
  getRecipeLabel,
  getTransportIconForKind,
} from '../data';
import {
  getBuildingOccupiedBox,
  getBuildingWorldPorts,
  normalizeRotIndex,
} from '../data/buildingLayouts';
import type {
  FactoryPlanConfig,
  LogisticsSummary,
  ProductionTarget,
  SolveResult,
} from '../types/coi';
import {
  type CompactGridPlan,
  type CustomTilePlacement,
  type GridTransportRoute,
  type PlacedGridBuilding,
  buildCompactGridLayout,
} from './blueprintGridPlanner';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

class BlobWriter {
  private buf: number[] = [];
  private stringTable: string[] = [];
  private stringIndex = new Map<string, number>();

  constructor() {
    // Index 0 is reserved for null by Mafi.Serialization.BlobWriter
    this.stringTable.push('');
  }

  writeByte(b: number): void {
    this.buf.push(b & 0xff);
  }

  writeBool(v: boolean): void {
    this.writeByte(v ? 1 : 0);
  }

  writeUInt(val: number): void {
    let v = val >>> 0;
    while (v >= 0x80) {
      this.buf.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.buf.push(v);
  }

  writeInt(val: number): void {
    const i = val | 0;
    const zigzag = ((i << 1) ^ (i >> 31)) >>> 0;
    this.writeUInt(zigzag);
  }

  writeString(str: string | null | undefined): void {
    if (str == null) {
      this.writeUInt(0);
      return;
    }
    const existing = this.stringIndex.get(str);
    if (existing !== undefined) {
      this.writeUInt(existing);
      return;
    }
    const ref = this.stringTable.length;
    this.stringTable.push(str);
    this.stringIndex.set(str, ref);
    this.writeUInt(ref);
    const bytes = textEncoder.encode(str);
    this.writeUInt(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      this.buf.push(bytes[i]);
    }
  }

  writeByteArray(bytes: Uint8Array): void {
    this.writeUInt(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      this.buf.push(bytes[i]);
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf);
  }
}

class BlobReader {
  private bytes: Uint8Array;
  private pos = 0;
  private stringTable: (string | null)[] = [null];

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  readByte(): number {
    if (this.pos >= this.bytes.length) {
      throw new Error(`Unexpected EOF at 0x${this.pos.toString(16)}`);
    }
    return this.bytes[this.pos++];
  }

  readBool(): boolean {
    return this.readByte() !== 0;
  }

  readUInt(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const b = this.readByte();
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  readInt(): number {
    const n = this.readUInt();
    return (n >>> 1) ^ -(n & 1);
  }

  readString(): string | null {
    const ref = this.readUInt();
    if (ref === this.stringTable.length) {
      const len = this.readUInt();
      const slice = this.bytes.subarray(this.pos, this.pos + len);
      this.pos += len;
      const str = textDecoder.decode(slice);
      this.stringTable.push(str);
      return str;
    }
    if (ref < this.stringTable.length) {
      return this.stringTable[ref];
    }
    throw new Error(`Invalid string table ref ${ref}`);
  }

  readByteArray(): Uint8Array {
    const len = this.readUInt();
    const slice = this.bytes.slice(this.pos, this.pos + len);
    this.pos += len;
    return slice;
  }
}

function encodeTransform(
  x: number,
  y: number,
  z = 0,
  rotation = 0,
  reflected = false,
): Uint8Array {
  const tw = new BlobWriter();
  tw.writeInt(x);
  tw.writeInt(y);
  tw.writeInt(z);
  tw.writeInt(rotation);
  tw.writeBool(reflected);
  return tw.toUint8Array();
}

function decodeTransform(bytes: Uint8Array): {
  x: number;
  y: number;
  z: number;
  rotIndex: 0 | 1 | 2 | 3;
  reflected: boolean;
} {
  const r = new BlobReader(bytes);
  const x = r.readInt();
  const y = r.readInt();
  const z = r.readInt();
  const rotIndex = normalizeRotIndex(r.readInt());
  const reflected = r.readBool();
  return { x, y, z, rotIndex, reflected };
}

function encodeTrajectory(
  startDir: [number, number, number],
  endDir: [number, number, number],
  pivots: [number, number, number][],
): Uint8Array {
  const tw = new BlobWriter();
  tw.writeInt(startDir[0]);
  tw.writeInt(startDir[1]);
  tw.writeInt(startDir[2]);
  tw.writeInt(endDir[0]);
  tw.writeInt(endDir[1]);
  tw.writeInt(endDir[2]);
  tw.writeUInt(pivots.length);
  for (const [x, y, z] of pivots) {
    tw.writeInt(x);
    tw.writeInt(y);
    tw.writeInt(z);
  }
  return tw.toUint8Array();
}

function decodeTrajectory(bytes: Uint8Array): {
  startDir: [number, number, number];
  endDir: [number, number, number];
  pivots: [number, number, number][];
} {
  const r = new BlobReader(bytes);
  const startDir: [number, number, number] = [r.readInt(), r.readInt(), r.readInt()];
  const endDir: [number, number, number] = [r.readInt(), r.readInt(), r.readInt()];
  const len = r.readUInt();
  const pivots: [number, number, number][] = [];
  for (let i = 0; i < len; i++) {
    pivots.push([r.readInt(), r.readInt(), r.readInt()]);
  }
  return { startDir, endDir, pivots };
}

function writeBuildingEntityConfig(
  w: BlobWriter,
  originalId: number,
  b: PlacedGridBuilding,
): void {
  const isStorage =
    b.role === 'input_storage' ||
    b.role === 'output_storage' ||
    b.role === 'buffer_storage' ||
    b.prototype.startsWith('Storage');

  if (b.role === 'junction' || b.role === 'lift') {
    // Minimal MiniZip / Lift IoPortShape entity (OriginalEntityId + Prototype + Transform)
    w.writeUInt(1);
    w.writeString('OriginalEntityId');
    w.writeInt(originalId);
    w.writeUInt(0); // bools
    w.writeUInt(1); // strings
    w.writeString('Prototype');
    w.writeString(b.prototype);
    w.writeUInt(0); // stringArrays
    w.writeUInt(1); // byteArrays
    w.writeString('Transform');
    w.writeByteArray(encodeTransform(b.tx, b.ty, b.tz, b.rotIndex, b.reflected));
    return;
  }

  if (isStorage) {
    const isInput = b.role === 'input_storage';
    // 1. integers dict: OriginalEntityId + Storage logistics configuration
    w.writeUInt(7);
    w.writeString('OriginalEntityId');
    w.writeInt(originalId);
    w.writeString('StorageImportUntilPercent');
    w.writeInt(isInput ? 100000 : 0);
    w.writeString('StorageExportFromPercent');
    w.writeInt(isInput ? 0 : 100000);
    w.writeString('StorageTransportFromPercent');
    w.writeInt(0);
    w.writeString('StorageTransportUntilPercent');
    w.writeInt(100000);
    w.writeString('StorageImportPriority');
    w.writeInt(8);
    w.writeString('StorageExportPriority');
    w.writeInt(8);

    // 2. booleans dict
    w.writeUInt(3);
    w.writeString('IsLogisticsInputDisabled');
    w.writeBool(!isInput);
    w.writeString('IsLogisticsOutputDisabled');
    w.writeBool(isInput);
    w.writeString('AllowNonAssignedOutput');
    w.writeBool(false);

    // 3. strings dict
    const strs: [string, string][] = [['Prototype', b.prototype]];
    if (b.storedProductGameId) {
      strs.push(['StorageStoredProduct', b.storedProductGameId]);
    }
    if (b.customTitle) {
      strs.push(['CustomTitle', b.customTitle]);
    }
    w.writeUInt(strs.length);
    for (const [k, v] of strs) {
      w.writeString(k);
      w.writeString(v);
    }

    // 4. stringArrays dict
    w.writeUInt(1);
    w.writeString('AllowedTruckGroups');
    w.writeUInt(0);

    // 5. byteArrays dict
    w.writeUInt(1);
    w.writeString('Transform');
    w.writeByteArray(encodeTransform(b.tx, b.ty, b.tz, b.rotIndex, b.reflected));
    return;
  }

  // Production / disposal entity
  w.writeUInt(4);
  w.writeString('OriginalEntityId');
  w.writeInt(originalId);
  w.writeString('LogisticsInputMode');
  w.writeInt(2);
  w.writeString('LogisticsOutputMode');
  w.writeInt(2);
  w.writeString('GeneralPriority');
  w.writeInt(9);

  w.writeUInt(0); // booleans

  if (b.customTitle) {
    w.writeUInt(2);
    w.writeString('Prototype');
    w.writeString(b.prototype);
    w.writeString('CustomTitle');
    w.writeString(b.customTitle);
  } else {
    w.writeUInt(1);
    w.writeString('Prototype');
    w.writeString(b.prototype);
  }

  if (b.gameRecipeId) {
    w.writeUInt(1);
    w.writeString('Recipes');
    w.writeUInt(1);
    w.writeString(b.gameRecipeId);
  } else {
    w.writeUInt(0);
  }

  w.writeUInt(1);
  w.writeString('Transform');
  w.writeByteArray(encodeTransform(b.tx, b.ty, b.tz, b.rotIndex, b.reflected));
}

function writeTransportEntityConfig(
  w: BlobWriter,
  route: GridTransportRoute,
): void {
  // 1. integers dict: TransportColor + TransportAccentColor
  w.writeUInt(2);
  w.writeString('TransportColor');
  w.writeInt(route.color);
  w.writeString('TransportAccentColor');
  w.writeInt(route.accentColor);

  // 2. booleans dict
  w.writeUInt(0);

  // 3. strings dict
  w.writeUInt(1);
  w.writeString('Prototype');
  w.writeString(route.protoId);

  // 4. stringArrays dict
  w.writeUInt(0);

  // 5. byteArrays dict: Trajectory
  w.writeUInt(1);
  w.writeString('Trajectory');
  w.writeByteArray(
    encodeTrajectory(route.startDir, route.endDir, route.pivots),
  );
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface BlueprintExportOptions {
  includeDisposalBuildings: boolean;
  includeBufferStorages: boolean;
}

export interface BlueprintExportEntry {
  machineId: string;
  machineGameId: string;
  machineNameRu: string;
  recipeId?: string;
  gameRecipeId?: string;
  recipeNameRu?: string;
  count: number;
  kind: 'production' | 'disposal' | 'storage';
}

export interface GeneratedGameBlueprint {
  code: string;
  entityCount: number;
  entries: BlueprintExportEntry[];
  unmappedRecipes: string[];
  gridPlan: CompactGridPlan;
}

export function encodeGridPlanToGameBlueprint(
  gridPlan: CompactGridPlan,
  planName: string,
): GeneratedGameBlueprint {
  const entriesMap = new Map<string, BlueprintExportEntry>();
  for (const b of gridPlan.buildings) {
    if (b.role === 'junction' || b.role === 'lift') continue;
    const kind: BlueprintExportEntry['kind'] =
      b.role === 'disposal'
        ? 'disposal'
        : b.role === 'input_storage' ||
            b.role === 'output_storage' ||
            b.role === 'buffer_storage'
          ? 'storage'
          : 'production';
    const key = `${kind}::${b.prototype}::${b.recipeId ?? ''}::${b.storedProductId ?? ''}`;
    const existing = entriesMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      entriesMap.set(key, {
        machineId: b.machineId ?? b.prototype,
        machineGameId: b.prototype,
        machineNameRu:
          b.role === 'input_storage'
            ? `Вход: ${b.storedProductNameRu ?? b.machineNameRu}`
            : b.role === 'output_storage'
              ? `Выход: ${b.storedProductNameRu ?? b.machineNameRu}`
              : b.role === 'buffer_storage'
                ? `Буфер: ${b.storedProductNameRu ?? b.machineNameRu}`
                : b.role === 'disposal' && b.prototype.startsWith('Storage')
                  ? `Цистерна под слив: ${b.storedProductNameRu ?? b.machineNameRu}`
                  : b.machineNameRu,
        recipeId: b.recipeId,
        gameRecipeId: b.gameRecipeId,
        recipeNameRu: b.recipeNameRu,
        count: 1,
        kind,
      });
    }
  }

  // Build binary payload matching Mafi.Core.Entities.Blueprints.BlueprintsLibrary (v4 header)
  const w = new BlobWriter();
  w.writeUInt(4); // libraryVersion = 4
  w.writeString('0.8.4');
  w.writeUInt(303);
  w.writeString(planName || 'COI Factory OS');
  w.writeString('Создано в калькуляторе COI // Factory OS (со складами и конвейерами)');

  const totalEntityCount = gridPlan.buildings.length + gridPlan.routes.length;
  w.writeUInt(totalEntityCount);

  let nextId = 1000;
  for (const b of gridPlan.buildings) {
    writeBuildingEntityConfig(w, nextId++, b);
  }
  for (const rt of gridPlan.routes) {
    writeTransportEntityConfig(w, rt);
  }

  // Library v4 trailer matching Blueprint.DeserializeForBlueprints:
  // 1) surfaces count = 0, 2) decals count = 0,
  // 3) legacy custom protos count = 0 (libraryVersion 2..5),
  // 4) overlapDeltaX = 0, 5) overlapDeltaY = 0 (libraryVersion >= 4)
  w.writeUInt(0); // surfaces count
  w.writeUInt(0); // decals count
  w.writeUInt(0); // legacy custom protos count
  w.writeInt(0); // overlapDeltaX
  w.writeInt(0); // overlapDeltaY

  const compressed = gzip(w.toUint8Array());
  const b64 = uint8ToBase64(compressed);
  return {
    code: `B${b64.length}:${b64}`,
    entityCount: totalEntityCount,
    entries: [...entriesMap.values()],
    unmappedRecipes: gridPlan.unmappedRecipes,
    gridPlan,
  };
}

export function encodePlanToGameBlueprint(
  solveResult: SolveResult,
  planName: string,
  options: BlueprintExportOptions,
  customPlacements: Record<string, CustomTilePlacement> = {},
): GeneratedGameBlueprint {
  const gridPlan = buildCompactGridLayout(solveResult, options, customPlacements);
  return encodeGridPlanToGameBlueprint(gridPlan, planName);
}

export interface DecodedMachineGroup {
  protoId: string;
  machineId: string | null;
  machineNameRu: string;
  machineIcon?: string;
  recipeGameIds: string[];
  recipeId: string | null;
  recipeNameRu: string | null;
  count: number;
  isTransport: boolean;
}

export interface DecodedGameBlueprint {
  name: string;
  description: string;
  gameVersion: string;
  saveVersion: number;
  libraryVersion: number;
  totalEntities: number;
  transportCount: number;
  machineGroups: DecodedMachineGroup[];
  gridPlan: CompactGridPlan;
}

const TRANSPORT_PROTO_PREFIXES = [
  'FlatConveyor',
  'LooseMaterialConveyor',
  'PipeT',
  'MoltenMetalChannel',
  'Shaft',
  'MiniZip',
  'Zipper',
  'LiftIoPort',
  'Transport',
  'Straight',
  'Turn',
  'Slope',
  'TrainLevelCrossing',
];

function inferTransportKindFromProto(
  protoId: string,
): Exclude<LogisticsSummary['kind'], 'virtual'> {
  if (protoId.startsWith('Pipe')) return 'fluid';
  if (protoId.startsWith('Molten')) return 'molten';
  if (protoId.startsWith('Loose')) return 'loose';
  return 'flat';
}

export function decodeGameBlueprint(rawCode: string): DecodedGameBlueprint {
  const trimmed = rawCode.trim();
  const match = trimmed.match(/^([BF])(\d+):(.+)$/s);
  const b64 = (match ? match[3] : trimmed).replace(/\s+/g, '');
  if (match && match[1] === 'F') {
    throw new Error('Поддерживаются одиночные чертежи (B...), а не папки (F...)');
  }

  const compressed = base64ToUint8(b64);
  const rawBytes = ungzip(compressed);
  const r = new BlobReader(rawBytes);

  const libraryVersion = r.readUInt();
  // Blueprints exported with libraryVersion >= 7 store loadedSaveVersion before Blueprint header
  if (libraryVersion >= 7) {
    r.readUInt();
  }
  const gameVersion = r.readString() ?? '';
  const saveVersion = r.readUInt();
  const name = r.readString() ?? 'Без названия';
  const description = r.readString() ?? '';
  const count = r.readUInt();

  const groupsMap = new Map<string, DecodedMachineGroup>();
  const buildings: PlacedGridBuilding[] = [];
  const routes: GridTransportRoute[] = [];
  let transportCount = 0;

  for (let i = 0; i < count; i++) {
    const ints: Record<string, number> = {};
    let n = r.readUInt();
    for (let j = 0; j < n; j++) {
      const k = r.readString() ?? '';
      ints[k] = r.readInt();
    }
    n = r.readUInt();
    for (let j = 0; j < n; j++) {
      r.readString();
      r.readBool();
    }
    const strings: Record<string, string | null> = {};
    n = r.readUInt();
    for (let j = 0; j < n; j++) {
      const k = r.readString() ?? '';
      strings[k] = r.readString();
    }
    const stringArrays: Record<string, (string | null)[]> = {};
    n = r.readUInt();
    for (let j = 0; j < n; j++) {
      const k = r.readString() ?? '';
      const arrLen = r.readUInt();
      const arr: (string | null)[] = [];
      for (let m = 0; m < arrLen; m++) arr.push(r.readString());
      stringArrays[k] = arr;
    }
    const byteArrays: Record<string, Uint8Array> = {};
    n = r.readUInt();
    for (let j = 0; j < n; j++) {
      const k = r.readString() ?? '';
      byteArrays[k] = r.readByteArray();
    }

    const protoId = strings['Prototype'] ?? 'Unknown';
    const isTransport = TRANSPORT_PROTO_PREFIXES.some((pref) =>
      protoId.startsWith(pref),
    );

    if (byteArrays['Trajectory']) {
      try {
        const traj = decodeTrajectory(byteArrays['Trajectory']);
        const kind = inferTransportKindFromProto(protoId);
        const maxZ = traj.pivots.reduce((m, p) => Math.max(m, p[2]), 0);
        routes.push({
          id: `dec-rt-${i}`,
          protoId,
          iconUrl: getTransportIconForKind(kind, 60),
          kind,
          zLevel: maxZ,
          ratePer60: 60,
          startDir: traj.startDir,
          endDir: traj.endDir,
          pivots: traj.pivots,
          color: ints['TransportColor'] ?? -2139062017,
          accentColor: ints['TransportAccentColor'] ?? 858993663,
        });
      } catch {
        // skip malformed trajectory
      }
    } else if (byteArrays['Transform']) {
      try {
        const tf = decodeTransform(byteArrays['Transform']);
        const machine = MACHINE_BY_GAME_ID[protoId];
        const gameRecipes = (stringArrays['Recipes'] ?? []).filter(
          (x): x is string => Boolean(x),
        );
        const primaryGameRecipe = gameRecipes[0] ?? '';
        const recipeId = primaryGameRecipe
          ? GAME_ID_TO_RECIPE_ID[primaryGameRecipe] ?? null
          : null;
        const storedProdGameId = strings['StorageStoredProduct'] ?? undefined;
        const storedProdId = storedProdGameId
          ? GAME_ID_TO_PRODUCT_ID[storedProdGameId]
          : undefined;
        const storedProd = storedProdId ? PRODUCTS[storedProdId] : undefined;
        const customTitle = strings['CustomTitle'] ?? undefined;
        const isMiniZip = protoId.startsWith('MiniZip') || protoId.startsWith('Zipper');
        const isLift = protoId.startsWith('LiftIoPort');
        const isDownLift = isLift && protoId.includes('__');
        const liftMatch = isLift ? protoId.match(/_(\d+)$/) : null;
        const liftZ = liftMatch ? Number(liftMatch[1]) : 0;
        const box = getBuildingOccupiedBox(
          protoId,
          tf.x,
          tf.y,
          tf.rotIndex,
          tf.reflected,
        );
        const ports = getBuildingWorldPorts(
          protoId,
          tf.x,
          tf.y,
          tf.rotIndex,
          tf.reflected,
          tf.z,
        );
        buildings.push({
          id: `dec-b-${i}`,
          role: isLift
            ? 'lift'
            : isMiniZip
              ? 'junction'
              : customTitle?.startsWith('Вход:')
                ? 'input_storage'
                : customTitle?.startsWith('Выход:')
                  ? 'output_storage'
                  : customTitle?.startsWith('Цистерна под слив:') ||
                      customTitle?.startsWith('Утилизация:')
                    ? 'disposal'
                    : customTitle?.startsWith('Буфер:')
                      ? 'buffer_storage'
                      : 'imported',
          prototype: protoId,
          machineId: machine?.id,
          machineNameRu: machine
            ? getMachineLabel(machine.id).ru
            : isLift
              ? isDownLift
                ? `Спуск конвейера Z${liftZ}→0`
                : `Подъёмник конвейера 0→Z${liftZ}`
              : isMiniZip
                ? 'Соединитель'
                : protoId,
          machineIcon:
            machine?.icon ??
            (isLift ? getTransportIconForKind(inferTransportKindFromProto(protoId), 60) : `${protoId}.png`),
          recipeId: recipeId ?? undefined,
          gameRecipeId: primaryGameRecipe || undefined,
          recipeNameRu: recipeId
            ? getRecipeLabel(recipeId).ru
            : primaryGameRecipe || undefined,
          storedProductId: storedProdId,
          storedProductGameId: storedProdGameId,
          storedProductNameRu: storedProdId
            ? (getProductLabel(storedProdId).ru ?? storedProd?.name)
            : undefined,
          storedProductIcon: storedProd?.icon,
          customTitle,
          tx: tf.x,
          ty: tf.y,
          tz: tf.z,
          rotIndex: tf.rotIndex,
          reflected: tf.reflected,
          minX: box.minX,
          minY: box.minY,
          width: box.width,
          height: box.height,
          ports,
        });
      } catch {
        // skip transform parse error
      }
    }

    if (isTransport) {
      transportCount++;
      continue;
    }

    const gameRecipes = (stringArrays['Recipes'] ?? []).filter(
      (x): x is string => Boolean(x),
    );
    const primaryGameRecipe = gameRecipes[0] ?? '';
    const key = `${protoId}::${primaryGameRecipe}`;

    const machine = MACHINE_BY_GAME_ID[protoId];
    const recipeId = primaryGameRecipe
      ? GAME_ID_TO_RECIPE_ID[primaryGameRecipe] ?? null
      : null;

    const existing = groupsMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      groupsMap.set(key, {
        protoId,
        machineId: machine?.id ?? null,
        machineNameRu: machine ? getMachineLabel(machine.id).ru : protoId,
        machineIcon: machine?.icon,
        recipeGameIds: gameRecipes,
        recipeId,
        recipeNameRu: recipeId ? getRecipeLabel(recipeId).ru : primaryGameRecipe || null,
        count: 1,
        isTransport: false,
      });
    }
  }

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

  const machineGroups = [...groupsMap.values()].sort(
    (a, b) => b.count - a.count,
  );

  return {
    name,
    description,
    gameVersion,
    saveVersion,
    libraryVersion,
    totalEntities: count,
    transportCount,
    machineGroups,
    gridPlan: {
      buildings,
      routes,
      bounds: { minX, minY, maxX, maxY },
      unmappedRecipes: [],
      inputStoragesCount: buildings.filter((b) => b.role === 'input_storage').length,
      outputStoragesCount: buildings.filter((b) => b.role === 'output_storage').length,
      transportCount: routes.length,
    },
  };
}

export function decodedBlueprintToFactoryPlan(
  bp: DecodedGameBlueprint,
): FactoryPlanConfig {
  // Determine which products are produced by machines in this blueprint,
  // and identify terminal outputs (products produced in the blueprint not consumed by other recipes in the blueprint)
  const producedGroups: {
    group: DecodedMachineGroup;
    primaryProductId: string;
    ratePer60: number;
  }[] = [];
  const consumedIds = new Set<string>();
  const recipeOverrides: Record<string, string> = {};

  for (const g of bp.machineGroups) {
    if (!g.recipeId) continue;
    const r = RECIPES[g.recipeId];
    const m = g.machineId ? MACHINES[g.machineId] : undefined;
    if (!r || !m || m.isStorage || m.isMine) continue;

    for (const inp of r.inputs) {
      consumedIds.add(inp.id);
    }

    const primaryOut = r.outputs[0];
    if (primaryOut && primaryOut.quantity > 0) {
      recipeOverrides[primaryOut.id] = r.id;
      const ratePer60 = ((primaryOut.quantity * 60) / r.duration) * g.count;
      producedGroups.push({
        group: g,
        primaryProductId: primaryOut.id,
        ratePer60,
      });
    }
  }

  // Prefer final outputs (not consumed internally by another step in the blueprint)
  let terminalTargets = producedGroups.filter(
    (pg) => !consumedIds.has(pg.primaryProductId),
  );
  if (terminalTargets.length === 0) {
    terminalTargets = producedGroups;
  }

  const targets: ProductionTarget[] = terminalTargets.map((t, idx) => ({
    id: `bp-t-${Date.now()}-${idx}`,
    productId: t.primaryProductId,
    ratePer60: Number(t.ratePer60.toFixed(1)),
    mode: 'machines',
    fixedMachines: t.group.count,
    recipeId: t.group.recipeId ?? undefined,
  }));

  return {
    id: `bp-${Date.now()}`,
    name: bp.name || 'Импорт из чертежа',
    description: `${bp.totalEntities} объектов из игрового чертежа`,
    targets,
    recipeOverrides,
    rawResources: [
      'iron_ore',
      'copper_ore',
      'coal',
      'limestone',
      'sand',
      'wood',
      'crude_oil',
      'water',
    ],
    contractOverrides: {},
    productionBoost: 1,
    roundMachinesUp: true,
  };
}
