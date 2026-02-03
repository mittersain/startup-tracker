import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { emailInboxService, type InboxConfig, type SyncResult } from '../services/email-inbox.service.js';
import prisma from '../utils/prisma.js';
import { encrypt } from '../utils/encryption.js';
import type { Request, Response, NextFunction } from 'express';

export const inboxRouter = Router();

// All routes require authentication
inboxRouter.use(authenticate);

// Validation middleware
const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, 'VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    return;
  }
  next();
};

// Get inbox configuration for organization
inboxRouter.get(
  '/config',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { settings: true },
      });

      const settings = org?.settings as Record<string, unknown> | null;
      const inboxConfig = settings?.emailInbox as Record<string, unknown> | undefined;

      // Don't expose password
      if (inboxConfig) {
        res.json({
          configured: true,
          host: inboxConfig.host,
          port: inboxConfig.port,
          user: inboxConfig.user,
          tls: inboxConfig.tls,
          folder: inboxConfig.folder,
          pollingEnabled: inboxConfig.pollingEnabled,
          pollingInterval: inboxConfig.pollingInterval,
        });
      } else {
        res.json({ configured: false });
      }
    } catch (error) {
      next(error);
    }
  }
);

// Save inbox configuration
inboxRouter.post(
  '/config',
  requirePermission('canManageSettings'),
  [
    body('host').notEmpty().withMessage('IMAP host is required'),
    body('port').isInt({ min: 1, max: 65535 }).withMessage('Valid port is required'),
    body('user').notEmpty().withMessage('Email username is required'),
    body('password').notEmpty().withMessage('Email password is required'),
    body('tls').isBoolean().optional(),
    body('folder').optional().trim(),
    body('pollingEnabled').isBoolean().optional(),
    body('pollingInterval').isInt({ min: 1, max: 60 }).optional(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { host, port, user, password, tls = true, folder = 'INBOX', pollingEnabled = false, pollingInterval = 5 } = req.body;

      const inboxConfig: InboxConfig = {
        host,
        port,
        user,
        password,
        tls,
        folder,
      };

      // Test connection first
      const testResult = await emailInboxService.testConnection(inboxConfig);
      if (!testResult.success) {
        throw new AppError(400, 'CONNECTION_FAILED', `Failed to connect to email server: ${testResult.error}`);
      }

      // Get current settings
      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { settings: true },
      });

      const currentSettings = (org?.settings as Record<string, unknown>) || {};

      // SECURITY: Encrypt password before storing
      const encryptedPassword = encrypt(password);

      // Update settings with inbox config
      await prisma.organization.update({
        where: { id: req.user.organizationId },
        data: {
          settings: {
            ...currentSettings,
            emailInbox: {
              host,
              port,
              user,
              password: encryptedPassword,  // Store encrypted password
              tls,
              folder,
              pollingEnabled,
              pollingInterval,
            },
          },
        },
      });

      // Start/stop polling based on setting
      if (pollingEnabled) {
        emailInboxService.startPolling(
          inboxConfig,
          req.user.organizationId,
          req.user.id,
          pollingInterval
        );
      } else {
        emailInboxService.stopPolling();
      }

      res.json({
        success: true,
        message: 'Inbox configuration saved',
        mailboxInfo: testResult.mailboxInfo,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Test inbox connection
inboxRouter.post(
  '/test',
  requirePermission('canManageSettings'),
  [
    body('host').notEmpty(),
    body('port').isInt({ min: 1, max: 65535 }),
    body('user').notEmpty(),
    body('password').notEmpty(),
    body('tls').isBoolean().optional(),
    body('folder').optional().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { host, port, user, password, tls = true, folder = 'INBOX' } = req.body;

      const config: InboxConfig = { host, port, user, password, tls, folder };
      const result = await emailInboxService.testConnection(config);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Manually trigger inbox processing
inboxRouter.post(
  '/process',
  requirePermission('canAddDeals'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Get inbox config from organization settings
      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { settings: true },
      });

      const settings = org?.settings as Record<string, unknown> | null;
      const inboxConfig = settings?.emailInbox as InboxConfig | undefined;

      if (!inboxConfig) {
        throw new AppError(400, 'NOT_CONFIGURED', 'Email inbox is not configured. Please configure it in settings first.');
      }

      const results = await emailInboxService.processInbox(
        inboxConfig,
        req.user.organizationId,
        req.user.id
      );

      const created = results.filter((r) => r.startupId).length;
      const failed = results.filter((r) => r.error).length;
      const skipped = results.length - created - failed;

      res.json({
        success: true,
        processed: results.length,
        created,
        skipped,
        failed,
        results: results.map((r) => ({
          subject: r.subject,
          from: r.from,
          date: r.date,
          startupName: r.proposal?.startupName,
          startupId: r.startupId,
          error: r.error,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Full sync: fetch emails, create startups, process attachments, create email threads
inboxRouter.post(
  '/sync',
  requirePermission('canAddDeals'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Get inbox config from organization settings
      const org = await prisma.organization.findUnique({
        where: { id: req.user.organizationId },
        select: { settings: true },
      });

      const settings = org?.settings as Record<string, unknown> | null;
      const inboxConfig = settings?.emailInbox as InboxConfig | undefined;

      if (!inboxConfig) {
        throw new AppError(400, 'NOT_CONFIGURED', 'Email inbox is not configured. Please configure it in settings first.');
      }

      const syncResult: SyncResult = await emailInboxService.syncInbox(
        inboxConfig,
        req.user.organizationId,
        req.user.id
      );

      // Check if all errors are quota-related
      const quotaErrors = syncResult.results.filter(r => r.error?.includes('quota'));
      const hasQuotaIssue = quotaErrors.length > 0 && quotaErrors.length === syncResult.failed;

      res.json({
        success: true,
        ...syncResult,
        quotaExceeded: hasQuotaIssue,
        message: hasQuotaIssue
          ? 'AI quota exceeded. Please check your Gemini API billing or wait for quota reset.'
          : undefined,
        results: syncResult.results.map((r) => ({
          subject: r.subject,
          from: r.from,
          date: r.date,
          startupName: r.proposal?.startupName,
          startupId: r.startupId,
          emailRecordId: r.emailRecordId,
          deckIds: r.deckIds,
          error: r.error,
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Process a single pasted email/message content
inboxRouter.post(
  '/parse',
  requirePermission('canAddDeals'),
  [
    body('content').notEmpty().withMessage('Email content is required'),
    body('subject').optional().trim(),
    body('from').optional().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { content, subject = 'Forwarded Message', from = 'Unknown' } = req.body;

      const emailContent = {
        subject,
        body: content,
        from,
        date: new Date().toISOString(),
      };

      const proposal = await emailInboxService.extractProposalFromEmail(emailContent);

      if (!proposal) {
        throw new AppError(400, 'EXTRACTION_FAILED', 'Could not extract startup information from the provided content');
      }

      // Optionally create the startup immediately
      const { createStartup } = req.body;
      let startupId: string | undefined;

      if (createStartup && proposal.confidence >= 50) {
        startupId = await emailInboxService.createStartupFromProposal(
          proposal,
          req.user.organizationId,
          req.user.id
        );
      }

      res.json({
        success: true,
        proposal,
        startupId,
      });
    } catch (error) {
      next(error);
    }
  }
);

// ==========================================
// Proposal Queue Endpoints
// ==========================================

// Get all pending proposals in the queue
inboxRouter.get(
  '/queue',
  requirePermission('canAddDeals'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const proposals = await emailInboxService.getQueuedProposals(req.user.organizationId);

      res.json({
        success: true,
        count: proposals.length,
        proposals,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Approve a proposal and create startup
inboxRouter.post(
  '/queue/:id/approve',
  requirePermission('canAddDeals'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const id = req.params.id as string;
      const startupId = await emailInboxService.approveProposal(id, req.user.id);

      res.json({
        success: true,
        message: 'Proposal approved and startup created',
        startupId,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Reject a proposal and send rejection email
inboxRouter.post(
  '/queue/:id/reject',
  requirePermission('canAddDeals'),
  [body('reason').optional().trim()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const id = req.params.id as string;
      const { reason } = req.body;

      const result = await emailInboxService.rejectProposal(id, req.user.id, reason);

      res.json({
        success: true,
        message: result.emailSent
          ? 'Proposal rejected and rejection email sent'
          : 'Proposal rejected (no email sent - founder email not available)',
        emailSent: result.emailSent,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Snooze a proposal and send follow-up email
inboxRouter.post(
  '/queue/:id/snooze',
  requirePermission('canAddDeals'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const id = req.params.id as string;

      const result = await emailInboxService.snoozeProposal(id, req.user.id);

      res.json({
        success: true,
        message: result.emailSent
          ? 'Proposal snoozed and follow-up email sent. The founder has been asked to keep you posted on progress.'
          : 'Proposal snoozed (no email sent - founder email not available)',
        emailSent: result.emailSent,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Check snoozed proposals for progress updates
inboxRouter.post(
  '/queue/check-snoozed',
  requirePermission('canAddDeals'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const result = await emailInboxService.checkSnoozedProposals(req.user.organizationId);

      res.json({
        success: true,
        ...result,
        message: `Checked ${result.checked} proposals: ${result.reactivated} reactivated, ${result.rejected} rejected, ${result.keepSnoozed} kept snoozed`,
      });
    } catch (error) {
      next(error);
    }
  }
);
