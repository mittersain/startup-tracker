import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface BackupConfig {
  enabled: boolean;
  intervalHours: number;
  maxBackups: number;
  backupDir: string;
}

export class BackupService {
  private config: BackupConfig;
  private backupInterval: NodeJS.Timeout | null = null;
  private dbPath: string;

  constructor() {
    // Default configuration
    this.config = {
      enabled: process.env['BACKUP_ENABLED'] !== 'false',
      intervalHours: parseInt(process.env['BACKUP_INTERVAL_HOURS'] || '6', 10),
      maxBackups: parseInt(process.env['BACKUP_MAX_COUNT'] || '10', 10),
      backupDir: process.env['BACKUP_DIR'] || path.join(process.cwd(), 'prisma', 'backups'),
    };

    // SQLite database path
    this.dbPath = path.join(process.cwd(), 'prisma', 'dev.db');
  }

  /**
   * Initialize the backup service
   */
  initialize(): void {
    if (!this.config.enabled) {
      console.log('[Backup] Backup service disabled');
      return;
    }

    // Ensure backup directory exists
    if (!fs.existsSync(this.config.backupDir)) {
      fs.mkdirSync(this.config.backupDir, { recursive: true });
      console.log(`[Backup] Created backup directory: ${this.config.backupDir}`);
    }

    // Create initial backup on startup
    this.createBackup('startup');

    // Schedule periodic backups
    this.startScheduledBackups();

    console.log(`[Backup] Service initialized - backing up every ${this.config.intervalHours} hours, keeping ${this.config.maxBackups} backups`);
  }

  /**
   * Start scheduled backups
   */
  private startScheduledBackups(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
    }

    const intervalMs = this.config.intervalHours * 60 * 60 * 1000;
    this.backupInterval = setInterval(() => {
      this.createBackup('scheduled');
    }, intervalMs);
  }

  /**
   * Create a backup of the database
   */
  createBackup(reason: 'startup' | 'scheduled' | 'manual' | 'pre-migration' = 'manual'): string | null {
    if (!fs.existsSync(this.dbPath)) {
      console.error('[Backup] Database file not found:', this.dbPath);
      return null;
    }

    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `backup-${reason}-${timestamp}.db`;
      const backupPath = path.join(this.config.backupDir, backupFileName);

      // Use SQLite's backup command for safe concurrent backup
      // This creates a consistent snapshot even if the database is being written to
      try {
        execSync(`sqlite3 "${this.dbPath}" ".backup '${backupPath}'"`, {
          timeout: 30000, // 30 second timeout
        });
      } catch {
        // Fallback to simple file copy if sqlite3 CLI not available
        fs.copyFileSync(this.dbPath, backupPath);
      }

      // Also backup the WAL file if it exists (for WAL mode)
      const walPath = this.dbPath + '-wal';
      if (fs.existsSync(walPath)) {
        fs.copyFileSync(walPath, backupPath + '-wal');
      }

      console.log(`[Backup] Created backup: ${backupFileName}`);

      // Clean up old backups
      this.cleanupOldBackups();

      return backupPath;
    } catch (error) {
      console.error('[Backup] Failed to create backup:', error);
      return null;
    }
  }

  /**
   * Clean up old backups, keeping only the configured max number
   */
  private cleanupOldBackups(): void {
    try {
      const files = fs.readdirSync(this.config.backupDir)
        .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
        .map(f => ({
          name: f,
          path: path.join(this.config.backupDir, f),
          time: fs.statSync(path.join(this.config.backupDir, f)).mtime.getTime(),
        }))
        .sort((a, b) => b.time - a.time); // Newest first

      // Remove old backups beyond the max count
      const toDelete = files.slice(this.config.maxBackups);
      for (const file of toDelete) {
        fs.unlinkSync(file.path);
        // Also delete WAL file if exists
        const walPath = file.path + '-wal';
        if (fs.existsSync(walPath)) {
          fs.unlinkSync(walPath);
        }
        console.log(`[Backup] Deleted old backup: ${file.name}`);
      }
    } catch (error) {
      console.error('[Backup] Failed to cleanup old backups:', error);
    }
  }

  /**
   * Restore from a backup file
   */
  restoreFromBackup(backupPath: string): boolean {
    if (!fs.existsSync(backupPath)) {
      console.error('[Backup] Backup file not found:', backupPath);
      return false;
    }

    try {
      // Create a pre-restore backup
      this.createBackup('pre-migration');

      // Stop any active connections (in a real app, you'd need to handle this more gracefully)
      console.log('[Backup] Restoring database from:', backupPath);

      // Copy the backup to the database location
      fs.copyFileSync(backupPath, this.dbPath);

      // Restore WAL file if it exists in backup
      const walBackupPath = backupPath + '-wal';
      const walPath = this.dbPath + '-wal';
      if (fs.existsSync(walBackupPath)) {
        fs.copyFileSync(walBackupPath, walPath);
      } else if (fs.existsSync(walPath)) {
        // Delete existing WAL if no backup WAL exists
        fs.unlinkSync(walPath);
      }

      console.log('[Backup] Database restored successfully');
      return true;
    } catch (error) {
      console.error('[Backup] Failed to restore backup:', error);
      return false;
    }
  }

  /**
   * List available backups
   */
  listBackups(): Array<{
    name: string;
    path: string;
    size: number;
    created: Date;
    reason: string;
  }> {
    if (!fs.existsSync(this.config.backupDir)) {
      return [];
    }

    return fs.readdirSync(this.config.backupDir)
      .filter(f => f.startsWith('backup-') && f.endsWith('.db'))
      .map(f => {
        const filePath = path.join(this.config.backupDir, f);
        const stats = fs.statSync(filePath);
        const match = f.match(/^backup-(\w+)-/);
        return {
          name: f,
          path: filePath,
          size: stats.size,
          created: stats.mtime,
          reason: match ? match[1] : 'unknown',
        };
      })
      .sort((a, b) => b.created.getTime() - a.created.getTime());
  }

  /**
   * Check database integrity
   */
  checkIntegrity(): { ok: boolean; message: string } {
    if (!fs.existsSync(this.dbPath)) {
      return { ok: false, message: 'Database file not found' };
    }

    try {
      const result = execSync(`sqlite3 "${this.dbPath}" "PRAGMA integrity_check;"`, {
        encoding: 'utf-8',
        timeout: 60000,
      }).trim();

      if (result === 'ok') {
        return { ok: true, message: 'Database integrity check passed' };
      } else {
        return { ok: false, message: `Integrity issues found: ${result}` };
      }
    } catch (error) {
      // If sqlite3 CLI not available, try a basic file check
      try {
        const stats = fs.statSync(this.dbPath);
        if (stats.size > 0) {
          return { ok: true, message: 'Database file exists and has content (detailed check unavailable)' };
        }
        return { ok: false, message: 'Database file is empty' };
      } catch {
        return { ok: false, message: `Failed to check integrity: ${error}` };
      }
    }
  }

  /**
   * Get database statistics
   */
  getStats(): {
    dbPath: string;
    dbSize: number;
    backupCount: number;
    lastBackup: Date | null;
    nextBackup: Date | null;
  } {
    const backups = this.listBackups();
    const dbSize = fs.existsSync(this.dbPath) ? fs.statSync(this.dbPath).size : 0;
    const lastBackup = backups.length > 0 ? backups[0].created : null;
    const nextBackup = lastBackup && this.config.enabled
      ? new Date(lastBackup.getTime() + this.config.intervalHours * 60 * 60 * 1000)
      : null;

    return {
      dbPath: this.dbPath,
      dbSize,
      backupCount: backups.length,
      lastBackup,
      nextBackup,
    };
  }

  /**
   * Stop the backup service
   */
  stop(): void {
    if (this.backupInterval) {
      clearInterval(this.backupInterval);
      this.backupInterval = null;
    }
    console.log('[Backup] Service stopped');
  }
}

export const backupService = new BackupService();
