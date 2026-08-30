'use client';

import { useEffect } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Trash2, X } from 'lucide-react';
import type { PhotoItem, Section } from '@/lib/types';
import { PhotoThumb } from '@/components/PhotoThumb';

export function PhotoLightbox({
  photos, index, sections, readOnly, onClose, onNav, onReplace, onDelete,
}: {
  photos: PhotoItem[];
  index: number;
  sections: Section[];
  readOnly: boolean;
  onClose: () => void;
  onNav: (nextIndex: number) => void;
  onReplace: (photo: PhotoItem) => void;
  onDelete: (photo: PhotoItem) => void;
}) {
  const photo = photos[index];

  // Навигация с клавиатуры
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && index > 0) onNav(index - 1);
      if (e.key === 'ArrowRight' && index < photos.length - 1) onNav(index + 1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, photos.length, onClose, onNav]);

  if (!photo) return null;

  const sectionName = sections.find((s) => s.id === photo.sectionId)?.name;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90">
      {/* Верхняя панель */}
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm">
          Фото {index + 1} из {photos.length}
        </span>
        <div className="flex items-center gap-2">
          {!readOnly && (
            <>
              <button onClick={() => onReplace(photo)}
                className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-white/20">
                <RefreshCw className="h-4 w-4" /> Заменить
              </button>
              <button onClick={() => onDelete(photo)}
                className="flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1.5 text-sm transition hover:bg-red-600">
                <Trash2 className="h-4 w-4" /> Удалить
              </button>
            </>
          )}
          <button onClick={onClose}
            className="rounded-lg bg-white/10 p-1.5 transition hover:bg-white/20">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Само фото */}
      <div className="relative flex flex-1 items-center justify-center px-4">
        <button onClick={() => onNav(index - 1)} disabled={index === 0}
          className="absolute left-4 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-20">
          <ChevronLeft className="h-6 w-6" />
        </button>

        <PhotoThumb key={photo.id} photoId={photo.id} alt={photo.caption ?? 'Фото'} variant="full" />

        <button onClick={() => onNav(index + 1)} disabled={index === photos.length - 1}
          className="absolute right-4 rounded-full bg-white/10 p-3 text-white transition hover:bg-white/20 disabled:opacity-20">
          <ChevronRight className="h-6 w-6" />
        </button>
      </div>

      {/* Нижняя панель с подписью */}
      <div className="px-6 py-4 text-center text-white">
        <p className="text-base font-medium">{photo.caption || 'Без подписи'}</p>
        <p className="mt-0.5 text-sm text-white/60">
          {sectionName ?? 'Раздел не указан'}
          {photo.shotDate && ` · ${new Date(photo.shotDate).toLocaleDateString('ru-RU')}`}
        </p>
      </div>
    </div>
  );
}