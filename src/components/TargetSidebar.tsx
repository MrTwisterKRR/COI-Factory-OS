import React, { useEffect, useRef, useState } from 'react';
import {
  Anchor,
  ArrowRight,
  Check,
  ChevronDown,
  Factory,
  Gauge,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import type {
  FactoryPlanConfig,
  ProductionTarget,
  RateUnit,
  SolveResult,
  UnlockedGameFilter,
} from '../types/coi';
import {
  CONTRACTS_BY_ID,
  MACHINES,
  PRODUCTS,
  getMachineIconUrl,
  getMachineLabel,
  getProductIconUrl,
  getProductLabel,
  getRecipeLabel,
} from '../data';
import { getProducingRecipes } from '../engine/solver';
import { cn } from '../utils/cn';
import { formatNumber, rateUnitLabel } from '../utils/format';

interface TargetSidebarProps {
  plan: FactoryPlanConfig;
  solveResult: SolveResult;
  rateUnit: RateUnit;
  unlockedFilter?: UnlockedGameFilter;
  onOpenAddTarget: () => void;
  onUpdateTarget: (targetId: string, patch: Partial<ProductionTarget>) => void;
  onRemoveTarget: (targetId: string) => void;
  onSelectRecipeOverride: (productId: string, recipeId: string) => void;
  onClearRecipeOverride: (productId: string) => void;
  onToggleRawResource: (productId: string) => void;
  onClearContractOverride: (productId: string) => void;
  onResetAllOverrides: () => void;
}

export const TargetSidebar: React.FC<TargetSidebarProps> = ({
  plan,
  solveResult,
  rateUnit,
  unlockedFilter,
  onOpenAddTarget,
  onUpdateTarget,
  onRemoveTarget,
  onSelectRecipeOverride,
  onClearRecipeOverride,
  onToggleRawResource,
  onClearContractOverride,
  onResetAllOverrides,
}) => {
  const [openRecipeTargetId, setOpenRecipeTargetId] = useState<string | null>(null);
  const [showLockedRecipes, setShowLockedRecipes] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setOpenRecipeTargetId(null);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenRecipeTargetId(null);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEsc);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEsc);
    };
  }, []);

  const unitFactor = rateUnit === '1s' ? 1 / 60 : 1;
  const overrideEntries = Object.entries(plan.recipeOverrides);
  const contractEntries = Object.entries(plan.contractOverrides);
  const hasAnyOverrides =
    overrideEntries.length > 0 ||
    plan.rawResources.length > 0 ||
    contractEntries.length > 0;

  return (
    <aside ref={sidebarRef} className="flex w-full flex-col gap-3 lg:w-80 lg:shrink-0">
      {/* Targets Panel */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
              Целевые продукты
            </h2>
            <p className="text-[11px] text-zinc-500">
              Выход фабрики ({rateUnitLabel(rateUnit)}) или кол-во зданий
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenAddTarget}
            className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition-all duration-150 ease-out hover:bg-emerald-500/25"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Цель</span>
          </button>
        </div>

        <div className="mt-3 flex flex-col gap-2.5">
          {plan.targets.length === 0 && (
            <div className="rounded-lg border border-dashed border-white/[0.1] bg-[#09090b]/50 p-4 text-center text-xs text-zinc-500">
              Добавьте целевой продукт для расчёта цепочки.
            </div>
          )}

          {plan.targets.map((target) => {
            const prod = PRODUCTS[target.productId];
            if (!prod) return null;
            const { en, ru } = getProductLabel(target.productId);
            const diag = solveResult.targetDiagnostics.find(
              (d) => d.targetId === target.id,
            );
            const recipes = getProducingRecipes(target.productId);
            const displayRate = Number(
              (target.ratePer60 * unitFactor).toFixed(rateUnit === '1s' ? 2 : 1),
            );

            return (
              <div
                key={target.id}
                className="rounded-lg border border-white/[0.08] bg-[#09090b] p-2.5 transition-all duration-150 ease-out hover:border-white/[0.14]"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={getProductIconUrl(prod.icon)}
                      alt={en}
                      className="h-7 w-7 shrink-0 rounded bg-white/[0.03] p-0.5 object-contain"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-zinc-100">
                        {ru ?? en}
                      </div>
                      {ru && (
                        <div className="truncate text-[10px] text-zinc-500">{en}</div>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemoveTarget(target.id)}
                    className="rounded p-1 text-zinc-500 transition-colors hover:bg-rose-500/15 hover:text-rose-400"
                    title="Удалить цель"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Mode toggle: Rate vs Fixed Machines */}
                <div className="mt-2.5 flex items-center gap-1 rounded-md border border-white/[0.07] bg-[#121214] p-0.5">
                  <button
                    type="button"
                    onClick={() => onUpdateTarget(target.id, { mode: 'rate' })}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded py-1 text-[11px] font-medium transition-all duration-150',
                      target.mode === 'rate'
                        ? 'bg-[#18181b] text-emerald-300 ring-1 ring-white/[0.08]'
                        : 'text-zinc-500 hover:text-zinc-300',
                    )}
                  >
                    <Gauge className="h-3 w-3" />
                    <span>Темп {rateUnitLabel(rateUnit)}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateTarget(target.id, { mode: 'machines' })}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1 rounded py-1 text-[11px] font-medium transition-all duration-150',
                      target.mode === 'machines'
                        ? 'bg-[#18181b] text-amber-300 ring-1 ring-white/[0.08]'
                        : 'text-zinc-500 hover:text-zinc-300',
                    )}
                  >
                    <Factory className="h-3 w-3" />
                    <span>Здания</span>
                  </button>
                </div>

                {/* Numeric Input */}
                <div className="mt-2 flex items-center gap-2">
                  {target.mode === 'rate' ? (
                    <div className="flex flex-1 items-center rounded-md border border-white/[0.1] bg-[#121214] px-2 py-1 focus-within:border-emerald-500/50">
                      <input
                        type="number"
                        min={0}
                        step={rateUnit === '1s' ? 0.5 : 5}
                        value={displayRate}
                        onChange={(e) => {
                          const val = Math.max(0, Number(e.target.value) || 0);
                          onUpdateTarget(target.id, {
                            ratePer60: val / unitFactor,
                          });
                        }}
                        className="w-full bg-transparent font-mono text-sm font-semibold tabular-nums text-zinc-100 outline-none"
                      />
                      <span className="font-mono text-[11px] text-zinc-500">
                        {rateUnitLabel(rateUnit)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center rounded-md border border-white/[0.1] bg-[#121214] px-2 py-1 focus-within:border-amber-500/50">
                      <input
                        type="number"
                        min={0.1}
                        step={1}
                        value={target.fixedMachines}
                        onChange={(e) =>
                          onUpdateTarget(target.id, {
                            fixedMachines: Math.max(0.1, Number(e.target.value) || 1),
                          })
                        }
                        className="w-full bg-transparent font-mono text-sm font-semibold tabular-nums text-amber-300 outline-none"
                      />
                      <span className="font-mono text-[11px] text-zinc-500">шт.</span>
                    </div>
                  )}

                  {/* Quick multipliers */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        target.mode === 'rate'
                          ? onUpdateTarget(target.id, {
                              ratePer60: Math.max(1, target.ratePer60 * 0.5),
                            })
                          : onUpdateTarget(target.id, {
                              fixedMachines: Math.max(1, target.fixedMachines - 1),
                            })
                      }
                      className="rounded border border-white/[0.08] bg-[#121214] px-1.5 py-1 font-mono text-[10px] text-zinc-400 hover:border-white/[0.2] hover:text-zinc-200"
                    >
                      {target.mode === 'rate' ? '×0.5' : '-1'}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        target.mode === 'rate'
                          ? onUpdateTarget(target.id, {
                              ratePer60: target.ratePer60 * 2,
                            })
                          : onUpdateTarget(target.id, {
                              fixedMachines: target.fixedMachines + 1,
                            })
                      }
                      className="rounded border border-white/[0.08] bg-[#121214] px-1.5 py-1 font-mono text-[10px] text-zinc-400 hover:border-white/[0.2] hover:text-zinc-200"
                    >
                      {target.mode === 'rate' ? '×2' : '+1'}
                    </button>
                  </div>
                </div>

                {/* Belt speed presets in rate mode */}
                {target.mode === 'rate' && (
                  <div className="mt-1.5 flex items-center gap-1">
                    <span className="text-[10px] text-zinc-500">Лента:</span>
                    {[60, 200, 450].map((v, idx) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => onUpdateTarget(target.id, { ratePer60: v })}
                        className={cn(
                          'rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums transition-colors',
                          Math.abs(target.ratePer60 - v) < 0.01
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-[#121214] text-zinc-500 hover:text-zinc-200',
                        )}
                      >
                        T{idx + 1} ({v})
                      </button>
                    ))}
                  </div>
                )}

                {/* Diagnostic info & recipe picker */}
                {diag && (
                  <div className="mt-2 flex items-center justify-between border-t border-white/[0.06] pt-1.5 font-mono text-[10px] tabular-nums text-zinc-400">
                    <span>
                      Выход:{' '}
                      <strong className="text-emerald-400">
                        {formatNumber(diag.actualRatePer60 * unitFactor, rateUnit === '1s' ? 2 : 1)}
                        {rateUnitLabel(rateUnit)}
                      </strong>
                    </span>
                    <span>
                      Зданий:{' '}
                      <strong className="text-zinc-200">
                        {formatNumber(diag.machinesUsed, 2)}×
                      </strong>
                    </span>
                  </div>
                )}

                {recipes.length > 1 && (() => {
                  const activeRecipeId = target.recipeId ?? diag?.recipeId ?? recipes[0].id;
                  const activeRec = recipes.find((r) => r.id === activeRecipeId) ?? recipes[0];
                  const activeMach = activeRec ? MACHINES[activeRec.machine] : undefined;
                  const isOpen = openRecipeTargetId === target.id;

                  return (
                    <div className="relative mt-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setOpenRecipeTargetId(isOpen ? null : target.id);
                          setShowLockedRecipes(false);
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-[11px] transition-all duration-150',
                          isOpen
                            ? 'border-emerald-500/50 bg-[#18181b] text-emerald-300'
                            : 'border-white/[0.1] bg-[#121214] text-zinc-200 hover:border-white/[0.2] hover:bg-[#18181b]',
                        )}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {activeMach && (
                            <img
                              src={getMachineIconUrl(activeMach.icon)}
                              alt={getMachineLabel(activeMach.id).ru}
                              className="h-4 w-4 shrink-0 object-contain"
                            />
                          )}
                          <span className="truncate font-medium">
                            {getRecipeLabel(activeRec.id).ru}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="rounded bg-white/[0.06] px-1 py-0.2 font-mono text-[9px] text-zinc-400">
                            {recipes.length}
                          </span>
                          <ChevronDown
                            className={cn(
                              'h-3.5 w-3.5 text-zinc-400 transition-transform duration-150',
                              isOpen && 'rotate-180 text-emerald-400',
                            )}
                          />
                        </div>
                      </button>

                      {isOpen && (() => {
                        const isFiltering = Boolean(unlockedFilter?.enabled);
                        const hasTelemetry =
                          unlockedFilter &&
                          (unlockedFilter.unlockedProductIds.size > 0 ||
                            unlockedFilter.builtMachineIds.size > 0);
                        const unlockedList = isFiltering
                          ? recipes.filter((r) => unlockedFilter!.unlockedRecipeIds.has(r.id))
                          : recipes;
                        const lockedList = isFiltering
                          ? recipes.filter((r) => !unlockedFilter!.unlockedRecipeIds.has(r.id))
                          : [];
                        const visibleList =
                          !isFiltering || showLockedRecipes || unlockedList.length === 0
                            ? [...unlockedList, ...lockedList]
                            : unlockedList;

                        return (
                          <div className="mt-1.5 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-white/[0.14] bg-[#121214] p-1.5 shadow-2xl">
                            {visibleList.map((r) => {
                              const m = MACHINES[r.machine];
                              const mLbl = m ? getMachineLabel(m.id) : null;
                              const rLbl = getRecipeLabel(r.id);
                              const isSelected = r.id === activeRec.id;
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
                                    onUpdateTarget(target.id, { recipeId: r.id });
                                    onSelectRecipeOverride(target.productId, r.id);
                                    setOpenRecipeTargetId(null);
                                  }}
                                  className={cn(
                                    'flex flex-col gap-1 rounded-md border p-2 text-left transition-colors',
                                    isSelected
                                      ? 'border-emerald-500/50 bg-emerald-500/10'
                                      : isLockedInGame
                                        ? 'border-white/[0.04] bg-[#09090b]/60 opacity-70 hover:border-white/[0.14]'
                                        : 'border-white/[0.06] bg-[#09090b] hover:border-white/[0.18] hover:bg-[#18181b]',
                                  )}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                      {m && (
                                        <img
                                          src={getMachineIconUrl(m.icon)}
                                          alt={mLbl?.ru ?? m.name}
                                          className="h-4 w-4 shrink-0 object-contain"
                                        />
                                      )}
                                      <span
                                        className={cn(
                                          'truncate text-[11px] font-semibold',
                                          isSelected ? 'text-emerald-300' : 'text-zinc-100',
                                        )}
                                      >
                                        {rLbl.ru}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      {isActiveInBase && (
                                        <span className="rounded bg-emerald-500/20 px-1 py-0.2 text-[9px] font-semibold text-emerald-300">
                                          ⚡ На базе
                                        </span>
                                      )}
                                      {isLockedInGame && (
                                        <span className="rounded bg-rose-500/15 px-1 py-0.2 text-[9px] font-semibold text-rose-300">
                                          🔒 Не изучено
                                        </span>
                                      )}
                                      {isSelected && (
                                        <Check className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                                      )}
                                    </div>
                                  </div>
                                  <div className="truncate text-[10px] text-zinc-400">
                                    {mLbl?.ru ?? r.machine} • {r.duration}с
                                  </div>
                                  <div className="flex flex-wrap items-center gap-1 font-mono text-[9px] text-zinc-400">
                                    <span>
                                      {r.inputs
                                        .map(
                                          (i) =>
                                            `${i.quantity} ${getProductLabel(i.id).ru ?? i.name}`,
                                        )
                                        .join(' + ') || '—'}
                                    </span>
                                    <ArrowRight className="h-2.5 w-2.5 shrink-0 text-zinc-600" />
                                    <span className="text-emerald-300">
                                      {r.outputs
                                        .map(
                                          (o) =>
                                            `${o.quantity} ${getProductLabel(o.id).ru ?? o.name}`,
                                        )
                                        .join(' + ')}
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                            {isFiltering && unlockedList.length > 0 && lockedList.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setShowLockedRecipes((v) => !v)}
                                className="mt-0.5 rounded-md border border-dashed border-white/[0.12] bg-[#09090b] py-1.5 text-center text-[10px] font-medium text-zinc-400 transition-colors hover:border-white/[0.25] hover:text-zinc-200"
                              >
                                {showLockedRecipes
                                  ? `Скрыть закрытые рецепты (${lockedList.length})`
                                  : `Показать закрытые рецепты (+${lockedList.length})`}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      </div>

      {/* Overrides, Raw Resources & Contracts Panel */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-400" />
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
              Сырьё и Переопределения
            </h3>
          </div>
          {hasAnyOverrides && (
            <button
              type="button"
              onClick={onResetAllOverrides}
              className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300"
              title="Сбросить пользовательские рецепты"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Сброс</span>
            </button>
          )}
        </div>

        {/* Raw Resources chips */}
        <div className="mt-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            Внешнее сырьё (без авторазворота)
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {plan.rawResources.length === 0 ? (
              <span className="text-[11px] text-zinc-600">
                Нет закреплённого сырья — нажмите на любой ресурс в таблице.
              </span>
            ) : (
              plan.rawResources.map((pid) => {
                const p = PRODUCTS[pid];
                const { en, ru } = getProductLabel(pid);
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => onToggleRawResource(pid)}
                    title="Нажмите, чтобы снова раскрывать цепочку производства"
                    className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-[#09090b] px-1.5 py-0.5 text-[11px] text-zinc-300 transition-all duration-150 hover:border-rose-500/40 hover:text-rose-300"
                  >
                    {p && (
                      <img
                        src={getProductIconUrl(p.icon)}
                        alt={en}
                        className="h-3.5 w-3.5 object-contain"
                      />
                    )}
                    <span>{ru ?? en}</span>
                    <X className="h-2.5 w-2.5 text-zinc-500" />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Recipe overrides */}
        {overrideEntries.length > 0 && (
          <div className="mt-3 border-t border-white/[0.06] pt-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
              Выбранные рецепты
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {overrideEntries.map(([pid, rid]) => {
                const { en, ru } = getProductLabel(pid);
                const rLbl = getRecipeLabel(rid);
                return (
                  <div
                    key={pid}
                    className="flex items-center justify-between gap-2 rounded bg-[#09090b] px-2 py-1 text-[11px]"
                  >
                    <div className="min-w-0 truncate">
                      <span className="font-medium text-emerald-300">{ru ?? en}</span>
                      <span className="mx-1 text-zinc-600">→</span>
                      <span className="text-zinc-400">{rLbl.ru}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onClearRecipeOverride(pid)}
                      className="shrink-0 text-zinc-500 hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Contract overrides */}
        {contractEntries.length > 0 && (
          <div className="mt-3 border-t border-white/[0.06] pt-2.5">
            <div className="text-[10px] font-medium uppercase tracking-wide text-violet-400">
              Торговые контракты
            </div>
            <div className="mt-1.5 flex flex-col gap-1">
              {contractEntries.map(([pid, cid]) => {
                const { en, ru } = getProductLabel(pid);
                const c = CONTRACTS_BY_ID[cid];
                const payLbl = c?.payProductId
                  ? getProductLabel(c.payProductId)
                  : null;
                return (
                  <div
                    key={pid}
                    className="flex items-center justify-between gap-2 rounded border border-violet-500/20 bg-violet-500/10 px-2 py-1 text-[11px]"
                  >
                    <div className="flex min-w-0 items-center gap-1.5 truncate">
                      <Anchor className="h-3 w-3 shrink-0 text-violet-400" />
                      <span className="truncate text-violet-200">
                        {ru ?? en} ⇄ {payLbl?.ru ?? c?.product_to_pay_with_name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onClearContractOverride(pid)}
                      className="shrink-0 text-violet-300 hover:text-rose-400"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
