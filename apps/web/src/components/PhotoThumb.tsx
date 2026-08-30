'use client';

import { useEffect, useState } from 'react';
import { ImageOff, Loader2 } from 'lucide-react';
import { apiBlobUrl } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export function PhotoThumb({
  photoId,
  alt,
  variant = 'thumb',
}: {
  photoId: string;
  alt: string;
  variant?: 'thumb' | 'full';
}) {
  const token = useAuth((s) => s.token);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const isFull = variant === 'full';

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);

    // full → оригинал (1920px), thumb → превью (400px)
    apiBlobUrl(`/photos/${photoId}/${isFull ? 'file' : 'thumb'}`, token)
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        revoke = u;
        setUrl(u);
      })
      .catch(() => !cancelled && setFailed(true));

    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [photoId, token, isFull]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 text-gray-300 ${
        isFull ? 'h-[70vh] w-full' : 'aspect-[4/3] w-full rounded-lg'
      }`}>
        <ImageOff className={isFull ? 'h-10 w-10' : 'h-6 w-6'} />
      </div>
    );
  }

  if (!url) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 text-gray-300 ${
        isFull ? 'h-[70vh] w-full' : 'aspect-[4/3] w-full rounded-lg'
      }`}>
        <Loader2 className={`animate-spin ${isFull ? 'h-8 w-8' : 'h-5 w-5'}`} />
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className={
        isFull
          ? 'max-h-[75vh] w-auto max-w-full object-contain'
          : 'aspect-[4/3] w-full rounded-lg bg-gray-50 object-contain'
      }
    />
  );
}