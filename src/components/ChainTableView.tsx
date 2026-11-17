import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Anchor,
  ArrowRight,
  ChevronDown,
  Cpu,
  Droplets,
  Filter,
  Flame,
  Layers,
  List,
  Package,
  PackageCheck,
  Pin,
  Plus,
  Radiation,
  RefreshCw,
  Users,
  Wind,
  Zap,
} from 'lucide-react';
import type {
  FactoryPlanConfig,
  RateUnit,
  SolvedStep,
  SolveResult,
  UnlockedGameFilter,
} from '../types/coi';
import {
  CONTRACTS_BY_ID,
  MACHINES,
  RECIPES,
  VIRTUAL_PRODUCT_IDS,
  getMachineIconUrl,
  getMachineLabel,
  getProductIconUrl,
  getProductLabel,
  getRecipeLabel,
} from '../data';
import { analyzeByproductsAndStorage } from '../engine/byproductAdvisor';
import { cn } from '../utils/cn';
import { formatNumber, formatPower, formatRate } from '../utils/format';

interface ChainTableViewProps {
  plan: FactoryPlanConfig;
  solveResult: SolveResult;
  rateUnit: RateUnit;
  unlockedFilter?: UnlockedGameFilter;
  onSelectRecipeOverride: (productId: string, recipeId: string) => void;
  onSelectContractOverride: (productId: string, contractId: string) => void;
  onClearContractOverride: (productId: string) => void;
  onToggleRawResource: (productId: string) => void;
  onInspectProduct: (productId: string) => void;
  onAddTargetWithRate: (productId: string, ratePer60: number, recipeId?: string) => void;
}

export const ChainTableView: React.FC<ChainTableViewProps> = ({
  plan,
  solveResult,
  rateUnit,
  unlockedFilter,
  onSelectRecipeOverride,
  onSelectContractOverride,
  onClearContractOverride,
  onToggleRawResource,
  onInspectProduct,
  onAddTargetWithRate,
}) => {
  const [groupByStage, setGroupByStage] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [openSwitcherStepId, setOpenSwitcherStepId] = useState<string | null>(
    null,
  );
  const [showLockedRecipes, setShowLockedRecipes] = useState(false);
  const [advisorFilter, setAdvisorFilter] = useState<'all' | 'dispose' | 'store'>('all');

  const rawSet = useMemo(() => new Set(plan.rawResources), [plan.rawResources]);
  const byproductAdvice = useMemo(
    () => analyzeByproductsAndStorage(solveResult),
    [solveResult],
  );
  const filteredAdvice = useMemo(() => {
    if (advisorFilter === 'all') return byproductAdvice;
    if (advisorFilter === 'dispose') {
      return byproductAdvice.filter(
        (a) => a.verdict === 'burn' || a.verdict === 'vent' || a.verdict === 'dump',
      );
    }
    return byproductAdvice.filter(
      (a) => a.verdict === 'store_buffer' || a.verdict === 'store_mandatory',
    );
  }, [byproductAdvice, advisorFilter]);

  const filteredSteps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return solveResult.steps;
    return solveResult.steps.filter((s) => {
      const { en, ru } = getProductLabel(s.primaryProductId);
      return (
        s.recipeName.toLowerCase().includes(q) ||
        s.machineName.toLowerCase().includes(q) ||
        en.toLowerCase().includes(q) ||
        (ru && ru.toLowerCase().includes(q)) ||
        s.inputs.some((i) => i.name.toLowerCase().includes(q)) ||
        s.outputs.some((o) => o.name.toLowerCase().includes(q))
      );
    });
  }, [solveResult.steps, searchQuery]);

  const groupedByDepth = useMemo(() => {
    const groups = new Map<number, SolvedStep[]>();
    for (const step of filteredSteps) {
      if (!groups.has(step.depth)) groups.set(step.depth, []);
      groups.get(step.depth)!.push(step);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  }, [filteredSteps]);

  const renderStepCard = (step: SolvedStep) => {
    const isSwitcherOpen = openSwitcherStepId === step.stepId;
    const hasAlternatives =
      step.alternativeRecipeIds.length > 1 ||
      step.alternativeContractIds.length > 0;
    const primaryLabel = getProductLabel(step.primaryProductId);

    return (
      <div
        key={step.stepId}
        className={cn(
          'relative rounded-xl border bg-[#121214] p-3.5 transition-all duration-150 ease-out',
          step.isTarget
            ? 'border-emerald-500/30 shadow-[0_0_24px_-12px_rgba(16,185,129,0.25)]'
            : step.kind === 'contract'
              ? 'border-violet-500/30'
              : 'border-white/[0.08] hover:border-white/[0.15]',
        )}
      >
        {/* Top Row: Machine, Recipe, Machine Counts, Telemetry */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-[#09090b] p-1">
              <img
                src={getMachineIconUrl(step.machineIcon)}
                alt={step.machineName}
                className="h-9 w-9 object-contain"
              />
              {step.isTarget && (
                <span
                  title="Целевой продукт"
                  className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border border-[#09090b] bg-emerald-400"
                />
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">
                  {step.machineName}
                </h3>
                <span className="rounded border border-white/[0.08] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                  Этап {step.depth}
                </span>
                {step.hasCycleInput && (
                  <span
                    title="Содержит циклическую обратную связь (замкнутый контур)"
                    className="flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300"
                  >
                    <RefreshCw className="h-2.5 w-2.5" />
                    <span>Цикл</span>
                  </span>
                )}
              </div>

              {/* Recipe & Inline Switcher Trigger */}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (hasAlternatives) {
                      setOpenSwitcherStepId(isSwitcherOpen ? null : step.stepId);
                      setShowLockedRecipes(false);
                    }
                  }}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs transition-all duration-150',
                    hasAlternatives
                      ? 'cursor-pointer border-white/[0.1] bg-[#18181b] text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300'
                      : 'cursor-default border-transparent bg-transparent px-0 text-zinc-400',
                  )}
                >
                  {step.kind === 'contract' && (
                    <Anchor className="h-3 w-3 text-violet-400" />
                  )}
                  <span className="truncate max-w-[320px]">{step.recipeName}</span>
                  {hasAlternatives && (
                    <span className="flex items-center gap-0.5 rounded bg-white/[0.06] px-1 py-0.2 font-mono text-[10px] text-zinc-400">
                      {step.alternativeRecipeIds.length +
                        step.alternativeContractIds.length}
                      <ChevronDown className="h-3 w-3" />
                    </span>
                  )}
                </button>
                <span className="font-mono text-[10px] text-zinc-500">
                  {step.duration}с цикл • {primaryLabel.ru ?? primaryLabel.en}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Machine Counts & Step Resource Telemetry */}
          <div className="flex flex-wrap items-center gap-2">
            {step.workers > 0 && (
              <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-[#09090b] px-2 py-1 font-mono text-[11px] tabular-nums text-zinc-400">
                <Users className="h-3 w-3 text-zinc-500" />
                <span>{formatNumber(step.workers, 0)}</span>
              </div>
            )}
            {step.electricityConsumedKw > 0 && (
              <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-[#09090b] px-2 py-1 font-mono text-[11px] tabular-nums text-amber-300/90">
                <Zap className="h-3 w-3 text-amber-400" />
                <span>{formatPower(step.electricityConsumedKw)}</span>
              </div>
            )}
            {step.computingTFlops > 0 && (
              <div className="flex items-center gap-1 rounded-md border border-white/[0.06] bg-[#09090b] px-2 py-1 font-mono text-[11px] tabular-nums text-violet-300">
                <Cpu className="h-3 w-3 text-violet-400" />
                <span>{formatNumber(step.computingTFlops, 1)} TF</span>
              </div>
            )}

            {/* Machine Count Badge */}
            <div className="flex items-baseline gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 font-mono tabular-nums">
              <span className="text-sm font-bold text-emerald-300">
                {step.ceilMachines}×
              </span>
              <span className="text-[11px] text-emerald-400/75">
                ({formatNumber(step.exactMachines, 2)})
              </span>
            </div>
          </div>
        </div>

        {/* Inline Recipe & Contract Switcher Drawer */}
        {isSwitcherOpen && (() => {
          const isFiltering = Boolean(unlockedFilter?.enabled);
          const hasTelemetry =
            unlockedFilter &&
            (unlockedFilter.unlockedProductIds.size > 0 ||
              unlockedFilter.builtMachineIds.size > 0);
          const unlockedIds = isFiltering
            ? step.alternativeRecipeIds.filter((rid) =>
                unlockedFilter!.unlockedRecipeIds.has(rid),
              )
            : step.alternativeRecipeIds;
          const lockedIds = isFiltering
            ? step.alternativeRecipeIds.filter(
                (rid) => !unlockedFilter!.unlockedRecipeIds.has(rid),
              )
            : [];
          const visibleIds =
            !isFiltering || showLockedRecipes || unlockedIds.length === 0
              ? [...unlockedIds, ...lockedIds]
              : unlockedIds;

          return (
            <div className="mt-3 rounded-lg border border-white/[0.12] bg-[#09090b] p-2.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  Альтернативные рецепты и контракты для «
                  {primaryLabel.ru ?? primaryLabel.en}»
                </span>
                <button
                  type="button"
                  onClick={() => setOpenSwitcherStepId(null)}
                  className="text-[11px] text-zinc-500 hover:text-zinc-200"
                >
                  Закрыть
                </button>
              </div>

              <div className="grid max-h-72 grid-cols-1 gap-1.5 overflow-y-auto pr-1 md:grid-cols-2">
                {visibleIds.map((rid) => {
                  const r = RECIPES[rid];
                  const m = r ? MACHINES[r.machine] : undefined;
                  if (!r || !m) return null;
                  const isSelected = step.kind === 'recipe' && step.recipeId === rid;

                  const rLbl = getRecipeLabel(rid);
                  const mLbl = getMachineLabel(m.id);
                  const isActiveInBase =
                    hasTelemetry && unlockedFilter!.activeRecipeIds.has(rid);
                  const isLockedInGame =
                    Boolean(unlockedFilter && unlockedFilter.stageMode !== 'all') &&
                    !unlockedFilter!.unlockedRecipeIds.has(rid);

                  return (
                    <button
                      key={rid}
                      type="button"
                      onClick={() => {
                        if (step.kind === 'contract') {
                          onClearContractOverride(step.primaryProductId);
                        }
                        onSelectRecipeOverride(step.primaryProductId, rid);
                        setOpenSwitcherStepId(null);
                      }}
                      className={cn(
                        'flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-all duration-150',
                        isSelected
                          ? 'border-emerald-500/50 bg-emerald-500/10'
                          : isLockedInGame
                            ? 'border-white/[0.04] bg-[#121214]/60 opacity-70 hover:border-white/[0.15]'
                            : 'border-white/[0.07] bg-[#121214] hover:border-white/[0.2] hover:bg-[#18181b]',
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img
                            src={getMachineIconUrl(m.icon)}
                            alt={mLbl.ru}
                            className="h-5 w-5 shrink-0 object-contain"
                          />
                          <span className="truncate text-xs font-semibold text-zinc-100">
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
                          <span className="font-mono text-[10px] text-zinc-400">
                            {mLbl.ru}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-zinc-400">
                        {r.inputs.length === 0 ? (
                          <span className="text-zinc-500">Добыча без сырья</span>
                        ) : (
                          r.inputs.map((i) => {
                            const iLbl = getProductLabel(i.id);
                            return (
                              <span
                                key={i.id}
                                className="rounded bg-white/[0.04] px-1 py-0.5"
                              >
                                {i.quantity} {iLbl.ru ?? i.name}
                              </span>
                            );
                          })
                        )}
                        <ArrowRight className="h-3 w-3 text-zinc-600" />
                        {r.outputs.map((o) => {
                          const oLbl = getProductLabel(o.id);
                          return (
                            <span
                              key={o.id}
                              className="rounded bg-emerald-500/10 px-1 py-0.5 text-emerald-300"
                            >
                              {o.quantity} {oLbl.ru ?? o.name}
                            </span>
                          );
                        })}
                      </div>
                    </button>
                  );
                })}

                {step.alternativeContractIds.map((cid) => {
                  const c = CONTRACTS_BY_ID[cid];
                  if (!c) return null;
                  const isSelected =
                    step.kind === 'contract' && step.contractId === cid;
                  const buyLbl = c.buyProductId
                    ? getProductLabel(c.buyProductId)
                    : null;
                  const payLbl = c.payProductId
                    ? getProductLabel(c.payProductId)
                    : null;
                  return (
                    <button
                      key={cid}
                      type="button"
                      onClick={() => {
                        onSelectContractOverride(step.primaryProductId, cid);
                        setOpenSwitcherStepId(null);
                      }}
                      className={cn(
                        'flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-all duration-150',
                        isSelected
                          ? 'border-violet-500/60 bg-violet-500/15'
                          : 'border-violet-500/20 bg-violet-500/5 hover:border-violet-500/40 hover:bg-violet-500/10',
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

              {isFiltering && unlockedIds.length > 0 && lockedIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowLockedRecipes((v) => !v)}
                  className="mt-2 w-full rounded-lg border border-dashed border-white/[0.12] bg-[#121214] py-1.5 text-center text-[11px] font-medium text-zinc-400 transition-colors hover:border-white/[0.25] hover:text-zinc-200"
                >
                  {showLockedRecipes
                    ? `Скрыть закрытые рецепты (${lockedIds.length})`
                    : `Показать закрытые рецепты (+${lockedIds.length})`}
                </button>
              )}
            </div>
          );
        })()}

        {/* Inputs -> Outputs Flow Strip */}
        <div className="mt-3 grid grid-cols-1 gap-2.5 border-t border-white/[0.06] pt-2.5 md:grid-cols-2">
          {/* Inputs */}
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Входы ({step.inputs.length})
            </div>
            {step.inputs.length === 0 ? (
              <span className="text-[11px] text-zinc-600">
                Прямая добыча / без входного сырья
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {step.inputs.map((inp) => {
                  const lbl = getProductLabel(inp.productId);
                  const isRawPinned = rawSet.has(inp.productId);
                  const canPin = !VIRTUAL_PRODUCT_IDS.has(inp.productId);

                  return (
                    <div
                      key={inp.productId}
                      className={cn(
                        'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-all duration-150',
                        inp.isCycle
                          ? 'border-amber-500/35 bg-amber-500/10'
                          : isRawPinned || inp.sourceType === 'raw'
                            ? 'border-sky-500/25 bg-sky-500/5'
                            : 'border-white/[0.08] bg-[#09090b]',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onInspectProduct(inp.productId)}
                        className="flex items-center gap-1.5 hover:opacity-80"
                        title="Открыть в базе знаний"
                      >
                        <img
                          src={getProductIconUrl(inp.icon)}
                          alt={lbl.en}
                          className="h-4 w-4 shrink-0 object-contain"
                        />
                        <span className="font-medium text-zinc-200">
                          {lbl.ru ?? lbl.en}
                        </span>
                      </button>

                      <span className="font-mono text-[11px] font-semibold tabular-nums text-zinc-300">
                        {formatRate(inp.ratePer60, rateUnit)}
                      </span>

                      {inp.beltInfo && (
                        <span className="rounded bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-zinc-400">
                          {inp.beltInfo.recommendedLabel}
                        </span>
                      )}

                      {canPin && (
                        <button
                          type="button"
                          onClick={() => onToggleRawResource(inp.productId)}
                          title={
                            isRawPinned
                              ? 'Убрать из внешнего сырья (раскрыть цепочку)'
                              : 'Считать внешним сырьём (остановить расчёт вверх)'
                          }
                          className={cn(
                            'rounded p-0.5 transition-colors',
                            isRawPinned
                              ? 'text-sky-300 hover:text-rose-400'
                              : 'text-zinc-600 hover:text-sky-300',
                          )}
                        >
                          <Pin className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Outputs */}
          <div>
            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Выходы ({step.outputs.length})
            </div>
            <div className="flex flex-wrap gap-1.5">
              {step.outputs.map((out) => {
                const lbl = getProductLabel(out.productId);
                const surplus = step.surplusOutputs.find(
                  (s) => s.productId === out.productId,
                );
                return (
                  <div
                    key={out.productId}
                    className={cn(
                      'flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs',
                      out.sourceType === 'target'
                        ? 'border-emerald-500/35 bg-emerald-500/10'
                        : 'border-white/[0.08] bg-[#09090b]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onInspectProduct(out.productId)}
                      className="flex items-center gap-1.5 hover:opacity-80"
                    >
                      <img
                        src={getProductIconUrl(out.icon)}
                        alt={lbl.en}
                        className="h-4 w-4 shrink-0 object-contain"
                      />
                      <span className="font-medium text-zinc-100">
                        {lbl.ru ?? lbl.en}
                      </span>
                    </button>

                    <span className="font-mono text-[11px] font-semibold tabular-nums text-emerald-300">
                      {formatRate(out.ratePer60, rateUnit)}
                    </span>

                    {out.beltInfo && (
                      <span className="rounded bg-white/[0.05] px-1 py-0.5 font-mono text-[10px] text-zinc-400">
                        {out.beltInfo.recommendedLabel}
                      </span>
                    )}

                    {surplus && out.sourceType !== 'target' && (
                      <span
                        title="Избыточный / побочный выход сверх потребности цепочки"
                        className="rounded bg-amber-500/15 px-1 py-0.5 font-mono text-[10px] text-amber-300"
                      >
                        +{formatRate(surplus.ratePer60, rateUnit)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-3 min-w-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#121214] px-3 py-2">
        <div className="flex flex-1 items-center gap-2 min-w-[200px]">
          <Filter className="h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Фильтр по зданию, рецепту или ресурсу в цепочке..."
            className="w-full bg-transparent text-xs text-zinc-200 placeholder:text-zinc-600 outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-zinc-500">
            Узлов: {filteredSteps.length}
          </span>
          <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5">
            <button
              type="button"
              onClick={() => setGroupByStage(true)}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                groupByStage
                  ? 'bg-[#18181b] text-emerald-300'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <Layers className="h-3 w-3" />
              <span>По этапам</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupByStage(false)}
              className={cn(
                'flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                !groupByStage
                  ? 'bg-[#18181b] text-emerald-300'
                  : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              <List className="h-3 w-3" />
              <span>Список</span>
            </button>
          </div>
        </div>
      </div>

      {/* Production Steps List */}
      {filteredSteps.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/[0.1] bg-[#121214] p-8 text-center text-sm text-zinc-500">
          Нет активных производственных узлов. Выберите цель или сбросьте фильтр.
        </div>
      ) : groupByStage ? (
        <div className="flex flex-col gap-4">
          {groupedByDepth.map(([depth, steps]) => (
            <div key={depth} className="flex flex-col gap-2">
              <div className="flex items-center gap-2 px-1">
                <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                  {depth === 0
                    ? 'Этап 0 — Финальный выпуск'
                    : `Этап ${depth} — Передел уровня ${depth}`}
                </span>
                <div className="h-px flex-1 bg-white/[0.06]" />
                <span className="font-mono text-[10px] text-zinc-500">
                  {steps.length} узл.
                </span>
              </div>
              <div className="flex flex-col gap-2.5">
                {steps.map(renderStepCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filteredSteps.map(renderStepCard)}
        </div>
      )}

      {/* Byproduct & Storage Advisor: What to Burn, Dump/Vent, or Store */}
      {byproductAdvice.length > 0 && (
        <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-2.5">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-300">
                Советник по утилизации и хранению: что сжигать, сбрасывать и хранить
              </h3>
              <p className="text-[11px] text-zinc-500">
                Расчёт факелов, дымовых труб, сливов и буферных складов (на 30 мин работы) для всех выходов и излишков
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5">
              {[
                { id: 'all' as const, label: `Все (${byproductAdvice.length})` },
                { id: 'dispose' as const, label: 'Сжигать / Сбрасывать' },
                { id: 'store' as const, label: 'Хранить на складах' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setAdvisorFilter(tab.id)}
                  className={cn(
                    'rounded px-2 py-1 text-[11px] font-medium transition-colors',
                    advisorFilter === tab.id
                      ? 'bg-[#18181b] text-amber-300'
                      : 'text-zinc-500 hover:text-zinc-300',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {filteredAdvice.map((adv) => {
              const badgeStyles =
                adv.verdict === 'store_mandatory'
                  ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                  : adv.verdict === 'burn'
                    ? 'border-orange-500/40 bg-orange-500/15 text-orange-300'
                    : adv.verdict === 'dump'
                      ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-300'
                      : adv.verdict === 'vent'
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                        : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300';

              const VerdictIcon =
                adv.verdict === 'store_mandatory'
                  ? Radiation
                  : adv.verdict === 'burn'
                    ? Flame
                    : adv.verdict === 'dump'
                      ? Droplets
                      : adv.verdict === 'vent'
                        ? Wind
                        : Package;

              return (
                <div
                  key={adv.productId}
                  className="flex flex-col justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#09090b] p-3"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <img
                          src={getProductIconUrl(adv.icon)}
                          alt={adv.name}
                          className="h-7 w-7 shrink-0 object-contain"
                        />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-semibold text-zinc-100">
                            {adv.name}
                          </div>
                          <div className="font-mono text-[11px] font-semibold text-amber-300">
                            +{formatRate(adv.ratePer60, rateUnit)}
                            <span className="ml-1.5 text-[10px] font-normal text-zinc-500">
                              {adv.isTarget ? '(Цель)' : '(Побочный/Излишек)'}
                            </span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={cn(
                          'flex shrink-0 items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold',
                          badgeStyles,
                        )}
                      >
                        <VerdictIcon className="h-3 w-3" />
                        <span>
                          {adv.verdict === 'burn'
                            ? 'Сжигать'
                            : adv.verdict === 'vent'
                              ? 'В трубу'
                              : adv.verdict === 'dump'
                                ? 'Слив'
                                : adv.verdict === 'store_mandatory'
                                  ? 'Спецсклад'
                                  : 'На склад'}
                        </span>
                      </span>
                    </div>

                    <p className="mt-1.5 text-[11px] leading-snug text-zinc-400">
                      {adv.verdictReason}
                    </p>
                  </div>

                  {/* Disposal & Storage Calculations */}
                  <div className="flex flex-col gap-1.5 border-t border-white/[0.06] pt-2 text-[11px]">
                    {adv.disposal && (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-[#121214] px-2 py-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img
                            src={getMachineIconUrl(adv.disposal.machineIcon)}
                            alt={adv.disposal.machineName}
                            className="h-4 w-4 shrink-0 object-contain"
                          />
                          <span className="truncate text-zinc-200">
                            {adv.disposal.machineName}
                          </span>
                        </div>
                        <span className="shrink-0 font-mono font-bold text-orange-300">
                          {adv.disposal.ceilMachines}× ({formatNumber(adv.disposal.exactMachines, 2)})
                        </span>
                      </div>
                    )}

                    {adv.storage && (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-white/[0.06] bg-[#121214] px-2 py-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <img
                            src={getMachineIconUrl(adv.storage.machineIcon)}
                            alt={adv.storage.machineName}
                            className="h-4 w-4 shrink-0 object-contain"
                          />
                          <span className="truncate text-zinc-300">
                            {adv.storage.machineName} ({adv.storage.capacityPerUnit})
                          </span>
                        </div>
                        <span className="shrink-0 font-mono text-[10px] text-zinc-400">
                          полн. за{' '}
                          <strong className="text-zinc-200">
                            {adv.storage.minutesToFillOne > 999
                              ? '999+'
                              : formatNumber(adv.storage.minutesToFillOne, 1)}{' '}
                            мин
                          </strong>
                          {' • '}
                          <span className="text-emerald-300">
                            {adv.storage.unitsFor30MinBuffer}×/30м
                          </span>
                        </span>
                      </div>
                    )}

                    {adv.recycleOptions.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1 pt-0.5">
                        <span className="text-[10px] text-zinc-500">В дело:</span>
                        {adv.recycleOptions.slice(0, 2).map((opt) => (
                          <button
                            key={opt.recipeId}
                            type="button"
                            onClick={() =>
                              onAddTargetWithRate(
                                opt.primaryOutputId,
                                Math.max(1, Number(opt.outputRateIfConsumedAll60.toFixed(1))),
                                opt.recipeId,
                              )
                            }
                            title={`${opt.machineName}: ${opt.recipeName}`}
                            className="flex items-center gap-1 rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 transition-colors hover:bg-emerald-500/20"
                          >
                            <Plus className="h-2.5 w-2.5" />
                            <span>{opt.primaryOutputName}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Bottom 3-Column Bento Summary: Raw Inputs, Net Outputs & Byproducts, Bill of Materials */}
      <div className="grid grid-cols-1 gap-3 pt-1 xl:grid-cols-3">
        {/* 1. Raw Inputs */}
        <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-sky-300">
              Внешнее сырьё (Вход)
            </h3>
            <span className="font-mono text-[11px] text-zinc-500">
              {solveResult.summary.rawInputs.length} поз.
            </span>
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {solveResult.summary.rawInputs.length === 0 ? (
              <span className="text-xs text-zinc-600">Нет внешнего сырья</span>
            ) : (
              solveResult.summary.rawInputs.map((raw) => {
                const lbl = getProductLabel(raw.productId);
                const isPinned = rawSet.has(raw.productId);
                return (
                  <div
                    key={raw.productId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#09090b] px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={getProductIconUrl(raw.icon)}
                        alt={lbl.en}
                        className="h-5 w-5 shrink-0 object-contain"
                      />
                      <span className="truncate text-xs font-medium text-zinc-200">
                        {lbl.ru ?? lbl.en}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-xs font-semibold tabular-nums text-sky-300">
                        {formatRate(raw.ratePer60, rateUnit)}
                      </span>
                      {raw.beltInfo && (
                        <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                          {raw.beltInfo.recommendedLabel}
                        </span>
                      )}
                      {isPinned && (
                        <button
                          type="button"
                          onClick={() => onToggleRawResource(raw.productId)}
                          title="Раскрыть производство этого ресурса"
                          className="text-[10px] text-zinc-500 hover:text-emerald-400"
                        >
                          Раскрыть
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 2. Net Outputs & Byproducts */}
        <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-300">
              Выпуск и Побочные продукты
            </h3>
            <span className="font-mono text-[11px] text-zinc-500">
              {solveResult.summary.netOutputs.length} поз.
            </span>
          </div>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {solveResult.summary.netOutputs.map((out) => {
              const lbl = getProductLabel(out.productId);
              return (
                <div
                  key={out.productId}
                  className={cn(
                    'flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5',
                    out.isTarget
                      ? 'border-emerald-500/25 bg-emerald-500/5'
                      : out.isPollution
                        ? 'border-rose-500/20 bg-rose-500/5'
                        : 'border-amber-500/20 bg-amber-500/5',
                  )}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <img
                      src={getProductIconUrl(out.icon)}
                      alt={lbl.en}
                      className="h-5 w-5 shrink-0 object-contain"
                    />
                    <span className="truncate text-xs font-medium text-zinc-200">
                      {lbl.ru ?? lbl.en}
                    </span>
                    {out.isPollution && (
                      <AlertTriangle className="h-3 w-3 shrink-0 text-rose-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        'font-mono text-xs font-semibold tabular-nums',
                        out.isTarget
                          ? 'text-emerald-300'
                          : out.isPollution
                            ? 'text-rose-300'
                            : 'text-amber-300',
                      )}
                    >
                      +{formatRate(out.ratePer60, rateUnit)}
                    </span>
                    <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {out.isTarget
                        ? 'Цель'
                        : out.isPollution
                          ? 'Отход'
                          : 'Излишек'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 3. Bill of Materials */}
        <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
              Ведомость постройки (BOM)
            </h3>
            <PackageCheck className="h-4 w-4 text-zinc-400" />
          </div>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            Ресурсы на возведение {solveResult.summary.totalMachinesCeil} зданий
          </p>
          <div className="mt-2.5 flex flex-col gap-1.5">
            {solveResult.summary.buildCosts.length === 0 ? (
              <span className="text-xs text-zinc-600">Нет затрат на постройку</span>
            ) : (
              solveResult.summary.buildCosts.map((bc) => {
                const lbl = getProductLabel(bc.productId);
                return (
                  <div
                    key={bc.productId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#09090b] px-2.5 py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <img
                        src={getProductIconUrl(bc.icon)}
                        alt={lbl.en}
                        className="h-5 w-5 shrink-0 object-contain"
                      />
                      <span className="truncate text-xs font-medium text-zinc-200">
                        {lbl.ru ?? lbl.en}
                      </span>
                    </div>
                    <span className="font-mono text-xs font-bold tabular-nums text-zinc-100">
                      {formatNumber(bc.quantity, 0)} шт.
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
