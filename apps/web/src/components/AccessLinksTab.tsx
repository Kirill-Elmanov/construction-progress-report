'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Pencil, Plus, ShieldOff, Trash2, X } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { fmtDateTime } from '@/lib/format';
import { getSectionMeta, GRANTABLE_SECTIONS, LINK_ROLES } from '@/lib/types';
import type { AccessLink, Employee, Project } from '@/lib/types';
import { useConfirm } from '@/components/ConfirmDialog';

const inputCls =
  'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20';

export function AccessLinksTab() {
  const token = useAuth((s) => s.token);
  const confirm = useConfirm();

  const [links, setLinks] = useState<AccessLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccessLink | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setLinks(await api<AccessLink[]>('/access-links', { token }));
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить доступы'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  function linkUrl(t: string) {
    return `${window.location.origin}/access/${t}`;
  }

  async function copy(t: string) {
    try {
      await navigator.clipboard.writeText(linkUrl(t));
      setCopied(t);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError('Не удалось скопировать — скопируйте ссылку вручную');
    }
  }

  async function revoke(l: AccessLink) {
    const ok = await confirm({
      message: l.isActive ? `Отозвать доступ у «${l.fullName ?? l.email}»?` : `Возобновить доступ?`,
      description: l.isActive
        ? 'Ссылка перестанет работать. Данные, которые специалист уже внёс, сохранятся.'
        : 'Ссылка снова станет рабочей.',
      confirmText: l.isActive ? 'Отозвать' : 'Возобновить',
      tone: l.isActive ? 'danger' : 'normal',
    });
    if (!ok) return;
    try {
      await api(`/access-links/${l.id}`, {
        method: 'PATCH', token,
        body: JSON.stringify({ isActive: !l.isActive }),
      });
      load();
    } catch (err) {
      setError(errText(err, 'Не удалось изменить доступ'));
    }
  }

  async function remove(l: AccessLink) {
    const ok = await confirm({
      message: `Удалить доступ у «${l.fullName ?? l.email ?? 'специалиста'}»?`,
      description: 'Ссылка перестанет работать без возможности восстановления. Уже внесённые данные и история изменений сохранятся.',
      confirmText: 'Удалить',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await api(`/access-links/${l.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) {
      setError(errText(err, 'Не удалось удалить доступ'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка…
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-bold text-[#28282D]">Доступы специалистов</h3>
          <p className="text-xs text-gray-400">
            Один токен; проекты и доступные для заполнения секции можно менять
          </p>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#006e33]">
          <Plus className="h-4 w-4" /> Выдать доступ
        </button>
      </div>

      {error && <div className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {links.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-16 text-center text-gray-400">
          Доступы не выданы. Нажмите «Выдать доступ», чтобы специалист смог заполнять свои секции.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Специалист</th>
                <th className="w-40 px-4 py-3">Роль</th>
                <th className="px-4 py-3">Проекты</th>
                <th className="px-4 py-3">Секции</th>
                <th className="w-40 px-4 py-3">Последний вход</th>
                <th className="w-32 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {links.map((l) => (
                <tr key={l.id} className={l.isActive ? '' : 'bg-gray-50/70 opacity-60'}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#28282D]">
                      {l.fullName ?? '— имя не указано —'}
                    </p>
                    <p className="text-xs text-gray-400">{l.email ?? '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {LINK_ROLES.find((r) => r.value === l.role)?.label ?? l.role}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {l.projects.map((project) => project.name ?? project.id).join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {l.allowedSections.map((s) => (
                        <span key={s}
                          className="rounded-md bg-[#00823C]/10 px-2 py-0.5 text-xs font-semibold text-[#00823C]">
                          {getSectionMeta(s)?.letter ?? s}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {l.lastUsedAt ? fmtDateTime(l.lastUsedAt) : 'ещё не заходил'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {l.isActive && (
                        <button onClick={() => copy(l.token)} title="Скопировать ссылку"
                          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-green-50 hover:text-[#00823C]">
                          {copied === l.token
                            ? <Check className="h-4 w-4 text-[#00823C]" />
                            : <Copy className="h-4 w-4" />}
                        </button>
                      )}
                      <button onClick={() => setEditing(l)} title="Изменить проекты и секции"
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-green-50 hover:text-[#00823C]">
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button onClick={() => revoke(l)}
                        title={l.isActive ? 'Отозвать доступ' : 'Возобновить'}
                        className={`rounded-lg p-1.5 transition ${
                          l.isActive
                            ? 'text-gray-400 hover:bg-red-50 hover:text-red-600'
                            : 'text-gray-400 hover:bg-green-50 hover:text-[#00823C]'
                        }`}>
                        {l.isActive ? <ShieldOff className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
                      </button>
                      <button onClick={() => remove(l)} title="Удалить доступ"
                        className="rounded-lg p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <CreateLinkModal
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); load(); }}
        />
      )}
      {editing && (
        <CreateLinkModal
          existing={editing}
          onClose={() => setEditing(null)}
          onCreated={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Модалка создания доступа ─────────────────────────────────
function CreateLinkModal({
  onClose, onCreated, existing,
}: {
  onClose: () => void;
  onCreated: () => void;
  existing?: AccessLink;
}) {
  const token = useAuth((s) => s.token);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [email, setEmail] = useState(existing?.email ?? '');
  const [manualName, setManualName] = useState(existing?.fullName ?? '');
  const [role, setRole] = useState(existing?.role ?? 'stroycontrol');
  const [sections, setSections] = useState<Set<string>>(new Set(existing?.allowedSections ?? []));
  const [projectIds, setProjectIds] = useState<Set<string>>(new Set(existing?.projects.map((project) => project.id) ?? []));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api<Employee[]>('/employees', { token }),
      api<Project[]>('/projects', { token }),
    ]).then(([employeeRows, projectRows]) => {
      setEmployees(employeeRows); setProjects(projectRows);
    }).catch(() => setErr('Не удалось загрузить справочник сотрудников или проекты'));
  }, [token]);

  const toggle = (key: string) =>
    setSections((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (role !== 'viewer' && sections.size === 0) {
      setErr('Выберите хотя бы одну секцию');
      return;
    }
    if (!existing && !email && !manualName.trim()) { setErr('Выберите сотрудника или введите имя'); return; }
    if (projectIds.size === 0) { setErr('Выберите хотя бы один проект'); return; }

    setSaving(true);
    setErr(null);
    try {
      if (existing) {
        await api(`/access-links/${existing.id}`, {
          method: 'PATCH', token,
          body: JSON.stringify({ allowedSections: [...sections], projectIds: [...projectIds] }),
        });
        onCreated();
      } else {
        const res = await api<AccessLink>('/access-links', {
          method: 'POST', token,
          body: JSON.stringify({
            email: email || null,
            displayName: email ? null : manualName.trim(),
            role,
            allowedSections: [...sections],
            projectIds: [...projectIds],
          }),
        });
        setCreated(`${window.location.origin}/access/${res.token}`);
      }
    } catch (e2) {
      setErr(errText(e2, 'Не удалось создать доступ'));
    } finally {
      setSaving(false);
    }
  }

  // Экран «ссылка готова»
  if (created) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
          <h3 className="mb-2 text-lg font-bold text-[#28282D]">Доступ выдан ✅</h3>
          <p className="mb-4 text-sm text-gray-500">
            Отправьте эту ссылку специалисту. Она открывает выбранные проекты,
            а редактировать можно только выбранные секции.
          </p>
          <div className="mb-4 rounded-lg bg-gray-50 p-3">
            <code className="block break-all text-xs text-[#28282D]">{created}</code>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => navigator.clipboard.writeText(created)}
              className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:border-[#00823C] hover:text-[#00823C]">
              <Copy className="h-4 w-4" /> Скопировать
            </button>
            <button onClick={onCreated}
              className="rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33]">
              Готово
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">{existing ? 'Изменить доступ специалиста' : 'Выдать доступ специалисту'}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4 p-6">
          {err && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

          {!existing && <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">
              Сотрудник <span className="text-xs font-normal text-gray-400">(из справочника)</span>
            </label>
            <select value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls}>
              <option value="">— ввести имя вручную —</option>
              {employees.map((e) => (
                <option key={e.email} value={e.email}>
                  {e.fullName}{e.position ? ` · ${e.position}` : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-400">
              ФИО берётся из Google-таблицы — при замене сотрудника правьте её, ссылку менять не нужно
            </p>
          </div>}

          {!existing && !email && (
            <div>
              <label className="mb-1 block text-sm font-medium text-[#28282D]">Имя вручную</label>
              <input value={manualName} onChange={(e) => setManualName(e.target.value)}
                placeholder="Иванов И.И." maxLength={150} className={inputCls} />
            </div>
          )}

          {!existing ? <div>
            <label className="mb-1 block text-sm font-medium text-[#28282D]">Роль</label>
            <select value={role} onChange={(e) => setRole(e.target.value)} className={inputCls}>
              {LINK_ROLES.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div> : <div className="rounded-lg bg-gray-50 p-3 text-sm"><b>{existing.fullName ?? existing.email}</b><br /><span className="text-gray-500">{LINK_ROLES.find((item) => item.value === existing.role)?.label ?? existing.role}</span></div>}

          <div>
            <label className="mb-2 block text-sm font-medium text-[#28282D]">Проекты <span className="text-red-500">*</span></label>
            <div className="space-y-2">
              {projects.map((project) => {
                const on = projectIds.has(project.id);
                return <label key={project.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 ${on ? 'border-[#00823C] bg-[#00823C]/5' : 'border-gray-200'}`}>
                  <input type="checkbox" checked={on} className="h-4 w-4 accent-[#00823C]" onChange={() => setProjectIds((current) => {
                    const next = new Set(current); on ? next.delete(project.id) : next.add(project.id); return next;
                  })} />
                  <span className="text-sm">{project.name}</span>
                </label>;
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#28282D]">
              Секции для редактирования <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2">
              {GRANTABLE_SECTIONS.map((s) => {
                const on = sections.has(s.key);
                return (
                  <label key={s.key}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2 transition ${
                      on ? 'border-[#00823C] bg-[#00823C]/5' : 'border-gray-200 hover:border-gray-300'
                    }`}>
                    <input type="checkbox" checked={on} onChange={() => toggle(s.key)}
                      className="h-4 w-4 accent-[#00823C]" />
                    <span className="text-sm font-semibold text-[#00823C]">{s.letter}</span>
                    <span className="text-sm text-[#28282D]">{s.title}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-gray-400">
              Выбрано секций: <b>{sections.size}</b>. Остальные будут доступны только для просмотра.
            </p>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {existing ? 'Сохранить' : 'Создать ссылку'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
