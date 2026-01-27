import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import { backupService } from '../services/backup.service.js';
import type { Request, Response, NextFunction } from 'express';

export const backupRouter = Router();

// All backup routes require authentication and admin permission
backupRouter.use(authenticate);

// Get backup status and stats
backupRouter.get(
  '/status',
  requirePermission('canManageSettings'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const stats = backupService.getStats();
      const integrity = backupService.checkIntegrity();

      res.json({
        success: true,
        stats: {
          ...stats,
          dbSizeFormatted: formatBytes(stats.dbSize),
        },
        integrity,
      });
    } catch (error) {
      next(error);
    }
  }
);

// List all backups
backupRouter.get(
  '/list',
  requirePermission('canManageSettings'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const backups = backupService.listBackups();

      res.json({
        success: true,
        count: backups.length,
        backups: backups.map(b => ({
          ...b,
          sizeFormatted: formatBytes(b.size),
        })),
      });
    } catch (error) {
      next(error);
    }
  }
);

// Create a manual backup
backupRouter.post(
  '/create',
  requirePermission('canManageSettings'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const backupPath = backupService.createBackup('manual');

      if (!backupPath) {
        throw new AppError(500, 'BACKUP_FAILED', 'Failed to create backup');
      }

      res.json({
        success: true,
        message: 'Backup created successfully',
        path: backupPath,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Check database integrity
backupRouter.get(
  '/integrity',
  requirePermission('canManageSettings'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const result = backupService.checkIntegrity();

      res.json({
        success: true,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Restore from a backup (dangerous operation)
backupRouter.post(
  '/restore',
  requirePermission('canManageSettings'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { backupName } = req.body;

      if (!backupName) {
        throw new AppError(400, 'MISSING_BACKUP', 'Backup name is required');
      }

      const backups = backupService.listBackups();
      const backup = backups.find(b => b.name === backupName);

      if (!backup) {
        throw new AppError(404, 'NOT_FOUND', 'Backup not found');
      }

      const success = backupService.restoreFromBackup(backup.path);

      if (!success) {
        throw new AppError(500, 'RESTORE_FAILED', 'Failed to restore backup');
      }

      res.json({
        success: true,
        message: 'Database restored successfully. Please restart the server.',
        restoredFrom: backupName,
      });
    } catch (error) {
      next(error);
    }
  }
);

// Helper function to format bytes
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
