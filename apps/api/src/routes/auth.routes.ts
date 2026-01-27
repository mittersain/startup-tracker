import { Router } from 'express';
import { body, validationResult } from 'express-validator';
import { authService } from '../services/auth.service.js';
import { authenticate } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import type { Request, Response, NextFunction } from 'express';

export const authRouter = Router();

// Validation middleware
const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, 'VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    return;
  }
  next();
};

// Register
authRouter.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('name').notEmpty().trim(),
    body('organizationName').optional().trim(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password, name, organizationName } = req.body as {
        email: string;
        password: string;
        name: string;
        organizationName?: string;
      };

      const result = await authService.register({
        email,
        password,
        name,
        organizationName,
      });

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Login
authRouter.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body as { email: string; password: string };

      const result = await authService.login({ email, password });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Refresh tokens
authRouter.post(
  '/refresh',
  [body('refreshToken').notEmpty()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };

      const tokens = await authService.refreshTokens(refreshToken);

      res.json(tokens);
    } catch (error) {
      next(error);
    }
  }
);

// Logout
authRouter.post(
  '/logout',
  [body('refreshToken').notEmpty()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body as { refreshToken: string };

      await authService.logout(refreshToken);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Logout all sessions
authRouter.post(
  '/logout-all',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      await authService.logoutAll(req.user.id);

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Get current user
authRouter.get(
  '/me',
  authenticate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const { default: prisma } = await import('../utils/prisma.js');

      const user = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
          organizationId: true,
          outlookConnectedAt: true,
          createdAt: true,
          organization: {
            select: {
              id: true,
              name: true,
              plan: true,
            },
          },
        },
      });

      // Add computed outlookConnected field for frontend compatibility
      const userWithConnected = user ? {
        ...user,
        outlookConnected: !!user.outlookConnectedAt,
      } : null;

      res.json({ user: userWithConnected, permissions: req.user.permissions });
    } catch (error) {
      next(error);
    }
  }
);
