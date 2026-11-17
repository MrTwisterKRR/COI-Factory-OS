import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  FactoryPlanConfig,
  ProductionTarget,
  RateUnit,
  TechStageMode,
} from './types/coi';
import { NATURAL_RAW_PRODUCT_IDS } from './data';
import { STARTER_PRESETS, createEmptyWorkspace } from './data/presets';
import { solveProductionChain } from './engine/solver';
import {
  DEFAULT_GAME_API_URL,
  type GameConnectionMode,
  type GameLiveBundle,
  type SourcesPeriod,
  buildDemoSnapshot,
  computeCapabilitiesForStage,
  fetchLiveGameBundle,
  sendGameCommand,
} from './engine/gameApiClient';
import { HeaderBar, type WorkspaceViewMode } from './components/HeaderBar';
import { BentoMetricsBar } from './components/BentoMetricsBar';
import { TargetSidebar } from './components/TargetSidebar';
import { ChainTableView } from './components/ChainTableView';
import { FlowGraphView } from './components/FlowGraphView';
import { GameTelemetryView } from './components/GameTelemetryView';
import { CodexView } from './components/CodexView';
import {
  BlueprintModal,
  CommandPaletteModal,
  ProductPickerModal,
} from './components/Modals';

const STORAGE_PLANS_KEY = 'coi_factory_os_plans_v1';
const STORAGE_ACTIVE_KEY = 'coi_factory_os_active_v1';
const STORAGE_UNIT_KEY = 'coi_factory_os_unit_v1';
const STORAGE_GAME_URL_KEY = 'coi_factory_os_game_url_v1';
const STORAGE_STAGE_MODE_KEY = 'coi_factory_os_stage_mode_v1';
const STORAGE_MANUAL_TECH_KEY = 'coi_factory_os_manual_tech_v1';

const VALID_STAGE_MODES = new Set<TechStageMode>([
  'game_sync',
  'stage_1',
  'stage_2',
  'stage_3',
  'stage_4',
  'all',
]);

function loadInitialPlans(): FactoryPlanConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_PLANS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FactoryPlanConfig[];
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {
    // Fallback to presets
  }
  return STARTER_PRESETS.slice(0, 3);
}

export function App() {
  const [plans, setPlans] = useState<FactoryPlanConfig[]>(loadInitialPlans);
  const [activePlanId, setActivePlanId] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_ACTIVE_KEY);
      if (saved) return saved;
    } catch {
      // ignore
    }
    return loadInitialPlans()[0].id;
  });
  const [rateUnit, setRateUnit] = useState<RateUnit>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_UNIT_KEY) as RateUnit | null;
      if (saved === '60s' || saved === '1s' || saved === '1m') return saved;
    } catch {
      // ignore
    }
    return '60s';
  });

  const [viewMode, setViewMode] = useState<WorkspaceViewMode>('table');
  const [codexInitialProduct, setCodexInitialProduct] = useState<string | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [blueprintOpen, setBlueprintOpen] = useState(false);

  // Live Game Web API & Telemetry states
  const [gameBaseUrl, setGameBaseUrl] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_GAME_URL_KEY) || DEFAULT_GAME_API_URL;
    } catch {
      return DEFAULT_GAME_API_URL;
    }
  });
  const [gamePeriod, setGamePeriod] = useState<SourcesPeriod>('lastMonth');
  const [gameMode, setGameMode] = useState<GameConnectionMode>('demo');
  const [gameBundle, setGameBundle] = useState<GameLiveBundle | null>(() =>
    buildDemoSnapshot('lastMonth'),
  );
  const [gameError, setGameError] = useState<string | null>(null);
  const [isPollingGame, setIsPollingGame] = useState(false);
  const [gameTps, setGameTps] = useState<number | null>(null);
  const lastTickSampleRef = useRef<{ tick: number; ts: number } | null>(null);

  const [techStageMode, setTechStageMode] = useState<TechStageMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_STAGE_MODE_KEY) as TechStageMode | null;
      if (saved && VALID_STAGE_MODES.has(saved)) return saved;
    } catch {
      // ignore
    }
    return 'stage_1';
  });
  const [manualUnlockedMachines, setManualUnlockedMachines] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_MANUAL_TECH_KEY) || '{}') as {
        unlocked?: string[];
      };
      return new Set(raw.unlocked ?? []);
    } catch {
      return new Set();
    }
  });
  const [manualLockedMachines, setManualLockedMachines] = useState<Set<string>>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_MANUAL_TECH_KEY) || '{}') as {
        locked?: string[];
      };
      return new Set(raw.locked ?? []);
    } catch {
      return new Set();
    }
  });

  const activePlan = useMemo(
    () => plans.find((p) => p.id === activePlanId) ?? plans[0],
    [plans, activePlanId],
  );

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PLANS_KEY, JSON.stringify(plans));
      localStorage.setItem(STORAGE_ACTIVE_KEY, activePlan.id);
      localStorage.setItem(STORAGE_UNIT_KEY, rateUnit);
      localStorage.setItem(STORAGE_GAME_URL_KEY, gameBaseUrl);
      localStorage.setItem(STORAGE_STAGE_MODE_KEY, techStageMode);
      localStorage.setItem(
        STORAGE_MANUAL_TECH_KEY,
        JSON.stringify({
          unlocked: [...manualUnlockedMachines],
          locked: [...manualLockedMachines],
        }),
      );
    } catch {
      // ignore storage quota errors
    }
  }, [
    plans,
    activePlan.id,
    rateUnit,
    gameBaseUrl,
    techStageMode,
    manualUnlockedMachines,
    manualLockedMachines,
  ]);

  const probeOrSyncGame = useCallback(
    async (fallbackToDemo: boolean, targetUrl = gameBaseUrl, period = gamePeriod) => {
      setIsPollingGame(true);
      try {
        const bundle = await fetchLiveGameBundle(targetUrl, period);
        const nowTs = performance.now();
        const prev = lastTickSampleRef.current;
        if (prev && !bundle.gameInfo.isPaused && nowTs > prev.ts) {
          const dt = (nowTs - prev.ts) / 1000;
          const tps = (bundle.gameInfo.tick - prev.tick) / dt;
          if (tps >= 0) setGameTps(tps);
        } else if (bundle.gameInfo.isPaused) {
          setGameTps(0);
        }
        lastTickSampleRef.current = { tick: bundle.gameInfo.tick, ts: nowTs };
        setGameBundle(bundle);
        setGameMode('live');
        setGameError(null);
        // Automatically switch to Live Game Sync when connecting manually or when live game responds on first visit
        let hasSavedStage = false;
        try {
          hasSavedStage = Boolean(localStorage.getItem(STORAGE_STAGE_MODE_KEY));
        } catch {
          // ignore
        }
        if (!fallbackToDemo || !hasSavedStage) {
          setTechStageMode('game_sync');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Нет ответа от игры';
        if (fallbackToDemo) {
          setGameBundle(buildDemoSnapshot(period));
          setGameMode('demo');
          setGameError(null);
          setGameTps(19.8);
        } else {
          setGameMode('offline');
          setGameBundle(null);
          setGameError(msg);
          setGameTps(null);
        }
      } finally {
        setIsPollingGame(false);
      }
    },
    [gameBaseUrl, gamePeriod],
  );

  // Initial silent startup check (uses /coi-live-api clean probe; falls back seamlessly to Demo snapshot)
  useEffect(() => {
    probeOrSyncGame(true);
  }, []);

  // Poll continuously when connected Live
  useEffect(() => {
    if (gameMode !== 'live') return;
    const id = setInterval(() => {
      probeOrSyncGame(false);
    }, 2500);
    return () => clearInterval(id);
  }, [gameMode, probeOrSyncGame]);

  const handleChangeGamePeriod = useCallback(
    (nextPeriod: SourcesPeriod) => {
      setGamePeriod(nextPeriod);
      if (gameMode === 'demo') {
        setGameBundle(buildDemoSnapshot(nextPeriod));
      } else if (gameMode === 'live') {
        probeOrSyncGame(false, gameBaseUrl, nextPeriod);
      }
    },
    [gameMode, gameBaseUrl, probeOrSyncGame],
  );

  const handleToggleManualMachine = useCallback(
    (machineId: string, action: 'unlock' | 'lock' | 'reset') => {
      setManualUnlockedMachines((prev) => {
        const next = new Set(prev);
        if (action === 'unlock') next.add(machineId);
        else next.delete(machineId);
        return next;
      });
      setManualLockedMachines((prev) => {
        const next = new Set(prev);
        if (action === 'lock') next.add(machineId);
        else next.delete(machineId);
        return next;
      });
    },
    [],
  );

  const capabilities = useMemo(
    () =>
      computeCapabilitiesForStage(
        techStageMode,
        gameBundle?.catalog ?? [],
        gameBundle?.sources ?? null,
        manualUnlockedMachines,
        manualLockedMachines,
      ),
    [techStageMode, gameBundle, manualUnlockedMachines, manualLockedMachines],
  );

  const unlockedFilter = useMemo(
    () => capabilities.toSolverFilter(techStageMode !== 'all'),
    [capabilities, techStageMode],
  );

  // Ctrl+K / Cmd+K shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const solveResult = useMemo(
    () => solveProductionChain(activePlan, unlockedFilter),
    [activePlan, unlockedFilter],
  );

  const updateActivePlan = useCallback(
    (updater: (prev: FactoryPlanConfig) => FactoryPlanConfig) => {
      setPlans((prev) =>
        prev.map((p) => (p.id === activePlan.id ? updater(p) : p)),
      );
    },
    [activePlan.id],
  );

  const handleCreatePlan = () => {
    const next = createEmptyWorkspace(plans.length + 1);
    setPlans((prev) => [...prev, next]);
    setActivePlanId(next.id);
  };

  const handleDuplicatePlan = (id: string) => {
    const src = plans.find((p) => p.id === id);
    if (!src) return;
    const copy: FactoryPlanConfig = {
      ...structuredClone(src),
      id: `plan-${Date.now()}`,
      name: `${src.name} (Копия)`,
    };
    setPlans((prev) => [...prev, copy]);
    setActivePlanId(copy.id);
  };

  const handleDeletePlan = (id: string) => {
    if (plans.length <= 1) return;
    setPlans((prev) => {
      const next = prev.filter((p) => p.id !== id);
      if (activePlanId === id && next[0]) {
        setActivePlanId(next[0].id);
      }
      return next;
    });
  };

  const handleRenamePlan = (id: string, name: string) => {
    setPlans((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  };

  const handleLoadPreset = (preset: FactoryPlanConfig) => {
    const existing = plans.find((p) => p.id === preset.id);
    if (existing) {
      setActivePlanId(existing.id);
    } else {
      const cloned = structuredClone(preset);
      setPlans((prev) => [...prev, cloned]);
      setActivePlanId(cloned.id);
    }
    if (viewMode === 'codex') setViewMode('table');
  };

  const handleAddTargetProduct = useCallback(
    (productId: string, recipeId?: string, ratePer60 = 30) => {
      updateActivePlan((prev) => {
        const cleanedRaw = prev.rawResources.filter((id) => id !== productId);
        const nextOverrides = recipeId
          ? { ...prev.recipeOverrides, [productId]: recipeId }
          : prev.recipeOverrides;
        const existing = prev.targets.find((t) => t.productId === productId);
        if (existing) {
          return {
            ...prev,
            rawResources: cleanedRaw,
            recipeOverrides: nextOverrides,
            targets: prev.targets.map((t) =>
              t.id === existing.id
                ? {
                    ...t,
                    ratePer60: Number((t.ratePer60 + ratePer60).toFixed(1)),
                    recipeId: recipeId ?? t.recipeId,
                  }
                : t,
            ),
          };
        }
        return {
          ...prev,
          rawResources: cleanedRaw,
          recipeOverrides: nextOverrides,
          targets: [
            ...prev.targets,
            {
              id: `t-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
              productId,
              ratePer60,
              mode: 'rate',
              fixedMachines: 1,
              recipeId,
            },
          ],
        };
      });
    },
    [updateActivePlan],
  );

  const handleUpdateTarget = useCallback(
    (targetId: string, patch: Partial<ProductionTarget>) => {
      updateActivePlan((prev) => ({
        ...prev,
        targets: prev.targets.map((t) =>
          t.id === targetId ? { ...t, ...patch } : t,
        ),
      }));
    },
    [updateActivePlan],
  );

  const handleRemoveTarget = useCallback(
    (targetId: string) => {
      updateActivePlan((prev) => ({
        ...prev,
        targets: prev.targets.filter((t) => t.id !== targetId),
      }));
    },
    [updateActivePlan],
  );

  const handleSelectRecipeOverride = useCallback(
    (productId: string, recipeId: string) => {
      updateActivePlan((prev) => ({
        ...prev,
        recipeOverrides: {
          ...prev.recipeOverrides,
          [productId]: recipeId,
        },
        rawResources: prev.rawResources.filter((id) => id !== productId),
      }));
    },
    [updateActivePlan],
  );

  const handleClearRecipeOverride = useCallback(
    (productId: string) => {
      updateActivePlan((prev) => {
        const next = { ...prev.recipeOverrides };
        delete next[productId];
        return { ...prev, recipeOverrides: next };
      });
    },
    [updateActivePlan],
  );

  const handleSelectContractOverride = useCallback(
    (productId: string, contractId: string) => {
      updateActivePlan((prev) => ({
        ...prev,
        contractOverrides: {
          ...prev.contractOverrides,
          [productId]: contractId,
        },
        rawResources: prev.rawResources.filter((id) => id !== productId),
      }));
    },
    [updateActivePlan],
  );

  const handleClearContractOverride = useCallback(
    (productId: string) => {
      updateActivePlan((prev) => {
        const next = { ...prev.contractOverrides };
        delete next[productId];
        return { ...prev, contractOverrides: next };
      });
    },
    [updateActivePlan],
  );

  const handleToggleRawResource = useCallback(
    (productId: string) => {
      updateActivePlan((prev) => {
        const exists = prev.rawResources.includes(productId);
        return {
          ...prev,
          rawResources: exists
            ? prev.rawResources.filter((id) => id !== productId)
            : [...prev.rawResources, productId],
        };
      });
    },
    [updateActivePlan],
  );

  const handleUseRawSource = useCallback(
    (productId: string) => {
      updateActivePlan((prev) => {
        const nextOverrides = { ...prev.recipeOverrides };
        delete nextOverrides[productId];
        const nextContracts = { ...prev.contractOverrides };
        delete nextContracts[productId];
        const nextRaw = NATURAL_RAW_PRODUCT_IDS.has(productId)
          ? prev.rawResources
          : prev.rawResources.includes(productId)
            ? prev.rawResources
            : [...prev.rawResources, productId];
        return {
          ...prev,
          recipeOverrides: nextOverrides,
          contractOverrides: nextContracts,
          rawResources: nextRaw,
        };
      });
    },
    [updateActivePlan],
  );

  const handleResetAllOverrides = useCallback(() => {
    updateActivePlan((prev) => ({
      ...prev,
      recipeOverrides: {},
      contractOverrides: {},
      rawResources: [],
    }));
  }, [updateActivePlan]);

  const handleInspectProduct = useCallback((productId: string) => {
    setCodexInitialProduct(productId);
    setViewMode('codex');
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[#09090b] text-zinc-100">
      <HeaderBar
        plans={plans}
        activePlanId={activePlan.id}
        activePlan={activePlan}
        viewMode={viewMode}
        rateUnit={rateUnit}
        gameMode={gameMode}
        unlockedMachinesCount={capabilities.unlockedMachinesCount}
        techStageMode={techStageMode}
        onSelectPlan={setActivePlanId}
        onCreatePlan={handleCreatePlan}
        onDuplicatePlan={handleDuplicatePlan}
        onDeletePlan={handleDeletePlan}
        onRenamePlan={handleRenamePlan}
        onLoadPreset={handleLoadPreset}
        onChangeViewMode={setViewMode}
        onChangeRateUnit={setRateUnit}
        onChangeBoost={(boost) =>
          updateActivePlan((prev) => ({ ...prev, productionBoost: boost }))
        }
        onToggleRoundUp={() =>
          updateActivePlan((prev) => ({
            ...prev,
            roundMachinesUp: !prev.roundMachinesUp,
          }))
        }
        onChangeTechStage={setTechStageMode}
        onOpenCommandPalette={() => setCmdOpen(true)}
        onOpenBlueprintModal={() => setBlueprintOpen(true)}
      />

      {viewMode !== 'codex' && viewMode !== 'telemetry' && (
        <BentoMetricsBar
          summary={solveResult.summary}
          rateUnit={rateUnit}
          roundMachinesUp={activePlan.roundMachinesUp}
        />
      )}

      {viewMode === 'telemetry' ? (
        <GameTelemetryView
          mode={gameMode}
          baseUrl={gameBaseUrl}
          bundle={gameBundle}
          capabilities={capabilities}
          techStageMode={techStageMode}
          period={gamePeriod}
          tps={gameTps}
          error={gameError}
          isPolling={isPollingGame}
          manualUnlockedMachines={manualUnlockedMachines}
          manualLockedMachines={manualLockedMachines}
          solveResult={solveResult}
          rateUnit={rateUnit}
          onChangeBaseUrl={setGameBaseUrl}
          onConnectLive={() => probeOrSyncGame(false, gameBaseUrl, gamePeriod)}
          onSwitchDemo={() => {
            setGameMode('demo');
            setGameBundle(buildDemoSnapshot(gamePeriod));
            setGameError(null);
            setGameTps(19.8);
          }}
          onRefreshNow={() => {
            if (gameMode === 'live') probeOrSyncGame(false);
            else if (gameMode === 'demo') setGameBundle(buildDemoSnapshot(gamePeriod));
          }}
          onChangePeriod={handleChangeGamePeriod}
          onChangeTechStage={setTechStageMode}
          onToggleManualMachine={handleToggleManualMachine}
          onResetManualMachines={() => {
            setManualUnlockedMachines(new Set());
            setManualLockedMachines(new Set());
          }}
          onSendCommand={async (type, args) => {
            await sendGameCommand(gameBaseUrl, type, args);
            await probeOrSyncGame(false);
          }}
          onAddDeficitToCalculator={(pid, rate60) => {
            handleAddTargetProduct(pid, undefined, rate60);
            setViewMode('table');
          }}
        />
      ) : viewMode === 'codex' ? (
        <CodexView
          key={codexInitialProduct ?? 'codex'}
          initialProductId={codexInitialProduct}
          onAddTargetProduct={(pid, rid) => {
            handleAddTargetProduct(pid, rid);
            setViewMode('table');
          }}
          onApplyRecipeOverride={(pid, rid) => {
            handleSelectRecipeOverride(pid, rid);
            setViewMode('table');
          }}
          onApplyContractOverride={(pid, cid) => {
            handleSelectContractOverride(pid, cid);
            setViewMode('table');
          }}
        />
      ) : (
        <main className="flex flex-1 flex-col gap-3 px-4 py-3 lg:flex-row">
          <TargetSidebar
            plan={activePlan}
            solveResult={solveResult}
            rateUnit={rateUnit}
            unlockedFilter={unlockedFilter}
            onOpenAddTarget={() => setPickerOpen(true)}
            onUpdateTarget={handleUpdateTarget}
            onRemoveTarget={handleRemoveTarget}
            onSelectRecipeOverride={handleSelectRecipeOverride}
            onClearRecipeOverride={handleClearRecipeOverride}
            onToggleRawResource={handleToggleRawResource}
            onClearContractOverride={handleClearContractOverride}
            onResetAllOverrides={handleResetAllOverrides}
          />

          {viewMode === 'table' ? (
            <ChainTableView
              plan={activePlan}
              solveResult={solveResult}
              rateUnit={rateUnit}
              unlockedFilter={unlockedFilter}
              onSelectRecipeOverride={handleSelectRecipeOverride}
              onSelectContractOverride={handleSelectContractOverride}
              onClearContractOverride={handleClearContractOverride}
              onToggleRawResource={handleToggleRawResource}
              onInspectProduct={handleInspectProduct}
              onAddTargetWithRate={(pid, rate60, rid) =>
                handleAddTargetProduct(pid, rid, rate60)
              }
            />
          ) : (
            <FlowGraphView
              plan={activePlan}
              solveResult={solveResult}
              rateUnit={rateUnit}
              unlockedFilter={unlockedFilter}
              onSelectRecipeOverride={handleSelectRecipeOverride}
              onSelectContractOverride={handleSelectContractOverride}
              onClearContractOverride={handleClearContractOverride}
              onToggleRawResource={handleToggleRawResource}
              onUseRawSource={handleUseRawSource}
              onAddTargetWithRate={(pid, rate60, rid) =>
                handleAddTargetProduct(pid, rid, rate60)
              }
            />
          )}
        </main>
      )}

      <ProductPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelectProduct={(pid) => handleAddTargetProduct(pid)}
      />

      <CommandPaletteModal
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onAddTargetProduct={(pid) => {
          handleAddTargetProduct(pid);
          if (viewMode === 'codex') setViewMode('table');
        }}
        onInspectProduct={handleInspectProduct}
        onLoadPreset={handleLoadPreset}
      />

      <BlueprintModal
        open={blueprintOpen}
        plan={activePlan}
        solveResult={solveResult}
        onClose={() => setBlueprintOpen(false)}
        onImportPlan={(imported) => {
          setPlans((prev) => [...prev, imported]);
          setActivePlanId(imported.id);
        }}
      />
    </div>
  );
}

export default App;
