import React from 'react';
import {
  Boxes,
  Cpu,
  Factory,
  Hammer,
  Truck,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import type { FactorySummary, RateUnit } from '../types/coi';
import { getProductIconUrl } from '../data';
import { formatNumber, formatPower, formatRate } from '../utils/format';

interface BentoMetricsBarProps {
  summary: FactorySummary;
  rateUnit: RateUnit;
  roundMachinesUp: boolean;
}

export const BentoMetricsBar: React.FC<BentoMetricsBarProps> = ({
  summary,
  rateUnit,
  roundMachinesUp,
}) => {
  const netPower = summary.netElectricityKw;
  const peakRaw = summary.rawInputs[0];

  return (
    <section className="grid grid-cols-2 gap-2.5 px-4 pt-3 sm:grid-cols-3 lg:grid-cols-6">
      {/* 1. Workers & Machines */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3 transition-all duration-150 ease-out hover:border-white/[0.14]">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
          <span>Персонал и Здания</span>
          <Users className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {formatNumber(summary.totalWorkers, 0)}
          </span>
          <span className="text-[11px] text-zinc-500">раб.</span>
        </div>
        <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-zinc-400">
          <Factory className="h-3 w-3 text-zinc-500" />
          <span>
            {roundMachinesUp
              ? `${summary.totalMachinesCeil} шт (${formatNumber(summary.totalMachinesExact, 1)} точн.)`
              : `${formatNumber(summary.totalMachinesExact, 1)} точн. (${summary.totalMachinesCeil} шт)`}
          </span>
        </div>
      </div>

      {/* 2. Electricity */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3 transition-all duration-150 ease-out hover:border-white/[0.14]">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
          <span>Энергобаланс</span>
          <Zap className="h-3.5 w-3.5 text-amber-400" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span
            className={`font-mono text-xl font-bold tabular-nums ${
              netPower >= 0 ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {formatPower(summary.electricityConsumedKw)}
          </span>
        </div>
        <div className="mt-1 font-mono text-[11px] tabular-nums text-zinc-400">
          {summary.electricityGeneratedKw > 0
            ? `Выработка: ${formatPower(summary.electricityGeneratedKw)}`
            : 'Потребление сети'}
        </div>
      </div>

      {/* 3. Maintenance I / II / III */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3 transition-all duration-150 ease-out hover:border-white/[0.14]">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
          <span>Обслуживание</span>
          <Wrench className="h-3.5 w-3.5 text-zinc-400" />
        </div>
        <div className="mt-1.5 flex flex-col gap-0.5 font-mono text-xs tabular-nums">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Maint I:</span>
            <span className="font-semibold text-zinc-200">
              {formatRate(summary.maintenance.maintenance_i, rateUnit)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Maint II:</span>
            <span className="font-semibold text-amber-300">
              {formatRate(summary.maintenance.maintenance_ii, rateUnit)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Maint III:</span>
            <span className="font-semibold text-violet-300">
              {formatRate(summary.maintenance.maintenance_iii, rateUnit)}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Computing & Unity */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3 transition-all duration-150 ease-out hover:border-white/[0.14]">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
          <span>TFlops и Единство</span>
          <Cpu className="h-3.5 w-3.5 text-violet-400" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold tabular-nums text-violet-300">
            {formatNumber(summary.computingTFlops, 1)}
          </span>
          <span className="font-mono text-[11px] text-zinc-500">TFlops</span>
        </div>
        <div className="mt-1 font-mono text-[11px] tabular-nums text-zinc-400">
          Unity:{' '}
          <span className="text-zinc-200">
            {formatNumber(summary.unityConsumed, 2)} /мес
          </span>
        </div>
      </div>

      {/* 5. Raw Logistics */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3 transition-all duration-150 ease-out hover:border-white/[0.14]">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
          <span>Входное сырьё</span>
          <Truck className="h-3.5 w-3.5 text-emerald-400" />
        </div>
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="font-mono text-xl font-bold tabular-nums text-zinc-100">
            {summary.rawInputs.length}
          </span>
          <span className="text-[11px] text-zinc-500">потоков</span>
        </div>
        <div className="mt-1 truncate font-mono text-[11px] tabular-nums text-zinc-400">
          {peakRaw
            ? `Пик: ${peakRaw.name} (${formatRate(peakRaw.ratePer60, rateUnit)})`
            : 'Нет внешнего сырья'}
        </div>
      </div>

      {/* 6. Build Capital Costs */}
      <div className="rounded-xl border border-white/[0.08] bg-[#121214] p-3 transition-all duration-150 ease-out hover:border-white/[0.14]">
        <div className="flex items-center justify-between text-[11px] font-medium text-zinc-400">
          <span>Постройка (BOM)</span>
          <Hammer className="h-3.5 w-3.5 text-zinc-400" />
        </div>
        {summary.buildCosts.length > 0 ? (
          <div className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-1">
            {summary.buildCosts.slice(0, 4).map((bc) => (
              <div
                key={bc.productId}
                className="flex items-center gap-1 font-mono text-[11px] tabular-nums"
                title={bc.name}
              >
                <img
                  src={getProductIconUrl(bc.icon)}
                  alt={bc.name}
                  className="h-3.5 w-3.5 shrink-0 object-contain"
                />
                <span className="truncate font-semibold text-zinc-200">
                  {formatNumber(bc.quantity, 0)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
            <Boxes className="h-3.5 w-3.5" />
            <span>Нет зданий</span>
          </div>
        )}
      </div>
    </section>
  );
};
