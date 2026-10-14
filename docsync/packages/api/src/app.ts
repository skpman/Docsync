import cors from 'cors';
import express from 'express';
import { authRouter } from './routes/auth.js';
import { documentsRouter } from './routes/documents.js';
import { errorHandler, HttpError } from './http.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/auth', authRouter);
  app.use('/documents', documentsRouter);
  app.use(() => {
    throw new HttpError(404, 'Not found');
  });
  app.use(errorHandler);
  return app;
}
