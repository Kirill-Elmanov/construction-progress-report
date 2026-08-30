import type { Config } from 'tailwindcss';
import rostPreset from '@rost/ui-config/tailwind';

export default {
  presets: [rostPreset as Config],
  content: ['./src/**/*.{ts,tsx}'],
} satisfies Config;