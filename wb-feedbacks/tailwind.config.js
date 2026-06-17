import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [path.join(__dirname, 'index.html'), path.join(__dirname, 'src/**/*.{js,jsx}')],
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
