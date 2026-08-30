// Дизайн-токены (ТЗ 3.1, палитра бренда РОСТ)
export const colors = {
  primary: '#00823C',        // кнопки-акцент, заголовки, шапка (К4)
  primaryLight: '#E8F5EE',   // фон активного раздела, hover
  secondary: '#8CC832',      // иконки, прогресс-бары
  secondaryLight: '#F2FAE3', // фон тегов, бейджей
  dark: '#28282D',           // основной текст
  traffic: { green: '#00823C', yellow: '#F5A623', red: '#D0342C' },
} as const;

export const fonts = {
  heading: ['Circe', 'Open Sans', 'sans-serif'],  // Circe — ⬜ долг 2b, fallback ✔
  body: ['Open Sans', 'sans-serif'],
} as const;

// Брейкпоинты (ТЗ 3.9)
export const breakpoints = { mobile: 0, tablet: 768, laptop: 1024, desktop: 1280 } as const;

// PDF-полоска подвала (4px #00823C) и поля страниц (ТЗ, PDF-раздел)
export const pdf = {
  margins: { top: '15mm', bottom: '15mm', left: '20mm', right: '20mm' },
  footerBar: { height: '4px', color: colors.primary },
} as const;