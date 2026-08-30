'use client';

import { Plus, Trash2 } from 'lucide-react';
import { maskNumberInput, unmaskNumber, toInputDate } from '@/lib/format';
import { PROJECT_STAGES } from '@/lib/types';
import type { Project, TechCondition } from '@/lib/types';

export const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-[#28282D] outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20';

export interface ProjectFormValues {
  name: string;
  address: string;
  customer: string;
  techCustomer: string;
  generalDesigner: string;
  contractor: string;
  expertiseConclusion: string;
  buildPermit: string;
  projectStage: string;
  planStart: string;
  planFinish: string;
  budget: string;    // маскированное «10 086 000 000»
  tepArea: string;   // Площадь ЗУ
  tepPower: string;  // Площадь возводимых объектов
  technicalConditions: TechCondition[];
  rdSheetUrl: string;
  planrEpsId: string;
  planrTargetStartAttr: string;
  planrTargetFinishAttr: string;
  scheduleReportMode: 'manual' | 's_curve';
}

export const emptyProjectForm: ProjectFormValues = {
  name: '', address: '', customer: '', techCustomer: '', generalDesigner: '',
  contractor: '', expertiseConclusion: '', buildPermit: '', projectStage: '',
  planStart: '', planFinish: '', budget: '', tepArea: '', tepPower: '',
  technicalConditions: [],
  rdSheetUrl: '', planrEpsId: '', planrTargetStartAttr: '', planrTargetFinishAttr: '',
  scheduleReportMode: 'manual',
};

export function projectToForm(p: Project): ProjectFormValues {
  return {
    name: p.name,
    address: p.address,
    customer: p.customer,
    techCustomer: p.techCustomer ?? '',
    generalDesigner: p.generalDesigner ?? '',
    contractor: p.contractor,
    expertiseConclusion: p.expertiseConclusion ?? '',
    buildPermit: p.buildPermit ?? '',
    projectStage: p.projectStage ?? '',
    planStart: toInputDate(p.planStart),
    planFinish: toInputDate(p.planFinish),
    budget: maskNumberInput(String(p.budget ?? '')),
    tepArea: p.tepArea != null ? maskNumberInput(String(p.tepArea)) : '',
    tepPower: p.tepPower ?? '',
    technicalConditions: p.technicalConditions ?? [],
    rdSheetUrl: p.rdSheetUrl ?? '',
    planrEpsId: p.planrEpsId ?? '',
    planrTargetStartAttr: p.planrAttrMap?.targetStart ?? '',
    planrTargetFinishAttr: p.planrAttrMap?.targetFinish ?? '',
    scheduleReportMode: p.scheduleReportMode ?? 'manual',
  };
}

export function buildProjectPayload(f: ProjectFormValues, includeIntegrations = false) {
  return {
    name: f.name.trim(),
    address: f.address.trim(),
    customer: f.customer.trim(),
    techCustomer: f.techCustomer.trim(),
    generalDesigner: f.generalDesigner.trim(),
    contractor: f.contractor.trim(),
    expertiseConclusion: f.expertiseConclusion.trim() || null,
    buildPermit: f.buildPermit.trim() || null,
    projectStage: f.projectStage || null,
    planStart: f.planStart,
    planFinish: f.planFinish,
    budget: unmaskNumber(f.budget) ?? 0,
    tepArea: unmaskNumber(f.tepArea),
    tepPower: f.tepPower.trim() || null,
    technicalConditions: f.technicalConditions
      .filter((t) => t.kind.trim() && t.org.trim())
      .map((t) => ({ kind: t.kind.trim(), org: t.org.trim() })),
    ...(includeIntegrations ? {
      rdSheetUrl: f.rdSheetUrl.trim() || null,
      planrEpsId: f.planrEpsId.trim() || null,
      planrAttrMap: f.planrEpsId.trim() ? {
        ...(f.planrTargetStartAttr.trim() && { targetStart: f.planrTargetStartAttr.trim() }),
        ...(f.planrTargetFinishAttr.trim() && { targetFinish: f.planrTargetFinishAttr.trim() }),
      } : null,
      scheduleReportMode: f.scheduleReportMode,
    } : {}),
  };
}

function Field({
  label, value, onChange, type = 'text', required = false, placeholder = '', error, hint,
}: {
  label: string; value: string; onChange: (v: string) => void;
  type?: string; required?: boolean; placeholder?: string;
  error?: string[]; hint?: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-[#28282D]">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input type={type} value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} className={inputCls} />
      {hint && !error && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error[0]}</p>}
    </div>
  );
}

/** Числовое поле с разрядами (ПР-2.5) */
function NumField(props: Omit<Parameters<typeof Field>[0], 'type'> & { unit?: string }) {
  const { unit, onChange, ...rest } = props;
  return (
    <Field {...rest}
      onChange={(v) => onChange(maskNumberInput(v))}
      hint={props.hint ?? (unit ? `в ${unit}` : undefined)} />
  );
}

export function ProjectFormFields({
  form, upd, errors = {}, showIntegrations = false,
}: {
  form: ProjectFormValues;
  upd: <K extends keyof ProjectFormValues>(key: K, val: ProjectFormValues[K]) => void;
  errors?: Record<string, string[]>;
  showIntegrations?: boolean;
}) {
  const tc = form.technicalConditions;

  return (
    <div className="space-y-6">
      {/* ── Блок 1: объект и стадия ── */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-bold uppercase tracking-wide text-[#00823C]">
          Объект
        </legend>
        <Field label="Наименование объекта" required value={form.name}
          onChange={(v) => upd('name', v)} error={errors.name}
          placeholder="Строительство производственного комплекса…" />
        <Field label="Адрес объекта" required value={form.address}
          onChange={(v) => upd('address', v)} error={errors.address}
          placeholder="г. Примерск, Промышленная улица, 1" />
        <div>
          <label className="mb-1 block text-sm font-medium text-[#28282D]">Стадия проекта</label>
          <select value={form.projectStage} onChange={(e) => upd('projectStage', e.target.value)}
            className={inputCls}>
            <option value="">— не выбрана —</option>
            {PROJECT_STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </fieldset>

      {/* ── Блок 4: участники ── */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-bold uppercase tracking-wide text-[#00823C]">
          Участники
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Заказчик" required value={form.customer}
            onChange={(v) => upd('customer', v)} error={errors.customer} />
          <Field label="Технический заказчик" required value={form.techCustomer}
            onChange={(v) => upd('techCustomer', v)} error={errors.techCustomer}
            placeholder="ООО «Технический заказчик»" />
          <Field label="Генеральный проектировщик" required value={form.generalDesigner}
            onChange={(v) => upd('generalDesigner', v)} error={errors.generalDesigner}
            placeholder="ООО «Проектный институт»" />
          <Field label="Генеральный подрядчик" required value={form.contractor}
            onChange={(v) => upd('contractor', v)} error={errors.contractor} />
        </div>
      </fieldset>

      {/* ── Блок 6: сроки и бюджет ── */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-bold uppercase tracking-wide text-[#00823C]">
          Сроки и бюджет
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Срок реализации: начало" type="date" required value={form.planStart}
            onChange={(v) => upd('planStart', v)} error={errors.planStart} />
          <Field label="Срок реализации: окончание" type="date" required value={form.planFinish}
            onChange={(v) => upd('planFinish', v)} error={errors.planFinish} />
        </div>
        <NumField label="Бюджет, ₽" required value={form.budget}
          onChange={(v) => upd('budget', v)} error={errors.budget}
          placeholder="1 000 000 000" />
      </fieldset>

      {/* ── Блок 3: ТЭП ── */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-bold uppercase tracking-wide text-[#00823C]">
          Технико-экономические показатели
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumField label="Площадь ЗУ, м²" value={form.tepArea}
            onChange={(v) => upd('tepArea', v)} error={errors.tepArea}
            placeholder="100 000" />
          <Field label="Площадь возводимых объектов, м²" value={form.tepPower}
            onChange={(v) => upd('tepPower', v)} error={errors.tepPower}
            placeholder="50 000" />
        </div>

        {/* ПР-2.4: технические условия */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-[#28282D]">
              Полученные технические условия
            </label>
            <button type="button"
              onClick={() => upd('technicalConditions', [...tc, { kind: '', org: '' }])}
              className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C]">
              <Plus className="h-3.5 w-3.5" /> Добавить ТУ
            </button>
          </div>

          {tc.length === 0 ? (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-400">
              Не заполнено (необязательный блок)
            </p>
          ) : (
            <div className="space-y-2">
              {tc.map((t, i) => (
                <div key={i} className="flex gap-2">
                  <input value={t.kind} placeholder="Канализация"
                    onChange={(e) => {
                      const next = [...tc];
                      next[i] = { ...next[i], kind: e.target.value };
                      upd('technicalConditions', next);
                    }}
                    className={`${inputCls} sm:max-w-[40%]`} />
                  <input value={t.org} placeholder="ООО «Ресурсоснабжающая организация»"
                    onChange={(e) => {
                      const next = [...tc];
                      next[i] = { ...next[i], org: e.target.value };
                      upd('technicalConditions', next);
                    }}
                    className={inputCls} />
                  <button type="button"
                    onClick={() => upd('technicalConditions', tc.filter((_, idx) => idx !== i))}
                    className="shrink-0 rounded-lg p-2 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      {/* ── Блок 5: экспертиза и разрешения ── */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-bold uppercase tracking-wide text-[#00823C]">
          Экспертиза и разрешения
        </legend>
        <Field label="Положительное заключение экспертизы" value={form.expertiseConclusion}
          onChange={(v) => upd('expertiseConclusion', v)} error={errors.expertiseConclusion}
          placeholder="№ 00-0-0-0-000000-2026 от 01.01.2026" />
        <Field label="Разрешение на строительство" value={form.buildPermit}
          onChange={(v) => upd('buildPermit', v)} error={errors.buildPermit}
          placeholder="№ 00-000000-00/00000000 от 01.01.2026" />
      </fieldset>

      {showIntegrations && (
        <fieldset className="space-y-4 rounded-xl border border-[#00823C]/20 bg-[#F5FAED] p-4">
          <legend className="px-2 text-sm font-bold uppercase tracking-wide text-[#00823C]">
            Автоматизация проекта · только суперадмин
          </legend>
          <Field label="Google-таблица реестра РД" value={form.rdSheetUrl}
            onChange={(v) => upd('rdSheetUrl', v)} error={errors.rdSheetUrl}
            placeholder="https://docs.google.com/spreadsheets/d/…/edit" />
          <Field label="EPS ID актуальной версии графика PLAN-R" value={form.planrEpsId}
            onChange={(v) => upd('planrEpsId', v)} error={errors.planrEpsId}
            placeholder="2da5c71e-dd0e-496e-8086-62423ac1b5ad" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="UUID атрибута «Целевой старт»" value={form.planrTargetStartAttr}
              onChange={(v) => upd('planrTargetStartAttr', v)} error={errors.planrAttrMap} />
            <Field label="UUID атрибута «Целевой финиш»" value={form.planrTargetFinishAttr}
              onChange={(v) => upd('planrTargetFinishAttr', v)} error={errors.planrAttrMap} />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-[#28282D]">Секция Д в отчёте</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 bg-white p-3">
                <input type="radio" checked={form.scheduleReportMode === 'manual'}
                  onChange={() => upd('scheduleReportMode', 'manual')} />
                <span><b className="block text-sm">Ручная таблица</b><span className="text-xs text-gray-500">Резервный вариант, заполняется КСП вручную</span></span>
              </label>
              <label className="flex cursor-pointer gap-3 rounded-lg border border-gray-200 bg-white p-3">
                <input type="radio" checked={form.scheduleReportMode === 's_curve'}
                  onChange={() => upd('scheduleReportMode', 's_curve')} />
                <span><b className="block text-sm">S-кривая PLAN-R</b><span className="text-xs text-gray-500">План, факт и прогноз с декомпозицией</span></span>
              </label>
            </div>
          </div>
        </fieldset>
      )}
    </div>
  );
}
