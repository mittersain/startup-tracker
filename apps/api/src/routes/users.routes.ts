import { Router } from 'express';
import { body, param, validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import prisma from '../utils/prisma.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import type { Request, Response, NextFunction } from 'express';
import type { UserRole } from '@startup-tracker/shared';

export const usersRouter = Router();

// All routes require authentication
usersRouter.use(authenticate);

// Validation helper
const validate = (req: Request, _res: Response, next: NextFunction): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    next(new AppError(400, 'VALIDATION_ERROR', 'Invalid input', { errors: errors.array() }));
    return;
  }
  next();
};

// List users in organization
usersRouter.get(
  '/',
  requireRole('admin', 'partner'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      const users = await prisma.user.findMany({
        where: { organizationId: req.user.organizationId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
          outlookConnectedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      // Add computed outlookConnected field for frontend compatibility
      const usersWithConnected = users.map(u => ({
        ...u,
        outlookConnected: !!u.outlookConnectedAt,
      }));

      res.json(usersWithConnected);
    } catch (error) {
      next(error);
    }
  }
);

// Get user by ID
usersRouter.get(
  '/:id',
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Users can only view their own profile or admins can view any
      if (req.params['id'] !== req.user.id && req.user.role !== 'admin') {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      const user = await prisma.user.findUnique({
        where: { id: req.params['id'] as string },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
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

      if (!user) {
        throw new AppError(404, 'NOT_FOUND', 'User not found');
      }

      res.json({
        ...user,
        outlookConnected: !!user.outlookConnectedAt,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Update user profile
usersRouter.patch(
  '/:id',
  [
    param('id').isUUID(),
    body('name').optional().notEmpty().trim(),
    body('avatarUrl').optional().isURL(),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Users can only update their own profile or admins can update any
      const userId = req.params['id'] as string;
      if (userId !== req.user.id && req.user.role !== 'admin') {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      const user = await prisma.user.update({
        where: { id: userId },
        data: {
          name: req.body.name as string | undefined,
          avatarUrl: req.body.avatarUrl as string | undefined,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          avatarUrl: true,
        },
      });

      res.json(user);
    } catch (error) {
      next(error);
    }
  }
);

// Update user role (admin only)
usersRouter.patch(
  '/:id/role',
  requireRole('admin'),
  [
    param('id').isUUID(),
    body('role').isIn(['admin', 'partner', 'analyst', 'viewer']),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Can't change your own role
      const targetUserId = req.params['id'] as string;
      if (targetUserId === req.user.id) {
        throw new AppError(400, 'INVALID_OPERATION', 'Cannot change your own role');
      }

      // Verify user is in the same organization
      const targetUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { organizationId: true },
      });

      if (!targetUser || targetUser.organizationId !== req.user.organizationId) {
        throw new AppError(404, 'NOT_FOUND', 'User not found');
      }

      const user = await prisma.user.update({
        where: { id: targetUserId },
        data: {
          role: req.body.role as UserRole,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
        },
      });

      res.json(user);
    } catch (error) {
      next(error);
    }
  }
);

// Change password
usersRouter.post(
  '/:id/password',
  [
    param('id').isUUID(),
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Users can only change their own password
      if (req.params['id'] !== req.user.id) {
        throw new AppError(403, 'FORBIDDEN', 'Access denied');
      }

      const user = await prisma.user.findUnique({
        where: { id: req.params['id'] },
        select: { passwordHash: true },
      });

      if (!user) {
        throw new AppError(404, 'NOT_FOUND', 'User not found');
      }

      // Verify current password
      const isValid = await bcrypt.compare(
        req.body.currentPassword as string,
        user.passwordHash
      );

      if (!isValid) {
        throw new AppError(401, 'INVALID_PASSWORD', 'Current password is incorrect');
      }

      // Hash new password
      const newHash = await bcrypt.hash(req.body.newPassword as string, 12);

      await prisma.user.update({
        where: { id: req.params['id'] },
        data: { passwordHash: newHash },
      });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  }
);

// Invite user to organization
usersRouter.post(
  '/invite',
  requireRole('admin'),
  [
    body('email').isEmail().normalizeEmail(),
    body('name').notEmpty().trim(),
    body('role').isIn(['admin', 'partner', 'analyst', 'viewer']),
  ],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Check if user already exists
      const existing = await prisma.user.findUnique({
        where: { email: req.body.email as string },
      });

      if (existing) {
        throw new AppError(409, 'USER_EXISTS', 'A user with this email already exists');
      }

      // Generate temporary password
      const tempPassword = generateTempPassword();
      const passwordHash = await bcrypt.hash(tempPassword, 12);

      const user = await prisma.user.create({
        data: {
          email: req.body.email as string,
          name: req.body.name as string,
          role: req.body.role as UserRole,
          passwordHash,
          organizationId: req.user.organizationId,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          createdAt: true,
        },
      });

      // In production, send email with tempPassword
      // For now, return it in response (development only)
      res.status(201).json({
        user,
        tempPassword: process.env['NODE_ENV'] === 'development' ? tempPassword : undefined,
        message: 'User invited. They should receive an email with login instructions.',
      });
    } catch (error) {
      next(error);
    }
  }
);

// Delete user (admin only)
usersRouter.delete(
  '/:id',
  requireRole('admin'),
  [param('id').isUUID()],
  validate,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
      }

      // Can't delete yourself
      const deleteUserId = req.params['id'] as string;
      if (deleteUserId === req.user.id) {
        throw new AppError(400, 'INVALID_OPERATION', 'Cannot delete your own account');
      }

      // Verify user is in the same organization
      const targetUser = await prisma.user.findUnique({
        where: { id: deleteUserId },
        select: { organizationId: true },
      });

      if (!targetUser || targetUser.organizationId !== req.user.organizationId) {
        throw new AppError(404, 'NOT_FOUND', 'User not found');
      }

      await prisma.user.delete({
        where: { id: deleteUserId },
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
);

// Helper to generate temporary password
function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
}
