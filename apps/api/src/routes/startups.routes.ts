import { Router } from 'express';
import { body, query, param, validationResult } from 'express-validator';
import { startupService } from '../services/startup.service.js';
import { scoringService } from '../services/scoring.service.js';
import { emailService } from '../services/email.service.js';
import { authenticate, checkStartupAccess, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import prisma from '../utils/prisma.js';
import type { Request, Response, NextFunction } from 'express';
import type { DealStatus, FundingStage, ScoreCategory } from '@startup-tracker/shared';

// Helper to safely get string params
const getParamString = (params: Record<string, string | string[] | undefined>, key: string): string => {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

export const startupsRouter = Router();

// All routes require authentication
startupsRouter.use(authenticate);

// Validation helper
const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, 'VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    return;
  }
  next();
};

// List startups
startupsRouter.get(
  '/',
  [
    query('status').optional().isIn(['reviewing', 'due_diligence', 'invested', 'passed', 'archived']),
    query('stage').optional().isIn(['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'growth']),
    query('search').optional().isString(),
    query('sortBy').optional().isIn(['name', 'currentScore', 'createdAt', 'updatedAt']),
    query('sortOrder').optional().isIn(['asc', 'desc']),
    query('page').optional().isInt({ min: 1 }),
    query('pageSize').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const result = await startupService.list({
        organizationId: req.user.organizationId,
        userId: req.user.id,
        canViewAll: req.user.permissions.canViewAllDeals,
        status: req.query['status'] as DealStatus | undefined,
        stage: req.query['stage'] as FundingStage | undefined,
        search: req.query['search'] as string | undefined,
        sortBy: req.query['sortBy'] as 'name' | 'currentScore' | 'createdAt' | 'updatedAt' | undefined,
        sortOrder: req.query['sortOrder'] as 'asc' | 'desc' | undefined,
        page: req.query['page'] ? parseInt(req.query['page'] as string, 10) : undefined,
        pageSize: req.query['pageSize'] ? parseInt(req.query['pageSize'] as string, 10) : undefined,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get status counts (for pipeline view)
startupsRouter.get(
  '/counts',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const counts = await startupService.getByStatus(
        req.user.organizationId,
        req.user.id,
        req.user.permissions.canViewAllDeals
      );

      res.json(counts);
    } catch (error) {
      next(error);
    }
  }
);

// Create startup
startupsRouter.post(
  '/',
  requirePermission('canAddDeals'),
  [
    body('name').notEmpty().trim(),
    body('website').optional().isURL(),
    body('description').optional().isString(),
    body('stage').optional().isIn(['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'growth']),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const startup = await startupService.create({
        name: req.body.name as string,
        website: req.body.website as string | undefined,
        description: req.body.description as string | undefined,
        stage: req.body.stage as FundingStage | undefined,
        organizationId: req.user.organizationId,
        ownerId: req.user.id,
      });

      res.status(201).json(startup);
    } catch (error) {
      next(error);
    }
  }
);

// Get startup by ID
startupsRouter.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const startup = await startupService.getById(
        getParamString(req.params, 'id'),
        req.user.organizationId
      );

      res.json(startup);
    } catch (error) {
      next(error);
    }
  }
);

// Update startup
startupsRouter.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().notEmpty().trim(),
    body('website').optional().isURL(),
    body('description').optional().isString(),
    body('status').optional().isIn(['reviewing', 'due_diligence', 'invested', 'passed', 'archived']),
    body('stage').optional().isIn(['pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'growth']),
    body('notes').optional().isString(),
    body('tags').optional().isArray(),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const startup = await startupService.update(
        getParamString(req.params, 'id'),
        req.user.organizationId,
        req.user.id,
        req.body
      );

      res.json(startup);
    } catch (error) {
      next(error);
    }
  }
);

// Update status only
startupsRouter.patch(
  '/:id/status',
  [
    param('id').isUUID(),
    body('status').isIn(['reviewing', 'due_diligence', 'invested', 'passed', 'archived']),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const startup = await startupService.updateStatus(
        getParamString(req.params, 'id'),
        req.user.organizationId,
        req.user.id,
        req.body.status as DealStatus
      );

      res.json(startup);
    } catch (error) {
      next(error);
    }
  }
);

// Delete startup
startupsRouter.delete(
  '/:id',
  [param('id').isUUID()],
  validate,
  requirePermission('canDeleteDeals'),
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      await startupService.delete(
        getParamString(req.params, 'id'),
        req.user.organizationId,
        req.user.id
      );

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Get score events
startupsRouter.get(
  '/:id/score-events',
  [
    param('id').isUUID(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 }),
    query('category').optional().isIn(['team', 'market', 'product', 'traction', 'deal', 'communication', 'momentum', 'red_flag']),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await scoringService.getEvents(getParamString(req.params, 'id'), {
        limit: req.query['limit'] ? parseInt(req.query['limit'] as string, 10) : undefined,
        offset: req.query['offset'] ? parseInt(req.query['offset'] as string, 10) : undefined,
        category: req.query['category'] as ScoreCategory | undefined,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Get score history
startupsRouter.get(
  '/:id/score-history',
  [
    param('id').isUUID(),
    query('days').optional().isInt({ min: 1, max: 365 }),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const days = req.query['days'] ? parseInt(req.query['days'] as string, 10) : 30;
      const history = await scoringService.getScoreHistory(getParamString(req.params, 'id'), days);

      res.json(history);
    } catch (error) {
      next(error);
    }
  }
);

// Add manual score event
startupsRouter.post(
  '/:id/score-events',
  [
    param('id').isUUID(),
    body('category').isIn(['team', 'market', 'product', 'traction', 'deal', 'communication', 'momentum', 'red_flag']),
    body('signal').notEmpty().isString(),
    body('impact').isFloat({ min: -10, max: 10 }),
    body('evidence').optional().isString(),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const event = await scoringService.addScoreEvent({
        startupId: getParamString(req.params, 'id'),
        source: 'manual',
        category: req.body.category as ScoreCategory,
        signal: req.body.signal as string,
        impact: req.body.impact as number,
        evidence: req.body.evidence as string | undefined,
        analyzedBy: 'user',
        userId: req.user.id,
      });

      res.status(201).json(event);
    } catch (error) {
      next(error);
    }
  }
);

// Assign user to startup
startupsRouter.post(
  '/:id/assign',
  requirePermission('canViewAllDeals'),
  [
    param('id').isUUID(),
    body('userId').isUUID(),
    body('accessLevel').optional().isIn(['view', 'edit']),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      await startupService.assign(
        getParamString(req.params, 'id'),
        req.body.userId as string,
        req.user.id,
        req.body.accessLevel as 'view' | 'edit' | undefined
      );

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Unassign user from startup
startupsRouter.delete(
  '/:id/assign/:userId',
  requirePermission('canViewAllDeals'),
  [
    param('id').isUUID(),
    param('userId').isUUID(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await startupService.unassign(getParamString(req.params, 'id'), getParamString(req.params, 'userId'));

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Update draft reply
startupsRouter.patch(
  '/:id/draft-reply',
  [
    param('id').isUUID(),
    body('draftReply').notEmpty().isString(),
  ],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const startupId = getParamString(req.params, 'id');

      const startup = await prisma.startup.update({
        where: { id: startupId },
        data: {
          draftReply: req.body.draftReply as string,
          draftReplyStatus: 'pending', // Reset status when edited
        },
      });

      // Log activity
      await prisma.activityLog.create({
        data: {
          organizationId: req.user.organizationId,
          userId: req.user.id,
          startupId,
          action: 'draft_reply_updated',
          details: JSON.stringify({
            length: (req.body.draftReply as string).length,
          }),
        },
      });

      res.json({
        success: true,
        draftReply: startup.draftReply,
        draftReplyStatus: startup.draftReplyStatus,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Send draft reply email to founder
startupsRouter.post(
  '/:id/send-reply',
  [param('id').isUUID()],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const startupId = getParamString(req.params, 'id');

      // Get startup with contact info
      const startup = await prisma.startup.findUnique({
        where: { id: startupId },
        include: {
          contacts: {
            where: { role: 'Founder' },
            take: 1,
          },
        },
      });

      if (!startup) {
        throw new AppError(404, 'NOT_FOUND', 'Startup not found');
      }

      if (!startup.draftReply) {
        throw new AppError(400, 'NO_DRAFT', 'No draft reply available for this startup');
      }

      // Get founder email
      const founderEmail = startup.contacts[0]?.email;
      if (!founderEmail) {
        throw new AppError(400, 'NO_EMAIL', 'No founder email found. Please add founder contact info first.');
      }

      // Send the email
      const subject = `Re: ${startup.name} - Following up on your pitch`;
      await emailService.sendEmail({
        to: founderEmail,
        subject,
        body: startup.draftReply,
        organizationId: req.user.organizationId,
        userId: req.user.id,
        startupId,
      });

      // Update draft reply status
      await prisma.startup.update({
        where: { id: startupId },
        data: {
          draftReplyStatus: 'sent',
        },
      });

      // Log activity
      await prisma.activityLog.create({
        data: {
          organizationId: req.user.organizationId,
          userId: req.user.id,
          startupId,
          action: 'draft_reply_sent',
          details: JSON.stringify({
            to: founderEmail,
            subject,
          }),
        },
      });

      res.json({
        success: true,
        message: `Email sent to ${founderEmail}`,
        to: founderEmail,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Regenerate draft reply with full context (emails, attachments, pitch deck)
startupsRouter.post(
  '/:id/regenerate-reply',
  [param('id').isUUID()],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const startupId = getParamString(req.params, 'id');

      // Get startup with all related data
      const startup = await prisma.startup.findUnique({
        where: { id: startupId },
        include: {
          contacts: {
            where: { role: 'Founder' },
            take: 1,
          },
          pitchDecks: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!startup) {
        throw new AppError(404, 'NOT_FOUND', 'Startup not found');
      }

      // Get email history for this startup
      const emails = await prisma.email.findMany({
        where: { startupId },
        orderBy: { receivedAt: 'asc' },
        take: 10,
      });

      // Get the original proposal email if exists
      const proposalQueue = await prisma.proposalQueue.findFirst({
        where: { createdStartupId: startupId },
      });

      // Import AI service dynamically to avoid circular dependencies
      const { aiService } = await import('../services/ai.service.js');

      if (!aiService.enabled) {
        throw new AppError(400, 'AI_DISABLED', 'AI features are not enabled');
      }

      // Get business model analysis or create one
      let businessAnalysis = startup.businessModelAnalysis as import('../services/ai.service.js').BusinessModelAnalysis | null;

      if (!businessAnalysis) {
        businessAnalysis = await aiService.analyzeBusinessModel({
          name: startup.name,
          description: startup.description,
          website: startup.website,
          founderName: startup.contacts[0]?.name,
          askAmount: null,
          stage: startup.stage,
          extractedData: null,
        });
      }

      // Build context for draft reply generation
      const context: {
        originalEmail?: {
          subject?: string;
          body?: string;
          from?: string;
          date?: string;
        };
        emailHistory?: Array<{
          subject: string;
          body: string;
          from: string;
          date: string;
          direction: 'inbound' | 'outbound';
        }>;
        pitchDeckAnalysis?: {
          strengths?: string[];
          weaknesses?: string[];
          questions?: string[];
          summary?: string;
          extractedData?: {
            problem?: string;
            solution?: string;
            traction?: Record<string, unknown>;
            team?: Array<{ name?: string; role?: string }>;
            askAmount?: string;
          };
        };
      } = {};

      // Add original email context
      if (proposalQueue) {
        context.originalEmail = {
          subject: proposalQueue.emailSubject,
          body: proposalQueue.emailPreview,
          from: proposalQueue.emailFromName
            ? `${proposalQueue.emailFromName} <${proposalQueue.emailFrom}>`
            : proposalQueue.emailFrom,
          date: proposalQueue.emailDate.toISOString(),
        };
      }

      // Add email history
      if (emails.length > 0) {
        context.emailHistory = emails.map((email) => ({
          subject: email.subject,
          body: email.bodyPreview || '',
          from: email.fromName
            ? `${email.fromName} <${email.fromAddress}>`
            : email.fromAddress,
          date: email.receivedAt.toISOString(),
          direction: email.direction as 'inbound' | 'outbound',
        }));
      }

      // Add pitch deck analysis
      const latestDeck = startup.pitchDecks[0];
      if (latestDeck?.aiAnalysis) {
        const deckAnalysis = latestDeck.aiAnalysis as Record<string, unknown>;
        const extractedData = latestDeck.extractedData as Record<string, unknown> | null;

        context.pitchDeckAnalysis = {
          strengths: deckAnalysis.strengths as string[] | undefined,
          weaknesses: deckAnalysis.weaknesses as string[] | undefined,
          questions: deckAnalysis.questions as string[] | undefined,
          summary: deckAnalysis.summary as string | undefined,
          extractedData: extractedData
            ? {
                problem: extractedData.problem as string | undefined,
                solution: extractedData.solution as string | undefined,
                traction: extractedData.traction as Record<string, unknown> | undefined,
                team: extractedData.team as Array<{ name?: string; role?: string }> | undefined,
                askAmount: extractedData.askAmount as string | undefined,
              }
            : undefined,
        };
      }

      // Generate new draft reply with full context
      const draftReply = await aiService.generateDraftReply(
        {
          name: startup.name,
          founderName: startup.contacts[0]?.name,
          founderEmail: startup.contacts[0]?.email,
          description: startup.description,
        },
        businessAnalysis,
        context
      );

      // Update startup with new draft reply
      await prisma.startup.update({
        where: { id: startupId },
        data: {
          draftReply,
          draftReplyStatus: 'pending',
          businessModelAnalysis: businessAnalysis as unknown as object,
          analysisUpdatedAt: new Date(),
        },
      });

      // Log activity
      await prisma.activityLog.create({
        data: {
          organizationId: req.user.organizationId,
          userId: req.user.id,
          startupId,
          action: 'draft_reply_regenerated',
          details: JSON.stringify({
            hasEmailContext: !!context.originalEmail,
            emailHistoryCount: context.emailHistory?.length || 0,
            hasPitchDeckAnalysis: !!context.pitchDeckAnalysis,
          }),
        },
      });

      res.json({
        success: true,
        draftReply,
        context: {
          hasOriginalEmail: !!context.originalEmail,
          emailHistoryCount: context.emailHistory?.length || 0,
          hasPitchDeckAnalysis: !!context.pitchDeckAnalysis,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);
