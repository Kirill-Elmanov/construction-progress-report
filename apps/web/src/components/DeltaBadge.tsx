'use client';

import { TrendingDown, TrendingUp } from 'lucide-react';

/** Δ за неделю — единый вид для секций Б, В, Е, З */
export function DeltaBadge({
  value, suffix = '', format,
}: {
  value: number;
  suffix?: string;
  format?: (v: number) => string;
}) {
  if (!value) return <span className="text-xs text-gray-400">без изменений</span>;
  const up = value > 0;
  const shown = format ? format(Math.abs(value)) : String(Math.abs(value));
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${up ? 'text-[#00823C]' : 'text-red-600'}`}>
      {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {up ? '+' : '−'}{shown}{suffix} за неделю
    </span>
  );
}