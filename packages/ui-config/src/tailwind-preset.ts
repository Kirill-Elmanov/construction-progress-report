// Tailwind-пресет: единые токены для apps/web (и любых будущих фронтов)
import type { Config } from 'tailwindcss';
import { colors, fonts } from './index.js';

export const rostPreset: Partial<Config> = {
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: colors.primary,      // #00823C
          light: colors.primaryLight,   // #E8F5EE
        },
        secondary: {
          DEFAULT: colors.secondary,    // #8CC832
          light: colors.secondaryLight, // #F2FAE3
        },
        dark: colors.dark,              // #28282D
        traffic: {
          green: colors.traffic.green,
          yellow: colors.traffic.yellow,
          red: colors.traffic.red,
        },
      },
      fontFamily: {
        heading: fonts.heading as unknown as string[],
        body: fonts.body as unknown as string[],
      },
    },
    // Брейкпоинты ТЗ 3.9 + стандартные имена Tailwind.
    // Компоненты используют оба варианта, поэтому нельзя заменять sm/md/lg.
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      tablet: '768px',
      laptop: '1024px',
      desktop: '1280px',
    },
  },
};

export default rostPreset;
