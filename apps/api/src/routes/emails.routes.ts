import { Router } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import prisma from '../utils/prisma.js';
import { aiService } from '../services/ai.service.js';
import { scoringService } from '../services/scoring.service.js';
import { authenticate, checkStartupAccess } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import type { Request, Response, NextFunction } from 'express';
import type { EmailMatchType, ScoreCategory } from '@startup-tracker/shared';

// Helper to safely get string params
const getParamString = (params: Record<string, string | string[] | undefined>, key: string): string => {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

export const emailsRouter = Router();

// All routes require authentication
emailsRouter.use(authenticate);

// Validation helper
const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, 'VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    return;
  }
  next();
};

// Get emails for a startup
emailsRouter.get(
  '/startup/:startupId',
  [
    param('startupId').isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 50;
      const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;

      const [emails, total] = await Promise.all([
        prisma.email.findMany({
          where: { startupId: getParamString(req.params, 'startupId') },
          orderBy: { receivedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.email.count({
          where: { startupId: getParamString(req.params, 'startupId') },
        }),
      ]);

      res.json({ data: emails, total, limit, offset });
    } catch (error) {
      next(error);
    }
  }
);

// Get unmatched emails (for review)
emailsRouter.get(
  '/unmatched',
  [
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const limit = req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : 50;
      const offset = req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : 0;

      const [emails, total] = await Promise.all([
        prisma.email.findMany({
          where: {
            organizationId: req.user.organizationId,
            startupId: null,
          },
          orderBy: { receivedAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.email.count({
          where: {
            organizationId: req.user.organizationId,
            startupId: null,
          },
        }),
      ]);

      res.json({ data: emails, total, limit, offset });
    } catch (error) {
      next(error);
    }
  }
);

// Match email to startup
emailsRouter.post(
  '/:id/match',
  [
    param('id').isUUID(),
    body('startupId').isUUID(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const email = await prisma.email.findUnique({
        where: { id: getParamString(req.params, 'id') },
      });

      if (!email) {
        throw new AppError(404, 'NOT_FOUND', 'Email not found');
      }

      if (email.organizationId !== req.user.organizationId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      // Update email with startup association
      const updatedEmail = await prisma.email.update({
        where: { id: getParamString(req.params, 'id') },
        data: {
          startupId: req.body.startupId as string,
          matchConfidence: 1.0, // Manual match = 100% confidence
        },
      });

      // Create/update contact from this email
      await prisma.startupContact.upsert({
        where: {
          startupId_email: {
            startupId: req.body.startupId as string,
            email: email.fromAddress,
          },
        },
        update: {
          matchType: 'confirmed',
          confirmedBy: req.user.id,
          confirmedAt: new Date(),
        },
        create: {
          startupId: req.body.startupId as string,
          email: email.fromAddress,
          name: email.fromName,
          matchType: 'confirmed',
          confirmedBy: req.user.id,
          confirmedAt: new Date(),
        },
      });

      // Trigger AI analysis for this email
      analyzeEmailAsync(updatedEmail.id, req.body.startupId as string).catch((error) => {
        console.error('Email analysis error:', error);
      });

      res.json(updatedEmail);
    } catch (error) {
      next(error);
    }
  }
);

// Get contacts for a startup
emailsRouter.get(
  '/contacts/:startupId',
  [param('startupId').isUUID()],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const contacts = await prisma.startupContact.findMany({
        where: { startupId: getParamString(req.params, 'startupId') },
        orderBy: { createdAt: 'desc' },
        include: {
          confirmer: {
            select: { id: true, name: true },
          },
        },
      });

      res.json(contacts);
    } catch (error) {
      next(error);
    }
  }
);

// Add contact to startup
emailsRouter.post(
  '/contacts/:startupId',
  [
    param('startupId').isUUID(),
    body('email').isEmail().normalizeEmail(),
    body('name').optional().trim(),
    body('role').optional().trim(),
    body('matchType').optional().isIn(['confirmed', 'domain', 'inferred', 'pending']),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const contact = await prisma.startupContact.create({
        data: {
          startupId: getParamString(req.params, 'startupId')!,
          email: req.body.email as string,
          name: req.body.name as string | undefined,
          role: req.body.role as string | undefined,
          matchType: (req.body.matchType as EmailMatchType) ?? 'confirmed',
          confirmedBy: req.user.id,
          confirmedAt: new Date(),
        },
      });

      res.status(201).json(contact);
    } catch (error) {
      next(error);
    }
  }
);

// Update contact
emailsRouter.patch(
  '/contacts/:contactId',
  [
    param('contactId').isUUID(),
    body('name').optional().trim(),
    body('role').optional().trim(),
    body('matchType').optional().isIn(['confirmed', 'domain', 'inferred', 'pending']),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const contact = await prisma.startupContact.findUnique({
        where: { id: getParamString(req.params, 'contactId') },
        include: {
          startup: {
            select: { organizationId: true },
          },
        },
      });

      if (!contact) {
        throw new AppError(404, 'NOT_FOUND', 'Contact not found');
      }

      if (contact.startup.organizationId !== req.user.organizationId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      const updated = await prisma.startupContact.update({
        where: { id: getParamString(req.params, 'contactId') },
        data: {
          name: req.body.name as string | undefined,
          role: req.body.role as string | undefined,
          matchType: req.body.matchType as EmailMatchType | undefined,
          ...(req.body.matchType === 'confirmed' && {
            confirmedBy: req.user.id,
            confirmedAt: new Date(),
          }),
        },
      });

      res.json(updated);
    } catch (error) {
      next(error);
    }
  }
);

// Delete contact
emailsRouter.delete(
  '/contacts/:contactId',
  [param('contactId').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const contact = await prisma.startupContact.findUnique({
        where: { id: getParamString(req.params, 'contactId') },
        include: {
          startup: {
            select: { organizationId: true },
          },
        },
      });

      if (!contact) {
        throw new AppError(404, 'NOT_FOUND', 'Contact not found');
      }

      if (contact.startup.organizationId !== req.user.organizationId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      await prisma.startupContact.delete({
        where: { id: getParamString(req.params, 'contactId') },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Analyze email with AI
emailsRouter.post(
  '/:id/analyze',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const email = await prisma.email.findUnique({
        where: { id: getParamString(req.params, 'id') },
      });

      if (!email) {
        throw new AppError(404, 'NOT_FOUND', 'Email not found');
      }

      if (email.organizationId !== req.user.organizationId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      if (!email.startupId) {
        throw new AppError(400, 'NOT_MATCHED', 'Email must be matched to a startup first');
      }

      res.json({ message: 'Analysis started...' });

      // Analyze asynchronously
      analyzeEmailAsync(email.id, email.startupId).catch((error) => {
        console.error('Email analysis error:', error);
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get communication metrics for a startup
emailsRouter.get(
  '/metrics/:startupId',
  [param('startupId').isUUID()],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const metrics = await prisma.communicationMetrics.findUnique({
        where: { startupId: getParamString(req.params, 'startupId') },
      });

      if (!metrics) {
        res.json({
          startupId: getParamString(req.params, 'startupId'),
          totalEmails: 0,
          message: 'No communication metrics available yet',
        });
        return;
      }

      res.json(metrics);
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to analyze email with AI
async function analyzeEmailAsync(emailId: string, startupId: string): Promise<void> {
  try {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
    });

    if (!email) return;

    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: {
        name: true,
        currentScore: true,
      },
    });

    if (!startup) return;

    // Get known metrics for this startup
    const metrics = await prisma.startupMetric.findMany({
      where: { startupId },
      orderBy: { reportedAt: 'desc' },
      take: 10,
    });

    const knownMetrics: Record<string, number> = {};
    for (const m of metrics) {
      if (!knownMetrics[m.metricName]) {
        knownMetrics[m.metricName] = m.value;
      }
    }

    // Get time since last email
    const lastEmail = await prisma.email.findFirst({
      where: {
        startupId,
        receivedAt: { lt: email.receivedAt },
      },
      orderBy: { receivedAt: 'desc' },
    });

    const timeSinceLastEmail = lastEmail
      ? formatTimeDiff(email.receivedAt.getTime() - lastEmail.receivedAt.getTime())
      : 'First email';

    // Analyze with AI
    const analysis = await aiService.analyzeEmail({
      startupName: startup.name,
      currentScore: startup.currentScore ?? 50,
      knownMetrics,
      timeSinceLastEmail,
      from: email.fromAddress,
      to: (email.toAddresses as string[]).join(', '),
      date: email.receivedAt.toISOString(),
      subject: email.subject,
      body: email.bodyPreview,
    });

    // Save analysis
    await prisma.email.update({
      where: { id: emailId },
      data: {
        aiAnalysis: analysis as unknown as object,
      },
    });

    // Create score events from signals
    const scoreEvents = analysis.signals.map((signal) => ({
      startupId,
      source: 'email' as const,
      sourceId: emailId,
      category: mapSignalToCategory(signal.type),
      signal: signal.description,
      impact: signal.impact,
      confidence: signal.confidence,
      evidence: signal.quote,
      analyzedBy: 'ai' as const,
    }));

    if (scoreEvents.length > 0) {
      await scoringService.addScoreEvents(scoreEvents);
    }

    // Save extracted metrics
    for (const metric of analysis.metricsExtracted) {
      await prisma.startupMetric.create({
        data: {
          startupId,
          metricName: metric.metric,
          value: metric.value,
          unit: metric.unit,
          reportedAt: new Date(metric.date),
          source: 'email',
          sourceId: emailId,
        },
      });
    }

    // Update communication metrics
    await updateCommunicationMetrics(startupId);

    console.log(`Email ${emailId} analyzed successfully. ${analysis.signals.length} signals detected.`);
  } catch (error) {
    console.error(`Error analyzing email ${emailId}:`, error);
  }
}

// Helper to map signal types to score categories
function mapSignalToCategory(signalType: string): ScoreCategory {
  const categoryMap: Record<string, ScoreCategory> = {
    traction_growth: 'traction',
    revenue_update: 'traction',
    customer_win: 'traction',
    partnership_announced: 'momentum',
    team_hire: 'team',
    product_milestone: 'product',
    fundraising_momentum: 'momentum',
    quick_response: 'communication',
    proactive_update: 'communication',
    transparent_communication: 'communication',
    detailed_metrics: 'communication',
    metric_inconsistency: 'red_flag',
    missed_deadline: 'red_flag',
    evasive_answer: 'red_flag',
    slow_response: 'communication',
    team_departure: 'red_flag',
    pivot_announced: 'red_flag',
    runway_concern: 'red_flag',
    legal_issue: 'red_flag',
    customer_churn: 'red_flag',
  };

  return categoryMap[signalType] ?? 'communication';
}

// Helper to format time difference
function formatTimeDiff(ms: number): string {
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return 'Less than 1 hour';
  if (hours < 24) return `${hours} hours`;
  const days = Math.floor(hours / 24);
  return `${days} day${days > 1 ? 's' : ''}`;
}

// Helper to update communication metrics
async function updateCommunicationMetrics(startupId: string): Promise<void> {
  const emails = await prisma.email.findMany({
    where: { startupId },
    orderBy: { receivedAt: 'asc' },
  });

  if (emails.length === 0) return;

  // Calculate metrics
  let totalResponseTime = 0;
  let responseCount = 0;
  let proactiveCount = 0;

  for (let i = 1; i < emails.length; i++) {
    const prev = emails[i - 1]!;
    const curr = emails[i]!;

    if (prev.direction === 'outbound' && curr.direction === 'inbound') {
      const responseTime = curr.receivedAt.getTime() - prev.receivedAt.getTime();
      totalResponseTime += responseTime;
      responseCount++;
    }

    if (curr.direction === 'inbound') {
      const analysis = curr.aiAnalysis as { communicationAssessment?: { responsiveness?: string } } | null;
      if (analysis?.communicationAssessment?.responsiveness === 'fast') {
        proactiveCount++;
      }
    }
  }

  const avgResponseTimeHours = responseCount > 0
    ? totalResponseTime / responseCount / (1000 * 60 * 60)
    : null;

  const responseRate = responseCount > 0 ? responseCount / emails.filter((e) => e.direction === 'outbound').length : null;

  // Get all unique metrics shared
  const metricsShared = await prisma.startupMetric.findMany({
    where: { startupId },
    distinct: ['metricName'],
    select: { metricName: true },
  });

  await prisma.communicationMetrics.upsert({
    where: { startupId },
    update: {
      avgResponseTimeHours,
      responseRate,
      totalEmails: emails.length,
      proactiveUpdates: proactiveCount,
      metricsShared: metricsShared.map((m) => m.metricName),
      lastCalculated: new Date(),
    },
    create: {
      startupId,
      avgResponseTimeHours,
      responseRate,
      totalEmails: emails.length,
      proactiveUpdates: proactiveCount,
      metricsShared: metricsShared.map((m) => m.metricName),
    },
  });
}
