'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import type { WhoAmI } from '@/lib/types';
import { normalizeSectionKey, type SectionKey } from '@rost/shared/types';

/** ПР-1.5: контекст специалиста, вошедшего по ссылке */
interface AccessState {
  who: WhoAmI | null;
  checked: boolean;
  check: () => Promise<void>;
  canEdit: (sectionKey: SectionKey, projectId: string) => boolean;
  clear: () => void;
}

export const useAccess = create<AccessState>((set, get) => ({
  who: null,
  checked: false,

  check: async () => {
    if (typeof window === 'undefined') return;
    const t = localStorage.getItem('rost_access_token');
    if (!t) { set({ checked: true }); return; }
    try {
      const who = await api<WhoAmI>('/access-links/whoami', {});
      set({ who, checked: true });
    } catch {
      localStorage.removeItem('rost_access_token');
      set({ who: null, checked: true });
    }
  },

  /** Может ли текущий актор редактировать секцию */
  canEdit: (sectionKey: SectionKey, projectId: string) => {
    const w = get().who;
    if (!w) return true;              // вход по паролю — всё можно
    if (w.kind === 'user') return true;
    const grant = w.projects.find((item) => item.projectId === projectId);
    return (grant?.allowedSections ?? []).some(
      (savedKey) => normalizeSectionKey(savedKey) === sectionKey,
    );
  },

  clear: () => {
    if (typeof window !== 'undefined') localStorage.removeItem('rost_access_token');
    set({ who: null, checked: true });
  },
}));
