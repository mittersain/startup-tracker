import { Router, type Request, type Response } from 'express';
import { prisma } from '../utils/prisma.js';
import { aiService, type EvaluationQuestion } from '../services/ai.service.js';
import { emailService } from '../services/email.service.js';

export const evaluationRouter = Router();

/**
 * Get evaluation for a startup
 */
evaluationRouter.get('/:startupId', async (req: Request, res: Response) => {
  try {
    const { startupId } = req.params;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get evaluation with QA rounds
    const evaluation = await prisma.startupEvaluation.findUnique({
      where: { startupId: startupId as string },
      include: {
        qaRounds: {
          orderBy: { roundNumber: 'asc' },
        },
        startup: {
          select: {
            id: true,
            name: true,
            description: true,
            website: true,
            stage: true,
            sector: true,
            founders: true,
            businessModelAnalysis: true,
          },
        },
      },
    });

    if (!evaluation) {
      res.status(404).json({ error: 'Evaluation not found' });
      return;
    }

    res.json(evaluation);
  } catch (error) {
    console.error('Error fetching evaluation:', error);
    res.status(500).json({ error: 'Failed to fetch evaluation' });
  }
});

/**
 * Create or initialize evaluation for a startup
 */
evaluationRouter.post('/:startupId/initialize', async (req: Request, res: Response) => {
  try {
    const { startupId } = req.params;
    const { isPostRevenue } = req.body;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Check if startup exists
    const startup = await prisma.startup.findUnique({
      where: { id: startupId as string },
      include: {
        pitchDecks: {
          orderBy: { uploadedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!startup) {
      res.status(404).json({ error: 'Startup not found' });
      return;
    }

    // Check if evaluation already exists
    let evaluation = await prisma.startupEvaluation.findUnique({
      where: { startupId: startupId as string },
    });

    if (evaluation) {
      res.json({ evaluation, message: 'Evaluation already exists' });
      return;
    }

    // Create new evaluation
    evaluation = await prisma.startupEvaluation.create({
      data: {
        startupId: startupId as string,
        organizationId,
        isPostRevenue: isPostRevenue ?? false,
        stage: 'presentation_review',
      },
    });

    res.json({ evaluation, message: 'Evaluation initialized' });
  } catch (error) {
    console.error('Error initializing evaluation:', error);
    res.status(500).json({ error: 'Failed to initialize evaluation' });
  }
});

/**
 * Generate questions for a QA round
 */
evaluationRouter.post('/:startupId/generate-questions', async (req: Request, res: Response) => {
  try {
    const { startupId } = req.params;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!aiService.enabled) {
      res.status(400).json({ error: 'AI service not enabled' });
      return;
    }

    // Get startup and evaluation
    const startup = await prisma.startup.findUnique({
      where: { id: startupId as string },
      include: {
        pitchDecks: {
          orderBy: { uploadedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!startup) {
      res.status(404).json({ error: 'Startup not found' });
      return;
    }

    const evaluation = await prisma.startupEvaluation.findUnique({
      where: { startupId: startupId as string },
      include: {
        qaRounds: {
          orderBy: { roundNumber: 'asc' },
        },
      },
    });

    if (!evaluation) {
      res.status(404).json({ error: 'Evaluation not found. Initialize first.' });
      return;
    }

    // Check if max rounds reached
    if (evaluation.qaRoundsCompleted >= 3) {
      res.status(400).json({ error: 'Maximum Q&A rounds (3) already completed' });
      return;
    }

    // Check if max questions reached
    if (evaluation.totalQuestionsAsked >= 10) {
      res.status(400).json({ error: 'Maximum questions (10) already asked' });
      return;
    }

    // Collect previous Q&A
    const previousQA: Array<{ question: string; answer: string }> = [];
    for (const round of evaluation.qaRounds) {
      if (round.status === 'analyzed' && round.responses) {
        const questions = round.questions as Array<{ id: string; question: string }>;
        const responses = round.responses as Array<{ questionId: string; answer: string }>;
        for (const q of questions) {
          const response = responses.find((r) => r.questionId === q.id);
          if (response) {
            previousQA.push({ question: q.question, answer: response.answer });
          }
        }
      }
    }

    // Get pitch deck content if available
    const pitchDeckContent = startup.pitchDecks[0]?.extractedText || null;
    const existingAnalysis = startup.businessModelAnalysis as Record<string, unknown> | null;

    // Get founder info
    const founders = startup.founders as Array<{ name?: string }> | null;
    const founderName = founders?.[0]?.name || null;

    // Generate questions
    const roundNumber = evaluation.qaRoundsCompleted + 1;
    const questions = await aiService.generateEvaluationQuestions(
      {
        name: startup.name,
        description: startup.description,
        website: startup.website,
        founderName,
        stage: startup.stage,
        sector: startup.sector,
        pitchDeckContent,
        existingAnalysis: existingAnalysis as Parameters<typeof aiService.generateEvaluationQuestions>[0]['existingAnalysis'],
      },
      roundNumber,
      previousQA
    );

    // Create QA round (draft status)
    const qaRound = await prisma.evaluationQARound.create({
      data: {
        evaluationId: evaluation.id,
        roundNumber,
        questions: questions as unknown as Parameters<typeof prisma.evaluationQARound.create>[0]['data']['questions'],
        questionCount: questions.length,
        status: 'draft',
      },
    });

    res.json({
      qaRound,
      questions,
      roundNumber,
      remainingQuestions: 10 - evaluation.totalQuestionsAsked - questions.length,
    });
  } catch (error) {
    console.error('Error generating questions:', error);
    res.status(500).json({ error: 'Failed to generate questions' });
  }
});

/**
 * Send Q&A email to founder
 */
evaluationRouter.post('/:startupId/send-questions', async (req: Request, res: Response) => {
  try {
    const { startupId } = req.params;
    const { qaRoundId, customEmail } = req.body;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get startup
    const startup = await prisma.startup.findUnique({
      where: { id: startupId as string },
      include: {
        contacts: {
          where: { matchType: 'confirmed' },
          take: 1,
        },
      },
    });

    if (!startup) {
      res.status(404).json({ error: 'Startup not found' });
      return;
    }

    // Get QA round
    const qaRound = await prisma.evaluationQARound.findUnique({
      where: { id: qaRoundId },
      include: { evaluation: true },
    });

    if (!qaRound) {
      res.status(404).json({ error: 'QA round not found' });
      return;
    }

    if (qaRound.status !== 'draft') {
      res.status(400).json({ error: 'QA round already sent' });
      return;
    }

    // Get founder email
    const founderEmail = startup.contacts[0]?.email;
    if (!founderEmail) {
      res.status(400).json({ error: 'No founder email found for this startup' });
      return;
    }

    // Get founder name
    const founders = startup.founders as Array<{ name?: string }> | null;
    const founderName = founders?.[0]?.name || null;

    // Generate or use custom email
    let emailBody = customEmail;
    if (!emailBody && aiService.enabled) {
      const questions = qaRound.questions as unknown as EvaluationQuestion[];
      emailBody = await aiService.generateQAEmail(
        { name: startup.name, founderName },
        questions,
        qaRound.roundNumber
      );
    }

    if (!emailBody) {
      res.status(400).json({ error: 'Email body required' });
      return;
    }

    // Send email
    const subject = qaRound.roundNumber === 1
      ? `Re: ${startup.name} - Follow-up Questions`
      : `Re: ${startup.name} - Additional Questions`;

    await emailService.sendEmail({
      to: founderEmail,
      subject,
      body: emailBody,
      organizationId,
      userId,
      startupId: startupId as string,
    });

    const messageId = `eval-${qaRound.id}-${Date.now()}`;

    // Update QA round
    await prisma.evaluationQARound.update({
      where: { id: qaRoundId },
      data: {
        status: 'sent',
        emailSentAt: new Date(),
        emailMessageId: messageId,
      },
    });

    // Update evaluation
    const questions = qaRound.questions as unknown as EvaluationQuestion[];
    await prisma.startupEvaluation.update({
      where: { id: qaRound.evaluationId },
      data: {
        totalQuestionsAsked: { increment: questions.length },
        stage: `qa_round_${qaRound.roundNumber}`,
      },
    });

    res.json({
      success: true,
      messageId,
      message: 'Questions sent to founder',
    });
  } catch (error) {
    console.error('Error sending questions:', error);
    res.status(500).json({ error: 'Failed to send questions' });
  }
});

/**
 * Record founder's response to questions
 */
evaluationRouter.post('/:startupId/record-response', async (req: Request, res: Response) => {
  try {
    const { startupId } = req.params;
    const { qaRoundId, emailBody, manualResponses } = req.body;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get QA round
    const qaRound = await prisma.evaluationQARound.findUnique({
      where: { id: qaRoundId },
      include: { evaluation: true },
    });

    if (!qaRound) {
      res.status(404).json({ error: 'QA round not found' });
      return;
    }

    if (qaRound.status !== 'sent') {
      res.status(400).json({ error: 'QA round not in sent state' });
      return;
    }

    const questions = qaRound.questions as unknown as EvaluationQuestion[];
    let responses: Array<{ questionId: string; answer: string }>;

    if (manualResponses) {
      // Manual responses provided
      responses = manualResponses;
    } else if (emailBody && aiService.enabled) {
      // Parse responses from email using AI
      responses = await aiService.parseQAResponses(questions, emailBody);
    } else {
      res.status(400).json({ error: 'Either emailBody or manualResponses required' });
      return;
    }

    // Update QA round
    await prisma.evaluationQARound.update({
      where: { id: qaRoundId },
      data: {
        status: 'answered',
        responses: responses as unknown as Parameters<typeof prisma.evaluationQARound.update>[0]['data']['responses'],
        responseReceivedAt: new Date(),
      },
    });

    // Update evaluation
    await prisma.startupEvaluation.update({
      where: { id: qaRound.evaluationId },
      data: {
        totalQuestionsAnswered: { increment: responses.filter((r) => r.answer !== 'Not answered').length },
        qaRoundsCompleted: { increment: 1 },
      },
    });

    res.json({
      success: true,
      responses,
      message: 'Responses recorded',
    });
  } catch (error) {
    console.error('Error recording response:', error);
    res.status(500).json({ error: 'Failed to record response' });
  }
});

/**
 * Generate final score for startup
 */
evaluationRouter.post('/:startupId/score', async (req: Request, res: Response) => {
  try {
    const { startupId } = req.params;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!aiService.enabled) {
      res.status(400).json({ error: 'AI service not enabled' });
      return;
    }

    // Get startup with evaluation and QA rounds
    const startup = await prisma.startup.findUnique({
      where: { id: startupId as string },
      include: {
        pitchDecks: {
          orderBy: { uploadedAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!startup) {
      res.status(404).json({ error: 'Startup not found' });
      return;
    }

    const evaluation = await prisma.startupEvaluation.findUnique({
      where: { startupId: startupId as string },
      include: {
        qaRounds: {
          orderBy: { roundNumber: 'asc' },
        },
      },
    });

    if (!evaluation) {
      res.status(404).json({ error: 'Evaluation not found' });
      return;
    }

    // Collect all Q&A history
    const qaHistory: Array<{ question: string; answer: string }> = [];
    for (const round of evaluation.qaRounds) {
      if (round.responses) {
        const questions = round.questions as Array<{ id: string; question: string }>;
        const responses = round.responses as Array<{ questionId: string; answer: string }>;
        for (const q of questions) {
          const response = responses.find((r) => r.questionId === q.id);
          if (response && response.answer !== 'Not answered') {
            qaHistory.push({ question: q.question, answer: response.answer });
          }
        }
      }
    }

    // Get pitch deck content
    const pitchDeckContent = startup.pitchDecks[0]?.extractedText || null;
    const existingAnalysis = startup.businessModelAnalysis as Record<string, unknown> | null;

    // Get founder info
    const founders = startup.founders as Array<{ name?: string }> | null;
    const founderName = founders?.[0]?.name || null;

    // Generate score
    const scoreResult = await aiService.scoreStartupEvaluation(
      {
        name: startup.name,
        description: startup.description,
        website: startup.website,
        founderName,
        stage: startup.stage,
        sector: startup.sector,
        pitchDeckContent,
        existingAnalysis: existingAnalysis as Parameters<typeof aiService.scoreStartupEvaluation>[0]['existingAnalysis'],
      },
      qaHistory,
      evaluation.isPostRevenue
    );

    // Update evaluation with scores
    await prisma.startupEvaluation.update({
      where: { id: evaluation.id },
      data: {
        stage: 'scoring_complete',
        totalScore: scoreResult.totalScore,

        // Thiel scores
        thielScore: scoreResult.thielScore,
        contrarianInsight: scoreResult.contrarianInsight as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['contrarianInsight'],
        productAdvantage10x: scoreResult.productAdvantage10x as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['productAdvantage10x'],
        monopolyPotential: scoreResult.monopolyPotential as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['monopolyPotential'],
        moatDurability: scoreResult.moatDurability as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['moatDurability'],
        longTermViability: scoreResult.longTermViability as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['longTermViability'],
        founderQuality: scoreResult.founderQuality as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['founderQuality'],
        teamLeverage: scoreResult.teamLeverage as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['teamLeverage'],
        timing: scoreResult.timing as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['timing'],
        distributionAdvantage: scoreResult.distributionAdvantage as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['distributionAdvantage'],
        missionPurpose: scoreResult.missionPurpose as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['missionPurpose'],

        // Founder scores
        founderTeamScore: scoreResult.founderTeamScore,
        determination: scoreResult.determination as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['determination'],
        founderMarketFit: scoreResult.founderMarketFit as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['founderMarketFit'],
        cofounderChemistry: scoreResult.cofounderChemistry as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['cofounderChemistry'],
        adaptability: scoreResult.adaptability as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['adaptability'],

        // Market scores
        marketScore: scoreResult.marketScore,
        tamSizeGrowth: scoreResult.tamSizeGrowth as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['tamSizeGrowth'],
        winnerTakeAll: scoreResult.winnerTakeAll as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['winnerTakeAll'],
        competitiveLandscape: scoreResult.competitiveLandscape as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['competitiveLandscape'],

        // Traction scores
        tractionScore: scoreResult.tractionScore,
        revenueGrowth: scoreResult.revenueGrowth as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['revenueGrowth'],
        userCustomerGrowth: scoreResult.userCustomerGrowth as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['userCustomerGrowth'],
        unitEconomics: scoreResult.unitEconomics as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['unitEconomics'],
        retentionChurn: scoreResult.retentionChurn as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['retentionChurn'],

        // Business model scores
        businessModelScore: scoreResult.businessModelScore,
        scalability: scoreResult.scalability as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['scalability'],
        pathToProfitability: scoreResult.pathToProfitability as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['pathToProfitability'],
        capitalEfficiency: scoreResult.capitalEfficiency as unknown as Parameters<typeof prisma.startupEvaluation.update>[0]['data']['capitalEfficiency'],

        // Overall
        overallCommentary: scoreResult.overallCommentary,
        strengths: scoreResult.strengths,
        concerns: scoreResult.concerns,
        recommendation: scoreResult.recommendation,

        scoredAt: new Date(),
        scoredBy: 'ai',
      },
    });

    // Also update startup's current score
    await prisma.startup.update({
      where: { id: startupId as string },
      data: {
        currentScore: scoreResult.totalScore,
        scoreUpdatedAt: new Date(),
      },
    });

    res.json({
      success: true,
      score: scoreResult,
      message: 'Scoring complete',
    });
  } catch (error) {
    console.error('Error scoring startup:', error);
    res.status(500).json({ error: 'Failed to score startup' });
  }
});

/**
 * Get score breakdown for display
 */
evaluationRouter.get('/:startupId/score-breakdown', async (req: Request, res: Response) => {
  try {
    const { startupId } = req.params;
    const userId = req.user?.id;
    const organizationId = req.user?.organizationId;

    if (!userId || !organizationId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const evaluation = await prisma.startupEvaluation.findUnique({
      where: { startupId: startupId as string },
      include: {
        startup: {
          select: { name: true },
        },
      },
    });

    if (!evaluation) {
      res.status(404).json({ error: 'Evaluation not found' });
      return;
    }

    if (!evaluation.totalScore) {
      res.status(400).json({ error: 'Startup not yet scored' });
      return;
    }

    // Format score breakdown for frontend
    const breakdown = {
      startupName: evaluation.startup.name,
      totalScore: evaluation.totalScore,
      isPostRevenue: evaluation.isPostRevenue,
      recommendation: evaluation.recommendation,
      overallCommentary: evaluation.overallCommentary,
      strengths: evaluation.strengths,
      concerns: evaluation.concerns,

      sections: [
        {
          name: 'Thiel Criteria',
          score: evaluation.thielScore,
          maxScore: evaluation.isPostRevenue ? 50 : 58,
          weight: '50%',
          criteria: [
            { name: 'Contrarian Insight / Secret', ...evaluation.contrarianInsight as object },
            { name: '10x Product Advantage', ...evaluation.productAdvantage10x as object },
            { name: 'Monopoly Potential', ...evaluation.monopolyPotential as object },
            { name: 'Moat Durability', ...evaluation.moatDurability as object },
            { name: 'Long-Term Viability', ...evaluation.longTermViability as object },
            { name: 'Founder Quality', ...evaluation.founderQuality as object },
            { name: 'Team Leverage', ...evaluation.teamLeverage as object },
            { name: 'Timing', ...evaluation.timing as object },
            { name: 'Distribution Advantage', ...evaluation.distributionAdvantage as object },
            { name: 'Mission & Purpose', ...evaluation.missionPurpose as object },
          ],
        },
        {
          name: 'Founder & Team',
          score: evaluation.founderTeamScore,
          maxScore: evaluation.isPostRevenue ? 15 : 22,
          weight: evaluation.isPostRevenue ? '15%' : '22%',
          criteria: [
            { name: 'Determination', ...evaluation.determination as object },
            { name: 'Founder-Market Fit', ...evaluation.founderMarketFit as object },
            { name: 'Cofounder Chemistry', ...evaluation.cofounderChemistry as object },
            { name: 'Adaptability', ...evaluation.adaptability as object },
          ],
        },
        {
          name: 'Market Opportunity',
          score: evaluation.marketScore,
          maxScore: 10,
          weight: '10%',
          criteria: [
            { name: 'TAM Size & Growth', ...evaluation.tamSizeGrowth as object },
            { name: 'Winner-Take-All Dynamics', ...evaluation.winnerTakeAll as object },
            { name: 'Competitive Landscape', ...evaluation.competitiveLandscape as object },
          ],
        },
        ...(evaluation.isPostRevenue
          ? [
              {
                name: 'Traction & Metrics',
                score: evaluation.tractionScore,
                maxScore: 15,
                weight: '15%',
                criteria: [
                  { name: 'Revenue Growth', ...evaluation.revenueGrowth as object },
                  { name: 'User/Customer Growth', ...evaluation.userCustomerGrowth as object },
                  { name: 'Unit Economics', ...evaluation.unitEconomics as object },
                  { name: 'Retention/Churn', ...evaluation.retentionChurn as object },
                ],
              },
            ]
          : []),
        {
          name: 'Business Model',
          score: evaluation.businessModelScore,
          maxScore: 10,
          weight: '10%',
          criteria: [
            { name: 'Scalability', ...evaluation.scalability as object },
            { name: 'Path to Profitability', ...evaluation.pathToProfitability as object },
            { name: 'Capital Efficiency', ...evaluation.capitalEfficiency as object },
          ],
        },
      ],

      qaHistory: {
        roundsCompleted: evaluation.qaRoundsCompleted,
        questionsAsked: evaluation.totalQuestionsAsked,
        questionsAnswered: evaluation.totalQuestionsAnswered,
      },

      scoredAt: evaluation.scoredAt,
    };

    res.json(breakdown);
  } catch (error) {
    console.error('Error fetching score breakdown:', error);
    res.status(500).json({ error: 'Failed to fetch score breakdown' });
  }
});
