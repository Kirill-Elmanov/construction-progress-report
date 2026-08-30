'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Copy, Loader2, Pencil, Power, PowerOff, Trash2, UserPlus, X } from 'lucide-react';
import { api, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { AuthGuard } from '@/components/AuthGuard';
import { ROLE_LABELS, type Project, type RoleType } from '@/lib/types';
import { useConfirm } from '@/components/ConfirmDialog';

const roles: RoleType[] = ['pzgd', 'head_of_projects', 'gip', 'gip_deputy', 'coordinator', 'stroycontrol'];
const globalRoles = new Set<RoleType>(['pzgd', 'head_of_projects']);

interface ManagedUser {
  id: string; email: string; displayName: string; role: RoleType;
  activated: boolean; isActive: boolean; projects: Array<{ id: string; name: string }>;
}

interface DirectoryPerson {
  id: string; displayName: string; email: string; role: RoleType;
}

interface DirectoryResponse {
  configured: boolean;
  people: DirectoryPerson[];
  warning?: string;
}

function UsersContent() {
  const router = useRouter();
  const token = useAuth((state) => state.token);
  const current = useAuth((state) => state.user);
  const confirm = useConfirm();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<RoleType>('gip');
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [activationLink, setActivationLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [directoryConfigured, setDirectoryConfigured] = useState(false);
  const [directoryPeople, setDirectoryPeople] = useState<DirectoryPerson[]>([]);
  const [directoryPersonId, setDirectoryPersonId] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryWarning, setDirectoryWarning] = useState<string | null>(null);

  async function load() {
    try {
      const [userRows, projectRows] = await Promise.all([
        api<ManagedUser[]>('/users', { token }), api<Project[]>('/projects', { token }),
      ]);
      setUsers(userRows); setProjects(projectRows);
    } catch (err) { setError(errText(err, 'Не удалось загрузить пользователей')); }
  }
  useEffect(() => { if (current?.role === 'superadmin') void load(); }, [current?.role]);

  // Правки v5: роль фильтрует Google-справочник. Единственный кандидат
  // выбирается автоматически, при нескольких руководителя выбирает админ.
  useEffect(() => {
    if (current?.role !== 'superadmin') return;
    let active = true;
    setDirectoryLoading(true);
    setDirectoryWarning(null);
    api<DirectoryResponse>(`/users/directory?role=${role}`, { token })
      .then((result) => {
        if (!active) return;
        setDirectoryConfigured(result.configured);
        setDirectoryPeople(result.people);
        setDirectoryWarning(result.warning ?? null);
        if (result.people.length === 1) {
          const person = result.people[0];
          setDirectoryPersonId(person.id);
          setDisplayName(person.displayName);
          setEmail(person.email);
        } else {
          setDirectoryPersonId('');
        }
      })
      .catch((err) => {
        if (active) setDirectoryWarning(errText(err, 'Не удалось загрузить Google-справочник'));
      })
      .finally(() => { if (active) setDirectoryLoading(false); });
    return () => { active = false; };
  }, [current?.role, role, token]);

  function chooseDirectoryPerson(personId: string) {
    setDirectoryPersonId(personId);
    const person = directoryPeople.find((item) => item.id === personId);
    if (person) {
      setDisplayName(person.displayName);
      setEmail(person.email);
    }
  }

  async function invite(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setActivationLink(null);
    try {
      const result = await api<{ activationPath: string }>('/users/invitations', {
        method: 'POST', token,
        body: JSON.stringify({ email, displayName, role, projectIds: globalRoles.has(role) ? [] : projectIds }),
      });
      setActivationLink(`${window.location.origin}${result.activationPath}`);
      setEmail(''); setDisplayName(''); setDirectoryPersonId(''); setProjectIds([]); await load();
    } catch (err) { setError(errText(err, 'Не удалось создать приглашение')); }
    finally { setBusy(false); }
  }

  async function toggleUser(user: ManagedUser) {
    if (user.id === current?.id) return;
    const nextActive = !user.isActive;
    const ok = await confirm({
      message: nextActive ? `Активировать «${user.displayName}»?` : `Деактивировать «${user.displayName}»?`,
      description: nextActive
        ? 'Пользователь снова сможет входить по логину и паролю.'
        : 'Пользователь больше не сможет войти, но его данные и история сохранятся.',
      confirmText: nextActive ? 'Активировать' : 'Деактивировать',
      tone: nextActive ? 'normal' : 'danger',
    });
    if (!ok) return;
    setBusyUserId(user.id); setError(null);
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH', token, body: JSON.stringify({ isActive: nextActive }),
      });
      await load();
    } catch (err) { setError(errText(err, 'Не удалось изменить статус пользователя')); }
    finally { setBusyUserId(null); }
  }

  async function removeUser(user: ManagedUser) {
    const ok = await confirm({
      message: `Удалить учётную запись «${user.displayName}»?`,
      description: 'Назначения на проекты будут удалены. Выпущенные отчёты и история действий сохранятся.',
      confirmText: 'Удалить', tone: 'danger',
    });
    if (!ok) return;
    setBusyUserId(user.id); setError(null);
    try {
      await api(`/users/${user.id}`, { method: 'DELETE', token });
      await load();
    } catch (err) { setError(errText(err, 'Не удалось удалить пользователя')); }
    finally { setBusyUserId(null); }
  }

  if (current?.role !== 'superadmin') return <div className="p-10 text-center text-red-600">Доступно только суперадмину</div>;

  return (
    <main className="min-h-screen bg-[#F2FAE3] px-6 py-8">
      <div className="mx-auto max-w-5xl">
        <button onClick={() => router.push('/projects')} className="mb-4 flex items-center gap-1 text-sm text-gray-500"><ArrowLeft className="h-4 w-4" /> К проектам</button>
        <h1 className="mb-6 text-2xl font-bold text-[#28282D]">Руководители и учётные записи</h1>
        {error && <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <form onSubmit={invite} className="mb-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 font-bold"><UserPlus className="h-5 w-5" /> Пригласить руководителя</h2>
          <div className={`grid gap-3 ${directoryConfigured ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
            <select value={role} onChange={(e) => {
              setRole(e.target.value as RoleType); setProjectIds([]);
              setDirectoryPersonId(''); setDisplayName(''); setEmail('');
            }} className="rounded-lg border px-3 py-2">
              {roles.map((item) => <option key={item} value={item}>{ROLE_LABELS[item]}</option>)}
            </select>
            {directoryConfigured && (
              <select value={directoryPersonId} disabled={directoryLoading || directoryPeople.length === 0}
                required={directoryPeople.length > 0}
                onChange={(event) => chooseDirectoryPerson(event.target.value)}
                className="rounded-lg border px-3 py-2 disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">
                  {directoryLoading ? 'Загрузка справочника…' : directoryPeople.length ? 'Выберите сотрудника' : 'Для роли никого нет'}
                </option>
                {directoryPeople.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
              </select>
            )}
            <input required value={displayName} readOnly={Boolean(directoryPersonId)}
              onChange={(e) => setDisplayName(e.target.value)} placeholder="ФИО"
              className="rounded-lg border px-3 py-2 read-only:bg-gray-50" />
            <input required type="email" value={email} readOnly={Boolean(directoryPersonId)}
              onChange={(e) => setEmail(e.target.value)} placeholder="Email"
              className="rounded-lg border px-3 py-2 read-only:bg-gray-50" />
          </div>
          {directoryWarning && <p className="mt-2 text-xs text-amber-700">Google-справочник: {directoryWarning}. Доступен ручной ввод.</p>}
          {!globalRoles.has(role) && <div className="mt-3 flex flex-wrap gap-2">
            {projects.map((project) => <label key={project.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
              <input type="checkbox" checked={projectIds.includes(project.id)} onChange={(e) => setProjectIds((ids) => e.target.checked ? [...ids, project.id] : ids.filter((id) => id !== project.id))} /> {project.name}
            </label>)}
          </div>}
          <button disabled={busy} className="mt-4 flex items-center gap-2 rounded-lg bg-[#00823C] px-4 py-2 text-white disabled:opacity-60">{busy && <Loader2 className="h-4 w-4 animate-spin" />} Создать ссылку</button>
        </form>

        {activationLink && <div className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm">
          <p className="mb-2 font-medium text-[#00823C]">Одноразовая ссылка создана на 72 часа:</p>
          <div className="flex gap-2"><input readOnly value={activationLink} className="min-w-0 flex-1 rounded border bg-white px-3 py-2" /><button onClick={() => navigator.clipboard.writeText(activationLink)} className="rounded-lg border bg-white px-3"><Copy className="h-4 w-4" /></button></div>
        </div>}

        <div className="overflow-hidden rounded-2xl border bg-white">
          {users.map((user) => <div key={user.id} className={`flex flex-wrap justify-between gap-3 border-b px-4 py-3 last:border-0 ${user.isActive ? '' : 'bg-gray-50 opacity-70'}`}>
            <div><p className="font-medium">{user.displayName}</p><p className="text-xs text-gray-500">{user.email} · {ROLE_LABELS[user.role]}</p></div>
            <div className="ml-auto text-right text-xs">
              <p className={!user.isActive ? 'text-red-600' : user.activated ? 'text-[#00823C]' : 'text-amber-600'}>
                {!user.isActive ? 'Деактивирован' : user.activated ? 'Активирован' : 'Ожидает активации'}
              </p>
              <p className="text-gray-400">{user.projects.map((p) => p.name).join(', ') || 'Все проекты'}</p>
            </div>
            <div className="flex items-center gap-1">
              {busyUserId === user.id ? <Loader2 className="h-4 w-4 animate-spin text-gray-400" /> : <>
                {!globalRoles.has(user.role) && (
                  <button onClick={() => setEditingUser(user)} title="Изменить проекты"
                    className="rounded-lg p-2 text-gray-400 hover:bg-green-50 hover:text-[#00823C]">
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                {user.id !== current?.id && (
                  <button onClick={() => toggleUser(user)} title={user.isActive ? 'Деактивировать' : 'Активировать'}
                    className={`rounded-lg p-2 ${user.isActive ? 'text-gray-400 hover:bg-red-50 hover:text-red-600' : 'text-gray-400 hover:bg-green-50 hover:text-[#00823C]'}`}>
                    {user.isActive ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />}
                  </button>
                )}
                {!user.isActive && user.id !== current?.id && (
                  <button onClick={() => removeUser(user)} title="Удалить учётную запись"
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </>}
            </div>
          </div>)}
        </div>

        {editingUser && (
          <UserProjectsModal
            user={editingUser}
            projects={projects}
            token={token}
            onClose={() => setEditingUser(null)}
            onSaved={async () => { setEditingUser(null); await load(); }}
          />
        )}
      </div>
    </main>
  );
}

/** Правки v6: назначения руководителя меняются без удаления учётной записи. */
function UserProjectsModal({ user, projects, token, onClose, onSaved }: {
  user: ManagedUser;
  projects: Project[];
  token: string | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(() => new Set(user.projects.map((project) => project.id)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (selected.size === 0) { setError('Выберите хотя бы один проект'); return; }
    setSaving(true); setError(null);
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH', token,
        body: JSON.stringify({ projectIds: [...selected] }),
      });
      await onSaved();
    } catch (saveError) {
      setError(errText(saveError, 'Не удалось изменить проекты'));
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div><h3 className="font-bold">Проекты руководителя</h3><p className="text-sm text-gray-500">{user.displayName}</p></div>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-6">
          {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
          {projects.map((project) => {
            const checked = selected.has(project.id);
            return <label key={project.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-3 ${checked ? 'border-[#00823C] bg-green-50' : 'border-gray-200'}`}>
              <input type="checkbox" checked={checked} className="h-4 w-4 accent-[#00823C]"
                onChange={() => setSelected((current) => {
                  const next = new Set(current); checked ? next.delete(project.id) : next.add(project.id); return next;
                })} />
              <span className="text-sm">{project.name}</span>
            </label>;
          })}
        </div>
        <div className="flex justify-end gap-3 border-t px-6 py-4">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-gray-600">Отмена</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm text-white disabled:opacity-60">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsersPage() { return <AuthGuard><UsersContent /></AuthGuard>; }
