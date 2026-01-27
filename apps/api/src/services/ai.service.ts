import { GoogleGenerativeAI } from '@google/generative-ai';
import {
  buildDeckExtractionPrompt,
  buildDeckScoringPrompt,
  buildEmailAnalysisPrompt,
  buildCommunicationMetricsPrompt,
  type EmailAnalysisContext,
} from '@startup-tracker/ai-prompts';
import type {
  DeckExtractedData,
  DeckAnalysis,
  EmailAnalysis,
  ScoreBreakdown,
  CommunicationMetrics,
} from '@startup-tracker/shared';

export class AIService {
  private client: GoogleGenerativeAI | null = null;
  private model = 'gemini-2.0-flash';
  private _enabled = false;

  constructor() {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey);
      this._enabled = true;
      console.log('AI Service enabled (Gemini)');
    } else {
      console.log('AI Service disabled - GEMINI_API_KEY not set');
    }
  }

  get enabled(): boolean {
    return this._enabled;
  }

  private ensureEnabled(): void {
    if (!this.client) {
      throw new Error('AI features are disabled. Set GEMINI_API_KEY to enable.');
    }
  }

  /**
   * Call Gemini API with a prompt
   */
  private async callGemini(prompt: string): Promise<string> {
    this.ensureEnabled();

    const model = this.client!.getGenerativeModel({ model: this.model });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  }

  /**
   * Extract JSON from AI response
   */
  private extractJson<T>(text: string): T {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    return JSON.parse(jsonMatch[0]) as T;
  }

  /**
   * Extract structured data from a pitch deck
   */
  async extractDeckData(deckText: string): Promise<DeckExtractedData> {
    const prompt = buildDeckExtractionPrompt(deckText);
    const text = await this.callGemini(prompt);

    try {
      return this.extractJson<DeckExtractedData>(text);
    } catch {
      console.error('Failed to parse deck extraction response:', text);
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Score a startup based on extracted deck data
   */
  async scoreDeck(extractedData: DeckExtractedData): Promise<DeckAnalysis> {
    const prompt = buildDeckScoringPrompt(extractedData);
    const text = await this.callGemini(prompt);

    try {
      return this.extractJson<DeckAnalysis>(text);
    } catch {
      console.error('Failed to parse deck scoring response:', text);
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Analyze a single email for signals
   */
  async analyzeEmail(context: EmailAnalysisContext): Promise<EmailAnalysis> {
    const prompt = buildEmailAnalysisPrompt(context);
    const text = await this.callGemini(prompt);

    try {
      return this.extractJson<EmailAnalysis>(text);
    } catch {
      console.error('Failed to parse email analysis response:', text);
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Analyze communication patterns from email history
   */
  async analyzeCommunicationMetrics(
    startupName: string,
    emailHistory: Array<{ from: string; to: string; date: string; subject: string; body: string }>
  ): Promise<Partial<CommunicationMetrics>> {
    const prompt = buildCommunicationMetricsPrompt(startupName, emailHistory);
    const text = await this.callGemini(prompt);

    try {
      return this.extractJson<Partial<CommunicationMetrics>>(text);
    } catch {
      console.error('Failed to parse communication metrics response:', text);
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Process a full deck: extract data, score, and return analysis
   */
  async processDeck(
    deckText: string
  ): Promise<{ extractedData: DeckExtractedData; analysis: DeckAnalysis }> {
    // Step 1: Extract structured data
    const extractedData = await this.extractDeckData(deckText);

    // Step 2: Score the startup
    const analysis = await this.scoreDeck(extractedData);

    return { extractedData, analysis };
  }

  /**
   * Convert deck analysis to score breakdown format
   */
  analysisToBreakdown(analysis: DeckAnalysis): ScoreBreakdown {
    return analysis.breakdown;
  }

  /**
   * Analyze startup business model and categorize by sector/stage
   */
  async analyzeBusinessModel(startup: {
    name: string;
    description?: string | null;
    website?: string | null;
    founderName?: string | null;
    askAmount?: string | null;
    stage?: string | null;
    extractedData?: Record<string, unknown> | null;
  }): Promise<BusinessModelAnalysis> {
    const prompt = `You are an experienced venture capital analyst. Analyze this startup and provide a detailed business model analysis.

STARTUP INFORMATION:
- Name: ${startup.name}
- Description: ${startup.description || 'Not provided'}
- Website: ${startup.website || 'Not provided'}
- Founder: ${startup.founderName || 'Not provided'}
- Funding Ask: ${startup.askAmount || 'Not provided'}
- Stated Stage: ${startup.stage || 'Not provided'}
${startup.extractedData ? `- Additional Data: ${JSON.stringify(startup.extractedData)}` : ''}

Analyze and return a JSON object with this exact structure:
{
  "sector": "one of: fintech, healthtech, saas, ecommerce, edtech, deeptech, consumer, enterprise, marketplace, climate, other",
  "sectorConfidence": 0.0-1.0,
  "stage": "one of: pre_seed, seed, series_a, series_b, series_c, growth",
  "stageReasoning": "brief explanation of stage assessment",
  "businessModel": {
    "type": "one of: b2b, b2c, b2b2c, marketplace, platform, subscription, transactional, freemium, other",
    "revenueStreams": ["list of potential revenue streams"],
    "customerSegments": ["target customer segments"],
    "valueProposition": "core value proposition in 1-2 sentences"
  },
  "marketAnalysis": {
    "marketSize": "estimated market size or 'unknown'",
    "competition": "brief competitive landscape assessment",
    "timing": "why now? market timing assessment"
  },
  "strengths": ["list 2-4 key strengths based on available info"],
  "concerns": ["list 2-4 concerns or areas needing clarification"],
  "keyQuestions": ["5-7 important questions to ask the founder to improve analysis"]
}

Return ONLY valid JSON, no other text.`;

    const text = await this.callGemini(prompt);

    try {
      return this.extractJson<BusinessModelAnalysis>(text);
    } catch {
      console.error('Failed to parse business model analysis:', text);
      throw new Error('Failed to parse AI response');
    }
  }

  /**
   * Generate a draft reply email for a startup founder
   */
  async generateDraftReply(startup: {
    name: string;
    founderName?: string | null;
    founderEmail?: string | null;
    description?: string | null;
  }, analysis: BusinessModelAnalysis): Promise<string> {
    const founderFirstName = startup.founderName?.split(' ')[0] || 'there';

    const prompt = `You are a professional investor responding to a startup pitch. Write a warm, professional reply email that:

1. Thanks the founder for reaching out
2. Shows genuine interest in their startup
3. Asks 3-4 focused questions that will help evaluate the opportunity
4. Keeps it concise and easy for the founder to respond to
5. Avoids going into unnecessary details early on - we want to make it easy for the founder to reply

STARTUP INFO:
- Name: ${startup.name}
- Founder: ${startup.founderName || 'Unknown'}
- Description: ${startup.description || 'Not provided'}

KEY QUESTIONS FROM ANALYSIS (pick the most relevant 3-4):
${analysis.keyQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

CONCERNS TO SUBTLY ADDRESS:
${analysis.concerns.slice(0, 2).map((c, i) => `${i + 1}. ${c}`).join('\n')}

Write the email body only (no subject line). Start with "Hi ${founderFirstName}," and end with exactly this signature (no variations):

Best regards,
Agent Jarvis
(on behalf of Nitish Mittersain)

Keep it under 150 words. Be warm but professional. Focus on questions that are easy for a founder to answer quickly.`;

    const text = await this.callGemini(prompt);
    // Ensure the signature is correct and consistent
    let reply = text.trim();
    // Replace any placeholder or variation of the signature
    reply = reply.replace(/\[YOUR NAME\]/gi, 'Agent Jarvis\n(on behalf of Nitish Mittersain)');
    reply = reply.replace(/Best regards,?\s*\n.*$/si, 'Best regards,\nAgent Jarvis\n(on behalf of Nitish Mittersain)');
    return reply;
  }

  /**
   * Generate a polite rejection email for a startup founder
   */
  async generateRejectionEmail(startup: {
    name: string;
    founderName?: string | null;
    description?: string | null;
  }): Promise<string> {
    const founderFirstName = startup.founderName?.split(' ')[0] || 'there';

    const prompt = `You are a professional investor writing a polite rejection email to a startup founder. Write a brief, kind email that:

1. Thanks them for reaching out and sharing their pitch
2. Acknowledges their hard work (without being condescending)
3. Politely declines without being specific about reasons
4. Wishes them well on their journey
5. Keeps the door open if circumstances change significantly in the future

STARTUP INFO:
- Name: ${startup.name}
- Founder: ${startup.founderName || 'Unknown'}
- Description: ${startup.description || 'Not provided'}

Write the email body only (no subject line). Start with "Hi ${founderFirstName}," and end with exactly this signature (no variations):

Best regards,
Agent Jarvis
(on behalf of Nitish Mittersain)

Keep it under 100 words. Be warm, professional, and respectful. Never mention specific reasons for rejection.`;

    const text = await this.callGemini(prompt);
    let reply = text.trim();
    reply = reply.replace(/\[YOUR NAME\]/gi, 'Agent Jarvis\n(on behalf of Nitish Mittersain)');
    reply = reply.replace(/Best regards,?\s*\n.*$/si, 'Best regards,\nAgent Jarvis\n(on behalf of Nitish Mittersain)');
    return reply;
  }

  /**
   * Generate a polite snooze/follow-up email for a startup founder
   */
  async generateSnoozeEmail(startup: {
    name: string;
    founderName?: string | null;
    description?: string | null;
  }): Promise<string> {
    const founderFirstName = startup.founderName?.split(' ')[0] || 'there';

    const prompt = `You are a professional investor writing an email to a startup founder. You're interested but want to see more progress before proceeding. Write a brief, encouraging email that:

1. Thanks them for reaching out
2. Shows genuine interest in what they're building
3. Explains you'd like to see more traction/progress before moving forward
4. Asks them to keep you updated on key milestones (revenue, users, partnerships, etc.)
5. Is warm and encouraging, not dismissive

STARTUP INFO:
- Name: ${startup.name}
- Founder: ${startup.founderName || 'Unknown'}
- Description: ${startup.description || 'Not provided'}

Write the email body only (no subject line). Start with "Hi ${founderFirstName}," and end with exactly this signature (no variations):

Best regards,
Agent Jarvis
(on behalf of Nitish Mittersain)

Keep it under 120 words. Be warm and encouraging. Make it clear you want to hear from them again when they have updates.`;

    const text = await this.callGemini(prompt);
    let reply = text.trim();
    reply = reply.replace(/\[YOUR NAME\]/gi, 'Agent Jarvis\n(on behalf of Nitish Mittersain)');
    reply = reply.replace(/Best regards,?\s*\n.*$/si, 'Best regards,\nAgent Jarvis\n(on behalf of Nitish Mittersain)');
    return reply;
  }

  /**
   * Evaluate if a snoozed startup has shown meaningful progress
   */
  async evaluateProgress(
    originalProposal: {
      name: string;
      description?: string | null;
      stage?: string | null;
      extractedData?: Record<string, unknown> | null;
    },
    updateEmail: {
      subject: string;
      body: string;
      from: string;
    }
  ): Promise<{
    hasSignificantProgress: boolean;
    progressScore: number; // 0-100
    progressSummary: string;
    keyChanges: string[];
    recommendation: 'reactivate' | 'keep_snoozed' | 'reject';
  }> {
    const prompt = `You are an experienced VC analyst evaluating whether a startup that was previously snoozed has made meaningful progress worth reconsidering.

ORIGINAL PROPOSAL:
- Name: ${originalProposal.name}
- Description: ${originalProposal.description || 'Not provided'}
- Stage: ${originalProposal.stage || 'Unknown'}
${originalProposal.extractedData ? `- Previous Data: ${JSON.stringify(originalProposal.extractedData)}` : ''}

NEW UPDATE EMAIL:
- Subject: ${updateEmail.subject}
- From: ${updateEmail.from}
- Content: ${updateEmail.body}

Analyze whether this update shows meaningful progress that warrants reconsideration. Look for:
- Revenue growth or first revenue
- Significant user/customer growth
- Major partnerships or customers
- Product launches or key milestones
- Team additions (key hires)
- Additional funding or validation

Return a JSON object with:
{
  "hasSignificantProgress": true/false,
  "progressScore": 0-100 (0 = no progress, 100 = exceptional progress),
  "progressSummary": "1-2 sentence summary of progress",
  "keyChanges": ["list of specific improvements"],
  "recommendation": "reactivate" | "keep_snoozed" | "reject"
}

Only recommend "reactivate" if progressScore >= 60 and there are concrete, verifiable improvements.
Recommend "reject" if the update is spammy, irrelevant, or shows concerning patterns.
Otherwise recommend "keep_snoozed".

Return ONLY valid JSON.`;

    const text = await this.callGemini(prompt);

    try {
      return this.extractJson<{
        hasSignificantProgress: boolean;
        progressScore: number;
        progressSummary: string;
        keyChanges: string[];
        recommendation: 'reactivate' | 'keep_snoozed' | 'reject';
      }>(text);
    } catch {
      console.error('Failed to parse progress evaluation:', text);
      return {
        hasSignificantProgress: false,
        progressScore: 0,
        progressSummary: 'Failed to evaluate progress',
        keyChanges: [],
        recommendation: 'keep_snoozed',
      };
    }
  }

  /**
   * Full startup onboarding analysis: business model + draft reply
   */
  async analyzeAndDraftReply(startup: {
    name: string;
    description?: string | null;
    website?: string | null;
    founderName?: string | null;
    founderEmail?: string | null;
    askAmount?: string | null;
    stage?: string | null;
    extractedData?: Record<string, unknown> | null;
  }): Promise<{
    analysis: BusinessModelAnalysis;
    draftReply: string;
    sector: string;
    stage: string;
  }> {
    // Step 1: Analyze business model
    const analysis = await this.analyzeBusinessModel(startup);

    // Step 2: Generate draft reply
    const draftReply = await this.generateDraftReply(startup, analysis);

    return {
      analysis,
      draftReply,
      sector: analysis.sector,
      stage: analysis.stage,
    };
  }

  // ==========================================
  // Startup Evaluation Scoring Methods
  // ==========================================

  /**
   * Generate strategic questions for startup evaluation
   */
  async generateEvaluationQuestions(
    startup: {
      name: string;
      description?: string | null;
      website?: string | null;
      founderName?: string | null;
      stage?: string | null;
      sector?: string | null;
      pitchDeckContent?: string | null;
      existingAnalysis?: BusinessModelAnalysis | null;
    },
    roundNumber: number,
    previousQA?: Array<{ question: string; answer: string }>
  ): Promise<EvaluationQuestion[]> {
    const remainingQuestions = 10 - (previousQA?.length || 0);
    const questionsThisRound = Math.min(remainingQuestions, roundNumber === 1 ? 5 : 3);

    if (questionsThisRound <= 0) {
      return [];
    }

    const previousQAText = previousQA?.length
      ? `PREVIOUS Q&A:\n${previousQA.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n\n')}`
      : '';

    const prompt = `You are an elite VC analyst using frameworks from Peter Thiel, Paul Graham, Mike Moritz (Sequoia), and a16z. Generate ${questionsThisRound} strategic questions to evaluate this startup.

STARTUP INFO:
- Name: ${startup.name}
- Description: ${startup.description || 'Not provided'}
- Website: ${startup.website || 'Not provided'}
- Founder: ${startup.founderName || 'Unknown'}
- Stage: ${startup.stage || 'Unknown'}
- Sector: ${startup.sector || 'Unknown'}
${startup.pitchDeckContent ? `- Pitch Deck Summary: ${startup.pitchDeckContent.substring(0, 2000)}...` : ''}
${startup.existingAnalysis ? `- Initial Analysis: ${JSON.stringify(startup.existingAnalysis)}` : ''}

${previousQAText}

SCORING FRAMEWORK (we need info to score these):
1. THIEL CRITERIA (50% weight):
   - Contrarian Insight / Secret (unique truth others miss)
   - 10x Product Advantage (definitively superior)
   - Monopoly Potential (can dominate a niche)
   - Moat Durability (network effects, switching costs)
   - Long-Term Viability (10-20 year defensibility)
   - Founder Quality (vision, mission-driven)
   - Team Leverage (quality of hires)
   - Timing (why now?)
   - Distribution Advantage (unique channel access)
   - Mission & Purpose (divergent ambition)

2. FOUNDER & TEAM (15%):
   - Determination (resilience through setbacks)
   - Founder-Market Fit (right person for this problem)
   - Cofounder Chemistry (working relationship)
   - Adaptability (pivot capability)

3. MARKET (10%):
   - TAM Size & Growth
   - Winner-Take-All Dynamics
   - Competitive Landscape

4. TRACTION (15% if post-revenue):
   - Revenue/MRR Growth
   - User/Customer Growth
   - Unit Economics (LTV/CAC)
   - Retention/Churn

5. BUSINESS MODEL (10%):
   - Scalability
   - Path to Profitability
   - Capital Efficiency

Generate questions that:
- Are specific and answerable (not vague)
- Can be answered in 2-3 sentences
- Help score specific criteria above
- Don't repeat previous questions
- Mix high-priority scoring gaps with lower priority ones

Return JSON array:
[
  {
    "id": "q1",
    "question": "specific question here",
    "category": "thiel|founder|market|traction|business_model",
    "priority": "high|medium|low",
    "rationale": "which criteria this helps score"
  }
]

Return ONLY valid JSON array with ${questionsThisRound} questions.`;

  const text = await this.callGemini(prompt);

    try {
      const questions = this.extractJson<EvaluationQuestion[]>(text.replace(/^\[/, '[').replace(/\]$/, ']'));
      // Ensure we have an array even if JSON extraction finds an object
      if (!Array.isArray(questions)) {
        const arr = text.match(/\[[\s\S]*\]/);
        if (arr) {
          return JSON.parse(arr[0]) as EvaluationQuestion[];
        }
        throw new Error('Response is not an array');
      }
      return questions;
    } catch {
      console.error('Failed to parse evaluation questions:', text);
      throw new Error('Failed to generate evaluation questions');
    }
  }

  /**
   * Score a startup based on presentation and Q&A
   */
  async scoreStartupEvaluation(
    startup: {
      name: string;
      description?: string | null;
      website?: string | null;
      founderName?: string | null;
      stage?: string | null;
      sector?: string | null;
      pitchDeckContent?: string | null;
      existingAnalysis?: BusinessModelAnalysis | null;
    },
    qaHistory: Array<{ question: string; answer: string }>,
    isPostRevenue: boolean
  ): Promise<EvaluationScoreResult> {
    const qaText = qaHistory.length
    ? `FOUNDER Q&A:\n${qaHistory.map((qa, i) => `Q${i + 1}: ${qa.question}\nA${i + 1}: ${qa.answer}`).join('\n\n')}`
    : 'No Q&A conducted yet.';

  const prompt = `You are an elite VC analyst. Score this startup using our comprehensive framework based on Peter Thiel (50% weight), Paul Graham/YC, Mike Moritz/Sequoia, and a16z methodologies.

STARTUP INFO:
- Name: ${startup.name}
- Description: ${startup.description || 'Not provided'}
- Website: ${startup.website || 'Not provided'}
- Founder: ${startup.founderName || 'Unknown'}
- Stage: ${startup.stage || 'Unknown'}
- Sector: ${startup.sector || 'Unknown'}
- Post-Revenue: ${isPostRevenue ? 'Yes' : 'No'}
${startup.pitchDeckContent ? `- Pitch Deck Content:\n${startup.pitchDeckContent.substring(0, 3000)}` : ''}
${startup.existingAnalysis ? `- Business Analysis: ${JSON.stringify(startup.existingAnalysis)}` : ''}

${qaText}

SCORING INSTRUCTIONS:
${isPostRevenue ? `
POST-REVENUE SCORING (100 points total):
- Thiel Criteria: 50 points (contrarian 6, product10x 6, monopoly 6, moat 6, longterm 5, founder 5, team 4, timing 4, distribution 4, mission 4)
- Founder & Team: 15 points (determination 4, founderMarketFit 4, chemistry 4, adaptability 3)
- Market: 10 points (tam 4, winnerTakeAll 3, competition 3)
- Traction: 15 points (revenue 5, users 4, unitEconomics 3, retention 3)
- Business Model: 10 points (scalability 4, profitability 3, efficiency 3)
` : `
PRE-REVENUE SCORING (100 points total):
- Thiel Criteria: 58 points (contrarian 7, product10x 7, monopoly 7, moat 7, longterm 6, founder 6, team 5, timing 5, distribution 4, mission 4)
- Founder & Team: 22 points (determination 6, founderMarketFit 6, chemistry 5, adaptability 5)
- Market: 10 points (tam 4, winnerTakeAll 3, competition 3)
- Traction: 0 points (all scores should be {score: 0, maxScore: 0, commentary: "N/A - pre-revenue"})
- Business Model: 10 points (scalability 4, profitability 3, efficiency 3)
`}

For each criterion, provide:
- score: actual points earned (0 to maxScore)
- maxScore: maximum possible points for this criterion
- commentary: 1-2 sentence specific explanation with evidence from deck/Q&A

Return this exact JSON structure:
{
  "totalScore": <sum of all section scores>,
  "isPostRevenue": ${isPostRevenue},

  "thielScore": <sum of thiel criteria>,
  "contrarianInsight": {"score": X, "maxScore": ${isPostRevenue ? 6 : 7}, "commentary": "..."},
  "productAdvantage10x": {"score": X, "maxScore": ${isPostRevenue ? 6 : 7}, "commentary": "..."},
  "monopolyPotential": {"score": X, "maxScore": ${isPostRevenue ? 6 : 7}, "commentary": "..."},
  "moatDurability": {"score": X, "maxScore": ${isPostRevenue ? 6 : 7}, "commentary": "..."},
  "longTermViability": {"score": X, "maxScore": ${isPostRevenue ? 5 : 6}, "commentary": "..."},
  "founderQuality": {"score": X, "maxScore": ${isPostRevenue ? 5 : 6}, "commentary": "..."},
  "teamLeverage": {"score": X, "maxScore": ${isPostRevenue ? 4 : 5}, "commentary": "..."},
  "timing": {"score": X, "maxScore": ${isPostRevenue ? 4 : 5}, "commentary": "..."},
  "distributionAdvantage": {"score": X, "maxScore": 4, "commentary": "..."},
  "missionPurpose": {"score": X, "maxScore": 4, "commentary": "..."},

  "founderTeamScore": <sum of founder criteria>,
  "determination": {"score": X, "maxScore": ${isPostRevenue ? 4 : 6}, "commentary": "..."},
  "founderMarketFit": {"score": X, "maxScore": ${isPostRevenue ? 4 : 6}, "commentary": "..."},
  "cofounderChemistry": {"score": X, "maxScore": ${isPostRevenue ? 4 : 5}, "commentary": "..."},
  "adaptability": {"score": X, "maxScore": ${isPostRevenue ? 3 : 5}, "commentary": "..."},

  "marketScore": <sum of market criteria>,
  "tamSizeGrowth": {"score": X, "maxScore": 4, "commentary": "..."},
  "winnerTakeAll": {"score": X, "maxScore": 3, "commentary": "..."},
  "competitiveLandscape": {"score": X, "maxScore": 3, "commentary": "..."},

  "tractionScore": <sum of traction criteria>,
  "revenueGrowth": {"score": X, "maxScore": ${isPostRevenue ? 5 : 0}, "commentary": "..."},
  "userCustomerGrowth": {"score": X, "maxScore": ${isPostRevenue ? 4 : 0}, "commentary": "..."},
  "unitEconomics": {"score": X, "maxScore": ${isPostRevenue ? 3 : 0}, "commentary": "..."},
  "retentionChurn": {"score": X, "maxScore": ${isPostRevenue ? 3 : 0}, "commentary": "..."},

  "businessModelScore": <sum of business model criteria>,
  "scalability": {"score": X, "maxScore": 4, "commentary": "..."},
  "pathToProfitability": {"score": X, "maxScore": 3, "commentary": "..."},
  "capitalEfficiency": {"score": X, "maxScore": 3, "commentary": "..."},

  "overallCommentary": "2-3 sentence overall assessment",
  "strengths": ["strength 1", "strength 2", "strength 3"],
  "concerns": ["concern 1", "concern 2", "concern 3"],
  "recommendation": "strong_invest|invest|consider|pass"
}

RECOMMENDATION GUIDELINES:
- strong_invest: 85-100 (exceptional opportunity)
- invest: 70-84 (strong candidate)
- consider: 55-69 (promising but needs work)
- pass: <55 (doesn't meet criteria)

Be rigorous and specific. Reference actual information from the deck and Q&A.
Return ONLY valid JSON.`;

  const text = await this.callGemini(prompt);

    try {
      return this.extractJson<EvaluationScoreResult>(text);
    } catch {
      console.error('Failed to parse evaluation score:', text);
      throw new Error('Failed to score startup evaluation');
    }
  }

  /**
   * Generate email with questions for founder
   */
  async generateQAEmail(
    startup: {
      name: string;
      founderName?: string | null;
    },
    questions: EvaluationQuestion[],
    roundNumber: number
  ): Promise<string> {
    const founderFirstName = startup.founderName?.split(' ')[0] || 'there';
    const isFollowUp = roundNumber > 1;

    const prompt = `Write a professional email to a startup founder ${isFollowUp ? 'following up with additional' : 'asking'} questions for investment evaluation.

STARTUP: ${startup.name}
FOUNDER: ${startup.founderName || 'Unknown'}
ROUND: ${roundNumber} of 3

QUESTIONS TO ASK:
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

Write the email body only. ${isFollowUp
      ? 'Thank them for their previous responses and explain you have a few more questions.'
      : 'Thank them for sharing their pitch and explain you have some questions to better understand the opportunity.'}

Start with "Hi ${founderFirstName}," and end with exactly:

Best regards,
Agent Jarvis
(on behalf of Nitish Mittersain)

Keep it professional but warm. List the questions clearly numbered. Keep intro/outro brief (2-3 sentences each).`;

    const text = await this.callGemini(prompt);
    let reply = text.trim();
    reply = reply.replace(/\[YOUR NAME\]/gi, 'Agent Jarvis\n(on behalf of Nitish Mittersain)');
    reply = reply.replace(/Best regards,?\s*\n.*$/si, 'Best regards,\nAgent Jarvis\n(on behalf of Nitish Mittersain)');
    return reply;
  }

  /**
   * Parse founder's email responses to match questions
   */
  async parseQAResponses(
    questions: EvaluationQuestion[],
    emailBody: string
  ): Promise<Array<{ questionId: string; answer: string }>> {
    const prompt = `Parse the founder's email response and match answers to the original questions.

ORIGINAL QUESTIONS:
${questions.map((q, i) => `${i + 1}. [ID: ${q.id}] ${q.question}`).join('\n')}

FOUNDER'S EMAIL RESPONSE:
${emailBody}

Extract each answer and match it to the corresponding question. Return JSON array:
[
  {"questionId": "q1", "answer": "extracted answer text"},
  {"questionId": "q2", "answer": "extracted answer text"}
]

If a question wasn't answered, use "Not answered" as the answer.
Return ONLY valid JSON array.`;

    const text = await this.callGemini(prompt);

    try {
      const arr = text.match(/\[[\s\S]*\]/);
      if (arr) {
        return JSON.parse(arr[0]) as Array<{ questionId: string; answer: string }>;
      }
      return this.extractJson<Array<{ questionId: string; answer: string }>>(text);
    } catch {
      console.error('Failed to parse QA responses:', text);
      // Return empty answers as fallback
      return questions.map((q) => ({ questionId: q.id, answer: 'Failed to parse response' }));
    }
  }
}

// ==========================================
// Exported Types
// ==========================================

export interface ScoreCriteria {
  score: number;
  maxScore: number;
  commentary: string;
}

export interface EvaluationScoreResult {
  totalScore: number;
  isPostRevenue: boolean;

  // Thiel Criteria (50 points)
  thielScore: number;
  contrarianInsight: ScoreCriteria;
  productAdvantage10x: ScoreCriteria;
  monopolyPotential: ScoreCriteria;
  moatDurability: ScoreCriteria;
  longTermViability: ScoreCriteria;
  founderQuality: ScoreCriteria;
  teamLeverage: ScoreCriteria;
  timing: ScoreCriteria;
  distributionAdvantage: ScoreCriteria;
  missionPurpose: ScoreCriteria;

  // Founder & Team (15 points post-revenue, 22 pre-revenue)
  founderTeamScore: number;
  determination: ScoreCriteria;
  founderMarketFit: ScoreCriteria;
  cofounderChemistry: ScoreCriteria;
  adaptability: ScoreCriteria;

  // Market Opportunity (10 points)
  marketScore: number;
  tamSizeGrowth: ScoreCriteria;
  winnerTakeAll: ScoreCriteria;
  competitiveLandscape: ScoreCriteria;

  // Traction & Metrics (15 points post-revenue, 0 pre-revenue)
  tractionScore: number;
  revenueGrowth: ScoreCriteria;
  userCustomerGrowth: ScoreCriteria;
  unitEconomics: ScoreCriteria;
  retentionChurn: ScoreCriteria;

  // Business Model & Scalability (10 points)
  businessModelScore: number;
  scalability: ScoreCriteria;
  pathToProfitability: ScoreCriteria;
  capitalEfficiency: ScoreCriteria;

  // Overall assessment
  overallCommentary: string;
  strengths: string[];
  concerns: string[];
  recommendation: 'strong_invest' | 'invest' | 'consider' | 'pass';
}

export interface EvaluationQuestion {
  id: string;
  question: string;
  category: 'thiel' | 'founder' | 'market' | 'traction' | 'business_model';
  priority: 'high' | 'medium' | 'low';
  rationale: string;
}

// Types for business model analysis
export interface BusinessModelAnalysis {
  sector: string;
  sectorConfidence: number;
  stage: string;
  stageReasoning: string;
  businessModel: {
    type: string;
    revenueStreams: string[];
    customerSegments: string[];
    valueProposition: string;
  };
  marketAnalysis: {
    marketSize: string;
    competition: string;
    timing: string;
  };
  strengths: string[];
  concerns: string[];
  keyQuestions: string[];
}

export const aiService = new AIService();
