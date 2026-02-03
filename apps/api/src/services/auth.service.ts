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
    // SECURITY: Tokens are hashed in DB, so we need to find by comparing hashes
    // This is acceptable for refresh tokens since users typically have 1-5 tokens max

    // First, get a sample token to extract userId from the token itself
    // Since we can't look up by token directly, we'll use a different approach:
    // Generate a hash and look up, but bcrypt uses random salts so we need to
    // fetch candidate tokens and compare each one

    // For efficiency, we'll limit the search to non-expired tokens
    const now = new Date();
    const candidateTokens = await prisma.refreshToken.findMany({
      where: {
        expiresAt: { gte: now },
      },
      include: { user: true },
    });

    // Find matching token by comparing hashes
    type TokenWithUser = typeof candidateTokens[number];
    let matchedToken: TokenWithUser | null = null;
    for (const candidate of candidateTokens) {
      const isMatch = await bcrypt.compare(refreshToken, candidate.token);
      if (isMatch) {
        matchedToken = candidate;
        break;
      }
    }

    if (!matchedToken) {
      throw new AppError(401, 'INVALID_TOKEN', 'Invalid refresh token');
    }

    if (matchedToken.expiresAt < new Date()) {
      // Delete expired token
      await prisma.refreshToken.delete({ where: { id: matchedToken.id } });
      throw new AppError(401, 'TOKEN_EXPIRED', 'Refresh token has expired');
    }

    // Delete old refresh token (token rotation for security)
    await prisma.refreshToken.delete({ where: { id: matchedToken.id } });

    // Generate new tokens
    return this.generateTokens(
      matchedToken.user.id,
      matchedToken.user.organizationId,
      matchedToken.user.role as UserRole
    );
  }

  async logout(refreshToken: string): Promise<void> {
    // SECURITY: Tokens are hashed in DB, need to find by comparing hashes
    const allTokens = await prisma.refreshToken.findMany();

    // Find matching token by comparing hashes
    for (const candidate of allTokens) {
      const isMatch = await bcrypt.compare(refreshToken, candidate.token);
      if (isMatch) {
        await prisma.refreshToken.delete({ where: { id: candidate.id } });
        break;
      }
    }
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

    // SECURITY: Hash refresh token before storing (10 rounds for refresh tokens)
    const hashedToken = await bcrypt.hash(refreshToken, 10);

    await prisma.refreshToken.create({
      data: {
        userId,
        token: hashedToken, // Store hashed token
        expiresAt: refreshExpiresAt,
      },
    });

    return {
      accessToken,
      refreshToken, // Return plain token to user (they'll send this back later)
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
