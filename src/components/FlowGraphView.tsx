import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import {
  Anchor,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  Boxes,
  ChevronDown,
  GitBranch,
  Layers,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pickaxe,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';
import type {
  FactoryPlanConfig,
  LogisticsSummary,
  RateUnit,
  SolveResult,
  SolvedStep,
  UnlockedGameFilter,
} from '../types/coi';
import {
  CONTRACTS_BY_ID,
  CONTRACTS_FOR_PRODUCT,
  MACHINES,
  NATURAL_RAW_PRODUCT_IDS,
  PRODUCTS,
  RECIPES,
  VIRTUAL_PRODUCT_IDS,
  computeLogistics,
  getDownstreamExtensions,
  getMachineIconUrl,
  getMachineLabel,
  getProductIconUrl,
  getProductLabel,
  getProductLogisticsKind,
  getRecipeLabel,
  getTransportIconForKind,
} from '../data';
import { getProducingRecipes } from '../engine/solver';
import { formatNumber, formatPower, formatRate } from '../utils/format';
import { cn } from '../utils/cn';

type GraphSubMode = 'dag' | 'bus';

const MAX_SPLIT_TILES_PER_STEP = 16;

interface RecipeNodeData extends Record<string, unknown> {
  step: SolvedStep;
  unitIndex: number;
  unitCount: number;
  isSplitTile: boolean;
  unitLoadFactor: number; // 1.0 for full unit or grouped, <1 for partial last unit, >1 if >16 clamped
  rateUnit: RateUnit;
  direction: 'LR' | 'TB';
  compact: boolean;
  rawSet: Set<string>;
  onOpenRecipeModal: (productId: string, step?: SolvedStep) => void;
  onOpenExtendModal: (productId: string, availableRate60: number) => void;
  onToggleRawResource: (productId: string) => void;
}

interface RawNodeData extends Record<string, unknown> {
  productId: string;
  ratePer60: number;
  beltLabel?: string;
  rateUnit: RateUnit;
  direction: 'LR' | 'TB';
  kind: LogisticsSummary['kind'];
  hasSourceAlternatives: boolean;
  onOpenSourceModal: (productId: string) => void;
}

interface FlowEdgeData extends Record<string, unknown> {
  productId: string;
  ratePer60: number;
  rateUnit: RateUnit;
  isCycle: boolean;
  isRaw: boolean;
  kind: LogisticsSummary['kind'];
  beltLabel?: string;
}

const EDGE_COLORS: Record<LogisticsSummary['kind'], string> = {
  flat: '#10b981', // emerald
  loose: '#f59e0b', // amber
  fluid: '#06b6d4', // cyan
  molten: '#f97316', // orange
  virtual: '#8b5cf6', // violet
};

const RecipeFlowNode: React.FC<NodeProps<Node<RecipeNodeData>>> = ({
  data,
  selected,
}) => {
  const {
    step,
    unitIndex,
    unitCount,
    isSplitTile,
    unitLoadFactor,
    rateUnit,
    direction,
    compact,
    rawSet,
    onOpenRecipeModal,
    onOpenExtendModal,
    onToggleRawResource,
  } = data;

  const isLR = direction === 'LR';
  const primary = getProductLabel(step.primaryProductId);
  const altCount =
    step.alternativeRecipeIds.length + step.alternativeContractIds.length;
  const hasAlternatives =
    altCount > 1 ||
    step.alternativeContractIds.length > 0 ||
    !step.isTarget;

  // Rate multiplier per tile:
  // If grouped: 1.0 * step total (inp.ratePer60).
  // If split: scale by (unitLoadFactor / step.exactMachines) when exactMachines > 0
  const flowScale =
    isSplitTile && step.exactMachines > 0
      ? unitLoadFactor / step.exactMachines
      : 1;

  const unitLoadPct = Math.round(unitLoadFactor * 100);
  const tilePowerKw =
    step.exactMachines > 0
      ? (step.electricityConsumedKw / Math.max(1, step.ceilMachines))
      : step.electricityConsumedKw;

  return (
    <div
      className={cn(
        'cursor-grab active:cursor-grabbing rounded-xl border bg-[#121214] text-zinc-100 shadow-2xl transition-colors duration-150',
        compact ? 'w-[280px] p-2.5' : 'w-[312px] p-3',
        selected
          ? 'border-emerald-400 ring-2 ring-emerald-500/30'
          : step.isTarget
            ? 'border-emerald-500/50 ring-1 ring-emerald-500/20'
            : step.kind === 'contract'
              ? 'border-violet-500/40'
              : 'border-white/[0.12]',
      )}
    >
      {!isLR && (
        <>
          <Handle
            type="target"
            position={Position.Top}
            id="in-default"
            className="!h-2.5 !w-2.5 !border-2 !border-[#09090b] !bg-emerald-400"
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="out-default"
            className="!h-2.5 !w-2.5 !border-2 !border-[#09090b] !bg-emerald-400"
          />
        </>
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={getMachineIconUrl(step.machineIcon)}
            alt={step.machineName}
            className="h-8 w-8 shrink-0 rounded-md border border-white/[0.08] bg-[#09090b] p-0.5 object-contain"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-xs font-semibold text-zinc-100 leading-tight">
                {step.machineName}
              </span>
              {isSplitTile && (
                <span className="shrink-0 rounded bg-white/[0.08] px-1 py-0.2 font-mono text-[10px] font-semibold text-zinc-300">
                  #{unitIndex + 1}
                  {unitCount < step.ceilMachines && unitIndex === unitCount - 1
                    ? `..${step.ceilMachines}`
                    : ''}
                </span>
              )}
            </div>
            <div className="truncate text-[10px] text-zinc-400">
              {primary.ru ?? primary.en}
              {tilePowerKw > 0 && (
                <span className="ml-1.5 font-mono text-amber-300/90">
                  • {formatPower(isSplitTile ? tilePowerKw : step.electricityConsumedKw)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end shrink-0">
          {isSplitTile ? (
            <>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[11px] font-bold tabular-nums',
                  unitLoadPct >= 99
                    ? 'bg-emerald-500/15 text-emerald-300'
                    : 'bg-amber-500/15 text-amber-300',
                )}
              >
                {unitLoadPct}%
              </span>
              <span className="mt-0.5 font-mono text-[9px] tabular-nums text-zinc-500">
                1 из {step.ceilMachines}
              </span>
            </>
          ) : (
            <>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-emerald-300">
                {step.ceilMachines}×
              </span>
              <span className="mt-0.5 font-mono text-[9px] tabular-nums text-zinc-500">
                {formatNumber(step.exactMachines, 2)} точн.
              </span>
            </>
          )}
        </div>
      </div>

      {/* Interactive Recipe Switcher Button */}
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpenRecipeModal(step.primaryProductId, step);
        }}
        title="Нажмите, чтобы выбрать другой рецепт, источник или контракт"
        className={cn(
          'nodrag nopan mt-2 flex w-full items-center justify-between gap-1.5 rounded-lg border px-2 py-1 text-left text-[11px] transition-all duration-150',
          hasAlternatives
            ? 'cursor-pointer border-white/[0.12] bg-[#09090b] text-zinc-200 hover:border-emerald-500/50 hover:bg-[#18181b] hover:text-emerald-300'
            : 'cursor-pointer border-white/[0.06] bg-[#09090b] text-zinc-400 hover:border-white/[0.14]',
        )}
      >
        <div className="flex items-center gap-1 min-w-0">
          {step.kind === 'contract' && (
            <Anchor className="h-3 w-3 shrink-0 text-violet-400" />
          )}
          {step.hasCycleInput && (
            <RefreshCw className="h-3 w-3 shrink-0 text-amber-400" />
          )}
          <span className="truncate font-medium">{step.recipeName}</span>
        </div>
        {hasAlternatives && (
          <span className="flex shrink-0 items-center gap-0.5 rounded bg-white/[0.08] px-1 py-0.2 font-mono text-[9px] text-zinc-300">
            {altCount}
            <ChevronDown className="h-2.5 w-2.5" />
          </span>
        )}
      </button>

      {/* Port-aligned Inputs & Outputs */}
      <div className="mt-2 grid grid-cols-2 gap-1.5 border-t border-white/[0.06] pt-2">
        {/* Inputs */}
        <div className="flex flex-col gap-1">
          {step.inputs.length === 0 ? (
            <span className="text-[9px] text-zinc-600">Без сырья</span>
          ) : (
            step.inputs.map((inp) => {
              const kind = getProductLogisticsKind(inp.productId);
              const isPinned = rawSet.has(inp.productId);
              const canPin = !VIRTUAL_PRODUCT_IDS.has(inp.productId);
              const lbl = getProductLabel(inp.productId);
              const rate = inp.ratePer60 * flowScale;

              return (
                <div
                  key={inp.productId}
                  className="relative flex items-center gap-1 rounded bg-[#09090b] px-1.5 py-0.5 text-[10px]"
                >
                  {isLR && (
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={`in-${inp.productId}`}
                      style={{
                        backgroundColor: EDGE_COLORS[kind],
                        left: -14,
                      }}
                      className="!h-2 !w-2 !border !border-[#09090b]"
                    />
                  )}
                  <img
                    src={getProductIconUrl(inp.icon)}
                    alt={lbl.en}
                    className="h-3.5 w-3.5 shrink-0 object-contain"
                  />
                  <span className="truncate font-mono tabular-nums text-zinc-300">
                    {formatRate(rate, rateUnit)}
                  </span>
                  {canPin && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleRawResource(inp.productId);
                      }}
                      title={
                        isPinned
                          ? 'Убрать из внешнего сырья'
                          : 'Закрепить как внешнее сырьё'
                      }
                      className={cn(
                        'nodrag nopan ml-auto shrink-0 rounded p-0.5',
                        isPinned
                          ? 'text-sky-400'
                          : 'text-zinc-600 hover:text-sky-300',
                      )}
                    >
                      <Pin className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Outputs */}
        <div className="flex flex-col gap-1">
          {step.outputs.map((out) => {
            const kind = getProductLogisticsKind(out.productId);
            const lbl = getProductLabel(out.productId);
            const surplus = step.surplusOutputs.find(
              (s) => s.productId === out.productId,
            );
            const canExtend = !VIRTUAL_PRODUCT_IDS.has(out.productId);
            const rate = out.ratePer60 * flowScale;
            const extendRate = surplus?.ratePer60 ?? out.ratePer60;

            return (
              <div
                key={out.productId}
                className={cn(
                  'relative flex items-center justify-between gap-1 rounded px-1.5 py-0.5 text-[10px]',
                  out.sourceType === 'target'
                    ? 'bg-emerald-500/10 text-emerald-300'
                    : surplus
                      ? 'bg-amber-500/10 text-amber-300'
                      : 'bg-[#09090b] text-zinc-200',
                )}
              >
                <div className="flex items-center gap-1 min-w-0">
                  <img
                    src={getProductIconUrl(out.icon)}
                    alt={lbl.en}
                    className="h-3.5 w-3.5 shrink-0 object-contain"
                  />
                  <span className="truncate font-mono tabular-nums">
                    {formatRate(rate, rateUnit)}
                  </span>
                </div>

                {canExtend && (
                  <button
                    type="button"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenExtendModal(out.productId, extendRate);
                    }}
                    title={`Продлить цепочку от «${lbl.ru ?? lbl.en}»`}
                    className="nodrag nopan shrink-0 rounded bg-white/[0.08] p-0.5 text-zinc-300 transition-colors hover:bg-emerald-500/30 hover:text-emerald-200"
                  >
                    <Plus className="h-2.5 w-2.5" />
                  </button>
                )}

                {isLR && (
                  <Handle
                    type="source"
                    position={Position.Right}
                    id={`out-${out.productId}`}
                    style={{
                      backgroundColor: EDGE_COLORS[kind],
                      right: -14,
                    }}
                    className="!h-2 !w-2 !border !border-[#09090b]"
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const RawInputFlowNode: React.FC<NodeProps<Node<RawNodeData>>> = ({
  data,
  selected,
}) => {
  const {
    productId,
    ratePer60,
    beltLabel,
    rateUnit,
    direction,
    kind,
    hasSourceAlternatives,
    onOpenSourceModal,
  } = data;
  const p = PRODUCTS[productId];
  const lbl = getProductLabel(productId);
  const isLR = direction === 'LR';
  const color = EDGE_COLORS[kind];
  const isMined = NATURAL_RAW_PRODUCT_IDS.has(productId);

  return (
    <div
      style={{ borderColor: selected ? color : `${color}55` }}
      className={cn(
        'w-[196px] cursor-grab active:cursor-grabbing rounded-xl border bg-[#0d1218] p-2 shadow-lg',
        selected && 'ring-2 ring-sky-500/30',
      )}
    >
      <Handle
        type="source"
        position={isLR ? Position.Right : Position.Bottom}
        id={`out-${productId}`}
        style={{ backgroundColor: color }}
        className="!h-2.5 !w-2.5 !border-2 !border-[#09090b]"
      />
      <div className="flex items-center gap-2">
        <img
          src={getProductIconUrl(p?.icon)}
          alt={lbl.en}
          className="h-6 w-6 shrink-0 object-contain"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            {isMined && <Pickaxe className="h-3 w-3 shrink-0 text-amber-400" />}
            <span className="truncate text-[11px] font-semibold text-zinc-100">
              {lbl.ru ?? lbl.en}
            </span>
          </div>
          <div
            style={{ color }}
            className="font-mono text-[10px] font-semibold tabular-nums"
          >
            {formatRate(ratePer60, rateUnit)}
          </div>
        </div>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-1">
        {beltLabel && (
          <div className="flex flex-1 items-center gap-1 rounded bg-black/35 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400 min-w-0">
            <img
              src={getTransportIconForKind(kind, ratePer60)}
              alt={beltLabel}
              className="h-3 w-3 shrink-0 object-contain"
            />
            <span className="truncate">{beltLabel}</span>
          </div>
        )}

        {hasSourceAlternatives && (
          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onOpenSourceModal(productId);
            }}
            title="Переключить источник (Карьер / Производство / Контракт)"
            className="nodrag nopan flex shrink-0 items-center gap-0.5 rounded border border-white/[0.12] bg-[#121214] px-1.5 py-0.5 text-[9px] font-medium text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300"
          >
            <span>Источник</span>
            <ChevronDown className="h-2.5 w-2.5" />
          </button>
        )}
      </div>
    </div>
  );
};

const FlowCustomEdge: React.FC<EdgeProps<Edge<FlowEdgeData>>> = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  const p = data ? PRODUCTS[data.productId] : undefined;
  const kind = data?.kind ?? 'flat';
  const stroke = data?.isCycle ? '#eab308' : EDGE_COLORS[kind];

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke,
          strokeWidth: kind === 'fluid' || kind === 'molten' ? 2.4 : 1.9,
          strokeDasharray: data?.isCycle
            ? '5 4'
            : kind === 'loose'
              ? '7 3'
              : undefined,
          opacity: 0.85,
        }}
      />
      {data && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              borderColor: `${stroke}44`,
            }}
            className="flex items-center gap-1 rounded-md border bg-[#09090b]/95 px-1.5 py-0.5 font-mono text-[9px] tabular-nums text-zinc-200 shadow"
          >
            {kind !== 'virtual' && (
              <img
                src={getTransportIconForKind(kind, data.ratePer60)}
                alt={kind}
                className="h-3 w-3 shrink-0 object-contain"
              />
            )}
            {p && (
              <img
                src={getProductIconUrl(p.icon)}
                alt={p.name}
                className="h-3 w-3 shrink-0 object-contain"
              />
            )}
            <span>{formatRate(data.ratePer60, data.rateUnit)}</span>
            {data.beltLabel && (
              <span className="text-zinc-500">({data.beltLabel})</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

const nodeTypes = {
  recipeNode: RecipeFlowNode,
  rawNode: RawInputFlowNode,
};

const edgeTypes = {
  flowEdge: FlowCustomEdge,
};

// Compact Bus Matrix View
const BusMatrixView: React.FC<{
  solveResult: SolveResult;
  rateUnit: RateUnit;
  rawSet: Set<string>;
  onOpenRecipeModal: (productId: string, step?: SolvedStep) => void;
  onOpenExtendModal: (productId: string, availableRate60: number) => void;
  onToggleRawResource: (productId: string) => void;
}> = ({
  solveResult,
  rateUnit,
  rawSet,
  onOpenRecipeModal,
  onOpenExtendModal,
  onToggleRawResource,
}) => {
  const busLines = useMemo(() => {
    const flowByProduct = new Map<string, number>();
    for (const raw of solveResult.summary.rawInputs) {
      if (VIRTUAL_PRODUCT_IDS.has(raw.productId)) continue;
      flowByProduct.set(
        raw.productId,
        (flowByProduct.get(raw.productId) ?? 0) + raw.ratePer60,
      );
    }
    for (const step of solveResult.steps) {
      for (const out of step.outputs) {
        if (VIRTUAL_PRODUCT_IDS.has(out.productId)) continue;
        flowByProduct.set(
          out.productId,
          (flowByProduct.get(out.productId) ?? 0) + out.ratePer60,
        );
      }
    }

    return [...flowByProduct.entries()]
      .map(([pid, rate60]) => {
        const kind = getProductLogisticsKind(pid);
        const cap =
          kind === 'molten'
            ? 120
            : rate60 <= 60
              ? 60
              : rate60 <= 200
                ? 200
                : rate60 <= 450 || kind !== 'fluid'
                  ? 450
                  : 900;
        const linesCount = Math.max(1, Math.ceil(rate60 / cap));
        const totalCap = linesCount * cap;
        const usedPct = Math.min(100, (rate60 / totalCap) * 100);
        const freeHeadroom60 = Math.max(0, totalCap - rate60);
        const log = computeLogistics(pid, rate60);
        return {
          productId: pid,
          rate60,
          kind,
          cap,
          linesCount,
          usedPct,
          freeHeadroom60,
          beltLabel: log?.recommendedLabel ?? '',
        };
      })
      .sort((a, b) => b.rate60 - a.rate60);
  }, [solveResult]);

  const columns = useMemo(() => {
    const map = new Map<number, SolvedStep[]>();
    for (const s of solveResult.steps) {
      if (!map.has(s.depth)) map.set(s.depth, []);
      map.get(s.depth)!.push(s);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]);
  }, [solveResult.steps]);

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
              Магистральная шина (Конвейеры, Трубы и Запас под расширение)
            </h3>
            <p className="text-[11px] text-zinc-500">
              Загрузка линий и свободная пропускная способность для будущих подключений
            </p>
          </div>
          <span className="font-mono text-[11px] text-zinc-400">
            Магистралей: {busLines.length}
          </span>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {busLines.slice(0, 18).map((line) => {
            const p = PRODUCTS[line.productId];
            const lbl = getProductLabel(line.productId);
            const color = EDGE_COLORS[line.kind];
            return (
              <div
                key={line.productId}
                className="flex flex-col gap-1.5 rounded-lg border border-white/[0.07] bg-[#09090b] p-2"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <img
                      src={getTransportIconForKind(line.kind, line.rate60)}
                      alt={line.beltLabel}
                      className="h-4 w-4 shrink-0 object-contain"
                    />
                    {p && (
                      <img
                        src={getProductIconUrl(p.icon)}
                        alt={lbl.en}
                        className="h-4 w-4 shrink-0 object-contain"
                      />
                    )}
                    <span className="truncate text-[11px] font-semibold text-zinc-200">
                      {lbl.ru ?? lbl.en}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      onOpenExtendModal(
                        line.productId,
                        Math.max(15, line.freeHeadroom60 || line.rate60),
                      )
                    }
                    title={`Подключить ещё потребителя к шине «${lbl.ru ?? lbl.en}»`}
                    className="shrink-0 rounded bg-white/[0.06] p-0.5 text-zinc-400 hover:bg-emerald-500/25 hover:text-emerald-300"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                </div>

                <div className="flex items-center justify-between font-mono text-[10px] tabular-nums">
                  <span style={{ color }}>
                    {formatRate(line.rate60, rateUnit)}
                  </span>
                  <span className="text-zinc-500">{line.beltLabel}</span>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    style={{
                      width: `${line.usedPct}%`,
                      backgroundColor: color,
                    }}
                    className="h-full rounded-full transition-all duration-200"
                  />
                </div>

                <div className="flex items-center justify-between font-mono text-[9px] text-zinc-500">
                  <span>Занято {Math.round(line.usedPct)}%</span>
                  <span className="text-emerald-400/80">
                    +{formatNumber(line.freeHeadroom60, 0)} запас
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-max items-start gap-3">
          {solveResult.summary.rawInputs.length > 0 && (
            <div className="flex w-52 shrink-0 flex-col gap-2 rounded-xl border border-sky-500/20 bg-[#0d1218]/60 p-2.5">
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-sky-300">
                  Внешнее сырьё
                </span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {solveResult.summary.rawInputs.length}
                </span>
              </div>
              {solveResult.summary.rawInputs.map((raw) => {
                const lbl = getProductLabel(raw.productId);
                const kind = getProductLogisticsKind(raw.productId);
                return (
                  <button
                    key={raw.productId}
                    type="button"
                    onClick={() => onOpenRecipeModal(raw.productId)}
                    className="flex items-center justify-between gap-1.5 rounded-lg border border-white/[0.07] bg-[#09090b] p-2 text-left hover:border-sky-500/40"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <img
                        src={getProductIconUrl(raw.icon)}
                        alt={lbl.en}
                        className="h-5 w-5 shrink-0 object-contain"
                      />
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-medium text-zinc-200">
                          {lbl.ru ?? lbl.en}
                        </div>
                        <div className="font-mono text-[10px] text-sky-300">
                          {formatRate(raw.ratePer60, rateUnit)}
                        </div>
                      </div>
                    </div>
                    {raw.beltInfo && (
                      <img
                        src={getTransportIconForKind(kind, raw.ratePer60)}
                        alt={raw.beltInfo.recommendedLabel}
                        title={raw.beltInfo.recommendedLabel}
                        className="h-4 w-4 shrink-0 object-contain"
                      />
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {columns.map(([depth, steps]) => (
            <div
              key={depth}
              className="flex w-64 shrink-0 flex-col gap-2 rounded-xl border border-white/[0.08] bg-[#121214]/75 p-2.5"
            >
              <div className="flex items-center justify-between border-b border-white/[0.06] pb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
                  {depth === 0 ? 'Финальный выпуск' : `Передел #${depth}`}
                </span>
                <span className="font-mono text-[10px] text-zinc-500">
                  {steps.length} цех.
                </span>
              </div>

              {steps.map((step) => {
                const iconCount = Math.min(step.ceilMachines, 5);
                return (
                  <div
                    key={step.stepId}
                    className={cn(
                      'flex flex-col gap-1.5 rounded-xl border bg-[#09090b] p-2.5',
                      step.isTarget
                        ? 'border-emerald-500/40'
                        : 'border-white/[0.08]',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        {Array.from({ length: iconCount }).map((_, idx) => (
                          <img
                            key={idx}
                            src={getMachineIconUrl(step.machineIcon)}
                            alt={step.machineName}
                            className="h-6 w-6 rounded border border-white/[0.08] bg-[#121214] p-0.5 object-contain"
                          />
                        ))}
                        {step.ceilMachines > 5 && (
                          <span className="font-mono text-[10px] text-zinc-400">
                            +{step.ceilMachines - 5}
                          </span>
                        )}
                        <span
                          title="Место под будущую пристройку линии"
                          className="flex h-6 w-6 items-center justify-center rounded border border-dashed border-white/[0.15] font-mono text-[9px] text-zinc-600"
                        >
                          +1
                        </span>
                      </div>

                      <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                        {step.ceilMachines}×
                      </span>
                    </div>

                    <div className="text-xs font-semibold text-zinc-100 leading-tight">
                      {step.machineName}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenRecipeModal(step.primaryProductId, step)}
                      className="flex items-center justify-between gap-1 rounded border border-white/[0.08] bg-[#121214] px-2 py-1 text-left text-[10px] text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300"
                    >
                      <span className="truncate">{step.recipeName}</span>
                      <ChevronDown className="h-3 w-3 shrink-0 text-zinc-500" />
                    </button>

                    <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-1.5">
                      {step.inputs.map((inp) => {
                        const kind = getProductLogisticsKind(inp.productId);
                        const isPinned = rawSet.has(inp.productId);
                        return (
                          <div
                            key={inp.productId}
                            className="flex items-center justify-between font-mono text-[10px] text-zinc-400"
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              <span
                                style={{ backgroundColor: EDGE_COLORS[kind] }}
                                className="h-1.5 w-1.5 shrink-0 rounded-full"
                              />
                              <img
                                src={getProductIconUrl(inp.icon)}
                                alt={inp.name}
                                className="h-3.5 w-3.5 shrink-0 object-contain"
                              />
                              <span className="truncate">{inp.name}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span>{formatRate(inp.ratePer60, rateUnit)}</span>
                              {!VIRTUAL_PRODUCT_IDS.has(inp.productId) && (
                                <button
                                  type="button"
                                  onClick={() => onToggleRawResource(inp.productId)}
                                  className={cn(
                                    'p-0.5',
                                    isPinned ? 'text-sky-400' : 'text-zinc-600 hover:text-sky-300',
                                  )}
                                >
                                  <Pin className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                      {step.outputs.map((out) => {
                        const kind = getProductLogisticsKind(out.productId);
                        return (
                          <div
                            key={out.productId}
                            className="flex items-center justify-between font-mono text-[10px] text-emerald-300"
                          >
                            <div className="flex items-center gap-1 min-w-0">
                              <ArrowRight className="h-2.5 w-2.5 shrink-0" />
                              <img
                                src={getProductIconUrl(out.icon)}
                                alt={out.name}
                                className="h-3.5 w-3.5 shrink-0 object-contain"
                              />
                              <span className="truncate">{out.name}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <span>{formatRate(out.ratePer60, rateUnit)}</span>
                              {out.beltInfo && (
                                <img
                                  src={getTransportIconForKind(kind, out.ratePer60)}
                                  alt={out.beltInfo.recommendedLabel}
                                  title={out.beltInfo.recommendedLabel}
                                  className="h-3.5 w-3.5 object-contain"
                                />
                              )}
                              {!VIRTUAL_PRODUCT_IDS.has(out.productId) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    onOpenExtendModal(out.productId, out.ratePer60)
                                  }
                                  className="rounded bg-white/[0.08] p-0.5 text-zinc-200 hover:bg-emerald-500/30"
                                >
                                  <Plus className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

interface FlowGraphViewProps {
  plan: FactoryPlanConfig;
  solveResult: SolveResult;
  rateUnit: RateUnit;
  unlockedFilter?: UnlockedGameFilter;
  onSelectRecipeOverride: (productId: string, recipeId: string) => void;
  onSelectContractOverride: (productId: string, contractId: string) => void;
  onClearContractOverride: (productId: string) => void;
  onToggleRawResource: (productId: string) => void;
  onUseRawSource: (productId: string) => void;
  onAddTargetWithRate: (productId: string, ratePer60: number, recipeId?: string) => void;
}

const FlowGraphInner: React.FC<FlowGraphViewProps> = ({
  plan,
  solveResult,
  rateUnit,
  unlockedFilter,
  onSelectRecipeOverride,
  onSelectContractOverride,
  onClearContractOverride,
  onToggleRawResource,
  onUseRawSource,
  onAddTargetWithRate,
}) => {
  const [subMode, setSubMode] = useState<GraphSubMode>('dag');
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR');
  const [compact, setCompact] = useState<boolean>(true);
  const [splitByBuilding, setSplitByBuilding] = useState<boolean>(true);
  const [modalContext, setModalContext] = useState<{
    productId: string;
    step?: SolvedStep;
  } | null>(null);
  const [showLockedRecipes, setShowLockedRecipes] = useState(false);
  const [extendContext, setExtendContext] = useState<{
    productId: string;
    availableRate60: number;
  } | null>(null);

  const rawSet = useMemo(() => new Set(plan.rawResources), [plan.rawResources]);

  const posStorageKey = `coi_graph_pos_v1_${plan.id}_${direction}_${splitByBuilding ? 'split' : 'group'}`;
  const customPositionsRef = useRef<Record<string, { x: number; y: number }>>({});

  // Load persisted custom node positions when plan/layout mode changes
  useEffect(() => {
    try {
      const saved = localStorage.getItem(posStorageKey);
      customPositionsRef.current = saved ? JSON.parse(saved) : {};
    } catch {
      customPositionsRef.current = {};
    }
  }, [posStorageKey]);

  const extensionOptions = useMemo(() => {
    if (!extendContext) return [];
    const list = getDownstreamExtensions(extendContext.productId);
    if (!unlockedFilter?.enabled) return list;
    return [...list].sort((a, b) => {
      const ua = unlockedFilter.unlockedRecipeIds.has(a.recipe.id) ? 1 : 0;
      const ub = unlockedFilter.unlockedRecipeIds.has(b.recipe.id) ? 1 : 0;
      return ub - ua;
    });
  }, [extendContext, unlockedFilter]);

  const openRecipeOrSourceModal = useCallback(
    (productId: string, step?: SolvedStep) => {
      setShowLockedRecipes(false);
      setModalContext({ productId, step });
    },
    [],
  );

  // Compute Dagre layout + merge with any user-dragged tile positions
  const buildLayout = useCallback(
    (ignoreSavedPositions = false) => {
      const g = new dagre.graphlib.Graph();
      g.setDefaultEdgeLabel(() => ({}));
      g.setGraph({
        rankdir: direction,
        nodesep: compact ? 14 : 36,
        ranksep: compact ? 72 : 120,
        marginx: 24,
        marginy: 24,
      });

      const nodeW = compact ? 280 : 312;
      const isLR = direction === 'LR';
      const rawNodesList: Node<RawNodeData>[] = [];
      const stepTilesMeta: {
        nodeId: string;
        step: SolvedStep;
        unitIndex: number;
        unitCount: number;
        isSplitTile: boolean;
        unitLoadFactor: number;
        width: number;
        height: number;
      }[] = [];
      const tilesByStepId = new Map<string, string[]>();
      const flowEdges: Edge<FlowEdgeData>[] = [];

      // 1. Expand steps into individual building tiles (or single grouped card)
      for (const step of solveResult.steps) {
        const ioRows = Math.max(1, step.inputs.length, step.outputs.length);
        const estHeight = (compact ? 104 : 116) + ioRows * 24;

        if (!splitByBuilding || step.ceilMachines <= 1) {
          const nid = step.stepId;
          g.setNode(nid, { width: nodeW, height: estHeight });
          tilesByStepId.set(step.stepId, [nid]);
          stepTilesMeta.push({
            nodeId: nid,
            step,
            unitIndex: 0,
            unitCount: 1,
            isSplitTile: splitByBuilding && step.ceilMachines === 1,
            unitLoadFactor:
              splitByBuilding && step.ceilMachines === 1
                ? Math.min(1, step.exactMachines)
                : 1,
            width: nodeW,
            height: estHeight,
          });
        } else {
          const totalMachines = Math.max(1, step.ceilMachines);
          const tileCount = Math.min(totalMachines, MAX_SPLIT_TILES_PER_STEP);
          const tileIds: string[] = [];

          for (let i = 0; i < tileCount; i++) {
            const nid = `${step.stepId}#${i}`;
            tileIds.push(nid);
            g.setNode(nid, { width: nodeW, height: estHeight });

            let loadFactor = 1;
            if (totalMachines <= MAX_SPLIT_TILES_PER_STEP) {
              if (i === tileCount - 1) {
                const rem = step.exactMachines - i;
                loadFactor = rem > 0.001 ? Math.min(1, rem) : 1;
              }
            } else if (i === tileCount - 1) {
              // Last clamped tile carries remaining machines
              loadFactor = Math.max(1, step.exactMachines - i);
            }

            stepTilesMeta.push({
              nodeId: nid,
              step,
              unitIndex: i,
              unitCount: tileCount,
              isSplitTile: true,
              unitLoadFactor: loadFactor,
              width: nodeW,
              height: estHeight,
            });
          }
          tilesByStepId.set(step.stepId, tileIds);
        }
      }

      // 2. Raw input tiles
      for (const raw of solveResult.summary.rawInputs) {
        const rawNodeId = `raw:${raw.productId}`;
        g.setNode(rawNodeId, { width: 196, height: 72 });
        const alts = getProducingRecipes(raw.productId);
        const contracts = CONTRACTS_FOR_PRODUCT[raw.productId] ?? [];
        rawNodesList.push({
          id: rawNodeId,
          type: 'rawNode',
          position: { x: 0, y: 0 },
          data: {
            productId: raw.productId,
            ratePer60: raw.ratePer60,
            beltLabel: raw.beltInfo?.recommendedLabel,
            rateUnit,
            direction,
            kind: getProductLogisticsKind(raw.productId),
            hasSourceAlternatives: alts.length > 0 || contracts.length > 0,
            onOpenSourceModal: (pid) => openRecipeOrSourceModal(pid),
          },
        });
      }

      // 3. Raw -> Step tiles edges
      for (const step of solveResult.steps) {
        const dstTiles = tilesByStepId.get(step.stepId) ?? [];
        for (const inp of step.inputs) {
          if (inp.sourceType === 'raw') {
            const rawNodeId = `raw:${inp.productId}`;
            if (!g.hasNode(rawNodeId)) continue;
            const kind = getProductLogisticsKind(inp.productId);

            dstTiles.forEach((dstId, idx) => {
              const meta = stepTilesMeta.find((m) => m.nodeId === dstId);
              const share =
                splitByBuilding && step.exactMachines > 0 && meta
                  ? inp.ratePer60 * (meta.unitLoadFactor / step.exactMachines)
                  : inp.ratePer60 / Math.max(1, dstTiles.length);
              const log = computeLogistics(inp.productId, share);
              g.setEdge(rawNodeId, dstId);
              flowEdges.push({
                id: `${rawNodeId}->${dstId}-${inp.productId}-${idx}`,
                source: rawNodeId,
                sourceHandle: isLR ? `out-${inp.productId}` : undefined,
                target: dstId,
                targetHandle: isLR ? `in-${inp.productId}` : 'in-default',
                type: 'flowEdge',
                data: {
                  productId: inp.productId,
                  ratePer60: share,
                  rateUnit,
                  isCycle: false,
                  isRaw: true,
                  kind,
                  beltLabel: log?.recommendedLabel,
                },
              });
            });
          }
        }
      }

      // 4. Step -> Step parallel lane edges
      for (const edge of solveResult.edges) {
        const srcTiles = tilesByStepId.get(edge.sourceStepId) ?? [];
        const dstTiles = tilesByStepId.get(edge.targetStepId) ?? [];
        if (srcTiles.length === 0 || dstTiles.length === 0) continue;

        const kind = getProductLogisticsKind(edge.productId);
        const laneCount = Math.max(srcTiles.length, dstTiles.length);
        const perLaneRate = edge.ratePer60 / laneCount;
        const log = computeLogistics(edge.productId, perLaneRate);

        for (let i = 0; i < laneCount; i++) {
          const sId = srcTiles[i % srcTiles.length];
          const dId = dstTiles[i % dstTiles.length];
          if (!edge.isCycle) {
            g.setEdge(sId, dId);
          }
          flowEdges.push({
            id: `${sId}->${dId}-${edge.productId}-${i}`,
            source: sId,
            sourceHandle: isLR ? `out-${edge.productId}` : 'out-default',
            target: dId,
            targetHandle: isLR ? `in-${edge.productId}` : 'in-default',
            type: 'flowEdge',
            animated: edge.isCycle,
            data: {
              productId: edge.productId,
              ratePer60: perLaneRate,
              rateUnit,
              isCycle: edge.isCycle,
              isRaw: false,
              kind,
              beltLabel: log?.recommendedLabel,
            },
          });
        }
      }

      dagre.layout(g);

      const saved = ignoreSavedPositions ? {} : customPositionsRef.current;

      const positionedRawNodes: Node<RawNodeData>[] = rawNodesList.map((rn) => {
        const pos = g.node(rn.id) ?? { x: 0, y: 0 };
        const userPos = saved[rn.id];
        return {
          ...rn,
          position: userPos ?? { x: pos.x - 98, y: pos.y - 36 },
        };
      });

      const positionedStepNodes: Node<RecipeNodeData>[] = stepTilesMeta.map((m) => {
        const pos = g.node(m.nodeId) ?? { x: 0, y: 0 };
        const userPos = saved[m.nodeId];
        return {
          id: m.nodeId,
          type: 'recipeNode',
          position: userPos ?? {
            x: pos.x - m.width / 2,
            y: pos.y - m.height / 2,
          },
          data: {
            step: m.step,
            unitIndex: m.unitIndex,
            unitCount: m.unitCount,
            isSplitTile: m.isSplitTile,
            unitLoadFactor: m.unitLoadFactor,
            rateUnit,
            direction,
            compact,
            rawSet,
            onOpenRecipeModal: openRecipeOrSourceModal,
            onOpenExtendModal: (pid, avail) =>
              setExtendContext({ productId: pid, availableRate60: avail }),
            onToggleRawResource,
          },
        };
      });

      return {
        nodes: [...positionedRawNodes, ...positionedStepNodes] as Node[],
        edges: flowEdges,
      };
    },
    [
      solveResult,
      rateUnit,
      direction,
      compact,
      splitByBuilding,
      rawSet,
      openRecipeOrSourceModal,
      onToggleRawResource,
    ],
  );

  const [nodes, setNodes] = useState<Node[]>(() => buildLayout().nodes);
  const [edges, setEdges] = useState<Edge[]>(() => buildLayout().edges);

  useEffect(() => {
    const next = buildLayout();
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [buildLayout]);

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes((nds) => {
        const updated = applyNodeChanges(changes, nds);
        let posChanged = false;
        for (const ch of changes) {
          if (ch.type === 'position' && ch.position) {
            customPositionsRef.current[ch.id] = {
              x: ch.position.x,
              y: ch.position.y,
            };
            posChanged = true;
          }
        }
        if (posChanged) {
          try {
            localStorage.setItem(
              posStorageKey,
              JSON.stringify(customPositionsRef.current),
            );
          } catch {
            // ignore storage quota errors
          }
        }
        return updated;
      });
    },
    [posStorageKey],
  );

  const handleResetLayout = () => {
    customPositionsRef.current = {};
    try {
      localStorage.removeItem(posStorageKey);
    } catch {
      // ignore
    }
    const next = buildLayout(true);
    setNodes(next.nodes);
    setEdges(next.edges);
  };

  // Modal details for switching recipe / source / contract
  const modalDetails = useMemo(() => {
    if (!modalContext) return null;
    const pid = modalContext.productId;
    const lbl = getProductLabel(pid);
    const altRecipes = getProducingRecipes(pid);
    const altContracts = CONTRACTS_FOR_PRODUCT[pid] ?? [];
    const isTarget = plan.targets.some((t) => t.productId === pid);
    const isCurrentlyRaw = !modalContext.step;
    return {
      productId: pid,
      productLabel: lbl.ru ?? lbl.en,
      step: modalContext.step,
      altRecipes,
      altContracts,
      canUseRaw: !isTarget,
      isCurrentlyRaw,
    };
  }, [modalContext, plan.targets]);

  return (
    <div className="flex flex-1 flex-col gap-2.5 min-w-0">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#121214] px-3 py-2">
        <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5">
          <button
            type="button"
            onClick={() => setSubMode('dag')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              subMode === 'dag'
                ? 'bg-[#18181b] text-emerald-300 ring-1 ring-white/[0.08]'
                : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span>Граф связей (DAG)</span>
          </button>
          <button
            type="button"
            onClick={() => setSubMode('bus')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              subMode === 'bus'
                ? 'bg-[#18181b] text-emerald-300 ring-1 ring-white/[0.08]'
                : 'text-zinc-400 hover:text-zinc-200',
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            <span>Компактная схема шин (Цехи и Магистрали)</span>
          </button>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-emerald-500" />
            <span>Конвейер</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 border-t-2 border-dashed border-amber-500" />
            <span>U-конвейер</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-cyan-500" />
            <span>Труба</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-4 rounded-full bg-orange-500" />
            <span>Желоб расплава</span>
          </span>
        </div>
      </div>

      {subMode === 'bus' ? (
        <BusMatrixView
          solveResult={solveResult}
          rateUnit={rateUnit}
          rawSet={rawSet}
          onOpenRecipeModal={openRecipeOrSourceModal}
          onOpenExtendModal={(pid, avail) =>
            setExtendContext({ productId: pid, availableRate60: avail })
          }
          onToggleRawResource={onToggleRawResource}
        />
      ) : (
        <div className="relative h-[680px] w-full flex-1 overflow-hidden rounded-xl border border-white/[0.08] bg-[#09090b]">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            nodesDraggable
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.12}
            maxZoom={1.8}
          >
            <Background color="#27272a" gap={20} size={1} />
            <Controls />
            <MiniMap
              nodeColor={(n) =>
                n.type === 'rawNode' ? '#38bdf8' : '#10b981'
              }
              maskColor="rgba(9, 9, 11, 0.78)"
            />
            <Panel position="top-right" className="flex flex-wrap items-center gap-2">
              {/* Split per building vs Grouped */}
              <div className="flex items-center rounded-lg border border-white/[0.1] bg-[#121214] p-0.5 shadow-lg">
                <button
                  type="button"
                  onClick={() => setSplitByBuilding(true)}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    splitByBuilding
                      ? 'bg-[#18181b] text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Boxes className="h-3 w-3" />
                  <span>Поштучно</span>
                </button>
                <button
                  type="button"
                  onClick={() => setSplitByBuilding(false)}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    !splitByBuilding
                      ? 'bg-[#18181b] text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Layers className="h-3 w-3" />
                  <span>Группой</span>
                </button>
              </div>

              {/* Compact / Spacious */}
              <div className="flex items-center rounded-lg border border-white/[0.1] bg-[#121214] p-0.5 shadow-lg">
                <button
                  type="button"
                  onClick={() => setCompact(true)}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    compact
                      ? 'bg-[#18181b] text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Minimize2 className="h-3 w-3" />
                  <span>Компактно</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCompact(false)}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    !compact
                      ? 'bg-[#18181b] text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <Maximize2 className="h-3 w-3" />
                  <span>Просторно</span>
                </button>
              </div>

              {/* Direction */}
              <div className="flex items-center rounded-lg border border-white/[0.1] bg-[#121214] p-0.5 shadow-lg">
                <button
                  type="button"
                  onClick={() => setDirection('LR')}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    direction === 'LR'
                      ? 'bg-[#18181b] text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>Горизонтально</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDirection('TB')}
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                    direction === 'TB'
                      ? 'bg-[#18181b] text-emerald-300'
                      : 'text-zinc-400 hover:text-zinc-200',
                  )}
                >
                  <ArrowUpDown className="h-3 w-3" />
                  <span>Вертикально</span>
                </button>
              </div>

              {/* Reset dragged layout */}
              <button
                type="button"
                onClick={handleResetLayout}
                title="Сбросить ручные позиции плиток и выровнять заново"
                className="flex items-center gap-1 rounded-lg border border-white/[0.1] bg-[#121214] px-2.5 py-1.5 text-xs font-medium text-zinc-300 shadow-lg hover:border-white/[0.2] hover:text-emerald-300"
              >
                <RotateCcw className="h-3 w-3" />
                <span>Авто-выравнивание</span>
              </button>
            </Panel>

            <Panel position="bottom-left" className="rounded-lg border border-white/[0.08] bg-[#121214]/90 px-2.5 py-1 text-[10px] text-zinc-400">
              Перетаскивайте плитки мышью для свободной компоновки (позиции сохраняются)
            </Panel>
          </ReactFlow>
        </div>
      )}

      {/* Modal: Switch Recipe / Mined Raw Source / Trade Contract */}
      {modalDetails && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setModalContext(null)}
        >
          <div
            className="flex max-h-[82vh] w-full max-w-2xl flex-col rounded-2xl border border-white/[0.14] bg-[#121214] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Выбор источника и рецепта для «{modalDetails.productLabel}»
                </h3>
                <p className="text-xs text-zinc-400">
                  {modalDetails.step
                    ? `Текущий завод: ${modalDetails.step.machineName} (${modalDetails.step.ceilMachines}×)`
                    : 'Сейчас используется как добываемое / внешнее сырьё'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalContext(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2 overflow-y-auto pr-1">
              {modalDetails.canUseRaw && (
                <button
                  type="button"
                  onClick={() => {
                    onUseRawSource(modalDetails.productId);
                    setModalContext(null);
                  }}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition-colors',
                    modalDetails.isCurrentlyRaw
                      ? 'border-sky-500/60 bg-sky-500/15'
                      : 'border-sky-500/25 bg-sky-500/5 hover:border-sky-500/45',
                  )}
                >
                  <div className="flex items-center gap-2.5">
                    <Pickaxe className="h-5 w-5 text-amber-400" />
                    <div>
                      <div className="text-xs font-semibold text-sky-200">
                        {NATURAL_RAW_PRODUCT_IDS.has(modalDetails.productId)
                          ? `Добывать из карьера: ${modalDetails.productLabel}`
                          : `Считать внешним сырьём / ввозом: ${modalDetails.productLabel}`}
                      </div>
                      <div className="text-[11px] text-zinc-400">
                        {NATURAL_RAW_PRODUCT_IDS.has(modalDetails.productId)
                          ? 'Добыча экскаваторами в карьере без производственной цепочки'
                          : 'Остановить расчёт цепочки вверх по этому ресурсу'}
                      </div>
                    </div>
                  </div>
                  {modalDetails.isCurrentlyRaw && (
                    <span className="shrink-0 rounded bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-200">
                      Активен
                    </span>
                  )}
                </button>
              )}

              {(() => {
                const isFiltering = Boolean(unlockedFilter?.enabled);
                const hasTelemetry =
                  unlockedFilter &&
                  (unlockedFilter.unlockedProductIds.size > 0 ||
                    unlockedFilter.builtMachineIds.size > 0);
                const unlockedRecipes = isFiltering
                  ? modalDetails.altRecipes.filter((r) =>
                      unlockedFilter!.unlockedRecipeIds.has(r.id),
                    )
                  : modalDetails.altRecipes;
                const lockedRecipes = isFiltering
                  ? modalDetails.altRecipes.filter(
                      (r) => !unlockedFilter!.unlockedRecipeIds.has(r.id),
                    )
                  : [];
                const visibleRecipes =
                  !isFiltering || showLockedRecipes || unlockedRecipes.length === 0
                    ? [...unlockedRecipes, ...lockedRecipes]
                    : unlockedRecipes;

                return (
                  <>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {visibleRecipes.map((r) => {
                        const m = MACHINES[r.machine];
                        if (!m) return null;
                        const rLbl = getRecipeLabel(r.id);
                        const mLbl = getMachineLabel(m.id);
                        const isSelected =
                          modalDetails.step?.kind === 'recipe' &&
                          modalDetails.step.recipeId === r.id;
                        const isActiveInBase =
                          hasTelemetry && unlockedFilter!.activeRecipeIds.has(r.id);
                        const isLockedInGame =
                          Boolean(unlockedFilter && unlockedFilter.stageMode !== 'all') &&
                          !unlockedFilter!.unlockedRecipeIds.has(r.id);

                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => {
                              if (modalDetails.step?.kind === 'contract') {
                                onClearContractOverride(modalDetails.productId);
                              }
                              onSelectRecipeOverride(modalDetails.productId, r.id);
                              setModalContext(null);
                            }}
                            className={cn(
                              'flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-all duration-150',
                              isSelected
                                ? 'border-emerald-500/55 bg-emerald-500/10'
                                : isLockedInGame
                                  ? 'border-white/[0.04] bg-[#09090b]/60 opacity-70 hover:border-white/[0.15]'
                                  : 'border-white/[0.08] bg-[#09090b] hover:border-white/[0.2] hover:bg-[#18181b]',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <img
                                  src={getMachineIconUrl(m.icon)}
                                  alt={mLbl.ru}
                                  className="h-6 w-6 shrink-0 object-contain"
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-zinc-100">
                                    {rLbl.ru}
                                  </div>
                                  <div className="truncate text-[10px] text-zinc-400">
                                    {mLbl.ru} • {r.duration}с
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {isActiveInBase && (
                                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-300">
                                    ⚡ На базе
                                  </span>
                                )}
                                {isLockedInGame && (
                                  <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-300">
                                    🔒 Не изучено
                                  </span>
                                )}
                                {isSelected && (
                                  <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                                    Активен
                                  </span>
                                )}
                              </div>
                            </div>

                            <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-zinc-400">
                              {r.inputs.length === 0 ? (
                                <span className="text-zinc-500">Без сырья</span>
                              ) : (
                                r.inputs.map((i) => (
                                  <span
                                    key={i.id}
                                    className="rounded bg-white/[0.04] px-1 py-0.5"
                                  >
                                    {i.quantity} {getProductLabel(i.id).ru ?? i.name}
                                  </span>
                                ))
                              )}
                              <ArrowRight className="h-3 w-3 text-zinc-600" />
                              {r.outputs.map((o) => (
                                <span
                                  key={o.id}
                                  className="rounded bg-emerald-500/10 px-1 py-0.5 text-emerald-300"
                                >
                                  {o.quantity} {getProductLabel(o.id).ru ?? o.name}
                                </span>
                              ))}
                            </div>
                          </button>
                        );
                      })}

                      {modalDetails.altContracts.map((c) => {
                        const isSelected =
                          modalDetails.step?.kind === 'contract' &&
                          modalDetails.step.contractId === c.id;
                        const buyLbl = c.buyProductId
                          ? getProductLabel(c.buyProductId)
                          : null;
                        const payLbl = c.payProductId
                          ? getProductLabel(c.payProductId)
                          : null;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              onSelectContractOverride(modalDetails.productId, c.id);
                              setModalContext(null);
                            }}
                            className={cn(
                              'flex flex-col gap-1.5 rounded-xl border p-2.5 text-left transition-all duration-150',
                              isSelected
                                ? 'border-violet-500/60 bg-violet-500/15'
                                : 'border-violet-500/25 bg-violet-500/5 hover:border-violet-500/45',
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <Anchor className="h-4 w-4 text-violet-400" />
                                <span className="text-xs font-semibold text-violet-200">
                                  Контракт: {buyLbl?.ru ?? c.product_to_buy_name}
                                </span>
                              </div>
                              <span className="font-mono text-[10px] text-violet-300">
                                {formatNumber(c.unity_per_month, 2)} Unity/мес
                              </span>
                            </div>
                            <div className="font-mono text-[10px] text-zinc-300">
                              Отдаём {c.product_to_pay_with_quantity}{' '}
                              {payLbl?.ru ?? c.product_to_pay_with_name} → Получаем{' '}
                              <span className="text-emerald-300">
                                {c.product_to_buy_quantity}{' '}
                                {buyLbl?.ru ?? c.product_to_buy_name}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {isFiltering && unlockedRecipes.length > 0 && lockedRecipes.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowLockedRecipes((v) => !v)}
                        className="mt-1 w-full rounded-xl border border-dashed border-white/[0.12] bg-[#09090b] py-2 text-center text-xs font-medium text-zinc-400 transition-colors hover:border-white/[0.25] hover:text-zinc-200"
                      >
                        {showLockedRecipes
                          ? `Скрыть закрытые рецепты (${lockedRecipes.length})`
                          : `Показать закрытые рецепты (+${lockedRecipes.length})`}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Modal: Extend Chain from Output (+ Продлить цепочку) */}
      {extendContext && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          onClick={() => setExtendContext(null)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-2xl border border-white/[0.14] bg-[#121214] p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/[0.08] pb-3">
              <div>
                <h3 className="text-sm font-semibold text-zinc-100">
                  Продление цепочки от «
                  {getProductLabel(extendContext.productId).ru ??
                    getProductLabel(extendContext.productId).en}
                  »
                </h3>
                <p className="text-xs text-zinc-400">
                  Доступный поток:{' '}
                  <span className="font-mono text-emerald-300">
                    {formatRate(extendContext.availableRate60, rateUnit)}
                  </span>{' '}
                  — выберите следующий передел для добавления в фабрику
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExtendContext(null)}
                className="rounded-lg p-1 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {extensionOptions.length === 0 ? (
                <div className="col-span-2 py-8 text-center text-xs text-zinc-500">
                  Нет перерабатывающих рецептов для этого ресурса.
                </div>
              ) : (
                extensionOptions.map((ext) => {
                  const rLbl = getRecipeLabel(ext.recipe.id);
                  const mLbl = getMachineLabel(ext.machine.id);
                  const outLbl = getProductLabel(ext.primaryOutputId);
                  const outProd = PRODUCTS[ext.primaryOutputId];
                  const targetRate60 = Math.max(
                    1,
                    Number(
                      (
                        (extendContext.availableRate60 * ext.outputPerCycle) /
                        ext.inputPerCycle
                      ).toFixed(1),
                    ),
                  );

                  return (
                    <button
                      key={ext.recipe.id}
                      type="button"
                      onClick={() => {
                        onAddTargetWithRate(
                          ext.primaryOutputId,
                          targetRate60,
                          ext.recipe.id,
                        );
                        setExtendContext(null);
                      }}
                      className="flex flex-col gap-1.5 rounded-xl border border-white/[0.08] bg-[#09090b] p-2.5 text-left transition-all duration-150 hover:border-emerald-500/45 hover:bg-[#18181b]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {outProd && (
                            <img
                              src={getProductIconUrl(outProd.icon)}
                              alt={outLbl.en}
                              className="h-6 w-6 shrink-0 object-contain"
                            />
                          )}
                          <div className="min-w-0">
                            <div className="truncate text-xs font-semibold text-emerald-300">
                              + {outLbl.ru ?? outLbl.en}
                            </div>
                            <div className="truncate text-[10px] text-zinc-400">
                              {mLbl.ru} • {rLbl.ru}
                            </div>
                          </div>
                        </div>
                        <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                          +{formatRate(targetRate60, rateUnit)}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-zinc-400">
                        {ext.recipe.inputs.map((i) => (
                          <span
                            key={i.id}
                            className="rounded bg-white/[0.04] px-1 py-0.5"
                          >
                            {i.quantity} {getProductLabel(i.id).ru ?? i.name}
                          </span>
                        ))}
                        <ArrowRight className="h-3 w-3 text-zinc-600" />
                        {ext.recipe.outputs.map((o) => (
                          <span
                            key={o.id}
                            className="rounded bg-emerald-500/10 px-1 py-0.5 text-emerald-300"
                          >
                            {o.quantity} {getProductLabel(o.id).ru ?? o.name}
                          </span>
                        ))}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export const FlowGraphView: React.FC<FlowGraphViewProps> = (props) => {
  return (
    <ReactFlowProvider>
      <FlowGraphInner {...props} />
    </ReactFlowProvider>
  );
};
