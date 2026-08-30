import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { RoleType, AccessScope } from '@/lib/types';

// В сторе храним то, что стабильно приходит и с login, и с /me
interface StoredUser {
  id: string;
  email: string;
  role: RoleType;
  displayName: string;
  fullName?: string;      // 🆕 ПР-1.3: ФИО из Google-справочника
  mustChangePassword: boolean;
  accessScope?: AccessScope;
  tenantId?: string;
  projectIds?: string[];
}

interface AuthState {
  token: string | null;
  user: StoredUser | null;
  setAuth: (token: string, user: StoredUser) => void;
  setToken: (token: string) => void;
  patchUser: (patch: Partial<StoredUser>) => void;
  logout: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setToken: (token) => set({ token }),
      patchUser: (patch) =>
        set((s) => ({ user: s.user ? { ...s.user, ...patch } : s.user })),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'rost-auth' },
  ),
);