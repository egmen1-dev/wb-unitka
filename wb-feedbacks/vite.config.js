import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { loadEnvLocal } from '../lib/load-env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

loadEnvLocal(root);

const API_ROUTES = {
  '/api/feedbacks/feedbacks': () => import('../api/feedbacks/feedbacks.js'),
  '/api/feedbacks/feedback-draft': () => import('../api/feedbacks/feedback-draft.js'),
  '/api/feedbacks/feedbacks-check': () => import('../api/feedbacks/feedbacks-check.js'),
  '/api/feedbacks/ai-config-check': () => import('../api/feedbacks/ai-config-check.js'),
  '/api/feedbacks/auto-reply-batch': () => import('../api/feedbacks/auto-reply-batch.js'),
  '/api/cron/auto-reply': () => import('../api/cron/auto-reply.js'),
};

function feedbacksApiPlugin() {
  return {
    name: 'feedbacks-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const pathname = req.url?.split('?')[0] || '';
        const loadHandler = API_ROUTES[pathname];
        if (!loadHandler) {
          next();
          return;
        }

        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          res.statusCode = 204;
          res.end();
          return;
        }

        try {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);
          const raw = Buffer.concat(chunks).toString('utf8');
          const body = raw ? JSON.parse(raw) : {};
          const query = Object.fromEntries(
            new URL(pathname + (req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''), 'http://local')
              .searchParams
          );

          const handler = (await loadHandler()).default;
          const fakeReq = {
            method: req.method,
            headers: req.headers,
            body,
            query,
          };
          const fakeRes = {
            statusCode: 200,
            headers: {},
            setHeader(k, v) {
              this.headers[k] = v;
              res.setHeader(k, v);
            },
            status(code) {
              this.statusCode = code;
              res.statusCode = code;
              return this;
            },
            json(data) {
              if (!res.getHeader('Content-Type')) {
                res.setHeader('Content-Type', 'application/json');
              }
              res.end(JSON.stringify(data));
            },
            end(data) {
              res.end(data);
            },
          };

          await handler(fakeReq, fakeRes);
        } catch (error) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: error.message || 'Ошибка сервера' }));
        }
      });
    },
  };
}

export default defineConfig({
  base: '/',
  root: __dirname,
  css: {
    postcss: path.resolve(__dirname, 'postcss.config.js'),
  },
  plugins: [react(), feedbacksApiPlugin()],
  resolve: {
    alias: {
      '@lib': path.resolve(root, 'lib'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    fs: {
      allow: [root],
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  define: {
    __APP_BUILD_ID__: JSON.stringify(
      (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || '').slice(0, 7) || 'local'
    ),
  },
});
