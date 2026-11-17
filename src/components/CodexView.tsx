import React, { useMemo, useState } from 'react';
import {
  Anchor,
  ArrowRight,
  Box,
  Cpu,
  Factory,
  FlaskConical,
  Plus,
  Search,
  Truck,
  Users,
  Zap,
} from 'lucide-react';
import {
  CATEGORIES_LIST,
  CONTRACTS,
  MACHINES,
  MACHINES_LIST,
  PRODUCTS,
  PRODUCTS_LIST,
  RECIPES,
  RECIPES_LIST,
  TRANSPORT_TIERS,
  getCategoryLabel,
  getMachineIconUrl,
  getMachineLabel,
  getProductIconUrl,
  getProductLabel,
  getRecipeLabel,
  matchesMachineQuery,
  matchesProductQuery,
  matchesRecipeQuery,
} from '../data';
import { getProducingRecipes } from '../engine/solver';
import { cn } from '../utils/cn';
import { formatNumber, formatPower } from '../utils/format';

type CodexTab = 'products' | 'machines' | 'recipes' | 'contracts' | 'logistics';

interface CodexViewProps {
  initialProductId: string | null;
  onAddTargetProduct: (productId: string, recipeId?: string) => void;
  onApplyRecipeOverride: (productId: string, recipeId: string) => void;
  onApplyContractOverride: (productId: string, contractId: string) => void;
}

export const CodexView: React.FC<CodexViewProps> = ({
  initialProductId,
  onAddTargetProduct,
  onApplyRecipeOverride,
  onApplyContractOverride,
}) => {
  const [tab, setTab] = useState<CodexTab>('products');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [selectedProductId, setSelectedProductId] = useState<string>(
    initialProductId ?? 'construction_parts_iii',
  );
  const [selectedMachineId, setSelectedMachineId] = useState<string>('blast_furnace_ii');
  const [contractRateInput, setContractRateInput] = useState<number>(60);
  const [recipeLimit, setRecipeLimit] = useState<number>(60);

  const filteredProducts = useMemo(
    () => PRODUCTS_LIST.filter((p) => matchesProductQuery(p, query)),
    [query],
  );

  const filteredMachines = useMemo(() => {
    return MACHINES_LIST.filter((m) => {
      if (categoryFilter !== 'all' && m.category_id !== categoryFilter) {
        return false;
      }
      return matchesMachineQuery(m, query);
    });
  }, [query, categoryFilter]);

  const filteredRecipes = useMemo(
    () => RECIPES_LIST.filter((r) => matchesRecipeQuery(r, query)),
    [query],
  );

  const filteredContracts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CONTRACTS.filter((c) => {
      if (!q) return true;
      const buyLbl = c.buyProductId ? getProductLabel(c.buyProductId) : null;
      const payLbl = c.payProductId ? getProductLabel(c.payProductId) : null;
      return (
        c.product_to_buy_name.toLowerCase().includes(q) ||
        c.product_to_pay_with_name.toLowerCase().includes(q) ||
        (buyLbl?.ru && buyLbl.ru.toLowerCase().includes(q)) ||
        (payLbl?.ru && payLbl.ru.toLowerCase().includes(q))
      );
    });
  }, [query]);

  const selectedProduct = PRODUCTS[selectedProductId] ?? PRODUCTS_LIST[0];
  const producingRecipesForSelected = useMemo(
    () => (selectedProduct ? getProducingRecipes(selectedProduct.id) : []),
    [selectedProduct],
  );
  const consumingRecipesForSelected = useMemo(() => {
    if (!selectedProduct) return [];
    return selectedProduct.recipes.input
      .map((rid) => RECIPES[rid])
      .filter((r) => r && !MACHINES[r.machine]?.isStorage);
  }, [selectedProduct]);

  const selectedMachine = MACHINES[selectedMachineId] ?? MACHINES_LIST[0];

  return (
    <div className="flex flex-1 flex-col gap-3 px-4 py-3">
      {/* Sub-tabs & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.08] bg-[#121214] p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {[
            { id: 'products' as CodexTab, label: `Продукты (${PRODUCTS_LIST.length})`, icon: Box },
            { id: 'machines' as CodexTab, label: `Здания (${MACHINES_LIST.length})`, icon: Factory },
            { id: 'recipes' as CodexTab, label: `Рецепты (${RECIPES_LIST.length})`, icon: FlaskConical },
            { id: 'contracts' as CodexTab, label: `Контракты (${CONTRACTS.length})`, icon: Anchor },
            { id: 'logistics' as CodexTab, label: `Логистика (${TRANSPORT_TIERS.length})`, icon: Truck },
          ].map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150',
                  tab === t.id
                    ? 'bg-[#18181b] text-violet-300 ring-1 ring-white/[0.1]'
                    : 'text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#09090b] px-2.5 py-1.5 min-w-[260px]">
          <Search className="h-3.5 w-3.5 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setRecipeLimit(60);
            }}
            placeholder="Поиск (RU / EN)..."
            className="w-full bg-transparent text-xs text-zinc-100 placeholder:text-zinc-600 outline-none"
          />
        </div>
      </div>

      {/* TAB 1: PRODUCTS */}
      {tab === 'products' && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          {/* Grid of products */}
          <div className="lg:col-span-7 rounded-xl border border-white/[0.08] bg-[#121214] p-3">
            <div className="grid max-h-[680px] grid-cols-2 gap-1.5 overflow-y-auto pr-1 sm:grid-cols-3">
              {filteredProducts.map((p) => {
                const { en, ru } = getProductLabel(p.id);
                const active = selectedProduct?.id === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedProductId(p.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border p-2 text-left transition-all duration-150',
                      active
                        ? 'border-violet-500/50 bg-violet-500/10'
                        : 'border-white/[0.06] bg-[#09090b] hover:border-white/[0.15] hover:bg-[#18181b]',
                    )}
                  >
                    <img
                      src={getProductIconUrl(p.icon)}
                      alt={en}
                      className="h-7 w-7 shrink-0 object-contain"
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-zinc-100">
                        {ru ?? en}
                      </div>
                      <div className="truncate text-[10px] text-zinc-500">
                        {ru ? en : p.id}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Product Details Inspector */}
          {selectedProduct && (
            <div className="lg:col-span-5 flex flex-col gap-3 rounded-xl border border-white/[0.08] bg-[#121214] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img
                    src={getProductIconUrl(selectedProduct.icon)}
                    alt={selectedProduct.name}
                    className="h-12 w-12 rounded-xl border border-white/[0.08] bg-[#09090b] p-1.5 object-contain"
                  />
                  <div>
                    <h2 className="text-base font-bold text-zinc-100">
                      {getProductLabel(selectedProduct.id).ru ?? selectedProduct.name}
                    </h2>
                    <div className="font-mono text-xs text-zinc-400">
                      {selectedProduct.name} • {selectedProduct.id}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onAddTargetProduct(selectedProduct.id)}
                  className="flex items-center gap-1 rounded-lg border border-emerald-500/35 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>В цели завода</span>
                </button>
              </div>

              {/* Producing Recipes */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Способы производства ({producingRecipesForSelected.length})
                </h3>
                <div className="mt-2 flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-1">
                  {producingRecipesForSelected.length === 0 ? (
                    <span className="text-xs text-zinc-500">
                      Добываемый / исходный ресурс или отход.
                    </span>
                  ) : (
                    producingRecipesForSelected.map((r) => {
                      const m = MACHINES[r.machine];
                      const mLbl = m ? getMachineLabel(m.id) : null;
                      const rLbl = getRecipeLabel(r.id);
                      return (
                        <div
                          key={r.id}
                          className="rounded-lg border border-white/[0.07] bg-[#09090b] p-2.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {m && (
                                <img
                                  src={getMachineIconUrl(m.icon)}
                                  alt={mLbl?.ru ?? m.name}
                                  className="h-5 w-5 shrink-0 object-contain"
                                />
                              )}
                              <div className="min-w-0">
                                <div className="truncate text-xs font-semibold text-zinc-100">
                                  {rLbl.ru}
                                </div>
                                {mLbl && (
                                  <div className="truncate text-[10px] text-zinc-500">
                                    {mLbl.ru}
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() =>
                                  onApplyRecipeOverride(selectedProduct.id, r.id)
                                }
                                className="rounded border border-white/[0.1] bg-[#121214] px-2 py-0.5 text-[10px] text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300"
                              >
                                Выбрать в план
                              </button>
                            </div>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 font-mono text-[10px] text-zinc-400">
                            {r.inputs.map((i) => (
                              <span
                                key={i.id}
                                className="rounded bg-white/[0.04] px-1.5 py-0.5"
                              >
                                {i.quantity} {getProductLabel(i.id).ru ?? i.name}
                              </span>
                            ))}
                            <ArrowRight className="h-3 w-3 text-zinc-600" />
                            {r.outputs.map((o) => (
                              <span
                                key={o.id}
                                className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300"
                              >
                                {o.quantity} {getProductLabel(o.id).ru ?? o.name}
                              </span>
                            ))}
                            <span className="ml-auto text-zinc-500">{r.duration}с</span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Consuming Recipes */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Где используется ({consumingRecipesForSelected.length})
                </h3>
                <div className="mt-2 flex max-h-56 flex-col gap-1.5 overflow-y-auto pr-1">
                  {consumingRecipesForSelected.slice(0, 30).map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-col gap-1 rounded-lg border border-white/[0.06] bg-[#09090b] px-2.5 py-1.5"
                    >
                      <div className="flex items-center justify-between text-xs font-medium text-zinc-200">
                        <span>{getRecipeLabel(r.id).ru}</span>
                        <span className="font-mono text-[10px] text-zinc-500">
                          {getMachineLabel(r.machine).ru}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1 font-mono text-[10px] text-zinc-400">
                        {r.inputs.map((i) => i.quantity + ' ' + (getProductLabel(i.id).ru ?? i.name)).join(' + ')} →{' '}
                        {r.outputs.map((o) => o.quantity + ' ' + (getProductLabel(o.id).ru ?? o.name)).join(' + ')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: MACHINES */}
      {tab === 'machines' && (
        <div className="flex flex-col gap-3">
          {/* Category Pills */}
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={cn(
                'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                categoryFilter === 'all'
                  ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
                  : 'border-white/[0.08] bg-[#121214] text-zinc-400 hover:text-zinc-200',
              )}
            >
              Все категории
            </button>
            {CATEGORIES_LIST.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  categoryFilter === cat.id
                    ? 'border-violet-500/40 bg-violet-500/15 text-violet-200'
                    : 'border-white/[0.08] bg-[#121214] text-zinc-400 hover:text-zinc-200',
                )}
              >
                {getCategoryLabel(cat.id)}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            <div className="lg:col-span-7 grid max-h-[620px] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {filteredMachines.map((m) => {
                const mLbl = getMachineLabel(m.id);
                return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedMachineId(m.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-2.5 text-left transition-all duration-150',
                    selectedMachine?.id === m.id
                      ? 'border-violet-500/50 bg-violet-500/10'
                      : 'border-white/[0.08] bg-[#121214] hover:border-white/[0.15]',
                  )}
                >
                  <img
                    src={getMachineIconUrl(m.icon)}
                    alt={mLbl.ru}
                    className="h-10 w-10 shrink-0 rounded-lg bg-[#09090b] p-1 object-contain"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-zinc-100">
                      {mLbl.ru}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">
                      {mLbl.en !== mLbl.ru ? `${mLbl.en} • ` : ''}
                      {getCategoryLabel(m.category_id)}
                    </div>
                    <div className="mt-1 flex items-center gap-2 font-mono text-[10px] tabular-nums text-zinc-400">
                      <span>{m.workers} раб.</span>
                      {m.electricity_consumed > 0 && (
                        <span className="text-amber-300">
                          {formatPower(m.electricity_consumed)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                );
              })}
            </div>

            {selectedMachine && (
              <div className="lg:col-span-5 rounded-xl border border-white/[0.08] bg-[#121214] p-4">
                <div className="flex items-center gap-3">
                  <img
                    src={getMachineIconUrl(selectedMachine.icon)}
                    alt={getMachineLabel(selectedMachine.id).ru}
                    className="h-14 w-14 rounded-xl border border-white/[0.08] bg-[#09090b] p-1.5 object-contain"
                  />
                  <div>
                    <h2 className="text-base font-bold text-zinc-100">
                      {getMachineLabel(selectedMachine.id).ru}
                    </h2>
                    <div className="text-xs text-zinc-400">
                      {selectedMachine.name} • {getCategoryLabel(selectedMachine.category_id)}
                    </div>
                  </div>
                </div>
                {getMachineLabel(selectedMachine.id).descRu && (
                  <p className="mt-2.5 rounded-lg border border-white/[0.06] bg-[#09090b] p-2.5 text-xs leading-relaxed text-zinc-400">
                    {getMachineLabel(selectedMachine.id).descRu}
                  </p>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2 font-mono text-xs tabular-nums">
                  <div className="rounded-lg border border-white/[0.06] bg-[#09090b] p-2">
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <Users className="h-3 w-3" /> Рабочие
                    </div>
                    <div className="mt-0.5 font-semibold text-zinc-100">
                      {selectedMachine.workers}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-[#09090b] p-2">
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <Zap className="h-3 w-3 text-amber-400" /> Энергия
                    </div>
                    <div className="mt-0.5 font-semibold text-amber-300">
                      {selectedMachine.electricity_generated > 0
                        ? `+${formatPower(selectedMachine.electricity_generated)}`
                        : formatPower(selectedMachine.electricity_consumed)}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-[#09090b] p-2">
                    <div className="text-[10px] text-zinc-500">Обслуживание</div>
                    <div className="mt-0.5 font-semibold text-zinc-200">
                      {selectedMachine.maintenance_cost_quantity > 0
                        ? `${selectedMachine.maintenance_cost_quantity} (${selectedMachine.maintenance_cost_units})`
                        : 'Нет'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-white/[0.06] bg-[#09090b] p-2">
                    <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                      <Cpu className="h-3 w-3 text-violet-400" /> Вычисления / Unity
                    </div>
                    <div className="mt-0.5 font-semibold text-violet-300">
                      {selectedMachine.computing_consumed} TF / {selectedMachine.unity_cost} U
                    </div>
                  </div>
                </div>

                {selectedMachine.build_costs.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                      Стоимость постройки
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {selectedMachine.build_costs.map((bc) => {
                        const prod = PRODUCTS[bc.id];
                        return (
                          <div
                            key={bc.id}
                            className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-[#09090b] px-2 py-1 font-mono text-xs"
                          >
                            {prod && (
                              <img
                                src={getProductIconUrl(prod.icon)}
                                alt={bc.name}
                                className="h-4 w-4 object-contain"
                              />
                            )}
                            <span>{getProductLabel(bc.id).ru ?? bc.name}:</span>
                            <strong className="text-zinc-100">{bc.quantity}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                    Рецепты в здании ({selectedMachine.recipes.length})
                  </div>
                  <div className="mt-1.5 flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
                    {selectedMachine.recipes.map((rid) => {
                      const r = RECIPES[rid];
                      if (!r) return null;
                      return (
                        <div
                          key={rid}
                          className="rounded border border-white/[0.06] bg-[#09090b] px-2.5 py-1.5 text-[11px]"
                        >
                          <div className="font-semibold text-zinc-200">{getRecipeLabel(r.id).ru}</div>
                          <div className="font-mono text-[10px] text-zinc-400">
                            {r.inputs.map((i) => `${i.quantity} ${getProductLabel(i.id).ru ?? i.name}`).join(' + ') || '—'} →{' '}
                            {r.outputs.map((o) => `${o.quantity} ${getProductLabel(o.id).ru ?? o.name}`).join(' + ')} ({r.duration}с)
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: RECIPES */}
      {tab === 'recipes' && (
        <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
            <span>Найдено рецептов: {filteredRecipes.length}</span>
            <span>Показаны первые {Math.min(recipeLimit, filteredRecipes.length)}</span>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {filteredRecipes.slice(0, recipeLimit).map((r) => {
              const m = MACHINES[r.machine];
              const mLbl = m ? getMachineLabel(m.id) : null;
              const rLbl = getRecipeLabel(r.id);
              return (
                <div
                  key={r.id}
                  className="flex flex-col justify-between rounded-xl border border-white/[0.07] bg-[#09090b] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {m && (
                        <img
                          src={getMachineIconUrl(m.icon)}
                          alt={mLbl?.ru ?? m.name}
                          className="h-6 w-6 shrink-0 object-contain"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold text-zinc-100">
                          {rLbl.ru}
                        </div>
                        <div className="truncate text-[10px] text-zinc-500">
                          {mLbl?.ru ?? r.machine} • {r.duration}с
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-[10px]">
                    {r.inputs.map((i) => (
                      <span
                        key={i.id}
                        className="rounded bg-white/[0.04] px-1.5 py-0.5 text-zinc-300"
                      >
                        {i.quantity} {getProductLabel(i.id).ru ?? i.name}
                      </span>
                    ))}
                    <ArrowRight className="h-3 w-3 text-zinc-600" />
                    {r.outputs.map((o) => (
                      <span
                        key={o.id}
                        className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300"
                      >
                        {o.quantity} {getProductLabel(o.id).ru ?? o.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          {recipeLimit < filteredRecipes.length && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setRecipeLimit((n) => n + 60)}
                className="rounded-lg border border-white/[0.1] bg-[#18181b] px-4 py-1.5 text-xs font-medium text-zinc-200 hover:border-white/[0.2]"
              >
                Загрузить ещё 60 рецептов
              </button>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: CONTRACTS */}
      {tab === 'contracts' && (
        <div className="flex flex-col gap-3">
          {/* Interactive Contract Rate Multiplier */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-violet-300">
                Калькулятор торговых контрактов (56 маршрутов)
              </h3>
              <p className="text-[11px] text-zinc-400">
                Укажите нужный темп импорта товара, чтобы увидеть требуемый экспорт и расход Unity
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-400">Желаемый импорт:</span>
              <input
                type="number"
                min={1}
                step={10}
                value={contractRateInput}
                onChange={(e) =>
                  setContractRateInput(Math.max(1, Number(e.target.value) || 60))
                }
                className="w-24 rounded-lg border border-white/[0.12] bg-[#09090b] px-2.5 py-1 font-mono text-sm font-semibold tabular-nums text-violet-200 outline-none focus:border-violet-400"
              />
              <span className="font-mono text-xs text-zinc-400">/60с</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {filteredContracts.map((c) => {
              const buyProd = c.buyProductId ? PRODUCTS[c.buyProductId] : undefined;
              const payProd = c.payProductId ? PRODUCTS[c.payProductId] : undefined;
              const buyLbl = c.buyProductId ? getProductLabel(c.buyProductId) : null;
              const payLbl = c.payProductId ? getProductLabel(c.payProductId) : null;
              const ratio =
                contractRateInput / Math.max(1, c.product_to_buy_quantity);
              const exportNeeded = ratio * c.product_to_pay_with_quantity;
              const totalUnity =
                c.unity_per_month +
                (contractRateInput / 100) * c.unity_per_100_bought;

              return (
                <div
                  key={c.id}
                  className="flex flex-col justify-between rounded-xl border border-white/[0.08] bg-[#121214] p-3.5 transition-all duration-150 hover:border-violet-500/35"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {buyProd && (
                        <img
                          src={getProductIconUrl(buyProd.icon)}
                          alt={c.product_to_buy_name}
                          className="h-7 w-7 shrink-0 object-contain"
                        />
                      )}
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-emerald-300">
                          +{buyLbl?.ru ?? c.product_to_buy_name}
                        </div>
                        <div className="truncate text-[10px] text-zinc-500">
                          База: {c.product_to_buy_quantity} за{' '}
                          {c.product_to_pay_with_quantity}{' '}
                          {c.product_to_pay_with_name}
                        </div>
                      </div>
                    </div>
                    <span className="rounded border border-white/[0.08] bg-[#09090b] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                      Rep ≥ {c.min_reputation_required}
                    </span>
                  </div>

                  {/* Calculated row */}
                  <div className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.06] bg-[#09090b] p-2 font-mono text-[11px] tabular-nums">
                    <div className="flex items-center gap-1.5 text-rose-300">
                      {payProd && (
                        <img
                          src={getProductIconUrl(payProd.icon)}
                          alt={c.product_to_pay_with_name}
                          className="h-4 w-4 object-contain"
                        />
                      )}
                      <span>
                        -{formatNumber(exportNeeded, 1)} {payLbl?.ru ?? c.product_to_pay_with_name}
                      </span>
                    </div>
                    <span className="text-violet-300">
                      {formatNumber(totalUnity, 2)} Unity/мес
                    </span>
                  </div>

                  {c.buyProductId && (
                    <button
                      type="button"
                      onClick={() =>
                        onApplyContractOverride(c.buyProductId!, c.id)
                      }
                      className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg border border-violet-500/30 bg-violet-500/10 py-1.5 text-xs font-medium text-violet-200 transition-colors hover:bg-violet-500/20"
                    >
                      <Anchor className="h-3.5 w-3.5" />
                      <span>Подключить в активный план</span>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 5: LOGISTICS */}
      {tab === 'logistics' && (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {TRANSPORT_TIERS.map((tr) => (
            <div
              key={tr.id}
              className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-[#121214] p-3.5"
            >
              <img
                src={tr.icon}
                alt={tr.name}
                className="h-12 w-12 shrink-0 rounded-lg border border-white/[0.08] bg-[#09090b] p-1 object-contain"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-zinc-100">{tr.ruName}</div>
                <div className="text-[11px] text-zinc-500">{tr.name}</div>
                <div className="mt-1.5 flex items-center gap-3 font-mono text-xs tabular-nums">
                  <span className="font-semibold text-emerald-300">
                    {tr.throughputPer60} /60с
                  </span>
                  <span className="text-zinc-400">({tr.throughputPerSec} /сек)</span>
                  {tr.electricityKw > 0 && (
                    <span className="text-amber-300">{tr.electricityKw} кВт</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
