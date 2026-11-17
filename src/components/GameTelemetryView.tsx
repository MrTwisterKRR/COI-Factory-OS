import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  ChevronDown,
  Copy,
  Factory,
  Flame,
  History,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Unlock,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { RateUnit, SolveResult, TechStageMode } from '../types/coi';
import {
  CATEGORIES_LIST,
  GAME_ID_TO_PRODUCT_ID,
  GAME_ID_TO_RECIPE_ID,
  MACHINE_BY_GAME_ID,
  MACHINES_LIST,
  PRODUCT_GAME_IDS,
  PRODUCTS,
  VIRTUAL_PRODUCT_IDS,
  getCategoryLabel,
  getMachineIconUrl,
  getMachineLabel,
  getProductIconUrl,
  getProductLabel,
  getRecipeLabel,
} from '../data';
import {
  type GameCapabilities,
  type GameConnectionMode,
  type GameLiveBundle,
  type ProductHistoryResponse,
  type SourcesPeriod,
  TECH_STAGE_OPTIONS,
  fetchProductHistory,
  fetchScreenshotBlobUrl,
} from '../engine/gameApiClient';
import { cn } from '../utils/cn';
import { formatNumber, formatRate, rateUnitLabel } from '../utils/format';

type TelemetrySubTab = 'monitor' | 'tech' | 'power' | 'explorer';

interface GameTelemetryViewProps {
  mode: GameConnectionMode;
  baseUrl: string;
  bundle: GameLiveBundle | null;
  capabilities: GameCapabilities;
  techStageMode: TechStageMode;
  period: SourcesPeriod;
  tps: number | null;
  error: string | null;
  isPolling: boolean;
  manualUnlockedMachines: Set<string>;
  manualLockedMachines: Set<string>;
  solveResult: SolveResult;
  rateUnit: RateUnit;
  onChangeBaseUrl: (url: string) => void;
  onConnectLive: () => void;
  onSwitchDemo: () => void;
  onRefreshNow: () => void;
  onChangePeriod: (period: SourcesPeriod) => void;
  onChangeTechStage: (stage: TechStageMode) => void;
  onToggleManualMachine: (machineId: string, action: 'unlock' | 'lock' | 'reset') => void;
  onResetManualMachines: () => void;
  onSendCommand: (
    type: 'SetSimPauseStateCmd' | 'GameSpeedChangeCmd',
    args: Record<string, unknown>,
  ) => Promise<void>;
  onAddDeficitToCalculator: (productId: string, ratePer60: number) => void;
}

interface AnalyzedProductRow {
  gameId: string;
  calcId: string | null;
  name: string;
  icon: string;
  kind: string;
  isUnlocked: boolean;
  isPinned: boolean;
  quantity: number;
  stored: number;
  capacity: number;
  fillRatio: number | null;
  prodPer60: number;
  consPer60: number;
  netPer60: number;
  runwayMonths: number | null;
}

interface AlertRow {
  severity: 'crit' | 'warn' | 'info';
  row: AnalyzedProductRow;
  issue: string;
  suggestedAddPer60: number | null;
}

const PERIOD_LABELS: Record<SourcesPeriod, string> = {
  lastMonth: 'Прошлый мес. (= /60с)',
  thisMonth: 'Текущий мес.',
  thisYear: 'Этот год',
  lastYear: 'Прошлый год',
  lifetime: 'За всё время',
};

const PERIOD_TO_STAT_INDEX: Record<SourcesPeriod, number> = {
  thisMonth: 0,
  lastMonth: 1,
  thisYear: 2,
  lastYear: 3,
  lifetime: 4,
};

const CONSOLE_CMD = 'web_api_start isPersistent:true allowOtherOriginsPost:true';

function shortNum(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e4) return `${(v / 1e3).toFixed(0)}k`;
  if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return String(Math.round(v));
}

function getGameOrLocalProductIcon(gameId: string, baseUrl: string, sessionId?: string): string {
  const calcId = GAME_ID_TO_PRODUCT_ID[gameId];
  if (calcId && PRODUCTS[calcId]) {
    return getProductIconUrl(PRODUCTS[calcId].icon);
  }
  const norm = (baseUrl || 'http://127.0.0.1:3073').replace(/\/+$/, '');
  const prefix =
    (norm === 'http://127.0.0.1:3073' || norm === 'http://localhost:3073') &&
    typeof window !== 'undefined' &&
    window.location.port === '5173'
      ? '/coi-live-api'
      : norm;
  return `${prefix}/api/v1/icons/${encodeURIComponent(gameId)}?v=${sessionId ?? '1'}`;
}

export const GameTelemetryView: React.FC<GameTelemetryViewProps> = ({
  mode,
  baseUrl,
  bundle,
  capabilities,
  techStageMode,
  period,
  tps,
  error,
  isPolling,
  manualUnlockedMachines,
  manualLockedMachines,
  solveResult,
  rateUnit,
  onChangeBaseUrl,
  onConnectLive,
  onSwitchDemo,
  onRefreshNow,
  onChangePeriod,
  onChangeTechStage,
  onToggleManualMachine,
  onResetManualMachines,
  onSendCommand,
  onAddDeficitToCalculator,
}) => {
  const [subTab, setSubTab] = useState<TelemetrySubTab>('monitor');
  const [urlDraft, setUrlDraft] = useState(baseUrl);
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Monitor filters
  const [alertFilter, setAlertFilter] = useState<'all' | 'crit' | 'warn' | 'deficit'>('all');
  const [alertSearch, setAlertSearch] = useState('');

  // Tech filters
  const [techFilter, setTechFilter] = useState<'all' | 'built' | 'unlocked' | 'locked'>('all');
  const [techSearch, setTechSearch] = useState('');

  // Explorer & Camera states
  const [selectedGameProdId, setSelectedGameProdId] = useState<string>('Product_Diesel');
  const [explorerPickerOpen, setExplorerPickerOpen] = useState(false);
  const [explorerSearch, setExplorerSearch] = useState('');
  const [historyRes, setHistoryRes] = useState<'day' | 'month' | 'year'>('month');
  const [historyData, setHistoryData] = useState<ProductHistoryResponse | null>(null);
  const [historyHoverIdx, setHistoryHoverIdx] = useState<number | null>(null);
  const [shotUrl, setShotUrl] = useState<string | null>(null);
  const [shotMeta, setShotMeta] = useState<string>('GET /screenshot');
  const [shotIntervalSec, setShotIntervalSec] = useState<0 | 5 | 15>(0);

  const explorerPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setUrlDraft(baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (
        explorerPickerRef.current &&
        !explorerPickerRef.current.contains(e.target as Node)
      ) {
        setExplorerPickerOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  // Load history when explorer tab is open or selection changes
  useEffect(() => {
    if (subTab !== 'explorer' || !bundle) return;
    let cancelled = false;
    fetchProductHistory(
      baseUrl,
      selectedGameProdId,
      historyRes,
      24,
      mode === 'demo' ? bundle : null,
    )
      .then((res) => {
        if (!cancelled) setHistoryData(res);
      })
      .catch(() => {
        if (!cancelled) setHistoryData(null);
      });
    return () => {
      cancelled = true;
    };
  }, [subTab, bundle, baseUrl, selectedGameProdId, historyRes, mode]);

  // Camera screenshot loader
  const refreshScreenshot = async () => {
    if (mode !== 'live') {
      setShotMeta('Доступно только при живом подключении к игре');
      return;
    }
    try {
      const res = await fetchScreenshotBlobUrl(baseUrl, 960, 540);
      setShotUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return res.url;
      });
      setShotMeta(`${res.sizeKb} КБ · ${res.ms} мс · ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      setShotMeta(e instanceof Error ? e.message : 'Ошибка загрузки камеры');
    }
  };

  useEffect(() => {
    if (subTab !== 'explorer' || mode !== 'live' || shotIntervalSec === 0) return;
    refreshScreenshot();
    const id = setInterval(refreshScreenshot, shotIntervalSec * 1000);
    return () => clearInterval(id);
  }, [subTab, mode, shotIntervalSec, baseUrl]);

  const handleCopyCommand = async () => {
    try {
      await navigator.clipboard.writeText(CONSOLE_CMD);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  // Analyze product metrics from bundle
  const productRows = useMemo<AnalyzedProductRow[]>(() => {
    if (!bundle) return [];
    const statIdx = PERIOD_TO_STAT_INDEX[period];
    const monthDivisor =
      period === 'thisYear' ? 6 : period === 'lastYear' ? 12 : period === 'thisMonth' ? 0.5 : 1;

    const catalogMap = new Map(bundle.catalog.map((c) => [c.id, c]));
    const rows: AnalyzedProductRow[] = [];

    for (const [gameId, st] of Object.entries(bundle.stats)) {
      const cat = catalogMap.get(gameId);
      if (cat?.kind === 'virtual') continue;
      const calcId = GAME_ID_TO_PRODUCT_ID[gameId] ?? null;
      if (calcId && VIRTUAL_PRODUCT_IDS.has(calcId)) continue;

      const prodPeriod = st.produced?.[statIdx] ?? 0;
      const consPeriod = st.consumed?.[statIdx] ?? 0;
      const lastMonthProd = st.produced?.[1] ?? prodPeriod;
      const lastMonthCons = st.consumed?.[1] ?? consPeriod;
      // For /60s equivalent: prefer lastMonth when period is lifetime or multi-month average
      const prodPer60 =
        period === 'lastMonth'
          ? prodPeriod
          : period === 'lifetime'
            ? lastMonthProd
            : period === 'thisMonth'
              ? Math.max(prodPeriod, lastMonthProd)
              : prodPeriod / monthDivisor;
      const consPer60 =
        period === 'lastMonth'
          ? consPeriod
          : period === 'lifetime'
            ? lastMonthCons
            : period === 'thisMonth'
              ? Math.max(consPeriod, lastMonthCons)
              : consPeriod / monthDivisor;

      const netPer60 = prodPer60 - consPer60;
      const cap = st.storageCapacity || 0;
      const fillRatio = cap > 0 ? st.stored / cap : null;
      const monthlyNetForRunway =
        period === 'lastMonth' || period === 'lifetime'
          ? lastMonthProd - lastMonthCons
          : netPer60;
      const runwayMonths =
        monthlyNetForRunway < -0.01 ? st.quantity / -monthlyNetForRunway : null;

      const lbl = calcId ? getProductLabel(calcId) : null;
      const name = lbl?.ru ?? cat?.name ?? bundle.sources?.names?.[gameId] ?? gameId;

      rows.push({
        gameId,
        calcId,
        name,
        icon: getGameOrLocalProductIcon(gameId, baseUrl, bundle.gameInfo.sessionId),
        kind: cat?.kind ?? 'countable',
        isUnlocked: cat?.isUnlocked ?? true,
        isPinned: bundle.pinnedIds.has(gameId),
        quantity: st.quantity,
        stored: st.stored,
        capacity: cap,
        fillRatio,
        prodPer60,
        consPer60,
        netPer60,
        runwayMonths,
      });
    }

    return rows.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [bundle, period, baseUrl]);

  const rowByCalcId = useMemo(() => {
    const map = new Map<string, AnalyzedProductRow>();
    for (const r of productRows) {
      if (r.calcId) map.set(r.calcId, r);
    }
    return map;
  }, [productRows]);

  const alerts = useMemo<AlertRow[]>(() => {
    const list: AlertRow[] = [];
    for (const r of productRows) {
      const deficit = r.consPer60 > r.prodPer60 ? r.consPer60 - r.prodPer60 : 0;
      if (r.consPer60 > 0 && r.quantity === 0) {
        list.push({
          severity: 'crit',
          row: r,
          issue: 'Запас иссяк (0 на складе при активном расходе)',
          suggestedAddPer60: Math.max(10, Math.ceil(deficit || r.consPer60 * 0.25)),
        });
      } else if (r.runwayMonths !== null && r.runwayMonths < 3) {
        list.push({
          severity: 'crit',
          row: r,
          issue: `Критический дефицит — хватит на ${r.runwayMonths.toFixed(1)} мес.`,
          suggestedAddPer60: Math.max(5, Math.ceil(deficit)),
        });
      } else if (r.runwayMonths !== null && r.runwayMonths < 12) {
        list.push({
          severity: 'warn',
          row: r,
          issue: `Запасы сокращаются — осталось ~${r.runwayMonths.toFixed(1)} мес.`,
          suggestedAddPer60: Math.max(5, Math.ceil(deficit)),
        });
      }

      if (r.fillRatio !== null && r.fillRatio >= 0.96) {
        list.push({
          severity: 'crit',
          row: r,
          issue: `Склад забит на ${Math.round(r.fillRatio * 100)}% — возможен затор линии`,
          suggestedAddPer60: null,
        });
      } else if (r.fillRatio !== null && r.fillRatio >= 0.88) {
        list.push({
          severity: 'warn',
          row: r,
          issue: `Склад заполнен на ${Math.round(r.fillRatio * 100)}%`,
          suggestedAddPer60: null,
        });
      }

      if (
        r.netPer60 < -0.5 &&
        r.consPer60 > 0 &&
        (r.runwayMonths === null || r.runwayMonths >= 12)
      ) {
        list.push({
          severity: 'info',
          row: r,
          issue: 'Расход превышает производство (стабильный запас на складе)',
          suggestedAddPer60: Math.ceil(deficit),
        });
      }
    }
    const order = { crit: 0, warn: 1, info: 2 };
    return list.sort((a, b) => order[a.severity] - order[b.severity]);
  }, [productRows]);

  const filteredAlerts = useMemo(() => {
    const q = alertSearch.trim().toLowerCase();
    return alerts.filter((a) => {
      if (alertFilter === 'crit' && a.severity !== 'crit') return false;
      if (alertFilter === 'warn' && a.severity !== 'warn') return false;
      if (alertFilter === 'deficit' && a.row.netPer60 >= 0) return false;
      if (q && !a.row.name.toLowerCase().includes(q) && !a.row.gameId.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [alerts, alertFilter, alertSearch]);

  // Comparison between active Calculator Plan and In-Game stats
  const planComparisonRows = useMemo(() => {
    const items: {
      productId: string;
      name: string;
      icon: string;
      role: 'Цель' | 'Сырьё' | 'Выпуск';
      plannedRate60: number;
      inGameRow: AnalyzedProductRow | null;
    }[] = [];
    const seen = new Set<string>();

    for (const out of solveResult.summary.netOutputs) {
      if (VIRTUAL_PRODUCT_IDS.has(out.productId) || seen.has(out.productId)) continue;
      seen.add(out.productId);
      items.push({
        productId: out.productId,
        name: out.name,
        icon: getProductIconUrl(out.icon),
        role: out.isTarget ? 'Цель' : 'Выпуск',
        plannedRate60: out.ratePer60,
        inGameRow: rowByCalcId.get(out.productId) ?? null,
      });
    }

    for (const raw of solveResult.summary.rawInputs) {
      if (VIRTUAL_PRODUCT_IDS.has(raw.productId) || seen.has(raw.productId)) continue;
      seen.add(raw.productId);
      items.push({
        productId: raw.productId,
        name: raw.name,
        icon: getProductIconUrl(raw.icon),
        role: 'Сырьё',
        plannedRate60: -raw.ratePer60,
        inGameRow: rowByCalcId.get(raw.productId) ?? null,
      });
    }

    return items;
  }, [solveResult, rowByCalcId]);

  // Power & Steam Analysis
  const powerAnalysis = useMemo(() => {
    if (!bundle?.sources?.products) return null;
    const sourcesProducts = bundle.sources.products;
    const nm = (k: string): string => {
      const prodCalc = GAME_ID_TO_PRODUCT_ID[k];
      if (prodCalc) return getProductLabel(prodCalc).ru ?? k;
      const mach = MACHINE_BY_GAME_ID[k.replace(/^Machine_/, '')];
      if (mach) return getMachineLabel(mach.id).ru;
      return bundle.sources.names[k] ?? k;
    };

    const isGen = (k: string) => /turbine|generator|турбин|генератор/i.test(k) || /turbine|generator|турбин|генератор/i.test(nm(k));
    const isBoiler = (k: string) => /boiler|reactor|solar|котел|котёл|реактор/i.test(k) || /boiler|reactor|котел|котёл|реактор/i.test(nm(k));
    const isVent = (k: string) => /smokestack|coolingtower|дымов|градирн/i.test(k) || /smokestack|coolingtower|дымов|градирн/i.test(nm(k));

    const steamIds = Object.keys(sourcesProducts).filter(
      (id) =>
        /steam/i.test(id) &&
        (sourcesProducts[id].produced.total > 0 || sourcesProducts[id].consumed.total > 0),
    );

    const turbConsumers: Record<string, number> = {};
    const steamProducers: Record<string, number> = {};
    const steamRows = steamIds.map((id) => {
      const entry = sourcesProducts[id];
      let intoTurb = 0;
      let vented = 0;
      for (const r of entry.produced.rows) {
        const k = r.machine || r.entity || r.type;
        if (!isGen(k)) {
          steamProducers[k] = (steamProducers[k] || 0) + r.quantity;
        }
      }
      for (const r of entry.consumed.rows) {
        const k = r.machine || r.entity || r.type;
        if (isGen(k)) {
          turbConsumers[k] = (turbConsumers[k] || 0) + r.quantity;
          intoTurb += r.quantity;
        } else if (isVent(k)) {
          vented += r.quantity;
        }
      }
      const st = bundle.stats[id];
      return {
        id,
        name: nm(id),
        made: entry.produced.total,
        used: entry.consumed.total,
        intoTurb,
        vented,
        stored: st?.stored ?? 0,
        cap: st?.storageCapacity ?? 0,
      };
    });

    const fuelsMap: Record<string, { id: string; used: number; by: Set<string> }> = {};
    for (const [prodId, entry] of Object.entries(sourcesProducts)) {
      if (/steam/i.test(prodId)) continue;
      for (const r of entry.consumed.rows) {
        const k = r.machine || '';
        if (!k || !(isBoiler(k) || isGen(k))) continue;
        if (!fuelsMap[prodId]) {
          fuelsMap[prodId] = { id: prodId, used: 0, by: new Set() };
        }
        fuelsMap[prodId].used += r.quantity;
        fuelsMap[prodId].by.add(nm(k));
      }
    }

    const totalMade = steamRows.reduce((s, r) => s + r.made, 0);
    const totalTurb = steamRows.reduce((s, r) => s + r.intoTurb, 0);
    const totalVent = steamRows.reduce((s, r) => s + r.vented, 0);

    return {
      steamRows,
      turbConsumers: Object.entries(turbConsumers)
        .map(([k, v]) => ({ id: k, label: nm(k), value: v }))
        .sort((a, b) => b.value - a.value),
      steamProducers: Object.entries(steamProducers)
        .map(([k, v]) => ({ id: k, label: nm(k), value: v }))
        .sort((a, b) => b.value - a.value),
      fuels: Object.values(fuelsMap)
        .map((f) => {
          const calcId = GAME_ID_TO_PRODUCT_ID[f.id] ?? null;
          const row = productRows.find((r) => r.gameId === f.id);
          return {
            ...f,
            calcId,
            name: nm(f.id),
            icon: getGameOrLocalProductIcon(f.id, baseUrl, bundle.gameInfo.sessionId),
            quantity: row?.quantity ?? bundle.stats[f.id]?.quantity ?? 0,
            netPer60: row?.netPer60 ?? 0,
            runwayMonths: row?.runwayMonths ?? null,
          };
        })
        .sort((a, b) => b.used - a.used),
      totalMade,
      totalTurb,
      totalVent,
    };
  }, [bundle, productRows, baseUrl]);

  // Tech Tree Categories & Machines
  const techMachinesByCategory = useMemo(() => {
    const q = techSearch.trim().toLowerCase();
    const groups: {
      categoryId: string;
      categoryName: string;
      machines: typeof MACHINES_LIST;
    }[] = [];

    for (const cat of CATEGORIES_LIST) {
      if (cat.id === 'storages' || cat.id === 'cargo_docks') continue;
      const list = MACHINES_LIST.filter((m) => {
        if (m.category_id !== cat.id || m.isStorage) return false;
        const isBuilt = capabilities.builtMachineIds.has(m.id);
        const isUnlocked = capabilities.unlockedMachineIds.has(m.id);
        if (techFilter === 'built' && !isBuilt) return false;
        if (techFilter === 'unlocked' && !isUnlocked) return false;
        if (techFilter === 'locked' && isUnlocked) return false;
        if (q) {
          const mLbl = getMachineLabel(m.id);
          const match =
            mLbl.ru.toLowerCase().includes(q) ||
            mLbl.en.toLowerCase().includes(q) ||
            cat.name.toLowerCase().includes(q) ||
            getCategoryLabel(cat.id).toLowerCase().includes(q);
          if (!match) return false;
        }
        return true;
      });
      if (list.length > 0) {
        groups.push({
          categoryId: cat.id,
          categoryName: getCategoryLabel(cat.id),
          machines: list,
        });
      }
    }
    return groups;
  }, [capabilities, techFilter, techSearch]);

  const kpiOutOfStock = productRows.filter((r) => r.consPer60 > 0 && r.quantity === 0).length;
  const kpiFullStorage = productRows.filter((r) => r.fillRatio !== null && r.fillRatio >= 0.95).length;
  const kpiShortRunway = productRows.filter((r) => r.runwayMonths !== null && r.runwayMonths < 6).length;
  const kpiDeficit = productRows.filter((r) => r.netPer60 < -0.5).length;

  const explorerCatalog = useMemo(() => {
    if (!bundle) return [];
    const q = explorerSearch.trim().toLowerCase();
    return bundle.catalog.filter((c) => {
      if (!q) return true;
      const calcId = GAME_ID_TO_PRODUCT_ID[c.id];
      const ru = calcId ? getProductLabel(calcId).ru : undefined;
      return (
        c.name.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        (ru && ru.toLowerCase().includes(q))
      );
    });
  }, [bundle, explorerSearch]);

  const selectedExplorerRow = useMemo(
    () => productRows.find((r) => r.gameId === selectedGameProdId) ?? productRows[0] ?? null,
    [productRows, selectedGameProdId],
  );

  const selectedExplorerSources = bundle?.sources?.products?.[selectedGameProdId] ?? null;

  const openProductInExplorer = (gameId: string) => {
    setSelectedGameProdId(gameId);
    setSubTab('explorer');
  };

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-3 px-4 py-3">
      {/* Connection & Game Control Top Bento Panel */}
      <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Status + URL + Mode Switch */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div
              className={cn(
                'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-semibold',
                mode === 'live'
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : mode === 'demo'
                    ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                    : 'border-rose-500/40 bg-rose-500/15 text-rose-300',
              )}
            >
              {mode === 'live' ? (
                <Wifi className="h-3.5 w-3.5" />
              ) : mode === 'demo' ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <WifiOff className="h-3.5 w-3.5" />
              )}
              <span>
                {mode === 'live'
                  ? 'ИГРА ПОДКЛЮЧЕНА (LIVE)'
                  : mode === 'demo'
                    ? 'ДЕМО-СНИМОК БАЗЫ (ОЗНАКОМЛЕНИЕ)'
                    : 'НЕТ СВЯЗИ С ИГРОЙ'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#09090b] px-2 py-1">
              <Server className="h-3.5 w-3.5 text-zinc-500" />
              <input
                type="text"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                onBlur={() => onChangeBaseUrl(urlDraft)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    onChangeBaseUrl(urlDraft);
                    onConnectLive();
                  }
                }}
                placeholder="http://127.0.0.1:3073"
                className="w-44 bg-transparent font-mono text-xs text-zinc-200 outline-none"
              />
            </div>

            <button
              type="button"
              onClick={() => {
                onChangeBaseUrl(urlDraft);
                onConnectLive();
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all duration-150',
                mode === 'live'
                  ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/[0.12] bg-[#18181b] text-zinc-200 hover:border-emerald-500/40 hover:text-emerald-300',
              )}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', isPolling && 'animate-spin')} />
              <span>Подключить игру</span>
            </button>

            <button
              type="button"
              onClick={onSwitchDemo}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all duration-150',
                mode === 'demo'
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                  : 'border-white/[0.08] bg-[#09090b] text-zinc-400 hover:text-zinc-200',
              )}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Демо-база</span>
            </button>
          </div>

          {/* Right: Live Session Metrics & Speed Control */}
          {bundle && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-[#09090b] px-2.5 py-1 font-mono text-[11px] tabular-nums">
                <span className="text-zinc-500">Дата:</span>
                <span className="font-semibold text-zinc-100">{bundle.gameInfo.date}</span>
                <span className="text-zinc-700">|</span>
                <span className="text-zinc-500">Тик:</span>
                <span className="text-zinc-300">{formatNumber(bundle.gameInfo.tick, 0)}</span>
                {tps !== null && (
                  <>
                    <span className="text-zinc-700">|</span>
                    <span className="text-emerald-400">{tps.toFixed(1)} тик/с</span>
                  </>
                )}
                {bundle.latencyMs != null && (
                  <>
                    <span className="text-zinc-700">|</span>
                    <span className="text-zinc-400">{bundle.latencyMs} мс</span>
                  </>
                )}
              </div>

              <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5">
                <button
                  type="button"
                  disabled={mode !== 'live'}
                  onClick={() =>
                    onSendCommand('SetSimPauseStateCmd', {
                      isPaused: !bundle.gameInfo.isPaused,
                    })
                  }
                  title={
                    mode !== 'live'
                      ? 'Управление доступно при живом подключении к игре'
                      : bundle.gameInfo.isPaused
                        ? 'Возобновить симуляцию'
                        : 'Пауза'
                  }
                  className={cn(
                    'flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors disabled:opacity-45',
                    bundle.gameInfo.isPaused
                      ? 'bg-rose-500/20 text-rose-300'
                      : 'text-zinc-300 hover:bg-[#18181b]',
                  )}
                >
                  {bundle.gameInfo.isPaused ? (
                    <Play className="h-3 w-3" />
                  ) : (
                    <Pause className="h-3 w-3" />
                  )}
                  <span>{bundle.gameInfo.isPaused ? 'Пауза' : 'Идёт'}</span>
                </button>
                {[1, 2, 3].map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    disabled={mode !== 'live'}
                    onClick={() =>
                      onSendCommand('GameSpeedChangeCmd', {
                        newSpeedMultiplier: sp,
                      })
                    }
                    className={cn(
                      'rounded px-2 py-1 font-mono text-[11px] font-semibold transition-colors disabled:opacity-45',
                      !bundle.gameInfo.isPaused && bundle.gameInfo.speed === sp
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'text-zinc-400 hover:text-zinc-200',
                    )}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Setup Helper Strip */}
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#09090b] px-3 py-2 text-[11px]">
          <div className="flex flex-wrap items-center gap-2 text-zinc-400">
            <span className="font-semibold text-zinc-200">
              Как подключить живую игру (без модов, штатный API CoI 0.8.4):
            </span>
            <span>
              Откройте консоль в игре (<kbd className="rounded border border-white/10 bg-[#121214] px-1">~</kbd>) и выполните:
            </span>
            <code className="rounded border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 font-mono text-emerald-300">
              {CONSOLE_CMD}
            </code>
            <button
              type="button"
              onClick={handleCopyCommand}
              className="flex items-center gap-1 rounded border border-white/[0.1] bg-[#121214] px-2 py-0.5 text-[11px] text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300"
            >
              {copiedCmd ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
              <span>{copiedCmd ? 'Скопировано' : 'Копировать'}</span>
            </button>
          </div>
          {error && mode === 'offline' && (
            <span className="font-mono text-[11px] text-rose-400">{error}</span>
          )}
        </div>
      </section>

      {/* Sub-Tabs Navigation + Tech Filter Master Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.08] bg-[#121214] p-1">
          {[
            { id: 'monitor' as TelemetrySubTab, label: 'Мониторинг и Дефициты', icon: AlertTriangle, badge: kpiOutOfStock + kpiShortRunway },
            { id: 'tech' as TelemetrySubTab, label: 'Доступные заводы и Технологии', icon: Unlock, badge: `${capabilities.unlockedMachinesCount}/${MACHINES_LIST.filter((m) => !m.isStorage).length}` },
            { id: 'power' as TelemetrySubTab, label: 'Энергосеть и Пар', icon: Flame },
            { id: 'explorer' as TelemetrySubTab, label: 'Разбор ресурса и Камера', icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSubTab(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-150',
                  subTab === tab.id
                    ? 'bg-[#18181b] text-emerald-300 ring-1 ring-white/[0.1]'
                    : 'text-zinc-400 hover:text-zinc-200',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
                {tab.badge !== undefined && Number(tab.badge) !== 0 && (
                  <span className="rounded bg-white/[0.08] px-1.5 py-0.2 font-mono text-[10px] tabular-nums text-zinc-200">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Tech-stage pill selector */}
        <div className="flex flex-wrap items-center gap-1 rounded-xl border border-white/[0.08] bg-[#121214] p-1">
          <span className="flex items-center gap-1 px-2 text-[11px] font-medium text-zinc-400">
            <ShieldCheck className="h-3.5 w-3.5 text-violet-400" />
            <span>Режим:</span>
          </span>
          {TECH_STAGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChangeTechStage(opt.id)}
              title={opt.description}
              className={cn(
                'rounded-lg px-2 py-1 text-[11px] font-medium transition-colors',
                techStageMode === opt.id
                  ? 'bg-violet-500/20 text-violet-200 ring-1 ring-violet-500/40'
                  : 'text-zinc-400 hover:bg-[#18181b] hover:text-zinc-200',
              )}
            >
              {opt.shortLabel}
            </button>
          ))}
        </div>
      </div>

      {!bundle ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-white/[0.12] bg-[#121214] p-12 text-center">
          <WifiOff className="h-8 w-8 text-rose-400" />
          <h3 className="mt-3 text-sm font-semibold text-zinc-100">
            Сервер Captain of Industry не отвечает на {baseUrl}
          </h3>
          <p className="mt-1 max-w-lg text-xs text-zinc-400">
            Запустите игру и введите в игровой консоли команду{' '}
            <code className="text-emerald-300">{CONSOLE_CMD}</code>, либо откройте встроенную демо-базу для просмотра всех графиков и фильтрации технологий.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={onConnectLive}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25"
            >
              Повторить подключение
            </button>
            <button
              type="button"
              onClick={onSwitchDemo}
              className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300 hover:bg-amber-500/25"
            >
              Открыть Демо-базу (Год 145)
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ================= SUB-TAB 1: MONITORING & DEFICITS ================= */}
          {subTab === 'monitor' && (
            <div className="flex flex-col gap-3">
              {/* Period + KPI row */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#121214] px-3 py-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] font-medium text-zinc-400">Период анализа:</span>
                  {(Object.keys(PERIOD_LABELS) as SourcesPeriod[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onChangePeriod(p)}
                      className={cn(
                        'rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                        period === p
                          ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/35'
                          : 'bg-[#09090b] text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      {PERIOD_LABELS[p]}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onRefreshNow}
                  className="flex items-center gap-1 rounded-md border border-white/[0.08] bg-[#09090b] px-2.5 py-1 text-[11px] text-zinc-300 hover:border-white/[0.2]"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span>Обновить данные</span>
                </button>
              </div>

              {/* 6 Bento KPIs */}
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Запас иссяк (0 ед.)</div>
                  <div className={cn('mt-1 font-mono text-2xl font-bold tabular-nums', kpiOutOfStock > 0 ? 'text-rose-400' : 'text-emerald-400')}>
                    {kpiOutOfStock}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Склады ≥ 95%</div>
                  <div className={cn('mt-1 font-mono text-2xl font-bold tabular-nums', kpiFullStorage > 0 ? 'text-amber-300' : 'text-zinc-200')}>
                    {kpiFullStorage}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Запас &lt; 6 мес.</div>
                  <div className={cn('mt-1 font-mono text-2xl font-bold tabular-nums', kpiShortRunway > 0 ? 'text-amber-300' : 'text-emerald-400')}>
                    {kpiShortRunway}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">В дефиците (нетто &lt; 0)</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-100">
                    {kpiDeficit}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Открыто продуктов</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-300">
                    {capabilities.unlockedProductsCount}
                    <span className="text-xs font-normal text-zinc-500">
                      /{capabilities.totalProductsCount}
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Типов заводов на базе</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-violet-300">
                    {capabilities.builtMachinesCount}
                  </div>
                </div>
              </div>

              {/* Alerts & 1-Click Deficit Mitigation Table */}
              <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                      Узкие места и дефициты на острове
                    </h2>
                    <p className="text-[11px] text-zinc-500">
                      Нажмите «+ В калькулятор», чтобы сразу рассчитать недостающие цехи для закрытия дефицита
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5 text-[11px]">
                      {[
                        { k: 'all' as const, l: 'Все' },
                        { k: 'crit' as const, l: 'Критично' },
                        { k: 'warn' as const, l: 'Внимание' },
                        { k: 'deficit' as const, l: 'Дефицит' },
                      ].map((f) => (
                        <button
                          key={f.k}
                          type="button"
                          onClick={() => setAlertFilter(f.k)}
                          className={cn(
                            'rounded px-2 py-1 transition-colors',
                            alertFilter === f.k
                              ? 'bg-[#18181b] text-zinc-100'
                              : 'text-zinc-500 hover:text-zinc-300',
                          )}
                        >
                          {f.l}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#09090b] px-2.5 py-1">
                      <Search className="h-3.5 w-3.5 text-zinc-500" />
                      <input
                        value={alertSearch}
                        onChange={(e) => setAlertSearch(e.target.value)}
                        placeholder="Фильтр продукта..."
                        className="w-36 bg-transparent text-xs text-zinc-200 outline-none"
                      />
                    </div>
                  </div>
                </div>

                <div className="max-h-80 overflow-y-auto rounded-lg border border-white/[0.06] bg-[#09090b]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 border-b border-white/[0.08] bg-[#121214] text-[10px] uppercase tracking-wider text-zinc-400">
                      <tr>
                        <th className="px-3 py-2">Статус</th>
                        <th className="px-3 py-2">Ресурс</th>
                        <th className="px-3 py-2">Проблема</th>
                        <th className="px-3 py-2 text-right">На складе</th>
                        <th className="px-3 py-2 text-right">Заполнение</th>
                        <th className="px-3 py-2 text-right">Баланс ({rateUnitLabel(rateUnit)})</th>
                        <th className="px-3 py-2 text-right">Действие</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05]">
                      {filteredAlerts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                            Критических отклонений по выбранному фильтру нет
                          </td>
                        </tr>
                      ) : (
                        filteredAlerts.map((a, idx) => {
                          const r = a.row;
                          const fillPct = r.fillRatio !== null ? Math.round(r.fillRatio * 100) : null;
                          return (
                            <tr
                              key={`${r.gameId}-${idx}`}
                              className="transition-colors hover:bg-[#18181b]/70"
                            >
                              <td className="px-3 py-2">
                                <span
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                    a.severity === 'crit'
                                      ? 'bg-rose-500/15 text-rose-300'
                                      : a.severity === 'warn'
                                        ? 'bg-amber-500/15 text-amber-300'
                                        : 'bg-sky-500/15 text-sky-300',
                                  )}
                                >
                                  <span
                                    className={cn(
                                      'h-1.5 w-1.5 rounded-full',
                                      a.severity === 'crit'
                                        ? 'bg-rose-400'
                                        : a.severity === 'warn'
                                          ? 'bg-amber-400'
                                          : 'bg-sky-400',
                                    )}
                                  />
                                  {a.severity === 'crit'
                                    ? 'Критично'
                                    : a.severity === 'warn'
                                      ? 'Внимание'
                                      : 'Инфо'}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => openProductInExplorer(r.gameId)}
                                  className="flex items-center gap-2 text-left hover:text-emerald-300"
                                >
                                  <img
                                    src={r.icon}
                                    alt={r.name}
                                    className="h-5 w-5 shrink-0 object-contain"
                                  />
                                  <span className="font-medium text-zinc-100">{r.name}</span>
                                </button>
                              </td>
                              <td className="px-3 py-2 text-zinc-300">{a.issue}</td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-200">
                                {formatNumber(r.quantity, 0)}
                              </td>
                              <td className="px-3 py-2 text-right font-mono tabular-nums text-zinc-400">
                                {fillPct !== null ? (
                                  <span
                                    className={cn(
                                      fillPct >= 95
                                        ? 'text-rose-400'
                                        : fillPct >= 85
                                          ? 'text-amber-300'
                                          : 'text-zinc-300',
                                    )}
                                  >
                                    {fillPct}% ({shortNum(r.capacity)})
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td
                                className={cn(
                                  'px-3 py-2 text-right font-mono font-semibold tabular-nums',
                                  r.netPer60 < 0 ? 'text-rose-400' : 'text-emerald-400',
                                )}
                              >
                                {r.netPer60 > 0 ? '+' : ''}
                                {formatRate(r.netPer60, rateUnit)}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {r.calcId && a.suggestedAddPer60 ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onAddDeficitToCalculator(r.calcId!, a.suggestedAddPer60!)
                                    }
                                    className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-1 font-mono text-[10px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                                  >
                                    <Plus className="h-3 w-3" />
                                    <span>+{formatRate(a.suggestedAddPer60, rateUnit)} в план</span>
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => openProductInExplorer(r.gameId)}
                                    className="rounded border border-white/[0.08] bg-[#121214] px-2 py-1 text-[10px] text-zinc-400 hover:text-zinc-200"
                                  >
                                    График
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Plan vs Actual Base Comparison */}
              <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <div>
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                      Сверка текущего плана калькулятора с базой в игре
                    </h2>
                    <p className="text-[11px] text-zinc-500">
                      Сопоставление потребляемого сырья и выпускаемых целей активного плана с реальными показателями на острове
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {planComparisonRows.map((item) => {
                    const g = item.inGameRow;
                    const inGameNet = g ? g.netPer60 : 0;
                    const neededRaw = item.role === 'Сырьё' ? Math.abs(item.plannedRate60) : 0;
                    const rawCovered = g ? g.prodPer60 >= neededRaw && g.netPer60 + g.prodPer60 >= 0 : false;
                    return (
                      <div
                        key={item.productId}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.08] bg-[#09090b] p-2.5"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <img
                            src={item.icon}
                            alt={item.name}
                            className="h-7 w-7 shrink-0 object-contain"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-xs font-semibold text-zinc-100">
                                {item.name}
                              </span>
                              <span
                                className={cn(
                                  'rounded px-1 py-0.2 text-[9px] font-semibold',
                                  item.role === 'Цель'
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : item.role === 'Сырьё'
                                      ? 'bg-sky-500/15 text-sky-300'
                                      : 'bg-white/[0.06] text-zinc-400',
                                )}
                              >
                                {item.role}
                              </span>
                            </div>
                            <div className="mt-0.5 font-mono text-[10px] tabular-nums text-zinc-400">
                              План:{' '}
                              <span className={item.plannedRate60 < 0 ? 'text-amber-300' : 'text-emerald-300'}>
                                {item.plannedRate60 > 0 ? '+' : ''}
                                {formatRate(item.plannedRate60, rateUnit)}
                              </span>
                              {g && (
                                <>
                                  {' • '}В игре: вып. {formatRate(g.prodPer60, rateUnit)} / расх.{' '}
                                  {formatRate(g.consPer60, rateUnit)}
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 text-right font-mono text-[10px] tabular-nums">
                          {g ? (
                            <>
                              <div className={inGameNet < 0 ? 'text-rose-400' : 'text-emerald-400'}>
                                {inGameNet > 0 ? '+' : ''}
                                {formatRate(inGameNet, rateUnit)}
                              </div>
                              <div className="text-zinc-500">
                                склад {formatNumber(g.quantity, 0)}
                                {item.role === 'Сырьё' && (rawCovered ? ' ✓' : ' !')}
                              </div>
                            </>
                          ) : (
                            <span className="text-zinc-600">нет в игре</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

              {/* Top Production, Consumption & Storage Bar Lists */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {[
                  {
                    title: 'Лидеры производства',
                    color: 'bg-sky-400',
                    items: [...productRows]
                      .filter((r) => r.prodPer60 > 0)
                      .sort((a, b) => b.prodPer60 - a.prodPer60)
                      .slice(0, 8)
                      .map((r) => ({
                        gameId: r.gameId,
                        label: r.name,
                        icon: r.icon,
                        val: r.prodPer60,
                        text: formatRate(r.prodPer60, rateUnit),
                      })),
                  },
                  {
                    title: 'Лидеры потребления',
                    color: 'bg-amber-400',
                    items: [...productRows]
                      .filter((r) => r.consPer60 > 0)
                      .sort((a, b) => b.consPer60 - a.consPer60)
                      .slice(0, 8)
                      .map((r) => ({
                        gameId: r.gameId,
                        label: r.name,
                        icon: r.icon,
                        val: r.consPer60,
                        text: formatRate(r.consPer60, rateUnit),
                      })),
                  },
                  {
                    title: 'Самые заполненные склады',
                    color: 'bg-emerald-400',
                    items: [...productRows]
                      .filter((r) => r.fillRatio !== null && r.capacity > 0)
                      .sort((a, b) => (b.fillRatio ?? 0) - (a.fillRatio ?? 0))
                      .slice(0, 8)
                      .map((r) => ({
                        gameId: r.gameId,
                        label: r.name,
                        icon: r.icon,
                        val: Math.min(100, (r.fillRatio ?? 0) * 100),
                        text: `${Math.round((r.fillRatio ?? 0) * 100)}%`,
                        customColor:
                          (r.fillRatio ?? 0) >= 0.95
                            ? 'bg-rose-400'
                            : (r.fillRatio ?? 0) >= 0.85
                              ? 'bg-amber-400'
                              : 'bg-emerald-400',
                      })),
                  },
                ].map((col) => {
                  const maxV = Math.max(1, ...col.items.map((x) => x.val));
                  return (
                    <section
                      key={col.title}
                      className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5"
                    >
                      <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                        {col.title}
                      </h3>
                      <div className="flex flex-col gap-2">
                        {col.items.map((it) => (
                          <button
                            key={it.gameId}
                            type="button"
                            onClick={() => openProductInExplorer(it.gameId)}
                            className="grid grid-cols-[minmax(100px,42%)_1fr_72px] items-center gap-2 text-left text-xs hover:opacity-90"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <img
                                src={it.icon}
                                alt={it.label}
                                className="h-4 w-4 shrink-0 object-contain"
                              />
                              <span className="truncate text-zinc-200">{it.label}</span>
                            </div>
                            <div className="h-2.5 overflow-hidden rounded-full bg-[#09090b]">
                              <div
                                className={cn(
                                  'h-full rounded-full transition-all',
                                  'customColor' in it && it.customColor ? it.customColor : col.color,
                                )}
                                style={{ width: `${Math.min(100, (it.val / maxV) * 100)}%` }}
                              />
                            </div>
                            <span className="text-right font-mono text-[11px] tabular-nums text-zinc-300">
                              {it.text}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================= SUB-TAB 2: AVAILABLE FACTORIES & TECH ================= */}
          {subTab === 'tech' && (
            <div className="flex flex-col gap-3">
              {/* Filter Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { k: 'all' as const, label: 'Все заводы' },
                    {
                      k: 'built' as const,
                      label: `Работают на базе (${capabilities.builtMachinesCount})`,
                    },
                    {
                      k: 'unlocked' as const,
                      label: `Доступны (${capabilities.unlockedMachinesCount})`,
                    },
                    { k: 'locked' as const, label: 'Не изучены' },
                  ].map((f) => (
                    <button
                      key={f.k}
                      type="button"
                      onClick={() => setTechFilter(f.k)}
                      className={cn(
                        'rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                        techFilter === f.k
                          ? 'bg-[#18181b] text-emerald-300 ring-1 ring-white/[0.12]'
                          : 'bg-[#09090b] text-zinc-400 hover:text-zinc-200',
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#09090b] px-2.5 py-1.5">
                    <Search className="h-3.5 w-3.5 text-zinc-500" />
                    <input
                      value={techSearch}
                      onChange={(e) => setTechSearch(e.target.value)}
                      placeholder="Поиск завода или цеха..."
                      className="w-48 bg-transparent text-xs text-zinc-200 outline-none"
                    />
                  </div>
                  {(manualUnlockedMachines.size > 0 || manualLockedMachines.size > 0) && (
                    <button
                      type="button"
                      onClick={onResetManualMachines}
                      className="flex items-center gap-1 rounded-lg border border-white/[0.08] bg-[#09090b] px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Сбросить ручные пометки</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Categories & Machines */}
              <div className="flex flex-col gap-3">
                {techMachinesByCategory.map((group) => (
                  <section
                    key={group.categoryId}
                    className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5"
                  >
                    <h3 className="mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-300">
                      <Factory className="h-3.5 w-3.5 text-emerald-400" />
                      <span>{group.categoryName}</span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        ({group.machines.length})
                      </span>
                    </h3>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {group.machines.map((m) => {
                        const mLbl = getMachineLabel(m.id);
                        const isBuilt = capabilities.builtMachineIds.has(m.id);
                        const isUnlocked = capabilities.unlockedMachineIds.has(m.id);
                        const isManualUnlock = manualUnlockedMachines.has(m.id);
                        const isManualLock = manualLockedMachines.has(m.id);
                        const act = capabilities.machineMonthlyActivity[m.id];

                        return (
                          <div
                            key={m.id}
                            className={cn(
                              'flex flex-col justify-between gap-2 rounded-xl border p-2.5 transition-all',
                              isBuilt
                                ? 'border-emerald-500/35 bg-[#09090b]'
                                : isUnlocked
                                  ? 'border-white/[0.08] bg-[#09090b]'
                                  : 'border-white/[0.04] bg-[#09090b]/55 opacity-75',
                            )}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <img
                                  src={getMachineIconUrl(m.icon)}
                                  alt={mLbl.ru}
                                  className="h-8 w-8 shrink-0 rounded border border-white/[0.08] bg-[#121214] p-0.5 object-contain"
                                />
                                <div className="min-w-0">
                                  <div className="truncate text-xs font-semibold text-zinc-100">
                                    {mLbl.ru}
                                  </div>
                                  <div className="truncate text-[10px] text-zinc-500">
                                    {mLbl.en}
                                  </div>
                                </div>
                              </div>
                              <span
                                className={cn(
                                  'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold',
                                  isBuilt
                                    ? 'bg-emerald-500/20 text-emerald-300'
                                    : isUnlocked
                                      ? 'bg-sky-500/15 text-sky-300'
                                      : 'bg-zinc-800 text-zinc-400',
                                )}
                              >
                                {isBuilt
                                  ? '⚡ На базе'
                                  : isUnlocked
                                    ? '✓ Открыто'
                                    : '🔒 Закрыто'}
                              </span>
                            </div>

                            {act && act.recipes.length > 0 && (
                              <div className="flex flex-col gap-1 border-t border-white/[0.06] pt-1.5 text-[10px]">
                                {act.recipes.slice(0, 2).map((ar) => (
                                  <div
                                    key={`${ar.recipeId}-${ar.productId}`}
                                    className="flex items-center justify-between gap-1 text-emerald-300/90"
                                  >
                                    <span className="truncate">
                                      • {getRecipeLabel(ar.recipeId).ru}
                                    </span>
                                    <span className="shrink-0 font-mono tabular-nums">
                                      {formatRate(ar.producedPer60, rateUnit)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center justify-between gap-1.5 border-t border-white/[0.05] pt-1.5 text-[10px]">
                              <div className="flex items-center gap-1 font-mono text-zinc-500">
                                {(m.build_costs ?? []).slice(0, 2).map((bc) => (
                                  <span key={bc.id} className="rounded bg-white/[0.04] px-1">
                                    {bc.quantity} {getProductLabel(bc.id).ru ?? bc.name}
                                  </span>
                                ))}
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  if (isManualUnlock || isManualLock) {
                                    onToggleManualMachine(m.id, 'reset');
                                  } else {
                                    onToggleManualMachine(
                                      m.id,
                                      isUnlocked ? 'lock' : 'unlock',
                                    );
                                  }
                                }}
                                title={
                                  isManualUnlock || isManualLock
                                    ? 'Сбросить ручное переопределение'
                                    : isUnlocked
                                      ? 'Исключить из доступных'
                                      : 'Разрешить вручную'
                                }
                                className={cn(
                                  'shrink-0 rounded border px-1.5 py-0.5 font-medium transition-colors',
                                  isManualUnlock
                                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                                    : isManualLock
                                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                                      : 'border-white/[0.08] bg-[#121214] text-zinc-400 hover:text-zinc-200',
                                )}
                              >
                                {isManualUnlock
                                  ? 'Ручн: Вкл ✕'
                                  : isManualLock
                                    ? 'Ручн: Искл ✕'
                                    : isUnlocked
                                      ? 'Исключить'
                                      : 'Разрешить'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}

          {/* ================= SUB-TAB 3: POWER GRID & STEAM ================= */}
          {subTab === 'power' && powerAnalysis && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Выработка пара</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-amber-300">
                    {shortNum(powerAnalysis.totalMade)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Пар в турбины (все ступени)</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-emerald-300">
                    {shortNum(powerAnalysis.totalTurb)}
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Конденсация / сброс пара</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-sky-300">
                    {shortNum(powerAnalysis.totalVent)}{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      (
                      {powerAnalysis.totalMade > 0
                        ? Math.round((powerAnalysis.totalVent / powerAnalysis.totalMade) * 100)
                        : 0}
                      %)
                    </span>
                  </div>
                </div>
                <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                  <div className="text-[11px] text-zinc-500">Топливных потоков энергетики</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums text-zinc-100">
                    {powerAnalysis.fuels.length}
                  </div>
                </div>
              </div>

              {/* Steam balance table */}
              <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
                <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-200">
                  Баланс пара по давлениям ({PERIOD_LABELS[period]})
                </h2>
                <div className="overflow-x-auto rounded-lg border border-white/[0.06] bg-[#09090b]">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="border-b border-white/[0.08] bg-[#121214] text-[10px] uppercase tracking-wider text-zinc-400">
                      <tr>
                        <th className="px-3 py-2">Тип пара</th>
                        <th className="px-3 py-2 text-right">Выработка</th>
                        <th className="px-3 py-2 text-right">Расход</th>
                        <th className="px-3 py-2 text-right">Нетто</th>
                        <th className="px-3 py-2 text-right">В турбины</th>
                        <th className="px-3 py-2 text-right">Градирни / Сброс</th>
                        <th className="px-3 py-2 text-right">Буфер</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.05] font-mono tabular-nums">
                      {powerAnalysis.steamRows.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="px-3 py-6 text-center font-sans text-zinc-500">
                            За выбранный период поток пара не зафиксирован
                          </td>
                        </tr>
                      ) : (
                        powerAnalysis.steamRows.map((s) => {
                          const net = s.made - s.used;
                          return (
                            <tr key={s.id} className="hover:bg-[#18181b]/60">
                              <td className="px-3 py-2 font-sans font-semibold text-zinc-100">
                                {s.name}
                              </td>
                              <td className="px-3 py-2 text-right text-zinc-200">
                                {formatNumber(s.made, 0)}
                              </td>
                              <td className="px-3 py-2 text-right text-zinc-300">
                                {formatNumber(s.used, 0)}
                              </td>
                              <td
                                className={cn(
                                  'px-3 py-2 text-right font-semibold',
                                  net < 0 ? 'text-rose-400' : 'text-emerald-400',
                                )}
                              >
                                {net > 0 ? '+' : ''}
                                {formatNumber(net, 0)}
                              </td>
                              <td className="px-3 py-2 text-right text-emerald-300">
                                {formatNumber(s.intoTurb, 0)}
                              </td>
                              <td className="px-3 py-2 text-right text-sky-300">
                                {formatNumber(s.vented, 0)}
                              </td>
                              <td className="px-3 py-2 text-right text-zinc-400">
                                {s.cap > 0 ? `${formatNumber(s.stored, 0)} / ${formatNumber(s.cap, 0)}` : '—'}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Generators & Fuels */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
                  <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Котлы, Реакторы и Турбины
                  </h3>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <div className="mb-1.5 text-[11px] font-medium text-amber-300">
                        Генерация пара
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {powerAnalysis.steamProducers.map((p) => (
                          <div
                            key={p.id}
                            className="flex items-center justify-between rounded bg-[#09090b] px-2.5 py-1.5 text-xs"
                          >
                            <span className="truncate text-zinc-200">{p.label}</span>
                            <span className="font-mono font-semibold text-amber-300">
                              {formatNumber(p.value, 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1.5 text-[11px] font-medium text-emerald-300">
                        Турбины (потребление пара)
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {powerAnalysis.turbConsumers.map((t) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between rounded bg-[#09090b] px-2.5 py-1.5 text-xs"
                          >
                            <span className="truncate text-zinc-200">{t.label}</span>
                            <span className="font-mono font-semibold text-emerald-300">
                              {formatNumber(t.value, 0)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>

                <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
                  <h3 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Топливо для энергосети и запас хода
                  </h3>
                  <div className="flex flex-col gap-2">
                    {powerAnalysis.fuels.map((f) => (
                      <div
                        key={f.id}
                        className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-[#09090b] px-3 py-2 text-xs"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <img src={f.icon} alt={f.name} className="h-5 w-5 shrink-0 object-contain" />
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-zinc-100">{f.name}</div>
                            <div className="truncate text-[10px] text-zinc-500">
                              {[...f.by].join(', ')}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] tabular-nums">
                          <div className="text-right">
                            <div className="text-amber-300">расх. {formatNumber(f.used, 0)}</div>
                            <div
                              className={cn(
                                f.runwayMonths !== null && f.runwayMonths < 4
                                  ? 'text-rose-400'
                                  : 'text-zinc-400',
                              )}
                            >
                              {f.runwayMonths !== null
                                ? `хватит ~${f.runwayMonths.toFixed(1)} мес`
                                : `склад ${formatNumber(f.quantity, 0)}`}
                            </div>
                          </div>
                          {f.calcId && f.netPer60 < 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                onAddDeficitToCalculator(
                                  f.calcId!,
                                  Math.max(5, Math.ceil(-f.netPer60)),
                                )
                              }
                              className="rounded border border-emerald-500/35 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/25"
                            >
                              + План
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* ================= SUB-TAB 4: PRODUCT EXPLORER & CAMERA ================= */}
          {subTab === 'explorer' && (
            <div className="flex flex-col gap-3">
              {/* Custom Product Picker Header (No Native <select>!) */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/[0.08] bg-[#121214] p-3">
                <div className="relative" ref={explorerPickerRef}>
                  <button
                    type="button"
                    onClick={() => setExplorerPickerOpen((v) => !v)}
                    className="flex items-center gap-2 rounded-lg border border-white/[0.12] bg-[#09090b] px-3 py-1.5 text-xs font-semibold text-zinc-100 hover:border-emerald-500/40"
                  >
                    {selectedExplorerRow && (
                      <img
                        src={selectedExplorerRow.icon}
                        alt={selectedExplorerRow.name}
                        className="h-5 w-5 object-contain"
                      />
                    )}
                    <span>{selectedExplorerRow?.name ?? selectedGameProdId}</span>
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                  </button>

                  {explorerPickerOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1.5 w-80 rounded-xl border border-white/[0.14] bg-[#121214] p-2 shadow-2xl">
                      <div className="mb-1.5 flex items-center gap-1.5 rounded-lg border border-white/[0.08] bg-[#09090b] px-2 py-1">
                        <Search className="h-3.5 w-3.5 text-zinc-500" />
                        <input
                          autoFocus
                          value={explorerSearch}
                          onChange={(e) => setExplorerSearch(e.target.value)}
                          placeholder="Найти продукт..."
                          className="w-full bg-transparent text-xs text-zinc-100 outline-none"
                        />
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        {explorerCatalog.slice(0, 60).map((c) => {
                          const calcId = GAME_ID_TO_PRODUCT_ID[c.id];
                          const lbl = calcId ? getProductLabel(calcId) : null;
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => {
                                setSelectedGameProdId(c.id);
                                setExplorerPickerOpen(false);
                              }}
                              className={cn(
                                'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                                c.id === selectedGameProdId
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'text-zinc-200 hover:bg-[#18181b]',
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <img
                                  src={getGameOrLocalProductIcon(c.id, baseUrl, bundle.gameInfo.sessionId)}
                                  alt={c.name}
                                  className="h-4 w-4 shrink-0 object-contain"
                                />
                                <span className="truncate">{lbl?.ru ?? c.name}</span>
                              </div>
                              {!c.isUnlocked && (
                                <Lock className="h-3 w-3 shrink-0 text-zinc-500" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Quick Pinned Products Strip */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-zinc-500">Быстрый выбор:</span>
                  {['coal', 'diesel', 'iron', 'steel', 'copper', 'construction_parts_ii']
                    .map((pid) => ({ pid, gid: PRODUCT_GAME_IDS[pid] }))
                    .filter((x) => Boolean(x.gid))
                    .map(({ pid, gid }) => (
                      <button
                        key={pid}
                        type="button"
                        onClick={() => setSelectedGameProdId(gid)}
                        className={cn(
                          'flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                          selectedGameProdId === gid
                            ? 'border-emerald-500/45 bg-emerald-500/15 text-emerald-300'
                            : 'border-white/[0.08] bg-[#09090b] text-zinc-400 hover:text-zinc-200',
                        )}
                      >
                        <span>{getProductLabel(pid).ru ?? pid}</span>
                      </button>
                    ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                {/* 24-Period History SVG Chart (2 cols) */}
                <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5 lg:col-span-2">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                        История потоков · {selectedExplorerRow?.name}
                      </h3>
                      <div className="mt-1 flex items-center gap-3 text-[11px] text-zinc-400">
                        {historyRes !== 'day' ? (
                          <>
                            <span className="flex items-center gap-1">
                              <i className="h-2 w-2 rounded-full bg-sky-400" /> Произведено
                            </span>
                            <span className="flex items-center gap-1">
                              <i className="h-2 w-2 rounded-full bg-amber-400" /> Потреблено
                            </span>
                            <span className="flex items-center gap-1">
                              <i className="h-2 w-2 rounded-full bg-emerald-400" /> На складе
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="flex items-center gap-1">
                              <i className="h-2 w-2 rounded-full bg-emerald-400" /> Количество
                            </span>
                            <span className="flex items-center gap-1">
                              <i className="h-2 w-2 rounded-full bg-violet-400" /> На складах
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center rounded-lg border border-white/[0.08] bg-[#09090b] p-0.5 text-[11px]">
                      {[
                        { r: 'day' as const, l: 'Дни' },
                        { r: 'month' as const, l: 'Месяцы' },
                        { r: 'year' as const, l: 'Годы' },
                      ].map((opt) => (
                        <button
                          key={opt.r}
                          type="button"
                          onClick={() => setHistoryRes(opt.r)}
                          className={cn(
                            'rounded px-2 py-1',
                            historyRes === opt.r
                              ? 'bg-[#18181b] text-emerald-300'
                              : 'text-zinc-500 hover:text-zinc-300',
                          )}
                        >
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(() => {
                    const entry = historyData?.products?.[selectedGameProdId];
                    const s1 =
                      historyRes === 'day' ? entry?.quantity ?? [] : entry?.produced ?? [];
                    const s2 =
                      historyRes === 'day' ? entry?.stored ?? [] : entry?.consumed ?? [];
                    const s3 = historyRes === 'day' ? [] : entry?.quantity ?? [];
                    const n = Math.max(s1.length, s2.length, s3.length);
                    if (!n) {
                      return (
                        <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-[#09090b] text-xs text-zinc-500">
                          Нет исторических данных для этого ресурса
                        </div>
                      );
                    }
                    const W = 720;
                    const H = 220;
                    const L = 48;
                    const R = 16;
                    const T = 14;
                    const B = 24;
                    const maxFlow = Math.max(1, ...s1, ...s2);
                    const maxQty = Math.max(1, ...s3);
                    const xAt = (i: number) =>
                      L + ((W - L - R) * (n === 1 ? 0.5 : i / (n - 1)));
                    const yFlow = (v: number) => T + (H - T - B) * (1 - v / maxFlow);
                    const yQty = (v: number) =>
                      T + (H - T - B) * (1 - v / (historyRes === 'day' ? maxFlow : maxQty));
                    const pts = (arr: number[], yFn: (v: number) => number) =>
                      arr.map((v, i) => `${xAt(i).toFixed(1)},${yFn(v).toFixed(1)}`).join(' ');

                    const hoverIdx = historyHoverIdx !== null && historyHoverIdx < n ? historyHoverIdx : null;

                    return (
                      <div className="relative rounded-lg border border-white/[0.06] bg-[#09090b] p-2">
                        <svg
                          viewBox={`0 0 ${W} ${H}`}
                          className="h-56 w-full select-none"
                          onMouseMove={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            const relX = ((e.clientX - rect.left) / rect.width) * W;
                            const idx = Math.max(
                              0,
                              Math.min(n - 1, Math.round(((relX - L) / (W - L - R)) * (n - 1))),
                            );
                            setHistoryHoverIdx(idx);
                          }}
                          onMouseLeave={() => setHistoryHoverIdx(null)}
                        >
                          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
                            const yy = T + (H - T - B) * t;
                            return (
                              <g key={t}>
                                <line
                                  x1={L}
                                  x2={W - R}
                                  y1={yy}
                                  y2={yy}
                                  stroke="rgba(255,255,255,0.06)"
                                />
                                <text
                                  x={L - 6}
                                  y={yy + 3}
                                  textAnchor="end"
                                  className="fill-zinc-500 font-mono text-[10px]"
                                >
                                  {shortNum(maxFlow * (1 - t))}
                                </text>
                              </g>
                            );
                          })}
                          {s1.length > 0 && (
                            <polyline
                              fill="none"
                              stroke={historyRes === 'day' ? '#10b981' : '#38bdf8'}
                              strokeWidth="2.2"
                              points={pts(s1, yFlow)}
                            />
                          )}
                          {s2.length > 0 && (
                            <polyline
                              fill="none"
                              stroke={historyRes === 'day' ? '#a78bfa' : '#fbbf24'}
                              strokeWidth="2"
                              points={pts(s2, yFlow)}
                            />
                          )}
                          {s3.length > 0 && (
                            <polyline
                              fill="none"
                              stroke="#10b981"
                              strokeWidth="1.6"
                              strokeDasharray="4 3"
                              points={pts(s3, yQty)}
                            />
                          )}
                          {hoverIdx !== null && (
                            <line
                              x1={xAt(hoverIdx)}
                              x2={xAt(hoverIdx)}
                              y1={T}
                              y2={H - B}
                              stroke="rgba(255,255,255,0.25)"
                              strokeDasharray="3 3"
                            />
                          )}
                        </svg>
                        {hoverIdx !== null && (
                          <div className="mt-1 flex items-center justify-between px-2 font-mono text-[11px] tabular-nums text-zinc-300">
                            <span>Точка #{hoverIdx + 1}</span>
                            <div className="flex items-center gap-3">
                              {historyRes !== 'day' ? (
                                <>
                                  <span className="text-sky-300">Выпуск: {s1[hoverIdx] ?? 0}</span>
                                  <span className="text-amber-300">Расход: {s2[hoverIdx] ?? 0}</span>
                                  <span className="text-emerald-300">Запас: {s3[hoverIdx] ?? 0}</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-emerald-300">Всего: {s1[hoverIdx] ?? 0}</span>
                                  <span className="text-violet-300">На складах: {s2[hoverIdx] ?? 0}</span>
                                </>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </section>

                {/* Live Camera Feed Card (1 col) */}
                <section className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5">
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <Camera className="h-4 w-4 text-emerald-400" />
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-200">
                        Камера острова
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 text-[10px]">
                      {([0, 5, 15] as const).map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          onClick={() => setShotIntervalSec(sec)}
                          className={cn(
                            'rounded px-1.5 py-0.5 font-mono',
                            shotIntervalSec === sec
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-[#09090b] text-zinc-500 hover:text-zinc-300',
                          )}
                        >
                          {sec === 0 ? 'Стоп' : `${sec}с`}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={refreshScreenshot}
                        className="rounded border border-white/[0.1] bg-[#09090b] px-2 py-0.5 text-zinc-300 hover:border-emerald-500/40"
                      >
                        Снимок
                      </button>
                    </div>
                  </div>
                  {mode === 'live' && shotUrl ? (
                    <img
                      src={shotUrl}
                      alt="Game Camera"
                      className="h-48 w-full rounded-lg border border-white/[0.08] bg-[#09090b] object-cover"
                    />
                  ) : (
                    <div className="flex h-48 flex-col items-center justify-center rounded-lg border border-dashed border-white/[0.08] bg-[#09090b] p-4 text-center text-xs text-zinc-500">
                      <Camera className="mb-2 h-6 w-6 text-zinc-600" />
                      <span>
                        {mode === 'live'
                          ? 'Нажмите «Снимок» для получения кадра с камеры игры (/screenshot)'
                          : 'Живая камера с острова доступна при подключении к запущенной игре'}
                      </span>
                    </div>
                  )}
                  <div className="mt-1.5 font-mono text-[10px] text-zinc-500">{shotMeta}</div>
                </section>
              </div>

              {/* Comes From & Goes To Breakdown */}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {[
                  {
                    title: 'Откуда поступает (Производители)',
                    side: selectedExplorerSources?.produced,
                    color: 'bg-sky-400',
                    textColor: 'text-sky-300',
                  },
                  {
                    title: 'Куда расходуется (Потребители)',
                    side: selectedExplorerSources?.consumed,
                    color: 'bg-amber-400',
                    textColor: 'text-amber-300',
                  },
                ].map((panel) => {
                  const rows = panel.side?.rows ?? [];
                  const maxQ = Math.max(1, ...rows.map((r) => r.quantity));
                  return (
                    <section
                      key={panel.title}
                      className="rounded-xl border border-white/[0.08] bg-[#121214] p-3.5"
                    >
                      <div className="mb-2.5 flex items-center justify-between">
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                          {panel.title}
                        </h3>
                        <span className={cn('font-mono text-xs font-semibold', panel.textColor)}>
                          Всего: {formatNumber(panel.side?.total ?? 0, 0)}
                        </span>
                      </div>
                      {rows.length === 0 ? (
                        <div className="py-6 text-center text-xs text-zinc-500">
                          За выбранный период потоки не зафиксированы
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          {rows.map((r, idx) => {
                            const machObj = r.machine
                              ? MACHINE_BY_GAME_ID[r.machine.replace(/^Machine_/, '')]
                              : undefined;
                            const machName = machObj
                              ? getMachineLabel(machObj.id).ru
                              : r.machine
                                ? bundle.sources.names[r.machine] ?? r.machine
                                : '';
                            const recCalcId = r.recipe
                              ? GAME_ID_TO_RECIPE_ID[r.recipe]
                              : undefined;
                            const recName = recCalcId
                              ? getRecipeLabel(recCalcId).ru
                              : r.recipe
                                ? bundle.sources.names[r.recipe] ?? r.recipe
                                : '';
                            const entityMach = r.entity
                              ? MACHINE_BY_GAME_ID[r.entity.replace(/^Machine_/, '')]
                              : undefined;
                            const label =
                              r.type === 'recipe'
                                ? `${machName}${recName ? ` · ${recName}` : ''}`
                                : r.entity
                                  ? (entityMach
                                      ? getMachineLabel(entityMach.id).ru
                                      : bundle.sources.names[r.entity] ?? r.entity)
                                  : machName || r.type;
                            return (
                              <div
                                key={`${label}-${idx}`}
                                className="grid grid-cols-[minmax(140px,52%)_1fr_64px] items-center gap-2 text-xs"
                              >
                                <span className="truncate text-zinc-200">{label}</span>
                                <div className="h-2.5 overflow-hidden rounded-full bg-[#09090b]">
                                  <div
                                    className={cn('h-full rounded-full', panel.color)}
                                    style={{ width: `${(r.quantity / maxQ) * 100}%` }}
                                  />
                                </div>
                                <span className="text-right font-mono tabular-nums text-zinc-300">
                                  {formatNumber(r.quantity, 0)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
