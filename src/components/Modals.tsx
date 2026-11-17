import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FileCode2,
  FileUp,
  Plus,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import type { FactoryPlanConfig, SolveResult } from '../types/coi';
import {
  MACHINES,
  PRODUCTS_LIST,
  getMachineIconUrl,
  getProductIconUrl,
  getProductLabel,
  matchesProductQuery,
} from '../data';
import { STARTER_PRESETS } from '../data/presets';
import { getProducingRecipes } from '../engine/solver';
import {
  decodeGameBlueprint,
  decodedBlueprintToFactoryPlan,
  encodePlanToGameBlueprint,
} from '../engine/gameBlueprint';
import { cn } from '../utils/cn';

interface ProductPickerModalProps {
  open: boolean;
  onClose: () => void;
  onSelectProduct: (productId: string) => void;
}

export const ProductPickerModal: React.FC<ProductPickerModalProps> = ({
  open,
  onClose,
  onSelectProduct,
}) => {
  const [query, setQuery] = useState('');
  const [onlyProducible, setOnlyProducible] = useState(true);

  const items = useMemo(() => {
    return PRODUCTS_LIST.filter((p) => {
      if (!matchesProductQuery(p, query)) return false;
      if (onlyProducible && getProducingRecipes(p.id).length === 0) return false;
      return true;
    });
  }, [query, onlyProducible]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/[0.12] bg-[#121214] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.08] px-4 py-3">
          <h3 className="text-sm font-semibold text-zinc-100">
            Добавить целевой продукт
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.08] px-4 py-2.5">
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-white/[0.1] bg-[#09090b] px-3 py-1.5">
            <Search className="h-4 w-4 text-zinc-500" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск на русском или английском (Сталь, Diesel, Microchips...)"
              className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setOnlyProducible((v) => !v)}
            className={cn(
              'rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors',
              onlyProducible
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-white/[0.08] bg-[#09090b] text-zinc-400',
            )}
          >
            Только производимые
          </button>
        </div>

        <div className="grid flex-1 grid-cols-2 gap-1.5 overflow-y-auto p-3 sm:grid-cols-3">
          {items.map((p) => {
            const { en, ru } = getProductLabel(p.id);
            const recCount = getProducingRecipes(p.id).length;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  onSelectProduct(p.id);
                  onClose();
                }}
                className="flex items-center gap-2.5 rounded-xl border border-white/[0.06] bg-[#09090b] p-2.5 text-left transition-all duration-150 hover:border-emerald-500/40 hover:bg-[#18181b]"
              >
                <img
                  src={getProductIconUrl(p.icon)}
                  alt={en}
                  className="h-8 w-8 shrink-0 object-contain"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-zinc-100">
                    {ru ?? en}
                  </div>
                  <div className="truncate text-[10px] text-zinc-500">
                    {ru ? en : `${recCount} рец.`}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface CommandPaletteModalProps {
  open: boolean;
  onClose: () => void;
  onAddTargetProduct: (productId: string) => void;
  onInspectProduct: (productId: string) => void;
  onLoadPreset: (preset: FactoryPlanConfig) => void;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  open,
  onClose,
  onAddTargetProduct,
  onInspectProduct,
  onLoadPreset,
}) => {
  const [query, setQuery] = useState('');

  const matchingProducts = useMemo(() => {
    return PRODUCTS_LIST.filter((p) => matchesProductQuery(p, query)).slice(0, 14);
  }, [query]);

  const matchingPresets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STARTER_PRESETS.filter(
      (pr) =>
        !q ||
        pr.name.toLowerCase().includes(q) ||
        (pr.description && pr.description.toLowerCase().includes(q)),
    );
  }, [query]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/75 px-4 pt-20 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/[0.14] bg-[#121214] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 border-b border-white/[0.08] px-4 py-3">
          <Search className="h-4 w-4 text-emerald-400" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
            placeholder="Быстрый поиск: Сталь, Дизель, Микрочипы, Copper, Пресет..."
            className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 outline-none"
          />
          <kbd className="rounded border border-white/[0.1] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-zinc-500">
            ESC
          </kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2">
          {matchingPresets.length > 0 && (
            <div className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Пресеты цехов
              </div>
              {matchingPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    onLoadPreset(preset);
                    onClose();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-[#18181b]"
                >
                  <Sparkles className="h-4 w-4 text-amber-400" />
                  <div>
                    <div className="font-semibold text-zinc-100">{preset.name}</div>
                    <div className="text-[11px] text-zinc-500">
                      {preset.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Продукты и ресурсы
            </div>
            {matchingProducts.map((p) => {
              const { en, ru } = getProductLabel(p.id);
              const producible = getProducingRecipes(p.id).length > 0;
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-[#18181b]"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <img
                      src={getProductIconUrl(p.icon)}
                      alt={en}
                      className="h-6 w-6 shrink-0 object-contain"
                    />
                    <div className="min-w-0">
                      <span className="text-xs font-semibold text-zinc-100">
                        {ru ?? en}
                      </span>
                      {ru && (
                        <span className="ml-2 text-[11px] text-zinc-500">{en}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {producible && (
                      <button
                        type="button"
                        onClick={() => {
                          onAddTargetProduct(p.id);
                          onClose();
                        }}
                        className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                      >
                        <Plus className="h-3 w-3" />
                        <span>В цель</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        onInspectProduct(p.id);
                        onClose();
                      }}
                      className="rounded border border-white/[0.08] bg-[#09090b] px-2 py-1 text-[11px] text-zinc-300 hover:border-white/[0.2]"
                    >
                      Кодекс
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

interface BlueprintModalProps {
  open: boolean;
  plan: FactoryPlanConfig;
  solveResult: SolveResult;
  onClose: () => void;
  onImportPlan: (imported: FactoryPlanConfig) => void;
}

export const BlueprintModal: React.FC<BlueprintModalProps> = ({
  open,
  plan,
  solveResult,
  onClose,
  onImportPlan,
}) => {
  const [tab, setTab] = useState<'game' | 'json'>('game');
  const [includeDisposal, setIncludeDisposal] = useState(true);
  const [includeStorage, setIncludeStorage] = useState(true);
  const [importText, setImportText] = useState('');
  const [gameBpInput, setGameBpInput] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatedGameBp = useMemo(() => {
    if (!open) return null;
    try {
      return encodePlanToGameBlueprint(solveResult, plan.name, {
        includeDisposalBuildings: includeDisposal,
        includeBufferStorages: includeStorage,
      });
    } catch {
      return null;
    }
  }, [open, solveResult, plan.name, includeDisposal, includeStorage]);

  const decodedGameBp = useMemo(() => {
    const raw = gameBpInput.trim();
    if (!raw) return { data: null, error: null };
    try {
      return { data: decodeGameBlueprint(raw), error: null };
    } catch (e) {
      return {
        data: null,
        error: e instanceof Error ? e.message : 'Не удалось расшифровать чертёж B...',
      };
    }
  }, [gameBpInput]);

  if (!open) return null;

  const exportedJson = JSON.stringify(plan, null, 2);

  const handleCopyText = async (txt: string) => {
    await navigator.clipboard.writeText(txt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleDownloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadTxtFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setGameBpInput(text.trim());
  };

  const handleImportJson = () => {
    try {
      const parsed = JSON.parse(importText) as FactoryPlanConfig;
      if (!parsed || !Array.isArray(parsed.targets)) {
        throw new Error('Некорректная структура плана (отсутствует массив targets)');
      }
      onImportPlan({
        ...parsed,
        id: `imported-${Date.now()}`,
        name: parsed.name ? `${parsed.name} (Импорт)` : 'Импортированный план',
        recipeOverrides: parsed.recipeOverrides ?? {},
        rawResources: parsed.rawResources ?? [],
        contractOverrides: parsed.contractOverrides ?? {},
        productionBoost: parsed.productionBoost ?? 1,
        roundMachinesUp: parsed.roundMachinesUp ?? true,
      });
      setImportText('');
      setError(null);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка разбора JSON');
    }
  };

  const handleImportGameBlueprint = () => {
    if (!decodedGameBp.data) return;
    const planFromBp = decodedBlueprintToFactoryPlan(decodedGameBp.data);
    onImportPlan(planFromBp);
    setGameBpInput('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-white/[0.12] bg-[#121214] p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.08] pb-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5">
              <button
                type="button"
                onClick={() => setTab('game')}
                className={cn(
                  'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors',
                  tab === 'game'
                    ? 'bg-[#18181b] text-emerald-300'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                <FileCode2 className="h-3.5 w-3.5" />
                <span>Чертёж для игры (B...)</span>
              </button>
              <button
                type="button"
                onClick={() => setTab('json')}
                className={cn(
                  'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                  tab === 'json'
                    ? 'bg-[#18181b] text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                JSON (Бэкап калькулятора)
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {tab === 'game' ? (
          <div className="mt-3 grid flex-1 grid-cols-1 gap-4 overflow-y-auto md:grid-cols-2">
            {/* Left: Generate Game Blueprint String */}
            <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#09090b] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-emerald-300">
                    Экспорт схемы цехов в игру
                  </h4>
                  <p className="text-[11px] text-zinc-500">
                    Скопируйте код и вставьте в игре через меню чертежей (Ctrl+V)
                  </p>
                </div>
                {generatedGameBp && (
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-emerald-300">
                    {generatedGameBp.entityCount} зд.
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-3 text-[11px] text-zinc-300">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeDisposal}
                    onChange={(e) => setIncludeDisposal(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <span>Включить факелы / трубы / сливы</span>
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={includeStorage}
                    onChange={(e) => setIncludeStorage(e.target.checked)}
                    className="accent-emerald-500"
                  />
                  <span>Включить склады-буферы</span>
                </label>
              </div>

              {generatedGameBp && (
                <>
                  <div className="max-h-36 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#121214] p-2">
                    <div className="flex flex-col gap-1">
                      {generatedGameBp.entries.map((ent, idx) => {
                        const m = MACHINES[ent.machineId];
                        return (
                          <div
                            key={`${ent.machineId}-${ent.recipeId ?? idx}`}
                            className="flex items-center justify-between gap-2 text-[11px]"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {m && (
                                <img
                                  src={getMachineIconUrl(m.icon)}
                                  alt={ent.machineNameRu}
                                  className="h-4 w-4 shrink-0 object-contain"
                                />
                              )}
                              <span className="truncate text-zinc-200">
                                {ent.machineNameRu}
                              </span>
                              {ent.recipeNameRu && (
                                <span className="truncate text-[10px] text-zinc-500">
                                  • {ent.recipeNameRu}
                                </span>
                              )}
                            </div>
                            <span
                              className={cn(
                                'shrink-0 font-mono font-bold',
                                ent.kind === 'disposal'
                                  ? 'text-orange-300'
                                  : ent.kind === 'storage'
                                    ? 'text-sky-300'
                                    : 'text-emerald-300',
                              )}
                            >
                              {ent.count}×
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <textarea
                    readOnly
                    value={generatedGameBp.code}
                    className="h-28 w-full rounded-lg border border-white/[0.08] bg-[#121214] p-2 font-mono text-[10px] text-zinc-400 outline-none"
                  />

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCopyText(generatedGameBp.code)}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {copied ? 'Код скопирован!' : 'Копировать код для игры'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleDownloadFile(
                          generatedGameBp.code,
                          `${plan.name || 'blueprint'}.txt`,
                          'text/plain;charset=utf-8',
                        )
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#121214] px-3 py-2 text-xs text-zinc-300 hover:border-white/[0.2]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>.txt</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* Right: Decode & Import Game Blueprint */}
            <div className="flex flex-col gap-2.5 rounded-xl border border-white/[0.08] bg-[#09090b] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-semibold text-violet-300">
                    Импорт и разбор чертежа из игры
                  </h4>
                  <p className="text-[11px] text-zinc-500">
                    Вставьте строку B... или загрузите файл .txt с чертежом
                  </p>
                </div>
                <label className="flex cursor-pointer items-center gap-1 rounded-lg border border-white/[0.1] bg-[#121214] px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-violet-500/40 hover:text-violet-200">
                  <FileUp className="h-3.5 w-3.5" />
                  <span>Загрузить .txt</span>
                  <input
                    type="file"
                    accept=".txt"
                    onChange={handleUploadTxtFile}
                    className="hidden"
                  />
                </label>
              </div>

              <textarea
                value={gameBpInput}
                onChange={(e) => setGameBpInput(e.target.value)}
                placeholder="Вставьте строку чертежа B... (например из 'Сталь на дуговых.txt')"
                className="h-24 w-full rounded-lg border border-white/[0.08] bg-[#121214] p-2 font-mono text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-violet-500/40"
              />

              {decodedGameBp.error && (
                <p className="text-xs text-rose-400">{decodedGameBp.error}</p>
              )}

              {decodedGameBp.data && (
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-500/25 bg-violet-500/10 px-2.5 py-1.5 text-xs">
                    <span className="font-semibold text-violet-200">
                      {decodedGameBp.data.name}
                    </span>
                    <span className="font-mono text-[10px] text-violet-300">
                      v{decodedGameBp.data.gameVersion} •{' '}
                      {decodedGameBp.data.totalEntities} об. (конв./труб:{' '}
                      {decodedGameBp.data.transportCount})
                    </span>
                  </div>

                  <div className="max-h-40 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#121214] p-2">
                    <div className="flex flex-col gap-1">
                      {decodedGameBp.data.machineGroups.map((g, i) => (
                        <div
                          key={`${g.protoId}-${i}`}
                          className="flex items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            {g.machineIcon && (
                              <img
                                src={getMachineIconUrl(g.machineIcon)}
                                alt={g.machineNameRu}
                                className="h-4 w-4 shrink-0 object-contain"
                              />
                            )}
                            <span className="truncate text-zinc-200">
                              {g.machineNameRu}
                            </span>
                            {g.recipeNameRu && (
                              <span className="truncate text-[10px] text-zinc-500">
                                • {g.recipeNameRu}
                              </span>
                            )}
                          </div>
                          <span className="shrink-0 font-mono font-semibold text-zinc-300">
                            {g.count}×
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleImportGameBlueprint}
                    className="mt-auto flex items-center justify-center gap-1.5 rounded-lg border border-violet-500/40 bg-violet-500/15 py-2 text-xs font-semibold text-violet-200 transition-colors hover:bg-violet-500/25"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    <span>Открыть схему в калькуляторе</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">
                  Текущий план ({plan.name})
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopyText(exportedJson)}
                    className="flex items-center gap-1 rounded border border-white/[0.1] bg-[#09090b] px-2 py-1 text-[11px] text-zinc-300 hover:border-white/[0.2]"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-emerald-400" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    <span>{copied ? 'Скопировано' : 'Копировать'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleDownloadFile(
                        exportedJson,
                        `${plan.id}.json`,
                        'application/json',
                      )
                    }
                    className="flex items-center gap-1 rounded border border-white/[0.1] bg-[#09090b] px-2 py-1 text-[11px] text-zinc-300 hover:border-white/[0.2]"
                  >
                    <Download className="h-3 w-3" />
                    <span>Файл</span>
                  </button>
                </div>
              </div>
              <textarea
                readOnly
                value={exportedJson}
                className="h-64 w-full rounded-lg border border-white/[0.08] bg-[#09090b] p-2.5 font-mono text-[11px] text-zinc-400 outline-none"
              />
            </div>

            <div className="flex flex-col">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-zinc-300">
                  Импортировать из JSON
                </span>
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="Вставьте JSON плана сюда..."
                className="h-64 w-full rounded-lg border border-white/[0.08] bg-[#09090b] p-2.5 font-mono text-[11px] text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-emerald-500/40"
              />
              {error && <p className="mt-1.5 text-xs text-rose-400">{error}</p>}
              <button
                type="button"
                onClick={handleImportJson}
                disabled={!importText.trim()}
                className="mt-2.5 flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/15 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-40"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Создать план из JSON</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
