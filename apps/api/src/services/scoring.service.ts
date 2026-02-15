import prisma from '../utils/prisma.js';
import type { ScoreBreakdown, ScoreEvent, ScoreCategory } from '@startup-tracker/shared';

interface ScoreEventInput {
  startupId: string;
  source: 'deck' | 'email' | 'meeting' | 'research' | 'manual' | 'system';
  sourceId?: string;
  category: ScoreCategory;
  signal: string;
  impact: number;
  confidence?: number;
  evidence?: string;
  analyzedBy: 'ai' | 'user';
  userId?: string;
}

interface AlertRule {
  threshold: number;
  urgency: 'low' | 'medium' | 'high';
}

const ALERT_RULES: Record<string, AlertRule> = {
  major_increase: { threshold: 5, urgency: 'medium' },
  major_decrease: { threshold: -5, urgency: 'high' },
};

const RED_FLAG_CATEGORIES = ['metric_inconsistency', 'team_departure', 'runway_concern'];

export class ScoringService {
  /**
   * Add a score event and recalculate the startup's score
   */
  async addScoreEvent(input: ScoreEventInput): Promise<ScoreEvent> {
    // Validate and clamp impact and confidence
    const impact = Math.max(-10, Math.min(10, input.impact));
    const confidence = Math.max(0, Math.min(1, input.confidence ?? 1.0));

    // Create the event
    const event = await prisma.scoreEvent.create({
      data: {
        startupId: input.startupId,
        source: input.source,
        sourceId: input.sourceId,
        category: input.category,
        signal: input.signal,
        impact,
        confidence,
        evidence: input.evidence,
        analyzedBy: input.analyzedBy,
        userId: input.userId,
      },
    });

    // Recalculate score
    await this.recalculateScore(input.startupId);

    return event as unknown as ScoreEvent;
  }

  /**
   * Add multiple score events at once (e.g., from deck analysis)
   */
  async addScoreEvents(events: ScoreEventInput[]): Promise<void> {
    if (events.length === 0) return;

    await prisma.scoreEvent.createMany({
      data: events.map((e) => ({
        startupId: e.startupId,
        source: e.source,
        sourceId: e.sourceId,
        category: e.category,
        signal: e.signal,
        impact: Math.max(-10, Math.min(10, e.impact)),
        confidence: Math.max(0, Math.min(1, e.confidence ?? 1.0)),
        evidence: e.evidence,
        analyzedBy: e.analyzedBy,
        userId: e.userId,
      })),
    });

    // Get unique startup IDs and recalculate each
    const startupIds = [...new Set(events.map((e) => e.startupId))];
    await Promise.all(startupIds.map((id) => this.recalculateScore(id)));
  }

  /**
   * Recalculate a startup's score based on all events
   */
  async recalculateScore(startupId: string): Promise<{ currentScore: number; breakdown: ScoreBreakdown }> {
    // Get the startup with its base score
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: {
        id: true,
        organizationId: true,
        baseScore: true,
        currentScore: true,
        scoreBreakdown: true,
      },
    });

    if (!startup) {
      throw new Error(`Startup ${startupId} not found`);
    }

    // Get all score events for this startup
    const events = await prisma.scoreEvent.findMany({
      where: { startupId },
      orderBy: { timestamp: 'desc' },
    });

    // Initialize breakdown from base score or defaults
    // Safely parse existing breakdown, falling back to defaults if corrupted
    let existingBreakdown: ScoreBreakdown | null = null;
    try {
      const raw = startup.scoreBreakdown as Record<string, unknown> | null;
      if (raw && typeof raw === 'object' && 'team' in raw && 'market' in raw) {
        existingBreakdown = raw as ScoreBreakdown;
      }
    } catch {
      existingBreakdown = null;
    }

    const breakdown: ScoreBreakdown = {
      team: {
        base: existingBreakdown?.team?.base ?? 0,
        adjusted: 0,
        subcriteria: existingBreakdown?.team?.subcriteria ?? {},
      },
      market: {
        base: existingBreakdown?.market?.base ?? 0,
        adjusted: 0,
        subcriteria: existingBreakdown?.market?.subcriteria ?? {},
      },
      product: {
        base: existingBreakdown?.product?.base ?? 0,
        adjusted: 0,
        subcriteria: existingBreakdown?.product?.subcriteria ?? {},
      },
      traction: {
        base: existingBreakdown?.traction?.base ?? 0,
        adjusted: 0,
        subcriteria: existingBreakdown?.traction?.subcriteria ?? {},
      },
      deal: {
        base: existingBreakdown?.deal?.base ?? 0,
        adjusted: 0,
        subcriteria: existingBreakdown?.deal?.subcriteria ?? {},
      },
      communication: 0,
      momentum: 0,
      redFlags: 0,
    };

    // Apply events with time decay
    const now = new Date();
    for (const event of events) {
      // Clamp impact and confidence to valid ranges
      const impact = Math.max(-10, Math.min(10, event.impact));
      const confidence = Math.max(0, Math.min(1, event.confidence));

      const decayFactor = this.calculateDecay(event.timestamp, now);
      const weightedImpact = impact * confidence * decayFactor;

      switch (event.category) {
        case 'communication':
          breakdown.communication += weightedImpact;
          break;
        case 'momentum':
          breakdown.momentum += weightedImpact;
          break;
        case 'red_flag':
          breakdown.redFlags += weightedImpact;
          break;
        case 'team':
        case 'market':
        case 'product':
        case 'traction':
        case 'deal': {
          const category = event.category as 'team' | 'market' | 'product' | 'traction' | 'deal';
          breakdown[category].adjusted += weightedImpact;
          break;
        }
      }
    }

    // Clamp cumulative categories to reasonable bounds (-20 to +20)
    breakdown.communication = Math.max(-20, Math.min(20, breakdown.communication));
    breakdown.momentum = Math.max(-20, Math.min(20, breakdown.momentum));
    breakdown.redFlags = Math.max(0, Math.min(30, Math.abs(breakdown.redFlags)));

    // Calculate base score from category bases
    const baseScore = startup.baseScore ??
      breakdown.team.base +
      breakdown.market.base +
      breakdown.product.base +
      breakdown.traction.base +
      breakdown.deal.base;

    // Calculate adjustments (red flags are subtracted)
    const adjustments =
      breakdown.team.adjusted +
      breakdown.market.adjusted +
      breakdown.product.adjusted +
      breakdown.traction.adjusted +
      breakdown.deal.adjusted +
      breakdown.communication +
      breakdown.momentum -
      Math.abs(breakdown.redFlags);

    // Final score (capped 0-100)
    const currentScore = Math.max(0, Math.min(100, Math.round(baseScore + adjustments)));

    // Calculate trend (30-day window)
    const { trend, delta } = await this.calculateTrend(startupId, currentScore);

    // Update startup
    const previousScore = startup.currentScore;
    await prisma.startup.update({
      where: { id: startupId },
      data: {
        currentScore,
        scoreBreakdown: breakdown as unknown as object,
        scoreTrend: trend,
        scoreTrendDelta: delta,
        scoreUpdatedAt: now,
      },
    });

    // Check for alerts
    if (previousScore !== null && previousScore !== undefined) {
      await this.checkAlerts(startup.organizationId, startupId, previousScore, currentScore, events[0]);
    }

    return { currentScore, breakdown };
  }

  /**
   * Calculate time decay factor for an event
   * Events older than 90 days have 50% weight
   */
  private calculateDecay(eventDate: Date, now: Date): number {
    const daysDiff = (now.getTime() - eventDate.getTime()) / (1000 * 60 * 60 * 24);

    if (daysDiff <= 7) return 1.0; // Full weight for recent events
    if (daysDiff <= 30) return 0.9;
    if (daysDiff <= 60) return 0.75;
    if (daysDiff <= 90) return 0.6;
    return 0.5;
  }

  /**
   * Calculate score trend over the last 30 days
   */
  private async calculateTrend(
    startupId: string,
    currentScore: number
  ): Promise<{ trend: 'up' | 'down' | 'stable'; delta: number }> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get the most recent score snapshot from ~30 days ago
    // by checking score alerts or computing from history
    const recentEvents = await prisma.scoreEvent.findMany({
      where: {
        startupId,
        timestamp: { gte: thirtyDaysAgo },
      },
      select: { impact: true, confidence: true, category: true },
    });

    // Sum weighted impacts with decay, accounting for red flags
    const now = new Date();
    const delta = recentEvents.reduce((sum, e) => {
      const impact = Math.max(-10, Math.min(10, e.impact));
      const confidence = Math.max(0, Math.min(1, e.confidence));
      const weighted = impact * confidence;
      // Red flags should be subtracted
      return e.category === 'red_flag' ? sum - Math.abs(weighted) : sum + weighted;
    }, 0);

    let trend: 'up' | 'down' | 'stable';
    if (delta > 2) {
      trend = 'up';
    } else if (delta < -2) {
      trend = 'down';
    } else {
      trend = 'stable';
    }

    return { trend, delta: Math.round(delta * 10) / 10 };
  }

  /**
   * Check if score change triggers any alerts
   */
  private async checkAlerts(
    organizationId: string,
    startupId: string,
    previousScore: number,
    newScore: number,
    triggerEvent?: { signal: string; category: string }
  ): Promise<void> {
    const scoreDelta = newScore - previousScore;
    const alerts: Array<{
      type: string;
      urgency: string;
      trigger: string;
    }> = [];

    // Major increase
    if (scoreDelta >= ALERT_RULES['major_increase']!.threshold) {
      alerts.push({
        type: 'major_increase',
        urgency: ALERT_RULES['major_increase']!.urgency,
        trigger: triggerEvent?.signal ?? 'Score increased',
      });
    }

    // Major decrease
    if (scoreDelta <= ALERT_RULES['major_decrease']!.threshold) {
      alerts.push({
        type: 'major_decrease',
        urgency: ALERT_RULES['major_decrease']!.urgency,
        trigger: triggerEvent?.signal ?? 'Score decreased',
      });
    }

    // Red flag
    if (triggerEvent && RED_FLAG_CATEGORIES.includes(triggerEvent.category)) {
      alerts.push({
        type: 'red_flag',
        urgency: 'high',
        trigger: triggerEvent.signal,
      });
    }

    // Milestone crossings (detect all crossed thresholds, not just the first)
    const milestones = [90, 80, 70, 50];
    for (const milestone of milestones) {
      if (
        (previousScore < milestone && newScore >= milestone) ||
        (previousScore >= milestone && newScore < milestone)
      ) {
        alerts.push({
          type: 'milestone',
          urgency: 'medium',
          trigger: `Score crossed ${milestone} threshold`,
        });
      }
    }

    // Create alerts
    if (alerts.length > 0) {
      await prisma.scoreAlert.createMany({
        data: alerts.map((alert) => ({
          organizationId,
          startupId,
          type: alert.type,
          previousScore,
          newScore,
          trigger: alert.trigger,
          urgency: alert.urgency,
        })),
      });
    }
  }

  /**
   * Set base score from deck analysis
   */
  async setBaseScore(startupId: string, breakdown: ScoreBreakdown): Promise<void> {
    const baseScore =
      breakdown.team.base +
      breakdown.market.base +
      breakdown.product.base +
      breakdown.traction.base +
      breakdown.deal.base;

    await prisma.startup.update({
      where: { id: startupId },
      data: {
        baseScore,
        currentScore: baseScore,
        scoreBreakdown: breakdown as unknown as object,
        scoreUpdatedAt: new Date(),
      },
    });
  }

  /**
   * Get score history for a startup
   */
  async getScoreHistory(
    startupId: string,
    days = 30
  ): Promise<Array<{ date: Date; score: number; events: number }>> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Get the startup's base score
    const startup = await prisma.startup.findUnique({
      where: { id: startupId },
      select: { baseScore: true },
    });
    const baseScore = startup?.baseScore ?? 0;

    // Get ALL events (not just recent) to compute accurate running scores
    const allEvents = await prisma.scoreEvent.findMany({
      where: { startupId },
      orderBy: { timestamp: 'asc' },
    });

    // Group events by day and compute actual score snapshots with time decay
    const dailyData = new Map<string, { score: number; events: number }>();

    // For each day in the range, calculate the score as it would have been on that day
    const current = new Date(startDate);
    const endDate = new Date();
    while (current <= endDate) {
      const dateKey = current.toISOString().split('T')[0]!;
      const dayEnd = new Date(current);
      dayEnd.setHours(23, 59, 59, 999);

      // Get events up to this day and apply time decay relative to this day
      const eventsUpToDay = allEvents.filter((e) => e.timestamp <= dayEnd);
      const dayEventCount = allEvents.filter((e) => {
        const eKey = e.timestamp.toISOString().split('T')[0];
        return eKey === dateKey;
      }).length;

      if (dayEventCount > 0 || dailyData.size === 0) {
        let adjustments = 0;
        for (const event of eventsUpToDay) {
          const decayFactor = this.calculateDecay(event.timestamp, dayEnd);
          const weightedImpact = event.impact * event.confidence * decayFactor;
          // Red flags should be subtracted
          if (event.category === 'red_flag') {
            adjustments -= Math.abs(weightedImpact);
          } else {
            adjustments += weightedImpact;
          }
        }

        const score = Math.max(0, Math.min(100, Math.round(baseScore + adjustments)));
        dailyData.set(dateKey, { score, events: dayEventCount });
      }

      current.setDate(current.getDate() + 1);
    }

    // Convert to array
    return Array.from(dailyData.entries()).map(([date, data]) => ({
      date: new Date(date),
      score: data.score,
      events: data.events,
    }));
  }

  /**
   * Get all events for a startup
   */
  async getEvents(
    startupId: string,
    options?: { limit?: number; offset?: number; category?: ScoreCategory }
  ): Promise<{ events: ScoreEvent[]; total: number }> {
    const where = {
      startupId,
      ...(options?.category && { category: options.category }),
    };

    const [events, total] = await Promise.all([
      prisma.scoreEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
      }),
      prisma.scoreEvent.count({ where }),
    ]);

    return { events: events as unknown as ScoreEvent[], total };
  }
}

export const scoringService = new ScoringService();
