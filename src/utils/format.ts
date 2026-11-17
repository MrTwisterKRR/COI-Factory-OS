import type { RateUnit } from '../types/coi';

export function formatNumber(value: number, maxDecimals = 1): string {
  if (!Number.isFinite(value)) return '0';
  const rounded = Number(value.toFixed(maxDecimals));
  if (Math.abs(rounded) < 1e-6) return '0';
  return rounded.toLocaleString('ru-RU', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export function formatRate(ratePer60: number, unit: RateUnit): string {
  const scaled =
    unit === '1s' ? ratePer60 / 60 : unit === '1m' ? ratePer60 : ratePer60;
  const suffix = unit === '1s' ? '/с' : unit === '1m' ? '/мин' : '/60с';
  const decimals = unit === '1s' ? 2 : 1;
  return `${formatNumber(scaled, decimals)} ${suffix}`;
}

export function formatRateValue(ratePer60: number, unit: RateUnit): string {
  const scaled = unit === '1s' ? ratePer60 / 60 : ratePer60;
  const decimals = unit === '1s' ? 2 : 1;
  return formatNumber(scaled, decimals);
}

export function rateUnitLabel(unit: RateUnit): string {
  switch (unit) {
    case '1s':
      return '/сек';
    case '1m':
      return '/мин';
    case '60s':
    default:
      return '/60с';
  }
}

export function formatPower(kw: number): string {
  const abs = Math.abs(kw);
  if (abs >= 1000) {
    return `${formatNumber(kw / 1000, 2)} МВт`;
  }
  return `${formatNumber(kw, 0)} кВт`;
}
