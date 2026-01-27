import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../utils/prisma.js';
import { AppError } from '../middleware/error-handler.js';
import type { UserRole, AuthTokens } from '@startup-tracker/shared';

interface RegisterInput {
  email: string;
  password: string;
  name: string;
  organizationName?: string;
  organizationId?: string;
  role?: UserRole;
}

interface LoginInput {
  email: string;
  password: string;
}

export class AuthService {
  private jwtSecret: string;
  private jwtExpiresIn: string;
  private refreshExpiresIn: string;

  constructor() {
    this.jwtSecret = process.env['JWT_SECRET'] ?? '';
    this.jwtExpiresIn = process.env['JWT_EXPIRES_IN'] ?? '7d';
    this.refreshExpiresIn = process.env['JWT_REFRESH_EXPIRES_IN'] ?? '30d';

    if (!this.jwtSecret) {
      throw new Error('JWT_SECRET environment variable is required');
    }
  }

  async register(input: RegisterInput): Promise<{ user: object; tokens: AuthTokens }> {
    const { email, password, name, organizationName, organizationId, role = 'analyst' } = input;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new AppError(409, 'USER_EXISTS', 'A user with this email already exists');
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create organization if not joining existing one
    let orgId = organizationId;
    if (!orgId) {
      if (!organizationName) {
        throw new AppError(400, 'INVALID_INPUT', 'Organization name is required for new users');
      }

      const organization = await prisma.organization.create({
        data: {
          name: organizationName,
          settings: {
            scoringWeights: {
              team: 25,
              market: 25,
              product: 20,
              traction: 20,
              deal: 10,
            },
            dealStages: ['reviewing', 'due_diligence', 'invested', 'passed'],
            customFields: [],
            emailSyncEnabled: true,
            aiAnalysisEnabled: true,
          },
        },
      });
      orgId = organization.id;
    }

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: orgId === organizationId ? role : 'admin', // First user is admin
        organizationId: orgId,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        createdAt: true,
      },
    });

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.organizationId, user.role as UserRole);

    return { user, tokens };
  }

  async login(input: LoginInput): Promise<{ user: object; tokens: AuthTokens }> {
    const { email, password } = input;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        organizationId: true,
        passwordHash: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Verify password
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
    }

    // Generate tokens
    const tokens = await this.generateTokens(user.id, user.organizationId, user.role as UserRole);

    // Return user without password
    const { passwordHash: _, ...userWithoutPassword } = user;

    return { user: userWithoutPassword, tokens };
  }

  async refreshTokens(refreshToken: string): Promise<AuthTokens> {
    // Find refresh token
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!tokenRecord) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid refresh token');
    }

    if (tokenRecord.expiresAt < new Date()) {
      // Delete expired token
      await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });
      throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired');
    }

    // Delete old refresh token
    await prisma.refreshToken.delete({ where: { id: tokenRecord.id } });

    // Generate new tokens
    return this.generateTokens(
      tokenRecord.user.id,
      tokenRecord.user.organizationId,
      tokenRecord.user.role as UserRole
    );
  }

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken },
    });
  }

  async logoutAll(userId: string): Promise<void> {
    await prisma.refreshToken.deleteMany({
      where: { userId },
    });
  }

  private async generateTokens(
    userId: string,
    organizationId: string,
    role: UserRole
  ): Promise<AuthTokens> {
    // Access token
    const expiresInSeconds = this.parseExpirySeconds(this.jwtExpiresIn);
    const accessToken = jwt.sign(
      { userId, organizationId, role },
      this.jwtSecret,
      { expiresIn: expiresInSeconds }
    );

    // Refresh token
    const refreshToken = uuidv4();
    const refreshExpiresAt = this.parseExpiry(this.refreshExpiresIn);

    await prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.parseExpirySeconds(this.jwtExpiresIn),
    };
  }

  private parseExpiry(expiry: string): Date {
    const now = new Date();
    const match = expiry.match(/^(\d+)([smhd])$/);

    if (!match) {
      // Default to 30 days
      return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }

    const [, value, unit] = match;
    const numValue = parseInt(value ?? '0', 10);

    switch (unit) {
      case 's':
        return new Date(now.getTime() + numValue * 1000);
      case 'm':
        return new Date(now.getTime() + numValue * 60 * 1000);
      case 'h':
        return new Date(now.getTime() + numValue * 60 * 60 * 1000);
      case 'd':
        return new Date(now.getTime() + numValue * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    }
  }

  private parseExpirySeconds(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);

    if (!match) {
      return 7 * 24 * 60 * 60; // Default 7 days
    }

    const [, value, unit] = match;
    const numValue = parseInt(value ?? '0', 10);

    switch (unit) {
      case 's':
        return numValue;
      case 'm':
        return numValue * 60;
      case 'h':
        return numValue * 60 * 60;
      case 'd':
        return numValue * 24 * 60 * 60;
      default:
        return 7 * 24 * 60 * 60;
    }
  }
}

export const authService = new AuthService();
