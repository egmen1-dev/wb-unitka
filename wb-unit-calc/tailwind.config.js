import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'src/**/*.{js,jsx}'),
  ],
  safelist: [
    'bg-brand-600',
    'bg-brand-700',
    'bg-brand-50',
    'border-brand-700',
    'border-brand-200',
    'border-brand-300',
    'border-brand-500',
    'text-brand-100',
    'text-brand-700',
    'ring-brand-200',
    'ring-brand-300',
    'hover:bg-brand-50',
    'hover:bg-brand-50/50',
    'hover:bg-white/10',
    'bg-white/15',
    'ring-white/20',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#2d6a4f',
          600: '#245a42',
          700: '#1b4332',
        },
      },
    },
  },
  plugins: [],
};
