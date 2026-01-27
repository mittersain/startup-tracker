import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/prisma.js';
import { AppError } from './error-handler.js';
import type { UserRole, UserPermissions } from '@startup-tracker/shared';
import { ROLE_PERMISSIONS } from '@startup-tracker/shared';

interface JwtPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        organizationId: string;
        role: UserRole;
        permissions: UserPermissions;
      };
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const token = authHeader.slice(7);
    const secret = process.env['JWT_SECRET'];

    if (!secret) {
      throw new AppError(500, 'CONFIG_ERROR', 'JWT secret not configured');
    }

    const payload = jwt.verify(token, secret) as JwtPayload;

    // Verify user still exists and is active
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, organizationId: true, role: true },
    });

    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'User not found');
    }

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      role: user.role as UserRole,
      permissions: ROLE_PERMISSIONS[user.role as UserRole],
    };

    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(permission: keyof UserPermissions) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
      return;
    }

    if (!req.user.permissions[permission]) {
      next(new AppError(403, 'FORBIDDEN', `Permission denied: ${permission}`));
      return;
    }

    next();
  };
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication required'));
      return;
    }

    if (!roles.includes(req.user.role)) {
      next(new AppError(403, 'FORBIDDEN', `Role required: ${roles.join(' or ')}`));
      return;
    }

    next();
  };
}

export async function checkStartupAccess(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const rawStartupId = req.params['startupId'] ?? req.params['id'];
    const startupId = Array.isArray(rawStartupId) ? rawStartupId[0] : rawStartupId;
    if (!startupId) {
      next();
      return;
    }

    // Admins and partners can access all deals in their org
    if (req.user.permissions.canViewAllDeals) {
      const startup = await prisma.startup.findFirst({
        where: {
          id: startupId,
          organizationId: req.user.organizationId,
        },
      });

      if (!startup) {
        throw new AppError(404, 'NOT_FOUND', 'Startup not found');
      }

      next();
      return;
    }

    // Analysts and viewers need explicit assignment
    const assignment = await prisma.startupAssignment.findUnique({
      where: {
        userId_startupId: {
          userId: req.user.id,
          startupId,
        },
      },
    });

    // Also check if user is the owner
    const startup = await prisma.startup.findFirst({
      where: {
        id: startupId,
        organizationId: req.user.organizationId,
        OR: [
          { ownerId: req.user.id },
        ],
      },
    });

    if (!assignment && !startup) {
      throw new AppError(403, 'FORBIDDEN', 'Access to this startup denied');
    }

    next();
  } catch (error) {
    next(error);
  }
}
