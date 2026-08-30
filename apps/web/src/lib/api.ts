const API_URL =
  process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const API_PREFIX = '/api/v1';

// 🔴 ЭТОТ export ОБЯЗАТЕЛЕН!
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ApiOptions extends RequestInit {
  token?: string | null;
}

// ── ПР-1.4: авто-refresh access-токена ──────────────────────
// Один общий промис, чтобы параллельные 401 не устроили шторм /auth/refresh
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch(`${API_URL}${API_PREFIX}/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // refresh лежит в httpOnly cookie
      });
      if (!res.ok) return null;
      const data = await res.json();
      const newToken: string | undefined = data?.token;
      if (!newToken) return null;

      // кладём новый токен в стор (динамический импорт — избегаем цикла)
      const { useAuth } = await import('@/stores/auth');
      useAuth.getState().setToken(newToken);
      return newToken;
    } catch {
      return null;
    } finally {
      // сбрасываем через тик, чтобы конкурентные вызовы успели переиспользовать
      setTimeout(() => { refreshPromise = null; }, 0);
    }
  })();

  return refreshPromise;
}

export async function api<T = unknown>(
  path: string,
  options: ApiOptions = {},
  _isRetry = false,
): Promise<T> {
  const { token, headers, ...rest } = options;

  const doFetch = (bearer: string | null | undefined) =>
    fetch(`${API_URL}${API_PREFIX}${path}`, {
      ...rest,
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(bearer
          ? { Authorization: `Bearer ${bearer}` }
          : typeof window !== 'undefined' && localStorage.getItem('rost_access_token')
            ? { 'X-Access-Token': localStorage.getItem('rost_access_token')! }
            : {}),
        ...options.headers,
      },
    });

  let res = await doFetch(token);

  // 401 → пробуем обновить токен и повторить запрос ОДИН раз
  if (res.status === 401 && !_isRetry && !path.startsWith('/auth/')) {
    const fresh = await refreshAccessToken();
    if (fresh) {
      res = await doFetch(fresh);
    }
  }

  if (res.status === 204) return undefined as T;

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const err = (data as any)?.error ?? {};
    throw new ApiError(
      res.status,
      err.code ?? 'UNKNOWN',
      err.message ?? 'Ошибка запроса',
      err.details,
    );
  }

  // Независимые формы сообщают панели версий об успешном сохранении.
  // Событие локальное для вкладки и не создаёт дополнительных запросов само по себе.
  if (
    typeof window !== 'undefined' &&
    rest.method && rest.method !== 'GET' &&
    path.startsWith('/reports/')
  ) {
    window.dispatchEvent(new CustomEvent('rost:data-saved'));
  }

  return data as T;
}

export async function checkHealth(): Promise<unknown> {
  const res = await fetch(`${API_URL}/health`);
  return res.json();
}

// Единый парсер текста ошибки: бэк шлёт details как {message} ИЛИ fieldErrors
export function errText(err: unknown, fallback = 'Произошла ошибка'): string {
  if (err instanceof ApiError) {
    const d = err.details as any;
    if (d && typeof d === 'object') {
      // { message: "..." } — sections.ts, progress.ts
      if (typeof d.message === 'string') return d.message;
      // zod flatten(): { formErrors: [], fieldErrors: {...} } — issues.ts, prescriptions.ts
      if (Array.isArray(d.formErrors) && d.formErrors.length) return d.formErrors[0];
      if (d.fieldErrors && typeof d.fieldErrors === 'object') {
        const first = Object.values(d.fieldErrors)[0];
        if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
      }
      // { field: ["..."] } — projects.ts
      const first = Object.values(d)[0];
      if (Array.isArray(first) && typeof first[0] === 'string') return first[0];
    }
    if (typeof d === 'string') return d;
    return err.message;
  }
  return fallback;
}

// ─── Загрузка файла (multipart) ────────────────────────────
// Content-Type НЕ ставим — браузер сам добавит boundary для FormData
export async function apiUpload<T>(
  path: string,
  file: File,
  token: string | null,
): Promise<T> {
  const fd = new FormData();
  fd.append('file', file);

  const linkToken = typeof window !== 'undefined' ? localStorage.getItem('rost_access_token') : null;
  const res = await fetch(`${API_URL}${API_PREFIX}${path}`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : linkToken ? { 'X-Access-Token': linkToken } : {}),
    },
    body: fd,
  });

    const json = await res.json().catch(() => null);
    if (!res.ok) {
      throw new ApiError(
        res.status,
        json?.error?.code ?? 'UPLOAD_ERROR',
        json?.error?.message ?? 'Ошибка загрузки файла',
        json?.error?.details,
      );
    }
    if (typeof window !== 'undefined' && path.startsWith('/reports/')) {
      window.dispatchEvent(new CustomEvent('rost:data-saved'));
    }
    return json as T;
}

// ─── Получить защищённый файл как blob: URL ────────────────
// Фото и PDF требуют авторизацию, поэтому прямой URL для них не подходит.
export async function apiBlobUrl(path: string, token: string | null): Promise<string> {
  const linkToken = typeof window !== 'undefined' ? localStorage.getItem('rost_access_token') : null;
  const requestBlob = (bearer: string | null) => fetch(`${API_URL}${API_PREFIX}${path}`, {
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : linkToken ? { 'X-Access-Token': linkToken } : {}),
      },
    });

  let res = await requestBlob(token);
  // Для руководителя один раз обновляем истёкший access-токен, как в обычных API-запросах.
  if (res.status === 401 && token) {
    const fresh = await refreshAccessToken();
    if (fresh) res = await requestBlob(fresh);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const error = (data as any)?.error ?? {};
    throw new ApiError(
      res.status,
      error.code ?? 'FETCH_ERROR',
      error.message ?? 'Не удалось загрузить файл',
      error.details,
    );
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
