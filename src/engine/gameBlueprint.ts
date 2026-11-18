import { gzip, ungzip } from 'pako';
import {
  GAME_ID_TO_RECIPE_ID,
  MACHINES,
  MACHINE_BY_GAME_ID,
  RECIPES,
  RECIPE_GAME_IDS,
  getMachineLabel,
  getProductLabel,
  getRecipeLabel,
} from '../data';
import type {
  FactoryPlanConfig,
  ProductionTarget,
  SolveResult,
} from '../types/coi';
import { analyzeByproductsAndStorage } from './byproductAdvisor';

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

function writeEntityConfig(
  w: BlobWriter,
  opts: {
    originalId: number;
    prototype: string;
    recipes?: string[];
    x: number;
    y: number;
    customTitle?: string;
  },
): void {
  // 1. integers dict: 4 keys (OriginalEntityId, LogisticsInputMode, LogisticsOutputMode, GeneralPriority)
  w.writeUInt(4);
  w.writeString('OriginalEntityId');
  w.writeInt(opts.originalId);
  w.writeString('LogisticsInputMode');
  w.writeInt(2);
  w.writeString('LogisticsOutputMode');
  w.writeInt(2);
  w.writeString('GeneralPriority');
  w.writeInt(9);

  // 2. booleans dict
  w.writeUInt(0);

  // 3. strings dict
  if (opts.customTitle) {
    w.writeUInt(2);
    w.writeString('Prototype');
    w.writeString(opts.prototype);
    w.writeString('CustomTitle');
    w.writeString(opts.customTitle);
  } else {
    w.writeUInt(1);
    w.writeString('Prototype');
    w.writeString(opts.prototype);
  }

  // 4. stringArrays dict
  if (opts.recipes && opts.recipes.length > 0) {
    w.writeUInt(1);
    w.writeString('Recipes');
    w.writeUInt(opts.recipes.length);
    for (const r of opts.recipes) {
      w.writeString(r);
    }
  } else {
    w.writeUInt(0);
  }

  // 5. byteArrays dict
  w.writeUInt(1);
  w.writeString('Transform');
  w.writeByteArray(encodeTransform(opts.x, opts.y, 0, 0, false));
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
}

export function encodePlanToGameBlueprint(
  solveResult: SolveResult,
  planName: string,
  options: BlueprintExportOptions,
): GeneratedGameBlueprint {
  const entries: BlueprintExportEntry[] = [];
  const unmappedRecipes: string[] = [];

  interface PlannedEntity {
    prototype: string;
    recipes?: string[];
    x: number;
    y: number;
  }

  const planned: PlannedEntity[] = [];

  // Place production buildings grouped cleanly in columns by stage depth (upstream on left, targets on right)
  const depths = [...new Set(solveResult.steps.map((s) => s.depth))].sort(
    (a, b) => b - a,
  );
  const depthToCol = new Map<number, number>(depths.map((d, idx) => [d, idx]));
  const colRowCounter = new Map<number, number>();

  for (const step of solveResult.steps) {
    if (step.kind !== 'recipe') continue;
    const machine = MACHINES[step.machineId];
    if (!machine?.game_id || machine.isMine) continue;
    const count = Math.max(1, step.ceilMachines);
    const col = depthToCol.get(step.depth) ?? 0;
    const gameRecipeId = step.recipeId
      ? RECIPE_GAME_IDS[step.recipeId]
      : undefined;

    if (step.recipeId && !gameRecipeId) {
      unmappedRecipes.push(step.recipeId);
    }

    entries.push({
      machineId: machine.id,
      machineGameId: machine.game_id,
      machineNameRu: getMachineLabel(machine.id).ru,
      recipeId: step.recipeId,
      gameRecipeId,
      recipeNameRu: step.recipeName,
      count,
      kind: 'production',
    });

    for (let i = 0; i < count; i++) {
      const row = colRowCounter.get(col) ?? 0;
      colRowCounter.set(col, row + 1);
      planned.push({
        prototype: machine.game_id,
        recipes: gameRecipeId ? [gameRecipeId] : undefined,
        x: col * 18,
        y: row * 12,
      });
    }
  }

  // Optional: Add calculated disposal buildings (flares, smoke stacks, liquid dumps) & buffer storages
  if (options.includeDisposalBuildings || options.includeBufferStorages) {
    const adviceList = analyzeByproductsAndStorage(solveResult);
    const auxCol = depths.length;
    let auxRow = 0;

    for (const adv of adviceList) {
      if (
        options.includeDisposalBuildings &&
        adv.disposal &&
        (adv.verdict === 'burn' || adv.verdict === 'vent' || adv.verdict === 'dump')
      ) {
        const d = adv.disposal;
        const gameRecipeId = RECIPE_GAME_IDS[d.recipeId];
        entries.push({
          machineId: d.machineId,
          machineGameId: d.machineGameId,
          machineNameRu: d.machineName,
          recipeId: d.recipeId,
          gameRecipeId,
          recipeNameRu: d.recipeName,
          count: d.ceilMachines,
          kind: 'disposal',
        });
        for (let i = 0; i < d.ceilMachines; i++) {
          planned.push({
            prototype: d.machineGameId,
            recipes: gameRecipeId ? [gameRecipeId] : undefined,
            x: auxCol * 18,
            y: auxRow++ * 12,
          });
        }
      }

      if (
        options.includeBufferStorages &&
        adv.storage &&
        (adv.verdict === 'store_mandatory' || adv.verdict === 'store_buffer')
      ) {
        const st = adv.storage;
        const stCount = adv.verdict === 'store_mandatory' ? 1 : 1;
        entries.push({
          machineId: st.machineId,
          machineGameId: st.machineGameId,
          machineNameRu: `${st.machineName} (${adv.name})`,
          count: stCount,
          kind: 'storage',
        });
        for (let i = 0; i < stCount; i++) {
          planned.push({
            prototype: st.machineGameId,
            x: (auxCol + 1) * 18,
            y: auxRow++ * 12,
          });
        }
      }
    }
  }

  // Build binary payload matching Mafi.Core.Entities.Blueprints.BlueprintsLibrary (v4 header)
  const w = new BlobWriter();
  w.writeUInt(4); // libraryVersion = 4
  w.writeString('0.8.4');
  w.writeUInt(303);
  w.writeString(planName || 'COI Factory OS');
  w.writeString('Создано в калькуляторе COI // Factory OS');
  w.writeUInt(planned.length);

  let nextId = 1000;
  for (const ent of planned) {
    writeEntityConfig(w, {
      originalId: nextId++,
      prototype: ent.prototype,
      recipes: ent.recipes,
      x: ent.x,
      y: ent.y,
    });
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
    entityCount: planned.length,
    entries,
    unmappedRecipes,
  };
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
  let transportCount = 0;

  for (let i = 0; i < count; i++) {
    let n = r.readUInt();
    for (let j = 0; j < n; j++) {
      r.readString();
      r.readInt();
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
    n = r.readUInt();
    for (let j = 0; j < n; j++) {
      r.readString();
      r.readByteArray();
    }

    const protoId = strings['Prototype'] ?? 'Unknown';
    const isTransport = TRANSPORT_PROTO_PREFIXES.some((pref) =>
      protoId.startsWith(pref),
    );
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
