import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'ghg-green': '#0C3D2E',
      },
      // 全站字級統一放大，貼近聊天視窗的閱讀舒適度（约 +2px／級距）
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],   // 12px → 14px
        sm: ['1rem', { lineHeight: '1.5rem' }],         // 14px → 16px
        base: ['1.0625rem', { lineHeight: '1.65rem' }], // 16px → 17px
        lg: ['1.1875rem', { lineHeight: '1.75rem' }],   // 18px → 19px
        xl: ['1.3125rem', { lineHeight: '1.75rem' }],   // 20px → 21px
        '2xl': ['1.5625rem', { lineHeight: '2rem' }],   // 24px → 25px
      },
    },
  },
  plugins: [],
};

export default config;
