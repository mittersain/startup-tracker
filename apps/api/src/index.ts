import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import { errorHandler } from './middleware/error-handler.js';
import { authRouter } from './routes/auth.routes.js';
import { startupsRouter } from './routes/startups.routes.js';
import { decksRouter } from './routes/decks.routes.js';
import { emailsRouter } from './routes/emails.routes.js';
import { usersRouter } from './routes/users.routes.js';
import { inboxRouter } from './routes/inbox.routes.js';
import { backupRouter } from './routes/backup.routes.js';
import { evaluationRouter } from './routes/evaluation.routes.js';
import { backupService } from './services/backup.service.js';

dotenv.config();

const app = express();
const PORT = process.env['PORT'] ?? 3001;

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRouter);
app.use('/api/startups', startupsRouter);
app.use('/api/decks', decksRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/users', usersRouter);
app.use('/api/inbox', inboxRouter);
app.use('/api/backup', backupRouter);
app.use('/api/evaluation', evaluationRouter);

// Error handling
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
  console.log(`📊 Environment: ${process.env['NODE_ENV'] ?? 'development'}`);

  // Initialize backup service
  backupService.initialize();
});

export default app;
