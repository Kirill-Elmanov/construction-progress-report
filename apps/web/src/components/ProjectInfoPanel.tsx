'use client';

import { Building2, CalendarRange, FileCheck2, Ruler, Users, Wallet } from 'lucide-react';
import { fmtDate, fmtMoney, fmtNum } from '@/lib/format';
import type { Project } from '@/lib/types';

function Block({
  icon: Icon, title, children, wide = false,
}: {
  icon: React.ElementType; title: string;
  children: React.ReactNode; wide?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-gray-200 bg-white p-4 ${wide ? 'md:col-span-2' : ''}`}>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#00823C]">
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <div className="space-y-1 text-sm text-[#28282D]">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <p className="flex flex-wrap gap-x-1.5">
      <span className="text-gray-500">{label}:</span>
      <span className="font-medium">{value?.trim() || '—'}</span>
    </p>
  );
}

/** ПР-2.2: панель «Информация об объекте» — 6 смысловых блоков */
export function ProjectInfoPanel({ project: p }: { project: Project }) {
  const tc = p.technicalConditions ?? [];

  return (
    <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
      {/* Блок 1 */}
      <Block icon={Building2} title="Наименование объекта">
        <p className="font-medium leading-snug">«{p.name}»</p>
        {p.projectStage && (
          <p className="mt-1 inline-block rounded-full bg-[#00823C]/10 px-2.5 py-0.5 text-xs font-medium text-[#00823C]">
            Стадия: {p.projectStage}
          </p>
        )}
      </Block>

      {/* Блок 2 */}
      <Block icon={Ruler} title="Адрес объекта">
        <p className="leading-snug">{p.address}</p>
      </Block>

      {/* Блок 3 */}
      <Block icon={Ruler} title="Основные технико-экономические показатели">
        <Row label="Площадь земельного участка"
          value={p.tepArea != null ? `${fmtNum(p.tepArea)} м²` : null} />
        <Row label="Площадь возводимых объектов"
          value={p.tepPower ? `${p.tepPower} м²` : null} />
        <div className="pt-1">
          <p className="text-gray-500">Полученные технические условия:</p>
          {tc.length === 0 ? (
            <p className="text-gray-400">—</p>
          ) : (
            <ul className="mt-0.5 space-y-0.5">
              {tc.map((t, i) => (
                <li key={i}>• <span className="text-gray-500">{t.kind}:</span>{' '}
                  <span className="font-medium">{t.org}</span></li>
              ))}
            </ul>
          )}
        </div>
      </Block>

      {/* Блок 4 */}
      <Block icon={Users} title="Информация об участниках">
        <Row label="Заказчик" value={p.customer} />
        <Row label="Технический заказчик" value={p.techCustomer} />
        <Row label="Генеральный проектировщик" value={p.generalDesigner} />
        <Row label="Генеральный подрядчик" value={p.contractor} />
      </Block>

      {/* Блок 5 */}
      <Block icon={FileCheck2} title="Экспертиза и разрешения">
        <Row label="Положительное заключение экспертизы" value={p.expertiseConclusion} />
        <Row label="Разрешение на строительство" value={p.buildPermit} />
      </Block>

      {/* Блок 6 */}
      <Block icon={CalendarRange} title="Срок реализации и бюджет">
        <p className="text-base font-semibold">
          {fmtDate(p.planStart)} г. — {fmtDate(p.planFinish)} г.
        </p>
        <p className="flex items-center gap-1.5 pt-1">
          <Wallet className="h-4 w-4 text-gray-400" />
          <span className="text-gray-500">Бюджет:</span>
          <span className="font-semibold text-[#00823C]">{fmtMoney(p.budget)}</span>
        </p>
      </Block>
    </div>
  );
}