import type { ReactNode } from 'react';
import './globals.css';
import { ConfirmProvider } from '@/components/ConfirmDialog';

export const metadata = {
  title: 'РОСТ-Отчёт',
  description: 'Система отчётов о ходе строительства',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <body className="font-body text-dark">
        <ConfirmProvider>{children}</ConfirmProvider>
      </body>
    </html>
  );
}