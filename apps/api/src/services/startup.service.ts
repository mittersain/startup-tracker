import prisma from '../utils/prisma.js';
import { AppError } from '../middleware/error-handler.js';
import type { Startup, DealStatus, FundingStage, PaginatedResponse } from '@startup-tracker/shared';

interface CreateStartupInput {
  name: string;
  website?: string;
  description?: string;
  stage?: FundingStage;
  organizationId: string;
  ownerId: string;
}

interface UpdateStartupInput {
  name?: string;
  website?: string;
  description?: string;
  status?: DealStatus;
  stage?: FundingStage;
  notes?: string;
  tags?: string[];
}

interface ListStartupsOptions {
  organizationId: string;
  userId: string;
  canViewAll: boolean;
  status?: DealStatus;
  stage?: FundingStage;
  search?: string;
  sortBy?: 'name' | 'currentScore' | 'createdAt' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export class StartupService {
  async create(input: CreateStartupInput): Promise<Startup> {
    // Extract domain from website
    let domain: string | undefined;
    if (input.website) {
      try {
        const url = new URL(input.website);
        domain = url.hostname.replace('www.', '');
      } catch {
        // Invalid URL, skip domain extraction
      }
    }

    const startup = await prisma.startup.create({
      data: {
        name: input.name,
        website: input.website,
        domain,
        description: input.description,
        stage: input.stage,
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        status: 'reviewing',
        scoreTrend: 'stable',
        scoreTrendDelta: 0,
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId: input.organizationId,
        userId: input.ownerId,
        startupId: startup.id,
        action: 'startup_created',
        details: { name: input.name },
      },
    });

    return startup as unknown as Startup;
  }

  async getById(id: string, organizationId: string): Promise<Startup> {
    const startup = await prisma.startup.findFirst({
      where: {
        id,
        organizationId,
      },
      include: {
        owner: {
          select: { id: true, name: true, email: true },
        },
        pitchDecks: {
          orderBy: { uploadedAt: 'desc' },
          take: 1,
        },
        _count: {
          select: {
            emails: true,
            scoreEvents: true,
            investments: true,
          },
        },
      },
    });

    if (!startup) {
      throw new AppError(404, 'NOT_FOUND', 'Startup not found');
    }

    return startup as unknown as Startup;
  }

  async list(options: ListStartupsOptions): Promise<PaginatedResponse<Startup>> {
    const {
      organizationId,
      userId,
      canViewAll,
      status,
      stage,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      page = 1,
      pageSize = 20,
    } = options;

    // Build where clause
    const where: Record<string, unknown> = {
      organizationId,
    };

    // If user can't view all, filter by ownership or assignment
    if (!canViewAll) {
      where['OR'] = [
        { ownerId: userId },
        {
          assignments: {
            some: { userId },
          },
        },
      ];
    }

    if (status) {
      where['status'] = status;
    }

    if (stage) {
      where['stage'] = stage;
    }

    if (search) {
      where['OR'] = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { website: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Execute query
    const [startups, total] = await Promise.all([
      prisma.startup.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          owner: {
            select: { id: true, name: true },
          },
          _count: {
            select: { emails: true },
          },
        },
      }),
      prisma.startup.count({ where }),
    ]);

    return {
      data: startups as unknown as Startup[],
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async update(
    id: string,
    organizationId: string,
    userId: string,
    input: UpdateStartupInput
  ): Promise<Startup> {
    // Verify startup exists in this org
    const existing = await prisma.startup.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Startup not found');
    }

    // Update domain if website changed
    let domain = existing.domain;
    if (input.website && input.website !== existing.website) {
      try {
        const url = new URL(input.website);
        domain = url.hostname.replace('www.', '');
      } catch {
        domain = null;
      }
    }

    const startup = await prisma.startup.update({
      where: { id },
      data: {
        ...input,
        domain,
      },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId,
        userId,
        startupId: id,
        action: 'startup_updated',
        details: input as unknown as object,
      },
    });

    return startup as unknown as Startup;
  }

  async updateStatus(
    id: string,
    organizationId: string,
    userId: string,
    status: DealStatus
  ): Promise<Startup> {
    const existing = await prisma.startup.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Startup not found');
    }

    const startup = await prisma.startup.update({
      where: { id },
      data: { status },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId,
        userId,
        startupId: id,
        action: 'status_changed',
        details: {
          from: existing.status,
          to: status,
        },
      },
    });

    return startup as unknown as Startup;
  }

  async delete(id: string, organizationId: string, userId: string): Promise<void> {
    const existing = await prisma.startup.findFirst({
      where: { id, organizationId },
    });

    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Startup not found');
    }

    await prisma.startup.delete({
      where: { id },
    });

    // Log activity
    await prisma.activityLog.create({
      data: {
        organizationId,
        userId,
        action: 'startup_deleted',
        details: { name: existing.name },
      },
    });
  }

  async getByStatus(
    organizationId: string,
    userId: string,
    canViewAll: boolean
  ): Promise<Record<DealStatus, number>> {
    const where: Record<string, unknown> = { organizationId };

    if (!canViewAll) {
      where['OR'] = [
        { ownerId: userId },
        { assignments: { some: { userId } } },
      ];
    }

    const counts = await prisma.startup.groupBy({
      by: ['status'],
      where,
      _count: true,
    });

    const result: Record<DealStatus, number> = {
      reviewing: 0,
      due_diligence: 0,
      invested: 0,
      passed: 0,
      archived: 0,
    };

    for (const c of counts) {
      result[c.status as DealStatus] = c._count;
    }

    return result;
  }

  async assign(
    startupId: string,
    userId: string,
    assignedBy: string,
    accessLevel: 'view' | 'edit' = 'view'
  ): Promise<void> {
    await prisma.startupAssignment.upsert({
      where: {
        userId_startupId: {
          userId,
          startupId,
        },
      },
      update: { accessLevel },
      create: {
        userId,
        startupId,
        accessLevel,
        assignedBy,
      },
    });
  }

  async unassign(startupId: string, userId: string): Promise<void> {
    await prisma.startupAssignment.deleteMany({
      where: {
        userId,
        startupId,
      },
    });
  }
}

export const startupService = new StartupService();
