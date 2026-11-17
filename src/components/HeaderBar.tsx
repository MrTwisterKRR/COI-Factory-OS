import React, { useState, useRef, useEffect } from 'react';
import {
  Activity,
  BookOpen,
  ChevronDown,
  Copy,
  Download,
  GitBranch,
  Layers,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Zap,
} from 'lucide-react';
import type { FactoryPlanConfig, RateUnit, TechStageMode } from '../types/coi';
import {
  type GameConnectionMode,
  TECH_STAGE_OPTIONS,
} from '../engine/gameApiClient';
import { STARTER_PRESETS } from '../data/presets';
import { cn } from '../utils/cn';

export type WorkspaceViewMode = 'table' | 'graph' | 'telemetry' | 'codex';

interface HeaderBarProps {
  plans: FactoryPlanConfig[];
  activePlanId: string;
  viewMode: WorkspaceViewMode;
  rateUnit: RateUnit;
  activePlan: FactoryPlanConfig;
  gameMode: GameConnectionMode;
  unlockedMachinesCount: number;
  techStageMode: TechStageMode;
  onSelectPlan: (id: string) => void;
  onCreatePlan: () => void;
  onDuplicatePlan: (id: string) => void;
  onDeletePlan: (id: string) => void;
  onRenamePlan: (id: string, name: string) => void;
  onLoadPreset: (preset: FactoryPlanConfig) => void;
  onChangeViewMode: (mode: WorkspaceViewMode) => void;
  onChangeRateUnit: (unit: RateUnit) => void;
  onChangeBoost: (boost: number) => void;
  onToggleRoundUp: () => void;
  onChangeTechStage: (stage: TechStageMode) => void;
  onOpenCommandPalette: () => void;
  onOpenBlueprintModal: () => void;
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  plans,
  activePlanId,
  viewMode,
  rateUnit,
  activePlan,
  gameMode,
  unlockedMachinesCount,
  techStageMode,
  onSelectPlan,
  onCreatePlan,
  onDuplicatePlan,
  onDeletePlan,
  onRenamePlan,
  onLoadPreset,
  onChangeViewMode,
  onChangeRateUnit,
  onChangeBoost,
  onToggleRoundUp,
  onChangeTechStage,
  onOpenCommandPalette,
  onOpenBlueprintModal,
}) => {
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [boostOpen, setBoostOpen] = useState(false);
  const [stageOpen, setStageOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const presetRef = useRef<HTMLDivElement>(null);
  const boostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) {
        setPresetsOpen(false);
      }
      if (boostRef.current && !boostRef.current.contains(e.target as Node)) {
        setBoostOpen(false);
      }
      if (stageRef.current && !stageRef.current.contains(e.target as Node)) {
        setStageOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const currentStage =
    TECH_STAGE_OPTIONS.find((s) => s.id === techStageMode) ?? TECH_STAGE_OPTIONS[1];

  const commitRename = () => {
    if (editingId && editingName.trim()) {
      onRenamePlan(editingId, editingName.trim());
    }
    setEditingId(null);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.08] bg-[#09090b]/95 backdrop-blur-md">
      {/* Top Row: Brand, View Switcher, Global Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tracking-tight text-zinc-100">
                  COI // FACTORY OS
                </span>
                <span className="rounded border border-white/[0.08] bg-[#121214] px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400">
                  v0.8.2 • U3
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">
                Инженерный расчёт цепочек Captain of Industry
              </p>
            </div>
          </div>

          {/* Mode Switcher */}
          <nav className="ml-2 flex items-center rounded-lg border border-white/[0.08] bg-[#121214] p-0.5">
            <button
              type="button"
              onClick={() => onChangeViewMode('table')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-out',
                viewMode === 'table'
                  ? 'bg-[#18181b] text-emerald-400 shadow-sm ring-1 ring-white/[0.08]'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Table2 className="h-3.5 w-3.5" />
              <span>Цепочка и Баланс</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('graph')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-out',
                viewMode === 'graph'
                  ? 'bg-[#18181b] text-emerald-400 shadow-sm ring-1 ring-white/[0.08]'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span>Граф потоков</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('telemetry')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-out',
                viewMode === 'telemetry'
                  ? 'bg-[#18181b] text-emerald-400 shadow-sm ring-1 ring-white/[0.08]'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  gameMode === 'live'
                    ? 'bg-emerald-400 shadow-[0_0_8px_#34d399]'
                    : gameMode === 'demo'
                      ? 'bg-amber-400'
                      : 'bg-zinc-600',
                )}
              />
              <Activity className="h-3.5 w-3.5" />
              <span>Телеметрия и Игра</span>
              {unlockedMachinesCount > 0 && (
                <span className="rounded bg-white/[0.08] px-1 py-0.2 font-mono text-[10px] tabular-nums text-zinc-300">
                  {unlockedMachinesCount}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => onChangeViewMode('codex')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150 ease-out',
                viewMode === 'codex'
                  ? 'bg-[#18181b] text-violet-400 shadow-sm ring-1 ring-white/[0.08]'
                  : 'text-zinc-400 hover:text-zinc-200',
              )}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>База знаний и Контракты</span>
            </button>
          </nav>
        </div>

        {/* Right Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Command Search */}
          <button
            type="button"
            onClick={onOpenCommandPalette}
            className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#121214] px-2.5 py-1.5 text-xs text-zinc-400 transition-all duration-150 ease-out hover:border-white/[0.16] hover:bg-[#18181b] hover:text-zinc-200"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Поиск ресурса / рецепта</span>
            <kbd className="rounded border border-white/[0.1] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
              Ctrl+K
            </kbd>
          </button>

          {/* Rate Unit */}
          <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#121214] p-0.5">
            {(['60s', '1m', '1s'] as RateUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                onClick={() => onChangeRateUnit(u)}
                className={cn(
                  'rounded px-2 py-1 font-mono text-[11px] font-medium transition-all duration-150 ease-out',
                  rateUnit === u
                    ? 'bg-[#18181b] text-zinc-100 ring-1 ring-white/[0.08]'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {u === '60s' ? '/60с' : u === '1m' ? '/мин' : '/сек'}
              </button>
            ))}
          </div>

          {/* Boost selector */}
          <div className="relative" ref={boostRef}>
            <button
              type="button"
              onClick={() => setBoostOpen((v) => !v)}
              title="Ускорение производства (Edicts / Boost)"
              className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#121214] px-2.5 py-1.5 font-mono text-[11px] font-medium text-zinc-200 transition-all duration-150 ease-out hover:border-white/[0.16] hover:bg-[#18181b]"
            >
              <Zap className="h-3 w-3 text-amber-400" />
              <span>{Math.round(activePlan.productionBoost * 100)}%</span>
              <ChevronDown className="h-3 w-3 text-zinc-500" />
            </button>
            {boostOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-36 rounded-xl border border-white/[0.12] bg-[#121214] p-1 shadow-2xl">
                {[
                  { val: 1, label: '100% (База)' },
                  { val: 1.15, label: '115% (+15%)' },
                  { val: 1.25, label: '125% (+25%)' },
                  { val: 1.5, label: '150% (+50%)' },
                ].map((opt) => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => {
                      onChangeBoost(opt.val);
                      setBoostOpen(false);
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 font-mono text-[11px] transition-colors',
                      Math.abs(activePlan.productionBoost - opt.val) < 0.01
                        ? 'bg-amber-500/15 text-amber-300'
                        : 'text-zinc-300 hover:bg-[#18181b]',
                    )}
                  >
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tech Progression Stage Selector Dropdown */}
          <div className="relative" ref={stageRef}>
            <button
              type="button"
              onClick={() => setStageOpen((v) => !v)}
              title="Выберите актуальный этап развития или синхронизацию с игрой — схемы и рецепты перестроятся автоматически"
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition-all duration-150 ease-out',
                techStageMode === 'all'
                  ? 'border-white/[0.08] bg-[#121214] text-zinc-300 hover:text-zinc-100'
                  : 'border-violet-500/45 bg-violet-500/15 text-violet-200 hover:bg-violet-500/25',
              )}
            >
              <ShieldCheck
                className={cn(
                  'h-3.5 w-3.5',
                  techStageMode === 'all' ? 'text-zinc-500' : 'text-violet-400',
                )}
              />
              <span className="hidden sm:inline text-zinc-400 font-normal">Уровень:</span>
              <span>{currentStage.shortLabel}</span>
              <span className="rounded bg-black/30 px-1 py-0.2 font-mono text-[10px] text-zinc-300">
                {unlockedMachinesCount}
              </span>
              <ChevronDown className="h-3 w-3 text-zinc-400" />
            </button>

            {stageOpen && (
              <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-white/[0.12] bg-[#121214] p-1.5 shadow-2xl">
                <div className="flex items-center justify-between px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  <span>Актуальный уровень развития</span>
                  <span className="font-mono text-zinc-400">{unlockedMachinesCount} цехов</span>
                </div>
                {TECH_STAGE_OPTIONS.map((opt) => {
                  const active = opt.id === techStageMode;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        onChangeTechStage(opt.id);
                        setStageOpen(false);
                      }}
                      className={cn(
                        'flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-colors',
                        active
                          ? 'bg-violet-500/15 ring-1 ring-violet-500/40'
                          : 'hover:bg-[#18181b]',
                      )}
                    >
                      <div className="flex w-full items-center justify-between gap-2">
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            active ? 'text-violet-200' : 'text-zinc-100',
                          )}
                        >
                          {opt.label}
                        </span>
                        {active && (
                          <span className="rounded bg-violet-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-violet-200">
                            Активен
                          </span>
                        )}
                      </div>
                      <span className="mt-0.5 text-[10px] leading-snug text-zinc-400">
                        {opt.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Exact vs Ceil */}
          <button
            type="button"
            onClick={onToggleRoundUp}
            title="Считать персонал и энергию по целому числу зданий (Ceil) или точному (Exact)"
            className={cn(
              'rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-medium transition-all duration-150 ease-out',
              activePlan.roundMachinesUp
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-white/[0.08] bg-[#121214] text-zinc-400 hover:text-zinc-200',
            )}
          >
            {activePlan.roundMachinesUp ? 'Здания: Целые' : 'Здания: Точные'}
          </button>

          {/* Blueprint Export/Import */}
          <button
            type="button"
            onClick={onOpenBlueprintModal}
            className="flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-semibold text-emerald-300 transition-all duration-150 ease-out hover:bg-emerald-500/25"
          >
            <Download className="h-3.5 w-3.5" />
            <span>Чертёж в игру (B...)</span>
          </button>
        </div>
      </div>

      {/* Bottom Row: Workspace Tabs & Starter Presets */}
      <div className="flex items-center justify-between gap-2 border-t border-white/[0.06] bg-[#0c0c0f] px-4 py-1.5">
        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto">
          {plans.map((plan) => {
            const isActive = plan.id === activePlanId;
            return (
              <div
                key={plan.id}
                className={cn(
                  'group flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition-all duration-150 ease-out',
                  isActive
                    ? 'border-white/[0.14] bg-[#18181b] text-zinc-100'
                    : 'border-transparent bg-transparent text-zinc-500 hover:border-white/[0.06] hover:bg-[#121214] hover:text-zinc-300',
                )}
              >
                {editingId === plan.id ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    className="w-32 bg-transparent text-xs text-zinc-100 outline-none"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectPlan(plan.id)}
                    onDoubleClick={() => {
                      setEditingId(plan.id);
                      setEditingName(plan.name);
                    }}
                    title="Двойной клик — переименовать"
                    className="font-medium"
                  >
                    {plan.name}
                  </button>
                )}

                {isActive && (
                  <div className="ml-1 flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => onDuplicatePlan(plan.id)}
                      title="Дублировать план"
                      className="rounded p-0.5 text-zinc-500 hover:bg-white/[0.08] hover:text-zinc-200"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    {plans.length > 1 && (
                      <button
                        type="button"
                        onClick={() => onDeletePlan(plan.id)}
                        title="Удалить план"
                        className="rounded p-0.5 text-zinc-500 hover:bg-rose-500/20 hover:text-rose-400"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <button
            type="button"
            onClick={onCreatePlan}
            className="flex shrink-0 items-center gap-1 rounded-md border border-dashed border-white/[0.12] px-2 py-1 text-[11px] font-medium text-zinc-400 transition-all duration-150 ease-out hover:border-emerald-500/40 hover:text-emerald-400"
          >
            <Plus className="h-3 w-3" />
            <span>Новый план</span>
          </button>
        </div>

        {/* Starter Presets Dropdown */}
        <div className="relative shrink-0" ref={presetRef}>
          <button
            type="button"
            onClick={() => setPresetsOpen((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-300 transition-all duration-150 ease-out hover:bg-amber-500/20"
          >
            <Sparkles className="h-3 w-3" />
            <span>Пресеты цехов</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {presetsOpen && (
            <div className="absolute right-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-white/[0.1] bg-[#121214] p-1.5 shadow-2xl">
              <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Готовые производственные комплексы
              </div>
              {STARTER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onLoadPreset(preset);
                    setPresetsOpen(false);
                  }}
                  className="flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left transition-all duration-150 ease-out hover:bg-[#18181b]"
                >
                  <span className="text-xs font-semibold text-zinc-100">
                    {preset.name}
                  </span>
                  <span className="mt-0.5 text-[11px] leading-snug text-zinc-400">
                    {preset.description}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
