import { Router } from 'express';
import { param, validationResult } from 'express-validator';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma.js';
import { aiService } from '../services/ai.service.js';
import { scoringService } from '../services/scoring.service.js';
import { authenticate, checkStartupAccess, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import type { Request, Response, NextFunction } from 'express';
import type { ScoreCategory } from '@startup-tracker/shared';

// Helper to safely get string params
const getParamString = (params: Record<string, string | string[] | undefined>, key: string): string => {
  const value = params[key];
  return (Array.isArray(value) ? value[0] : value) ?? '';
};

export const decksRouter = Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (_req, file, cb) => {
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only PDF and PowerPoint files are allowed.'));
    }
  },
});

// All routes require authentication
decksRouter.use(authenticate);

// Validation helper
const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, 'VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    return;
  }
  next();
};

// Upload deck for a startup
decksRouter.post(
  '/startup/:startupId',
  requirePermission('canAddDeals'),
  [param('startupId').isUUID()],
  validate,
  checkStartupAccess,
  upload.single('file'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      if (!req.file) {
        throw new AppError(400, 'MISSING_FILE', 'No file uploaded');
      }

      const startupId = getParamString(req.params, 'startupId');
      const file = req.file;

      // Extract text from PDF
      let extractedText = '';
      if (file.mimetype === 'application/pdf') {
        try {
          const pdfParse = (await import('pdf-parse')).default;
          const pdfData = await pdfParse(file.buffer);
          extractedText = pdfData.text;
        } catch (error) {
          console.error('PDF parsing error:', error);
          throw new AppError(400, 'PDF_PARSE_ERROR', 'Failed to parse PDF file');
        }
      } else {
        // For PowerPoint files, we'd need additional parsing
        // For MVP, we'll require PDF uploads or implement later
        throw new AppError(400, 'UNSUPPORTED_FORMAT', 'Please upload a PDF file for automatic analysis');
      }

      // For now, store file in memory (in production, upload to S3)
      // TODO: Implement S3 upload
      const fileUrl = `file://${uuidv4()}-${file.originalname}`;

      // Create deck record
      const deck = await prisma.pitchDeck.create({
        data: {
          startupId,
          fileUrl,
          fileName: file.originalname,
          fileSize: file.size,
          mimeType: file.mimetype,
          extractedText,
          uploadedBy: req.user.id,
        },
      });

      // Process with AI in background
      res.status(201).json({
        deck: {
          id: deck.id,
          fileName: deck.fileName,
          fileSize: deck.fileSize,
          uploadedAt: deck.uploadedAt,
          status: 'processing',
        },
        message: 'Deck uploaded. AI analysis in progress...',
      });

      // Process asynchronously (don't await)
      processDeckWithAI(deck.id, startupId, extractedText, req.user.id).catch((error) => {
        console.error('Deck processing error:', error);
      });
    } catch (error) {
      next(error);
    }
  }
);

// Get deck by ID
decksRouter.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const deck = await prisma.pitchDeck.findUnique({
        where: { id: getParamString(req.params, 'id') },
        include: {
          startup: {
            select: { id: true, name: true, organizationId: true },
          },
          uploader: {
            select: { id: true, name: true },
          },
        },
      });

      if (!deck) {
        throw new AppError(404, 'NOT_FOUND', 'Deck not found');
      }

      // Check organization access
      if (deck.startup.organizationId !== req.user.organizationId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      res.json(deck);
    } catch (error) {
      next(error);
    }
  }
);

// Get decks for a startup
decksRouter.get(
  '/startup/:startupId',
  [param('startupId').isUUID()],
  validate,
  checkStartupAccess,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const startupId = req.params['startupId'] as string;
      const decks = await prisma.pitchDeck.findMany({
        where: { startupId },
        orderBy: { uploadedAt: 'desc' },
        include: {
          uploader: {
            select: { id: true, name: true },
          },
        },
      });

      res.json(decks);
    } catch (error) {
      next(error);
    }
  }
);

// Reprocess deck with AI
decksRouter.post(
  '/:id/reprocess',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const deck = await prisma.pitchDeck.findUnique({
        where: { id: getParamString(req.params, 'id') },
        include: {
          startup: {
            select: { id: true, organizationId: true },
          },
        },
      });

      if (!deck) {
        throw new AppError(404, 'NOT_FOUND', 'Deck not found');
      }

      if (deck.startup.organizationId !== req.user.organizationId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      if (!deck.extractedText) {
        throw new AppError(400, 'NO_TEXT', 'No extracted text available for this deck');
      }

      res.json({ message: 'Reprocessing started...' });

      // Process asynchronously
      processDeckWithAI(deck.id, deck.startupId, deck.extractedText, req.user.id).catch((error) => {
        console.error('Deck reprocessing error:', error);
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete deck
decksRouter.delete(
  '/:id',
  [param('id').isUUID()],
  validate,
  requirePermission('canEditDeals'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const deck = await prisma.pitchDeck.findUnique({
        where: { id: getParamString(req.params, 'id') },
        include: {
          startup: {
            select: { organizationId: true },
          },
        },
      });

      if (!deck) {
        throw new AppError(404, 'NOT_FOUND', 'Deck not found');
      }

      if (deck.startup.organizationId !== req.user.organizationId) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      await prisma.pitchDeck.delete({
        where: { id: getParamString(req.params, 'id') },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to process deck with AI
async function processDeckWithAI(
  deckId: string,
  startupId: string,
  extractedText: string,
  userId: string
): Promise<void> {
  try {
    // Process deck with AI
    const { extractedData, analysis } = await aiService.processDeck(extractedText);

    // Update deck with results
    await prisma.pitchDeck.update({
      where: { id: deckId },
      data: {
        extractedData: extractedData as unknown as object,
        aiAnalysis: analysis as unknown as object,
      },
    });

    // Update startup with extracted data and clear cached consolidated analysis
    // so it will be rebuilt on next draft reply generation
    await prisma.startup.update({
      where: { id: startupId },
      data: {
        founders: extractedData.team as unknown as object,
        metrics: extractedData.traction as unknown as object,
        description: extractedData.tagline ?? extractedData.solution,
        // Clear consolidated analysis cache to force rebuild with new deck
        consolidatedDeckAnalysis: null,
      },
    });

    // Set base score
    await scoringService.setBaseScore(startupId, analysis.breakdown);

    // Create score events from deck analysis
    const events: Array<{
      startupId: string;
      source: 'deck';
      sourceId: string;
      category: ScoreCategory;
      signal: string;
      impact: number;
      confidence: number;
      evidence: string;
      analyzedBy: 'ai';
    }> = [];

    // Add events for each strength
    for (const strength of analysis.strengths) {
      events.push({
        startupId,
        source: 'deck' as const,
        sourceId: deckId,
        category: 'momentum' as const,
        signal: `Strength: ${strength}`,
        impact: 1,
        confidence: 0.8,
        evidence: strength,
        analyzedBy: 'ai' as const,
      });
    }

    // Add events for each weakness (as red flags with lower impact)
    for (const weakness of analysis.weaknesses) {
      events.push({
        startupId,
        source: 'deck' as const,
        sourceId: deckId,
        category: 'red_flag' as const,
        signal: `Weakness: ${weakness}`,
        impact: -0.5,
        confidence: 0.8,
        evidence: weakness,
        analyzedBy: 'ai' as const,
      });
    }

    if (events.length > 0) {
      await scoringService.addScoreEvents(events);
    }

    // Log activity
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: { organizationId: true },
    });

    if (startup) {
      await prisma.activityLog.create({
        data: {
          organizationId: startup.organizationId,
          userId,
          startupId,
          action: 'deck_analyzed',
          details: {
            deckId,
            score: analysis.score,
          },
        },
      });
    }

    console.log(`Deck ${deckId} processed successfully. Score: ${analysis.score}`);
  } catch (error) {
    console.error(`Error processing deck ${deckId}:`, error);

    // Update deck with error status
    await prisma.pitchDeck.update({
      where: { id: deckId },
      data: {
        aiAnalysis: {
          error: true,
          message: error instanceof Error ? error.message : 'Processing failed',
        },
      },
    });
  }
}
