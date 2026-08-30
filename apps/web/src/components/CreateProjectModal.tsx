'use client';

import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import {
  ProjectFormFields, buildProjectPayload, emptyProjectForm,
  type ProjectFormValues,
} from '@/components/ProjectForm';

export function CreateProjectModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const token = useAuth((s) => s.token);
  const user = useAuth((s) => s.user);
  const [form, setForm] = useState<ProjectFormValues>(emptyProjectForm);
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const upd = <K extends keyof ProjectFormValues>(key: K, val: ProjectFormValues[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setGeneral(null);
    setLoading(true);
    try {
      await api('/projects', {
        method: 'POST', token,
        body: JSON.stringify(buildProjectPayload(form, user?.role === 'superadmin')),
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 400 && err.details) setErrors(err.details as Record<string, string[]>);
        else setGeneral(err.message);
      } else setGeneral('Не удалось создать проект');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
          <h3 className="text-lg font-bold text-[#28282D]">Новый проект</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 p-6">
          {general && (
            <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{general}</div>
          )}

          <ProjectFormFields form={form} upd={upd} errors={errors} showIntegrations={user?.role === 'superadmin'} />

          <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
            <button type="button" onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-100">
              Отмена
            </button>
            <button type="submit" disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-[#00823C] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#006e33] disabled:opacity-60">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Создание…' : 'Создать'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
