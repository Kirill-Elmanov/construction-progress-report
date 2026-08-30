'use client';

/** ПР-4.2: отклонение + светофор одним компактным бейджем */
export function DeviationBadge({
  days, light, pending,
}: {
  days: number | null;
  light: 'green' | 'yellow' | 'red' | null;
  pending: boolean;
}) {
  if (days === null) {
    return <span className="text-xs text-gray-300">—</span>;
  }

  const cls =
    light === 'red' ? 'bg-red-50 text-red-700 border-red-200'
    : light === 'yellow' ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-green-50 text-[#00823C] border-green-200';

  const emoji = light === 'red' ? '🔴' : light === 'yellow' ? '🟡' : '🟢';
  const sign = days > 0 ? '+' : '';

  return (
    <span
      title={pending ? 'Факт не внесён — показана текущая просрочка' : 'Отклонение факта от плана'}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {emoji} {sign}{days} дн{pending && <span className="opacity-60">*</span>}
    </span>
  );
}