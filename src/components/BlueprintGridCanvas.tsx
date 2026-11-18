import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Eye,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
} from 'lucide-react';
import {
  PRODUCTS,
  VIRTUAL_PRODUCT_IDS,
  getMachineIconUrl,
  getProductIconUrl,
  getProductLabel,
  getTransportIconForKind,
} from '../data';
import { normalizeRotIndex } from '../data/buildingLayouts';
import {
  type CompactGridPlan,
  type CustomTilePlacement,
  type GridTransportRoute,
  type PlacedGridBuilding,
  buildCompactGridLayout,
} from '../engine/blueprintGridPlanner';
import {
  decodeGameBlueprint,
  encodeGridPlanToGameBlueprint,
} from '../engine/gameBlueprint';
import type {
  FactoryPlanConfig,
  LogisticsSummary,
  RateUnit,
  SolveResult,
  SolvedStep,
} from '../types/coi';
import { cn } from '../utils/cn';
import { copyTextToClipboard } from '../utils/clipboard';
import { formatRate } from '../utils/format';

export const GRID_PLACEMENTS_STORAGE_PREFIX = 'coi_grid_placements_v1_';

export function getGridPlacementsStorageKey(planId: string): string {
  return `${GRID_PLACEMENTS_STORAGE_PREFIX}${planId}`;
}

export function loadSavedGridPlacements(
  planId: string,
): Record<string, CustomTilePlacement> {
  try {
    const raw = localStorage.getItem(getGridPlacementsStorageKey(planId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CustomTilePlacement>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

// Reference compact blueprint from Captain of Industry ("Плавильня 1") for visual comparison on the 1:1 grid
const REFERENCE_SMELTERY_B1648 =
  'B1648:H4sIAAAAAAAACo1WwWsjVRz+venLZPq2SbPp7PgcSwgljCGUkIZQx1ICUlQKLVtsT17KkM52R7IzYTIVe/TmQfCqIPgfiOhFXITNIrKIaHYRQQ8i4mFZFg+LqKAs/t5LmozudNLynd683/u+933fTJr9QSGZRv25+vN/EUUffjC8Ofxo+PHw0+HNu28PP7/7TnltDvYpLVwNvWPPd7ov+pEXnW4f3blFMsWd4NjrR16nv+33TqLd4MgFdWmyePUkOlvNLr7s+m7odPdCLwjxgCIQbX4vDKIgOu2585f3b7jdyPOPXzoJfafjHqwRln3F7Xg9t69cKm6HgX+242BtK3C6C0v/XdvvhE6P5OYPQsfvXwvCGxnGAIDSr1AnqJAVhPnc1TdOj11/TEIYWcztR67bPTuH5DJlTY59HRsrLGw5/cgNt4Kg6x7h1OWinBKrODRezmWaDBRQinmpoReE0VbQDcI3//n7z8UlfbL4Qqfj+qNHj7997xMVCfTibtCNXH/XjZzu1nXH990ukCsMZ15zO1EQnuYIqiKg6Aw4shRHh07mcbPYoSB0DQwNCL13i+ATw9r1fO9Vr3e4Hewh+f51p+ceJrHlMlzcnNDv5OBT1R3vWhQf2gmCvrvroA8ejgX+6+5pEB4erolRYEBx9Hs5yp+92GhTTBp5JP3/fZ5W9zD4gzVQrhTw1nizOSsPVl41Edk9r9t1wn5GsfJm/olRnFkSZilAdQo6VTliQTUzik45JfRXqfEZnuSLYJVO5NUnRQmTz06ualBDUGhS7Mr9WFfmCVMuLeAZzJQ9ehCvnyicqBiXjx7GKyZaJSpkygolxysLYAI30wvAweAYxqNRAeR9uEz291GyMjBTBvbHKDAZRCkpiHgCJbBKqlkSVlols0To45GVkqE0yzEONYQOTT2RJQdSvsINlS8LCm7w5bRwzYJmIYoIwO1mwSokn6tI37iu8aJmzhGuJ20zpHWAyaMbmoVQEGDOU57nlIOFZr0/mF63oCWbNVXHbISOEIcIdXbBTqSeKmS8yC6gkHFgNoIiwMypZwptsLHfn8VVsmSVE8plxg0mzF7mRvpGjRvaeCOlXwySCl+Trf5ykFD4qnx0Z5BQ+NqswteA19ILXwWjivl8M5gWvioLPxxMC1+Thb83mBa+PqvwdbDqqlmXha+bdUJ/jHlbn1X4KtQQFWhW8Oo/JTq2IW35OckxWz76JcmxjVmObQDfSHfMBsNGN+7HHLOlYw9ijm1Ixx7GHGvPcqwNVls129KxttnGT07MsfYsx2yoIVrQbKV/ItZVvik/Eet8M/UlbGgWoomQn4iG1UgteUvjTfmJaBH61u2p8Masl73BbEQLIV925LEbdiudi/EmG3O9G+ea9cpuMr4uX9lNvp6+UePrWurGsZ1lla+oQko5MdtRZ+b0CugV1aiInXol9UBL5avywFVCP4zdrZJQADHIRpIJL0n3S6nXqmt8RTOzc7zOV3mijkksZc1CrCBE/Mtlq0zo7Zie8jm5TvWwC+hhfIVdUA+zERWEqInQY5ftCn5W4prOyX8SQwv0lmq0ZAznVGwcQ0PlTRlDA//riVG0zolhQqGDrquGLinO+ckaUxRUXpQUBUJ/i1HoSHH29y8gI88iYQwAAA==';

const KIND_COLOR: Record<Exclude<LogisticsSummary['kind'], 'virtual'>, string> = {
  flat: '#10b981',
  loose: '#f59e0b',
  fluid: '#06b6d4',
  molten: '#f97316',
};

interface BlueprintGridCanvasProps {
  plan: FactoryPlanConfig;
  solveResult: SolveResult;
  rateUnit: RateUnit;
  includeDisposalBuildings?: boolean;
  includeBufferStorages?: boolean;
  onOpenRecipeModal?: (productId: string, step?: SolvedStep) => void;
}

export const BlueprintGridCanvas: React.FC<BlueprintGridCanvasProps> = ({
  plan,
  solveResult,
  rateUnit,
  includeDisposalBuildings = true,
  includeBufferStorages = true,
  onOpenRecipeModal,
}) => {
  const [tilePx, setTilePx] = useState(22);
  const [pan, setPan] = useState({ x: 24, y: 24 });
  const [showReference, setShowReference] = useState(false);
  const [zFilter, setZFilter] = useState<'all' | 'z0' | 'z1' | 'z2' | 'z3+'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredRouteId, setHoveredRouteId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedCount, setCopiedCount] = useState(0);

  const [customPlacements, setCustomPlacements] = useState<
    Record<string, CustomTilePlacement>
  >(() => loadSavedGridPlacements(plan.id));

  useEffect(() => {
    setCustomPlacements(loadSavedGridPlacements(plan.id));
    setSelectedId(null);
    setZFilter('all');
  }, [plan.id]);

  const persistPlacements = useCallback(
    (next: Record<string, CustomTilePlacement>) => {
      setCustomPlacements(next);
      try {
        localStorage.setItem(
          getGridPlacementsStorageKey(plan.id),
          JSON.stringify(next),
        );
      } catch {
        // ignore quota errors
      }
    },
    [plan.id],
  );

  const generatedGrid = useMemo(
    () =>
      buildCompactGridLayout(
        solveResult,
        {
          includeDisposalBuildings,
          includeBufferStorages,
        },
        customPlacements,
      ),
    [solveResult, includeDisposalBuildings, includeBufferStorages, customPlacements],
  );

  const referenceGrid = useMemo(() => {
    if (!showReference) return null;
    try {
      return decodeGameBlueprint(REFERENCE_SMELTERY_B1648).gridPlan;
    } catch {
      return null;
    }
  }, [showReference]);

  const activeGrid: CompactGridPlan = referenceGrid ?? generatedGrid;
  const stepById = useMemo(
    () => new Map(solveResult.steps.map((s) => [s.stepId, s])),
    [solveResult.steps],
  );

  const PAD_TILES = 3;
  const minX = activeGrid.bounds.minX - PAD_TILES;
  const maxX = activeGrid.bounds.maxX + PAD_TILES;
  const minY = activeGrid.bounds.minY - PAD_TILES;
  const maxY = activeGrid.bounds.maxY + PAD_TILES;
  const gridTilesW = Math.max(12, maxX - minX + 1);
  const gridTilesH = Math.max(12, maxY - minY + 1);
  const canvasW = gridTilesW * tilePx;
  const canvasH = gridTilesH * tilePx;

  const toScreenX = useCallback(
    (wx: number) => (wx - minX) * tilePx,
    [minX, tilePx],
  );
  // COI world Y points North (up); map maxY + 1 to top edge y = 0
  const toScreenY = useCallback(
    (wy: number) => (maxY + 1 - wy) * tilePx,
    [maxY, tilePx],
  );

  // Dragging either canvas pan or building snap-to-tile
  const viewportRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    mode: 'pan' | 'building';
    buildingId?: string;
    startClientX: number;
    startClientY: number;
    origPanX: number;
    origPanY: number;
    origMinX?: number;
    origMinY?: number;
    origRot?: 0 | 1 | 2 | 3;
    deltaTilesX: number;
    deltaTilesY: number;
  } | null>(null);

  // Auto-center initial pan whenever activeGrid or reference toggle changes
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (vw <= 0 || vh <= 0) return;
    const fitZoom = Math.floor(
      Math.min((vw - 40) / gridTilesW, (vh - 40) / gridTilesH),
    );
    const nextTilePx = Math.max(16, Math.min(28, fitZoom || 22));
    setTilePx(nextTilePx);
    const nextW = gridTilesW * nextTilePx;
    const nextH = gridTilesH * nextTilePx;
    setPan({
      x: Math.round(Math.max(16, (vw - nextW) / 2)),
      y: Math.round(Math.max(16, (vh - nextH) / 2)),
    });
  }, [plan.id, showReference, gridTilesW, gridTilesH]);

  const handleViewportPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    setSelectedId(null);
    setDragState({
      mode: 'pan',
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      deltaTilesX: 0,
      deltaTilesY: 0,
    });
  };

  const handleBuildingPointerDown = (
    e: React.PointerEvent,
    b: PlacedGridBuilding,
  ) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    setSelectedId(b.id);
    if (showReference) return;
    setDragState({
      mode: 'building',
      buildingId: b.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      origPanX: pan.x,
      origPanY: pan.y,
      origMinX: b.minX,
      origMinY: b.minY,
      origRot: b.rotIndex,
      deltaTilesX: 0,
      deltaTilesY: 0,
    });
  };

  useEffect(() => {
    if (!dragState) return;
    const handleMove = (e: PointerEvent) => {
      const dx = e.clientX - dragState.startClientX;
      const dy = e.clientY - dragState.startClientY;
      if (dragState.mode === 'pan') {
        setPan({ x: dragState.origPanX + dx, y: dragState.origPanY + dy });
      } else {
        setDragState((prev) =>
          prev
            ? {
                ...prev,
                deltaTilesX: Math.round(dx / tilePx),
                deltaTilesY: Math.round(-dy / tilePx),
              }
            : null,
        );
      }
    };
    const handleUp = () => {
      if (
        dragState.mode === 'building' &&
        dragState.buildingId &&
        dragState.origMinX !== undefined &&
        dragState.origMinY !== undefined &&
        (dragState.deltaTilesX !== 0 || dragState.deltaTilesY !== 0)
      ) {
        const nextPlacements = {
          ...customPlacements,
          [dragState.buildingId]: {
            minX: dragState.origMinX + dragState.deltaTilesX,
            minY: dragState.origMinY + dragState.deltaTilesY,
            rotIndex: normalizeRotIndex(dragState.origRot ?? 0),
          },
        };
        persistPlacements(nextPlacements);
      }
      setDragState(null);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
  }, [dragState, tilePx, customPlacements, persistPlacements]);

  const selectedBuilding = useMemo(
    () => activeGrid.buildings.find((b) => b.id === selectedId) ?? null,
    [activeGrid.buildings, selectedId],
  );

  const handleRotateSelected = () => {
    if (!selectedBuilding || showReference) return;
    const nextRot = normalizeRotIndex(selectedBuilding.rotIndex + 1);
    persistPlacements({
      ...customPlacements,
      [selectedBuilding.id]: {
        minX: selectedBuilding.minX,
        minY: selectedBuilding.minY,
        rotIndex: nextRot,
      },
    });
  };

  const handleResetGrid = () => {
    persistPlacements({});
    setSelectedId(null);
  };

  const copyTimerRef = useRef<number | null>(null);

  const handleCopyGameBlueprint = async () => {
    const bp = encodeGridPlanToGameBlueprint(
      activeGrid,
      showReference ? 'Плавильня 1 (Копия)' : plan.name,
    );
    await copyTextToClipboard(bp.code);
    setCopiedCode(bp.code);
    setCopiedCount(bp.entityCount);
    if (copyTimerRef.current) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => setCopiedCode(null), 5000);
  };

  const buildRoutePolylinePoints = (rt: GridTransportRoute): string => {
    const pts: [number, number][] = [];
    const srcBld = rt.fromBuildingId
      ? activeGrid.buildings.find((b) => b.id === rt.fromBuildingId)
      : undefined;
    const srcPort = srcBld?.ports.find((p) => p.name === rt.fromPortName);
    if (srcPort) {
      pts.push([
        toScreenX(srcPort.tileX + 0.5 + srcPort.dirX * 0.5),
        toScreenY(srcPort.tileY + 0.5 + srcPort.dirY * 0.5),
      ]);
    }
    for (const [px, py] of rt.pivots) {
      pts.push([toScreenX(px + 0.5), toScreenY(py + 0.5)]);
    }
    const dstBld = rt.toBuildingId
      ? activeGrid.buildings.find((b) => b.id === rt.toBuildingId)
      : undefined;
    const dstPort = dstBld?.ports.find((p) => p.name === rt.toPortName);
    if (dstPort) {
      pts.push([
        toScreenX(dstPort.tileX + 0.5 + dstPort.dirX * 0.5),
        toScreenY(dstPort.tileY + 0.5 + dstPort.dirY * 0.5),
      ]);
    }
    return pts.map(([x, y]) => `${x},${y}`).join(' ');
  };

  const getRouteMidpoint = (rt: GridTransportRoute): [number, number] | null => {
    if (rt.pivots.length < 2) return null;
    const midIdx = Math.floor((rt.pivots.length - 1) / 2);
    const a = rt.pivots[midIdx];
    const b = rt.pivots[midIdx + 1];
    return [
      toScreenX((a[0] + b[0]) / 2 + 0.5),
      toScreenY((a[1] + b[1]) / 2 + 0.5),
    ];
  };

  const inputStorages = useMemo(
    () => activeGrid.buildings.filter((b) => b.role === 'input_storage'),
    [activeGrid.buildings],
  );
  const outputStorages = useMemo(
    () => activeGrid.buildings.filter((b) => b.role === 'output_storage'),
    [activeGrid.buildings],
  );
  const liftCount = useMemo(
    () => activeGrid.buildings.filter((b) => b.role === 'lift').length,
    [activeGrid.buildings],
  );

  const matchesZFilter = useCallback(
    (z: number) => {
      if (zFilter === 'all') return true;
      if (zFilter === 'z0') return z === 0;
      if (zFilter === 'z1') return z === 1;
      if (zFilter === 'z2') return z === 2;
      return z >= 3;
    },
    [zFilter],
  );

  return (
    <div className="flex flex-col gap-2.5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#121214] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5">
            <button
              type="button"
              onClick={() => setShowReference(false)}
              className={cn(
                'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                !showReference
                  ? 'bg-[#18181b] text-emerald-300 ring-1 ring-white/[0.08]'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              Схема цеха ({plan.name})
            </button>
            <button
              type="button"
              onClick={() => setShowReference(true)}
              className={cn(
                'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                showReference
                  ? 'bg-[#18181b] text-amber-300 ring-1 ring-white/[0.08]'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
              title="Показать эталонный чертёж Плавильня 1 (B1648) на сетке 1:1"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Эталон: Плавильня 1 (B1648)</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[11px] tabular-nums">
            <span className="rounded border border-sky-500/25 bg-sky-500/10 px-2 py-0.5 text-sky-300">
              Складов входа: {activeGrid.inputStoragesCount}
            </span>
            <span className="rounded border border-white/[0.08] bg-[#09090b] px-2 py-0.5 text-zinc-300">
              Зданий: {activeGrid.buildings.length}
            </span>
            <span className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
              Складов выхода: {activeGrid.outputStoragesCount}
            </span>
            <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-amber-300">
              Конвейеры/трубы: {activeGrid.transportCount}
            </span>
            {liftCount > 0 && (
              <span className="rounded border border-violet-500/25 bg-violet-500/10 px-2 py-0.5 text-violet-300">
                Подъёмники: {liftCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5 font-mono text-[10px]">
            <span className="px-1.5 text-zinc-500">Уровень:</span>
            {(['all', 'z0', 'z1', 'z2', 'z3+'] as const).map((zf) => (
              <button
                key={zf}
                type="button"
                onClick={() => setZFilter(zf)}
                className={cn(
                  'rounded px-1.5 py-0.5 transition-colors',
                  zFilter === zf
                    ? 'bg-[#18181b] font-semibold text-violet-300 ring-1 ring-violet-500/40'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                {zf === 'all' ? 'Все Z' : zf.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {selectedBuilding && !showReference && (
            <button
              type="button"
              onClick={handleRotateSelected}
              className="flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-xs font-semibold text-amber-200 transition-colors hover:bg-amber-500/25"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Повернуть 90°</span>
            </button>
          )}

          {!showReference && (
            <button
              type="button"
              onClick={handleResetGrid}
              title="Вернуть компактную авто-раскладку по колонкам"
              className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#09090b] px-2.5 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/[0.2] hover:text-emerald-300"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>Сбросить сетку</span>
            </button>
          )}

          <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#09090b]">
            <button
              type="button"
              onClick={() => setTilePx((z) => Math.max(12, z - 3))}
              className="px-2 py-1.5 text-zinc-400 hover:text-zinc-100"
              title="Отдалить сетку"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 font-mono text-[11px] tabular-nums text-zinc-300">
              {tilePx}px
            </span>
            <button
              type="button"
              onClick={() => setTilePx((z) => Math.min(40, z + 3))}
              className="px-2 py-1.5 text-zinc-400 hover:text-zinc-100"
              title="Приблизить сетку"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleCopyGameBlueprint}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/45 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
          >
            {copiedCode ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span>
              {copiedCode
                ? `Скопировано (${copiedCount} об.)`
                : 'Скопировать чертёж в игру (B...)'}
            </span>
          </button>
        </div>
      </div>

      {/* Input & Output Storage Balance Bar (exact required inflow per minute for target output) */}
      {(inputStorages.length > 0 || outputStorages.length > 0) && (
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-500/20 bg-[#0d141c]/80 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">
              Вход (Подача сырья):
            </span>
            {inputStorages.length === 0 ? (
              <span className="text-xs text-zinc-500">Нет внешнего сырья</span>
            ) : (
              inputStorages.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-1.5 rounded-lg border border-sky-500/25 bg-[#09090b] px-2 py-1 text-xs"
                >
                  {b.storedProductIcon && (
                    <img
                      src={getProductIconUrl(b.storedProductIcon)}
                      alt={b.storedProductNameRu}
                      className="h-4 w-4 shrink-0 object-contain"
                    />
                  )}
                  <span className="text-zinc-200">{b.storedProductNameRu}</span>
                  {b.flowRatePer60 !== undefined && (
                    <span className="font-mono font-semibold tabular-nums text-sky-300">
                      +{formatRate(b.flowRatePer60, rateUnit)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-500/20 bg-[#0c1a15]/80 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
              Выход (Готовый продукт):
            </span>
            {outputStorages.length === 0 ? (
              <span className="text-xs text-zinc-500">Нет целевых складов</span>
            ) : (
              outputStorages.map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-1.5 rounded-lg border border-emerald-500/25 bg-[#09090b] px-2 py-1 text-xs"
                >
                  {b.storedProductIcon && (
                    <img
                      src={getProductIconUrl(b.storedProductIcon)}
                      alt={b.storedProductNameRu}
                      className="h-4 w-4 shrink-0 object-contain"
                    />
                  )}
                  <span className="text-zinc-200">{b.storedProductNameRu}</span>
                  {b.flowRatePer60 !== undefined && (
                    <span className="font-mono font-semibold tabular-nums text-emerald-300">
                      → {formatRate(b.flowRatePer60, rateUnit)}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Interactive 1:1 COI Tile Grid Viewport */}
      <div
        ref={viewportRef}
        onPointerDown={handleViewportPointerDown}
        className="relative h-[660px] w-full select-none overflow-hidden rounded-xl border border-white/[0.08] bg-[#09090b] cursor-grab active:cursor-grabbing"
      >
        <div
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px)`,
            width: canvasW,
            height: canvasH,
          }}
          className="relative origin-top-left"
        >
          {/* SVG Tile Grid + Transports */}
          <svg
            width={canvasW}
            height={canvasH}
            className="absolute inset-0 overflow-visible"
          >
            <defs>
              <pattern
                id="coi-tile-grid-1"
                width={tilePx}
                height={tilePx}
                patternUnits="userSpaceOnUse"
              >
                <path
                  d={`M ${tilePx} 0 L 0 0 0 ${tilePx}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.045)"
                  strokeWidth="1"
                />
              </pattern>
              <pattern
                id="coi-tile-grid-5"
                width={tilePx * 5}
                height={tilePx * 5}
                patternUnits="userSpaceOnUse"
              >
                <rect width={tilePx * 5} height={tilePx * 5} fill="url(#coi-tile-grid-1)" />
                <path
                  d={`M ${tilePx * 5} 0 L 0 0 0 ${tilePx * 5}`}
                  fill="none"
                  stroke="rgba(255,255,255,0.11)"
                  strokeWidth="1"
                />
              </pattern>
            </defs>

            <rect width={canvasW} height={canvasH} fill="url(#coi-tile-grid-5)" />

            {/* Conveyor, Pipe, and Molten Channel Tracks */}
            {activeGrid.routes.map((rt) => {
              const pts = buildRoutePolylinePoints(rt);
              const color = KIND_COLOR[rt.kind];
              const isHighlighted =
                hoveredRouteId === rt.id ||
                (selectedId !== null &&
                  (rt.fromBuildingId === selectedId || rt.toBuildingId === selectedId));
              const matchesZ = matchesZFilter(rt.zLevel ?? 0);
              const mid = getRouteMidpoint(rt);
              const zBadgeOffset = (rt.zLevel ?? 0) > 0 ? 12 : 0;

              return (
                <g
                  key={rt.id}
                  onMouseEnter={() => setHoveredRouteId(rt.id)}
                  onMouseLeave={() => setHoveredRouteId(null)}
                  opacity={matchesZ ? 1 : 0.14}
                  className="cursor-pointer transition-opacity duration-150"
                >
                  {/* Dark outer casing (subtle violet/amber aura when elevated Z > 0) */}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={(rt.zLevel ?? 0) > 0 ? '#1e1b2e' : '#09090b'}
                    strokeWidth={Math.max(6, tilePx * 0.42)}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {/* Belt / pipe bed */}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke={color}
                    strokeWidth={
                      isHighlighted
                        ? Math.max(4, tilePx * 0.28)
                        : Math.max(2.5, tilePx * 0.2)
                    }
                    strokeDasharray={rt.kind === 'loose' ? '6 3' : undefined}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    opacity={isHighlighted ? 1 : 0.85}
                  />
                  {/* Directional center stripe */}
                  <polyline
                    points={pts}
                    fill="none"
                    stroke="rgba(255,255,255,0.45)"
                    strokeWidth={1.2}
                    strokeDasharray="2 7"
                    strokeLinejoin="round"
                  />
                  {/* Endpoint dot */}
                  {rt.pivots.length >= 2 && (
                    <circle
                      cx={toScreenX(rt.pivots[rt.pivots.length - 1][0] + 0.5)}
                      cy={toScreenY(rt.pivots[rt.pivots.length - 1][1] + 0.5)}
                      r={Math.max(2.5, tilePx * 0.14)}
                      fill={color}
                      stroke="#09090b"
                      strokeWidth="1"
                    />
                  )}
                  {/* Midpoint badge with transport icon, material icon, rate, and height level (Z1..Z5) */}
                  {mid && tilePx >= 16 && (
                    <g
                      transform={`translate(${mid[0]}, ${mid[1]})`}
                      opacity={isHighlighted ? 1 : 0.92}
                    >
                      <rect
                        x={-24 - zBadgeOffset / 2}
                        y={-9}
                        width={48 + zBadgeOffset}
                        height={18}
                        rx={4}
                        fill="#09090b"
                        stroke={color}
                        strokeOpacity={isHighlighted ? 0.95 : 0.45}
                        strokeWidth="1"
                      />
                      <image
                        href={rt.iconUrl}
                        x={-21 - zBadgeOffset / 2}
                        y={-7}
                        width={14}
                        height={14}
                      />
                      {rt.productIcon ? (
                        <image
                          href={getProductIconUrl(rt.productIcon)}
                          x={-5 - zBadgeOffset / 2}
                          y={-6}
                          width={12}
                          height={12}
                        />
                      ) : null}
                      <text
                        x={(rt.productIcon ? 9 : -4) - zBadgeOffset / 2}
                        y={3}
                        fill="#e4e4e7"
                        fontSize="8.5"
                        fontFamily="ui-monospace, SFMono-Regular, monospace"
                      >
                        {rt.ratePer60 > 0 && !showReference
                          ? `${Math.round(rt.ratePer60)}`
                          : rt.protoId.replace('MoltenMetalChannel', 'Жел').replace('Pipe', 'Тр')}
                      </text>
                      {(rt.zLevel ?? 0) > 0 && (
                        <text
                          x={24 + zBadgeOffset / 2 - 2}
                          y={3}
                          textAnchor="end"
                          fill="#c4b5fd"
                          fontSize="7.5"
                          fontWeight="700"
                          fontFamily="ui-monospace, SFMono-Regular, monospace"
                        >
                          Z{rt.zLevel}
                        </text>
                      )}
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Building & Storage Footprint Cards */}
          {activeGrid.buildings.map((b) => {
            const isDraggingThis =
              dragState?.mode === 'building' && dragState.buildingId === b.id;
            const liveMinX =
              b.minX + (isDraggingThis ? dragState.deltaTilesX : 0);
            const liveMinY =
              b.minY + (isDraggingThis ? dragState.deltaTilesY : 0);

            const left = toScreenX(liveMinX);
            const top = toScreenY(liveMinY + b.height);
            const width = b.width * tilePx;
            const height = b.height * tilePx;
            const isSelected = selectedId === b.id;

            if (b.role === 'junction') {
              const jMatches = matchesZFilter(b.tz);
              return (
                <div
                  key={b.id}
                  onPointerDown={(e) => handleBuildingPointerDown(e, b)}
                  style={{ left, top, width, height }}
                  title={`${b.machineNameRu} (${b.prototype} • Z=${b.tz})`}
                  className={cn(
                    'absolute flex items-center justify-center rounded border bg-[#18181b]/95 cursor-move transition-opacity',
                    jMatches ? 'opacity-100' : 'opacity-20',
                    isSelected
                      ? 'border-amber-400 ring-2 ring-amber-400/30'
                      : b.tz > 0
                        ? 'border-violet-400/60'
                        : 'border-white/25',
                  )}
                >
                  {b.tz > 0 && tilePx >= 18 ? (
                    <span className="font-mono text-[8px] font-bold text-violet-300">
                      Z{b.tz}
                    </span>
                  ) : (
                    <span className="h-2 w-2 rotate-45 bg-amber-400/90" />
                  )}
                </div>
              );
            }

            if (b.role === 'lift') {
              const liftMatch = b.prototype.match(/_(\d+)$/);
              const liftZ = liftMatch ? Number(liftMatch[1]) : 1;
              const isDown = b.prototype.includes('__');
              const liftMatchesZ =
                zFilter === 'all' || zFilter === 'z0' || matchesZFilter(liftZ);
              return (
                <div
                  key={b.id}
                  onPointerDown={(e) => handleBuildingPointerDown(e, b)}
                  style={{ left, top, width, height }}
                  title={`${b.machineNameRu} (${b.prototype})${b.storedProductNameRu ? ` • ${b.storedProductNameRu}` : ''}`}
                  className={cn(
                    'absolute flex items-center justify-center gap-0.5 rounded border cursor-move transition-opacity',
                    liftMatchesZ ? 'opacity-100' : 'opacity-25',
                    isDown
                      ? 'border-amber-400/75 bg-amber-950/90 text-amber-200'
                      : 'border-violet-400/75 bg-violet-950/90 text-violet-200',
                    isSelected && 'ring-2 ring-emerald-400',
                  )}
                >
                  <span className="font-mono text-[9px] font-bold leading-none">
                    {isDown ? '↓' : '↑'}Z{liftZ}
                  </span>
                </div>
              );
            }

            const isDumpTank =
              b.role === 'disposal' && b.prototype.startsWith('StorageFluid');
            const isStorage =
              b.role === 'input_storage' ||
              b.role === 'output_storage' ||
              b.role === 'buffer_storage' ||
              isDumpTank;

            const roleStyles =
              b.role === 'input_storage'
                ? 'border-sky-400/55 bg-[#0c1a27]/95 shadow-[0_0_18px_-6px_rgba(56,189,248,0.35)]'
                : b.role === 'output_storage'
                  ? 'border-emerald-400/60 bg-[#0b2117]/95 shadow-[0_0_18px_-6px_rgba(16,185,129,0.35)]'
                  : isDumpTank
                    ? 'border-cyan-400/55 bg-[#091c24]/95 shadow-[0_0_18px_-6px_rgba(34,211,238,0.3)]'
                    : b.role === 'disposal'
                      ? 'border-orange-400/50 bg-[#21150b]/95'
                      : b.role === 'buffer_storage'
                        ? 'border-amber-400/50 bg-[#201b0c]/95'
                        : 'border-white/20 bg-[#141418]/95';

            const linkedStep = b.stepId ? stepById.get(b.stepId) : undefined;

            return (
              <div
                key={b.id}
                onPointerDown={(e) => handleBuildingPointerDown(e, b)}
                style={{ left, top, width, height }}
                title={
                  isDumpTank
                    ? `${b.customTitle ?? b.machineNameRu} — подключите береговую сливную трубу (WasteDump) к выходу цистерны`
                    : b.customTitle ?? b.machineNameRu
                }
                className={cn(
                  'group absolute overflow-visible rounded-md border transition-shadow duration-150',
                  !showReference ? 'cursor-move' : 'cursor-pointer',
                  roleStyles,
                  isSelected && 'ring-2 ring-emerald-400/70 border-emerald-400',
                  isDraggingThis && 'z-30 opacity-90 shadow-2xl',
                )}
              >
                {/* Port markers around exact building perimeter walls */}
                {b.ports.map((p) => {
                  const px = toScreenX(p.tileX + 0.5 + p.dirX * 0.48) - left;
                  const py = toScreenY(p.tileY + 0.5 + p.dirY * 0.48) - top;
                  const pColor = KIND_COLOR[p.kind];
                  return (
                    <div
                      key={p.name}
                      style={{
                        left: px - 4,
                        top: py - 4,
                        backgroundColor: p.isInput ? '#09090b' : pColor,
                        borderColor: pColor,
                      }}
                      title={`${p.name} (${p.isInput ? 'Вход' : 'Выход'}, ${p.kind})`}
                      className="pointer-events-none absolute z-20 flex h-2 w-2 items-center justify-center rounded-[2px] border"
                    />
                  );
                })}

                {/* Centered Machine / Storage Sprite (never crushed to 0px on small footprints) */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-1">
                  <img
                    src={getMachineIconUrl(b.machineIcon)}
                    alt={b.machineNameRu}
                    draggable={false}
                    style={{
                      maxHeight: Math.max(18, height - 8),
                      maxWidth: Math.max(18, width - 8),
                    }}
                    className="h-[72%] w-[72%] object-contain opacity-95 drop-shadow"
                  />
                </div>

                {/* Top Corner Strip: Role / Size + Product Sprite + Switch Action */}
                <div className="relative z-10 flex items-start justify-between gap-0.5 p-0.5">
                  {b.role === 'input_storage' ? (
                    <span className="truncate rounded bg-[#09090b]/85 px-1 py-0.2 text-[8px] font-bold uppercase tracking-wider text-sky-300 ring-1 ring-sky-500/30">
                      Вход
                    </span>
                  ) : b.role === 'output_storage' ? (
                    <span className="truncate rounded bg-[#09090b]/85 px-1 py-0.2 text-[8px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                      Выход
                    </span>
                  ) : isDumpTank ? (
                    <span className="truncate rounded bg-[#09090b]/85 px-1 py-0.2 text-[8px] font-bold uppercase text-cyan-300 ring-1 ring-cyan-500/35">
                      Под слив
                    </span>
                  ) : b.role === 'disposal' ? (
                    <span className="truncate rounded bg-[#09090b]/85 px-1 py-0.2 text-[8px] font-bold uppercase text-orange-300 ring-1 ring-orange-500/30">
                      Сброс
                    </span>
                  ) : (
                    <span className="truncate rounded bg-[#09090b]/75 px-1 font-mono text-[8px] text-zinc-400">
                      {b.width}×{b.height} {b.rotIndex * 90}°
                    </span>
                  )}

                  <div className="flex items-center gap-0.5 shrink-0">
                    {(b.storedProductIcon ||
                      (b.storedProductId && PRODUCTS[b.storedProductId])) && (
                      <img
                        src={getProductIconUrl(
                          b.storedProductIcon ??
                            PRODUCTS[b.storedProductId!]?.icon,
                        )}
                        alt={b.storedProductNameRu ?? ''}
                        draggable={false}
                        className="h-4 w-4 rounded bg-[#09090b]/90 p-0.5 object-contain ring-1 ring-white/[0.15]"
                      />
                    )}
                    {onOpenRecipeModal &&
                      linkedStep &&
                      b.role === 'production' &&
                      !showReference && (
                        <button
                          type="button"
                          onPointerDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenRecipeModal(linkedStep.primaryProductId, linkedStep);
                          }}
                          title="Сменить рецепт / источник"
                          className="rounded bg-[#09090b]/90 p-0.5 text-zinc-300 ring-1 ring-white/[0.15] hover:bg-emerald-500/30 hover:text-emerald-300"
                        >
                          <SlidersHorizontal className="h-2.5 w-2.5" />
                        </button>
                      )}
                  </div>
                </div>

                {/* Bottom Overlay Label: Name & Exact Flow Rate (/60s) */}
                {width >= 48 && height >= 42 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 rounded-b-[5px] bg-[#09090b]/88 px-1 py-0.5 text-center leading-tight">
                    <div className="w-full truncate text-[8.5px] font-semibold text-zinc-100">
                      {isStorage
                        ? isDumpTank
                          ? `Слив: ${b.storedProductNameRu ?? b.machineNameRu}`
                          : b.storedProductNameRu ?? b.machineNameRu
                        : b.machineNameRu}
                    </div>
                    {isStorage && b.flowRatePer60 !== undefined ? (
                      <div
                        className={cn(
                          'font-mono text-[8.5px] font-bold tabular-nums',
                          b.role === 'input_storage'
                            ? 'text-sky-300'
                            : isDumpTank
                              ? 'text-cyan-300'
                              : 'text-emerald-300',
                        )}
                      >
                        {b.role === 'input_storage' ? '+' : '→'}
                        {formatRate(b.flowRatePer60, rateUnit)}
                      </div>
                    ) : b.recipeNameRu ? (
                      <div className="w-full truncate text-[7.5px] text-zinc-400">
                        {b.recipeNameRu}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Floating Helper Status Bar */}
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 right-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="rounded-lg border border-white/[0.08] bg-[#121214]/90 px-2.5 py-1 text-[10px] text-zinc-400">
            {showReference
              ? 'Режим просмотра эталонного чертежа игры (B1648 • 83 объекта)'
              : 'Разные материалы разведены по уровням Z0–Z5 и портам без смешивания; к цистернам слива подключите сливную трубу на берегу'}
          </div>
          {selectedBuilding && (
            <div className="rounded-lg border border-emerald-500/35 bg-[#121214]/95 px-2.5 py-1 font-mono text-[10px] text-zinc-200">
              {selectedBuilding.machineNameRu} ({selectedBuilding.prototype}) •{' '}
              поз. ({selectedBuilding.tx}, {selectedBuilding.ty}, z={selectedBuilding.tz}) •{' '}
              {selectedBuilding.width}×{selectedBuilding.height} • пов. {selectedBuilding.rotIndex * 90}°
              {selectedBuilding.storedProductId && (
                <> • {getProductLabel(selectedBuilding.storedProductId).ru}</>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
