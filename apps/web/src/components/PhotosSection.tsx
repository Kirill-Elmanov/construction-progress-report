'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ChevronLeft, ChevronRight, Loader2, Maximize2, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api, apiUpload, errText } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { PHOTO_MAX_PER_REPORT, PHOTO_MAX_SIZE_MB } from '@/lib/types';
import type { PhotoItem, Section } from '@/lib/types';
import { PhotoThumb } from '@/components/PhotoThumb';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import { useConfirm } from '@/components/ConfirmDialog';

const cell =
  'w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm outline-none transition focus:border-[#00823C] focus:ring-2 focus:ring-[#00823C]/20 disabled:bg-gray-50 disabled:text-gray-400';

export function PhotosSection({
  reportId, projectId, readOnly,
}: {
  reportId: string;
  projectId: string;
  readOnly: boolean;
}) {
  const token = useAuth((s) => s.token);
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceTarget, setReplaceTarget] = useState<PhotoItem | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s] = await Promise.all([
        api<{ items: PhotoItem[] }>(`/reports/${reportId}/photos`, { token }),
        api<Section[]>(`/projects/${projectId}/sections`, { token }),
      ]);
      setPhotos(p.items);
      setSections(s);
    } catch (err) {
      setError(errText(err, 'Не удалось загрузить фотоотчёт'));
    } finally {
      setLoading(false);
    }
  }, [reportId, projectId, token]);

  useEffect(() => { load(); }, [load]);

  async function uploadFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    const free = PHOTO_MAX_PER_REPORT - photos.length;
    if (free <= 0) {
      setError(`Максимум ${PHOTO_MAX_PER_REPORT} фото на отчёт`);
      return;
    }
    const batch = arr.slice(0, free);
    if (arr.length > free) {
      setError(`Загружено будет только ${free} фото — лимит ${PHOTO_MAX_PER_REPORT} на отчёт`);
    } else {
      setError(null);
    }

    setUploading(batch.length);
    for (const f of batch) {
      if (f.size > PHOTO_MAX_SIZE_MB * 1024 * 1024) {
        setError(`«${f.name}» больше ${PHOTO_MAX_SIZE_MB} МБ — пропущен`);
        setUploading((n) => n - 1);
        continue;
      }
      try {
        await apiUpload<{ data: PhotoItem }>(`/reports/${reportId}/photos`, f, token);
      } catch (err) {
        setError(errText(err, `Не удалось загрузить «${f.name}»`));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    load();
  }

  // Автосохранение подписи/раздела/даты (И2/И3/И4)
  async function patchPhoto(id: string, patch: Partial<Pick<PhotoItem, 'caption' | 'sectionId' | 'shotDate'>>) {
    setPhotos((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    try {
      await api(`/photos/${id}`, { method: 'PATCH', token, body: JSON.stringify(patch) });
    } catch (err) {
      setError(errText(err, 'Не удалось сохранить данные фото'));
    }
  }

  async function removePhoto(id: string) {
    const ok = await confirm({ message: 'Удалить фото?', confirmText: 'Удалить' });
    if (!ok) return;
    try {
      await api(`/photos/${id}`, { method: 'DELETE', token });
      setPhotos((ps) => ps.filter((p) => p.id !== id));
    } catch (err) {
      setError(errText(err, 'Не удалось удалить фото'));
    }
  }

    // Замена фото: загружаем новое → переносим подпись/раздел/дату → удаляем старое
  function askReplace(photo: PhotoItem) {
    setReplaceTarget(photo);
    replaceRef.current?.click();
  }

  async function doReplace(file: File) {
    const target = replaceTarget;
    setReplaceTarget(null);
    if (!target) return;

    if (file.size > PHOTO_MAX_SIZE_MB * 1024 * 1024) {
      setError(`Файл больше ${PHOTO_MAX_SIZE_MB} МБ`);
      return;
    }

    setUploading(1);
    setError(null);
    try {
      const res = await apiUpload<{ data: PhotoItem }>(
        `/reports/${reportId}/photos`, file, token,
      );
      const newId = res.data.id;

      // переносим метаданные И2/И3/И4 со старого фото
      if (target.caption || target.sectionId || target.shotDate) {
        await api(`/photos/${newId}`, {
          method: 'PATCH', token,
          body: JSON.stringify({
            caption: target.caption,
            sectionId: target.sectionId,
            shotDate: target.shotDate,
          }),
        });
      }

      // удаляем старое
      await api(`/photos/${target.id}`, { method: 'DELETE', token });

      // ставим новое фото на позицию старого
      const order = photos.map((p) => (p.id === target.id ? newId : p.id));
      await api(`/reports/${reportId}/photos/reorder`, {
        method: 'PATCH', token, body: JSON.stringify({ order }),
      }).catch(() => {});

      await load();
    } catch (err) {
      setError(errText(err, 'Не удалось заменить фото'));
    } finally {
      setUploading(0);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const next = index + dir;
    if (next < 0 || next >= photos.length) return;
    const arr = [...photos];
    [arr[index], arr[next]] = [arr[next], arr[index]];
    setPhotos(arr);
    try {
      await api(`/reports/${reportId}/photos/reorder`, {
        method: 'PATCH', token,
        body: JSON.stringify({ order: arr.map((p) => p.id) }),
      });
    } catch (err) {
      setError(errText(err, 'Не удалось изменить порядок'));
      load();
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка секции И…
      </div>
    );
  }

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-[#28282D]">Секция И — Фотоотчёт</h2>
        <span className="text-sm text-gray-400">
          {photos.length} / {PHOTO_MAX_PER_REPORT}
        </span>
      </div>

      {error && <div className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {!readOnly && (
        <>
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) uploadFiles(e.dataTransfer.files);
            }}
            className={`mb-4 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
              dragOver ? 'border-[#00823C] bg-[#00823C]/5' : 'border-gray-300 bg-white'
            }`}
          >
            <Upload className="mx-auto mb-2 h-8 w-8 text-gray-300" />
            <p className="text-sm text-gray-500">
              Перетащите фото сюда или выберите файлы
            </p>
            <p className="mt-0.5 text-xs text-gray-400">
              JPG, PNG, HEIC · до {PHOTO_MAX_SIZE_MB} МБ · сжатие автоматическое
            </p>

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              <button onClick={() => inputRef.current?.click()}
                className="rounded-lg bg-[#00823C] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#006e33]">
                Выбрать файлы
              </button>
              <button onClick={() => cameraRef.current?.click()}
                className="flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm text-[#28282D] transition hover:border-[#00823C] hover:text-[#00823C] sm:hidden">
                <Camera className="h-4 w-4" /> Сфотографировать
              </button>
            </div>

            {uploading > 0 && (
              <p className="mt-3 flex items-center justify-center gap-2 text-sm text-[#00823C]">
                <Loader2 className="h-4 w-4 animate-spin" /> Загрузка… осталось {uploading}
              </p>
            )}
          </div>

          <input ref={inputRef} type="file" accept="image/*" multiple hidden
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden
            onChange={(e) => { if (e.target.files) uploadFiles(e.target.files); e.target.value = ''; }} />
        </>
      )}

      {/* Скрытый input для замены конкретного фото */}
      <input ref={replaceRef} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) doReplace(f); e.target.value = ''; }} />

      {photos.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-gray-300 bg-white py-10 text-center text-sm text-gray-400">
          Фотографий пока нет
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {photos.map((p, i) => (
            <div key={p.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
              <div className="group relative">
                <button onClick={() => setLightbox(i)} title="Открыть предпросмотр"
                  className="block w-full cursor-zoom-in">
                  <PhotoThumb photoId={p.id} alt={p.caption ?? 'Фото'} />
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/0 opacity-0 transition group-hover:bg-black/20 group-hover:opacity-100">
                    <Maximize2 className="h-7 w-7 text-white drop-shadow" />
                  </span>
                </button>

                <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
                  {i + 1}
                </span>

                {!readOnly && (
                  <div className="absolute right-2 top-2 flex gap-1">
                    <button onClick={() => move(i, -1)} disabled={i === 0} title="Левее"
                      className="rounded-md bg-white/90 p-1 text-gray-600 transition hover:text-[#00823C] disabled:opacity-30">
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button onClick={() => move(i, 1)} disabled={i === photos.length - 1} title="Правее"
                      className="rounded-md bg-white/90 p-1 text-gray-600 transition hover:text-[#00823C] disabled:opacity-30">
                      <ChevronRight className="h-4 w-4" />
                    </button>
                    <button onClick={() => askReplace(p)} title="Заменить фото"
                      className="rounded-md bg-white/90 p-1 text-gray-600 transition hover:text-[#00823C]">
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button onClick={() => removePhoto(p.id)} title="Удалить"
                      className="rounded-md bg-white/90 p-1 text-gray-600 transition hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="space-y-2 p-3">
                {/* ПР-6.6: поле «Подпись к фото» убрано */}
                <select value={p.sectionId ?? ''} disabled={readOnly}
                  onChange={(e) => patchPhoto(p.id, { sectionId: e.target.value || null })}
                  className={cell}>
                  <option value="">Раздел не указан</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>

                <input type="date" value={p.shotDate ?? ''} disabled={readOnly}
                  onChange={(e) => patchPhoto(p.id, { shotDate: e.target.value || null })}
                  className={cell} />
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox !== null && photos[lightbox] && (
        <PhotoLightbox
          photos={photos}
          index={lightbox}
          sections={sections}
          readOnly={readOnly}
          onClose={() => setLightbox(null)}
          onNav={(n) => setLightbox(Math.max(0, Math.min(photos.length - 1, n)))}
          onReplace={(p) => { setLightbox(null); askReplace(p); }}
          onDelete={async (p) => {
            setLightbox(null);
            await removePhoto(p.id);
          }}
        />
      )}
    </section>
  );
}
