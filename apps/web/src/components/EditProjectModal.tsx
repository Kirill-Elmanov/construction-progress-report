'use client';

import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api, ApiError, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import {
  ProjectFormFields, buildProjectPayload, projectToForm,
  type ProjectFormValues,
} from '@/components/ProjectForm';
import type { Project } from '@/lib/types';

export function EditProjectModal({
  project, onClose, onSaved,
}: {
  project: Project;
  onClose: () => void;
  onSaved: () => void;
}) {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const [form, setForm] = useState<ProjectFormValues>(projectToForm(project));
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const upd = <K extends keyof ProjectFormValues>(key: K, val: ProjectFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setErrors({});
    setSaving(true);
    try {
      await api(`/projects/${project.id}`, {
        method: 'PATCH', token,
        body: JSON.stringify(buildProjectPayload(form, user?.role === 'superadmin')),
      });
      onSaved();
    } catch (e2) {
      if (e2 instanceof ApiError && e2.status === 400 && e2.details) {
        setErrors(e2.details as Record<string, string[]>);
      }
      setErr(errText(e2, 'Не удалось сохранить изменения'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">Редактировать проект</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-6 p-6">
          {err && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{err}</div>}

          <ProjectFormFields form={form} upd={upd} errors={errors} showIntegrations={user?.role === 'superadmin'} />

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">
              Отмена
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white hover:bg-[#006e33] disabled:opacity-60">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
