import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { z } from 'zod';

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

// SECURITY: Validate critical environment variables on startup
const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().min(32, 'ENCRYPTION_KEY must be at least 32 characters'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required'),
  PORT: z.string().regex(/^\d+$/, 'PORT must be a number').optional(),
  NODE_ENV: z.enum(['development', 'production', 'test']).optional(),
  JWT_EXPIRES_IN: z.string().optional(),
  JWT_REFRESH_EXPIRES_IN: z.string().optional(),
});

try {
  envSchema.parse(process.env);
  console.log('✅ Environment variables validated successfully');
} catch (error) {
  console.error('❌ CRITICAL: Environment validation failed:');
  if (error instanceof z.ZodError) {
    error.errors.forEach((err) => {
      console.error(`   - ${err.path.join('.')}: ${err.message}`);
    });
  }
  console.error('\n💡 Please check your .env file and ensure all required variables are set.');
  console.error('   See .env.example for reference.\n');
  process.exit(1);
}

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
