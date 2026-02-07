import prisma from '../utils/prisma.js';
import { aiService } from './ai.service.js';

export interface CumulativeAnalysis {
  // Understanding of the startup
  problem?: string;
  solution?: string;
  businessModel?: string;
  targetMarket?: string;
  competitiveAdvantage?: string;

  // Team
  founders?: Array<{ name?: string; role?: string; background?: string }>;
  teamStrengths?: string[];
  teamConcerns?: string[];

  // Traction & Metrics
  traction?: Record<string, unknown>;
  keyMetrics?: string[];
  growth?: string;

  // Financials
  askAmount?: string;
  valuation?: string;
  useOfFunds?: string[];

  // Assessment
  strengths: string[];
  weaknesses: string[];
  opportunities?: string[];
  risks?: string[];

  // Open questions
  unansweredQuestions: string[];
  answeredQuestions: Array<{ question: string; answer: string }>;

  // Overall
  investmentThesis?: string;
  recommendation?: string;
  confidenceLevel: number; // 0-100
}

export interface AnalysisEventInput {
  startupId: string;
  sourceType: 'email' | 'deck' | 'manual' | 'initial';
  sourceId?: string;
  sourceName?: string;
  inputSummary?: string;
  rawContent?: string;
  // For deck analysis
  deckAnalysis?: {
    extractedData: Record<string, unknown>;
    analysis: {
      strengths: string[];
      weaknesses: string[];
      questions?: string[];
      summary?: string;
    };
  };
  // For email analysis
  emailContent?: {
    subject: string;
    body: string;
    from: string;
    direction: 'inbound' | 'outbound';
  };
}

class AnalysisTrackerService {
  /**
   * Get the latest cumulative analysis for a startup
   */
  async getLatestAnalysis(startupId: string): Promise<CumulativeAnalysis | null> {
    try {
      const latestEvent = await prisma.analysisEvent.findFirst({
        where: { startupId },
        orderBy: { createdAt: 'desc' },
      });

      if (!latestEvent?.cumulativeAnalysis) {
        return null;
      }

      return latestEvent.cumulativeAnalysis as unknown as CumulativeAnalysis;
    } catch (error) {
      // Table might not exist yet
      console.warn('[AnalysisTracker] getLatestAnalysis failed:', error);
      return null;
    }
  }

  /**
   * Get all analysis events for a startup (timeline)
   */
  async getAnalysisTimeline(startupId: string): Promise<Array<{
    id: string;
    sourceType: string;
    sourceName: string | null;
    inputSummary: string | null;
    newInsights: unknown;
    concerns: unknown;
    questions: unknown;
    overallConfidence: number | null;
    createdAt: Date;
  }>> {
    try {
      const events = await prisma.analysisEvent.findMany({
        where: { startupId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          sourceType: true,
          sourceName: true,
          inputSummary: true,
          newInsights: true,
          concerns: true,
          questions: true,
          overallConfidence: true,
          createdAt: true,
        },
      });

      return events;
    } catch (error) {
      // Table might not exist yet
      console.warn('[AnalysisTracker] getAnalysisTimeline failed:', error);
      return [];
    }
  }

  /**
   * Create initial analysis event when a startup is first created
   */
  async createInitialAnalysis(
    startupId: string,
    proposal: {
      name: string;
      description?: string | null;
      website?: string | null;
      founderName?: string | null;
      stage?: string | null;
      askAmount?: string | null;
    },
    emailContext?: {
      subject?: string;
      body?: string;
      from?: string;
    },
    deckAnalysis?: AnalysisEventInput['deckAnalysis']
  ): Promise<void> {
    try {
      // Build initial cumulative analysis
      const initialAnalysis: CumulativeAnalysis = {
        problem: deckAnalysis?.extractedData?.problem as string || undefined,
        solution: deckAnalysis?.extractedData?.solution as string || proposal.description || undefined,
        founders: deckAnalysis?.extractedData?.team as CumulativeAnalysis['founders'] ||
          (proposal.founderName ? [{ name: proposal.founderName, role: 'Founder' }] : undefined),
        askAmount: deckAnalysis?.extractedData?.askAmount as string || proposal.askAmount || undefined,
        traction: deckAnalysis?.extractedData?.traction as Record<string, unknown> || undefined,
        strengths: deckAnalysis?.analysis?.strengths || [],
        weaknesses: deckAnalysis?.analysis?.weaknesses || [],
        unansweredQuestions: deckAnalysis?.analysis?.questions || [],
        answeredQuestions: [],
        confidenceLevel: deckAnalysis ? 40 : 20, // Higher confidence if we have a deck
      };

      // Build input summary
      const inputParts: string[] = [];
      if (emailContext?.subject) inputParts.push(`Email: "${emailContext.subject}"`);
      if (deckAnalysis) inputParts.push('Pitch deck analyzed');
      const inputSummary = inputParts.join(', ') || 'Initial proposal received';

      // Build new insights
      const newInsights: string[] = [];
      if (proposal.description) newInsights.push(`Company: ${proposal.description}`);
      if (proposal.founderName) newInsights.push(`Founder: ${proposal.founderName}`);
      if (proposal.stage) newInsights.push(`Stage: ${proposal.stage}`);
      if (proposal.askAmount) newInsights.push(`Raising: ${proposal.askAmount}`);
      if (deckAnalysis?.analysis?.summary) newInsights.push(deckAnalysis.analysis.summary);

      await prisma.analysisEvent.create({
        data: {
          startupId,
          sourceType: 'initial',
          sourceName: emailContext?.subject || 'Initial Proposal',
          inputSummary,
          newInsights: newInsights.length > 0 ? newInsights : undefined,
          concerns: deckAnalysis?.analysis?.weaknesses?.length
            ? deckAnalysis.analysis.weaknesses
            : undefined,
          questions: deckAnalysis?.analysis?.questions?.length
            ? deckAnalysis.analysis.questions
            : undefined,
          cumulativeAnalysis: initialAnalysis as unknown as object,
          overallConfidence: initialAnalysis.confidenceLevel / 100,
        },
      });
    } catch (error) {
      // Table might not exist yet - log but don't crash
      console.warn('[AnalysisTracker] createInitialAnalysis failed:', error);
    }
  }

  /**
   * Record analysis from a new pitch deck
   */
  async recordDeckAnalysis(
    startupId: string,
    deckId: string,
    fileName: string,
    deckAnalysis: NonNullable<AnalysisEventInput['deckAnalysis']>
  ): Promise<void> {
    try {
    const previousAnalysis = await this.getLatestAnalysis(startupId);

    // Build incremental analysis using AI
    let incrementalInsights: {
      newInsights: string[];
      updatedInsights: string[];
      confirmedInsights: string[];
      newConcerns: string[];
      resolvedConcerns: string[];
    } = {
      newInsights: [],
      updatedInsights: [],
      confirmedInsights: [],
      newConcerns: [],
      resolvedConcerns: [],
    };

    if (aiService.enabled && previousAnalysis) {
      try {
        incrementalInsights = await this.generateIncrementalAnalysis(
          previousAnalysis,
          'deck',
          deckAnalysis
        );
      } catch (error) {
        console.error('[AnalysisTracker] Failed to generate incremental analysis:', error);
      }
    }

    // Merge with previous analysis
    const updatedAnalysis: CumulativeAnalysis = previousAnalysis || {
      strengths: [],
      weaknesses: [],
      unansweredQuestions: [],
      answeredQuestions: [],
      confidenceLevel: 0,
    };

    // Update with deck data
    if (deckAnalysis.extractedData.problem) {
      updatedAnalysis.problem = deckAnalysis.extractedData.problem as string;
    }
    if (deckAnalysis.extractedData.solution) {
      updatedAnalysis.solution = deckAnalysis.extractedData.solution as string;
    }
    if (deckAnalysis.extractedData.team) {
      updatedAnalysis.founders = deckAnalysis.extractedData.team as CumulativeAnalysis['founders'];
    }
    if (deckAnalysis.extractedData.traction) {
      updatedAnalysis.traction = {
        ...updatedAnalysis.traction,
        ...(deckAnalysis.extractedData.traction as Record<string, unknown>),
      };
    }
    if (deckAnalysis.extractedData.askAmount) {
      updatedAnalysis.askAmount = deckAnalysis.extractedData.askAmount as string;
    }

    // Merge strengths and weaknesses (deduplicate)
    for (const s of deckAnalysis.analysis.strengths) {
      if (!updatedAnalysis.strengths.includes(s)) {
        updatedAnalysis.strengths.push(s);
      }
    }
    for (const w of deckAnalysis.analysis.weaknesses) {
      if (!updatedAnalysis.weaknesses.includes(w)) {
        updatedAnalysis.weaknesses.push(w);
      }
    }

    // Add new questions
    if (deckAnalysis.analysis.questions) {
      for (const q of deckAnalysis.analysis.questions) {
        if (!updatedAnalysis.unansweredQuestions.includes(q)) {
          updatedAnalysis.unansweredQuestions.push(q);
        }
      }
    }

    // Increase confidence
    updatedAnalysis.confidenceLevel = Math.min(
      updatedAnalysis.confidenceLevel + 15,
      85
    );

    await prisma.analysisEvent.create({
      data: {
        startupId,
        sourceType: 'deck',
        sourceId: deckId,
        sourceName: fileName,
        inputSummary: deckAnalysis.analysis.summary || `Pitch deck: ${fileName}`,
        newInsights: incrementalInsights.newInsights.length > 0
          ? incrementalInsights.newInsights
          : deckAnalysis.analysis.strengths,
        updatedInsights: incrementalInsights.updatedInsights.length > 0
          ? incrementalInsights.updatedInsights
          : undefined,
        confirmedInsights: incrementalInsights.confirmedInsights.length > 0
          ? incrementalInsights.confirmedInsights
          : undefined,
        concerns: deckAnalysis.analysis.weaknesses.length > 0
          ? deckAnalysis.analysis.weaknesses
          : undefined,
        questions: deckAnalysis.analysis.questions?.length
          ? deckAnalysis.analysis.questions
          : undefined,
        cumulativeAnalysis: updatedAnalysis as unknown as object,
        overallConfidence: updatedAnalysis.confidenceLevel / 100,
      },
    });
    } catch (error) {
      // Table might not exist yet - log but don't crash
      console.warn('[AnalysisTracker] recordDeckAnalysis failed:', error);
    }
  }

  /**
   * Record analysis from a new email
   */
  async recordEmailAnalysis(
    startupId: string,
    emailId: string,
    email: {
      subject: string;
      body: string;
      from: string;
      direction: 'inbound' | 'outbound';
    },
    emailAnalysis?: {
      signals?: Array<{ type: string; content: string; sentiment: string }>;
      answeredQuestions?: Array<{ question: string; answer: string }>;
      newInfo?: string[];
    }
  ): Promise<void> {
    try {
    const previousAnalysis = await this.getLatestAnalysis(startupId);

    if (!previousAnalysis) {
      // No previous analysis, skip (shouldn't happen in normal flow)
      return;
    }

    const updatedAnalysis = { ...previousAnalysis };

    // Track answered questions
    if (emailAnalysis?.answeredQuestions) {
      for (const qa of emailAnalysis.answeredQuestions) {
        // Remove from unanswered
        updatedAnalysis.unansweredQuestions = updatedAnalysis.unansweredQuestions.filter(
          q => !q.toLowerCase().includes(qa.question.toLowerCase().substring(0, 20))
        );
        // Add to answered
        updatedAnalysis.answeredQuestions.push(qa);
      }
    }

    // Increase confidence based on engagement
    if (email.direction === 'inbound') {
      updatedAnalysis.confidenceLevel = Math.min(
        updatedAnalysis.confidenceLevel + 5,
        95
      );
    }

    const inputSummary = email.direction === 'inbound'
      ? `Founder reply: "${email.subject}"`
      : `Sent: "${email.subject}"`;

    await prisma.analysisEvent.create({
      data: {
        startupId,
        sourceType: 'email',
        sourceId: emailId,
        sourceName: email.subject,
        inputSummary,
        newInsights: emailAnalysis?.newInfo?.length ? emailAnalysis.newInfo : undefined,
        concerns: emailAnalysis?.signals
          ?.filter(s => s.sentiment === 'negative')
          .map(s => s.content),
        cumulativeAnalysis: updatedAnalysis as unknown as object,
        overallConfidence: updatedAnalysis.confidenceLevel / 100,
      },
    });
    } catch (error) {
      // Table might not exist yet - log but don't crash
      console.warn('[AnalysisTracker] recordEmailAnalysis failed:', error);
    }
  }

  /**
   * Generate incremental analysis using AI
   */
  private async generateIncrementalAnalysis(
    previousAnalysis: CumulativeAnalysis,
    sourceType: 'deck' | 'email',
    newData: AnalysisEventInput['deckAnalysis'] | AnalysisEventInput['emailContent']
  ): Promise<{
    newInsights: string[];
    updatedInsights: string[];
    confirmedInsights: string[];
    newConcerns: string[];
    resolvedConcerns: string[];
  }> {
    const prompt = `You are analyzing new information about a startup. Compare it with what we already knew and identify what's new, updated, or confirmed.

PREVIOUS UNDERSTANDING:
${JSON.stringify(previousAnalysis, null, 2)}

NEW INFORMATION (${sourceType}):
${JSON.stringify(newData, null, 2)}

Analyze and return JSON with:
{
  "newInsights": ["Things we learned that we didn't know before"],
  "updatedInsights": ["Things that changed or became clearer"],
  "confirmedInsights": ["Things that were validated/confirmed"],
  "newConcerns": ["New concerns or red flags"],
  "resolvedConcerns": ["Previous concerns that are now addressed"]
}

Be specific and concise. Focus on meaningful changes.`;

    try {
      const response = await (aiService as any).callGemini(prompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error('[AnalysisTracker] AI incremental analysis failed:', error);
    }

    return {
      newInsights: [],
      updatedInsights: [],
      confirmedInsights: [],
      newConcerns: [],
      resolvedConcerns: [],
    };
  }

  /**
   * Get summary for draft reply generation
   */
  async getAnalysisSummaryForReply(startupId: string): Promise<{
    cumulativeAnalysis: CumulativeAnalysis | null;
    recentInsights: string[];
    openQuestions: string[];
    keyStrengths: string[];
    keyConcerns: string[];
  }> {
    const latestAnalysis = await this.getLatestAnalysis(startupId);

    if (!latestAnalysis) {
      return {
        cumulativeAnalysis: null,
        recentInsights: [],
        openQuestions: [],
        keyStrengths: [],
        keyConcerns: [],
      };
    }

    // Get last 3 analysis events for recent context
    const recentEvents = await prisma.analysisEvent.findMany({
      where: { startupId },
      orderBy: { createdAt: 'desc' },
      take: 3,
      select: { newInsights: true },
    });

    const recentInsights: string[] = [];
    for (const event of recentEvents) {
      if (Array.isArray(event.newInsights)) {
        recentInsights.push(...(event.newInsights as string[]));
      }
    }

    return {
      cumulativeAnalysis: latestAnalysis,
      recentInsights: recentInsights.slice(0, 5),
      openQuestions: latestAnalysis.unansweredQuestions.slice(0, 5),
      keyStrengths: latestAnalysis.strengths.slice(0, 5),
      keyConcerns: latestAnalysis.weaknesses.slice(0, 5),
    };
  }
}

export const analysisTrackerService = new AnalysisTrackerService();
