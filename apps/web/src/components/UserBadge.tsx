'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/stores/auth';
import { useAccess } from '@/stores/access';
import { LINK_ROLES, ROLE_LABELS } from '@/lib/types';

/** ПР-1.3: сверху ФИО, снизу роль. */
export function UserBadge() {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const accessWho = useAccess((s) => s.who);
  const clearAccess = useAccess((s) => s.clear);

  if (!user && !accessWho) return null;

  const name = user
    ? user.fullName || user.displayName || user.email
    : accessWho!.name;
  const roleLabel = user
    ? ROLE_LABELS[user.role]
    : LINK_ROLES.find((role) => role.value === accessWho!.role)?.label ?? accessWho!.role;
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#00823C] text-sm font-semibold text-white">
        {initials || '—'}
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-[#28282D]">{name}</p>
        <p className="text-xs text-gray-500">{roleLabel}</p>
      </div>
      <button
        onClick={() => {
          logout();
          clearAccess();
          router.replace('/login');
        }}
        title="Выйти"
        className="ml-1 rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-red-600"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );
}
