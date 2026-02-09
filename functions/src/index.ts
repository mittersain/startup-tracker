import * as dotenv from 'dotenv';
dotenv.config();

import * as functionsV1 from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Busboy from 'busboy';
import * as nodemailer from 'nodemailer';
import sanitizeHtml from 'sanitize-html';
import { z } from 'zod';

// Initialize Gemini AI
// Note: Using fallback for Firebase deployment compatibility, but functions will validate at runtime
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'PLACEHOLDER_KEY_SET_IN_PRODUCTION';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// AI Helper function to extract startup proposal from email
async function extractStartupFromEmail(subject: string, body: string, from: string): Promise<{
  isStartupProposal: boolean;
  startupName?: string;
  description?: string;
  founderName?: string;
  stage?: string;
  askAmount?: string;
  confidence: number;
  reason: string;
} | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Analyze this email and determine if it's an investment proposal, funding pitch, or startup seeking investment.

Email Subject: ${subject}
From: ${from}
Body: ${body.substring(0, 3000)}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "isStartupProposal": boolean (true if this is ANY business/startup seeking investment or funding),
  "startupName": string or null (the company/business/startup name if found),
  "description": string or null (brief description of what the business does),
  "founderName": string or null (founder's or sender's name if they seem to be the owner),
  "stage": string or null (seed, pre-seed, series-a, growth, etc),
  "askAmount": string or null (funding amount if mentioned),
  "confidence": number (0-100, how confident you are this is a real investment opportunity),
  "reason": string (brief reason for your classification)
}

IMPORTANT Classification Guidelines:
- Return TRUE for: funding requests, pitch decks, investment proposals, business introductions seeking capital, founders reaching out for investment
- This includes ANY industry: tech, retail, jewelry, food, manufacturing, services, etc.
- If someone is introducing their business and seems to be seeking investment or partnership, mark as TRUE
- Return FALSE for: newsletters, marketing emails, cold sales pitches (selling TO investor), automated notifications, spam, general correspondence`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[AI] No JSON found in response');
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('[AI] Error extracting startup from email:', error);
    return null;
  }
}

// AI Helper function to analyze a startup and generate scores + business model
async function analyzeStartupWithAI(startup: {
  name: string;
  description?: string;
  founderName?: string;
  founderEmail?: string;
  stage?: string;
  emailContent?: string;
}): Promise<{
  currentScore: number;
  scoreBreakdown: {
    team: { base: number; adjusted: number; subcriteria: Record<string, number> };
    market: { base: number; adjusted: number; subcriteria: Record<string, number> };
    product: { base: number; adjusted: number; subcriteria: Record<string, number> };
    traction: { base: number; adjusted: number; subcriteria: Record<string, number> };
    deal: { base: number; adjusted: number; subcriteria: Record<string, number> };
    communication: number;
    momentum: number;
    redFlags: number;
  };
  businessModelAnalysis: {
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
  };
  draftReply: string;
} | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Analyze this startup pitch and provide a comprehensive evaluation.

Startup Name: ${startup.name}
Description: ${startup.description || 'Not provided'}
Founder: ${startup.founderName || 'Unknown'} (${startup.founderEmail || 'No email'})
Stage: ${startup.stage || 'Unknown'}
${startup.emailContent ? `Original Email Content: ${startup.emailContent.substring(0, 4000)}` : ''}

Provide your analysis as a JSON object with this exact structure:
{
  "currentScore": number (0-100, overall investibility score),
  "scoreBreakdown": {
    "team": { "base": number (0-25), "adjusted": 0, "subcriteria": { "experience": number, "domain_expertise": number, "execution_ability": number } },
    "market": { "base": number (0-25), "adjusted": 0, "subcriteria": { "size": number, "growth": number, "timing": number } },
    "product": { "base": number (0-20), "adjusted": 0, "subcriteria": { "innovation": number, "defensibility": number, "scalability": number } },
    "traction": { "base": number (0-20), "adjusted": 0, "subcriteria": { "revenue": number, "users": number, "growth_rate": number } },
    "deal": { "base": number (0-10), "adjusted": 0, "subcriteria": { "valuation": number, "terms": number } },
    "communication": 0,
    "momentum": 0,
    "redFlags": 0
  },
  "businessModelAnalysis": {
    "sector": string (fintech, healthtech, saas, ecommerce, edtech, deeptech, consumer, enterprise, marketplace, climate, agritech, other),
    "sectorConfidence": number (0-1),
    "stage": string (pre_seed, seed, series_a, series_b),
    "stageReasoning": string (why this stage assessment),
    "businessModel": {
      "type": string (b2b, b2c, b2b2c, marketplace, saas, subscription, transactional, advertising),
      "revenueStreams": string[] (list of revenue sources),
      "customerSegments": string[] (target customer types),
      "valueProposition": string (core value proposition)
    },
    "marketAnalysis": {
      "marketSize": string (TAM/SAM estimate or assessment),
      "competition": string (competitive landscape assessment),
      "timing": string (why now is the right time)
    },
    "strengths": string[] (3-5 key strengths),
    "concerns": string[] (3-5 key concerns or risks),
    "keyQuestions": string[] (5-8 specific, insightful questions to ask the founders covering: traction metrics, unit economics, competitive differentiation, go-to-market strategy, team background, funding history, and growth plans)
  },
  "draftReply": string (a direct, natural email reply from an individual angel investor.

    TONE - be direct and to the point:
    - NO pleasantries like "hope this finds you well", "thanks so much for reaching out"
    - Write like texting a smart friend, not a formal business letter
    - Use "I" not "we" - personal investor
    - Skip the flattery - get to the questions

    STRUCTURE:
    1. One short line acknowledging what they're building (optional)
    2. Your questions - work them naturally into the email, can be numbered or inline
    3. Sign off simply as "Nitish"

    QUESTIONS to include (pick 4-5 most relevant):
    - Current traction (users, revenue, growth)
    - Unit economics / how money is made
    - What's different from competitors
    - Team background
    - How much raising and use of funds

    Keep it SHORT - 3-5 sentences total. Founders are busy, you're busy.)
}

Be realistic in your scoring. Early-stage startups with limited info should score 40-60. Only exceptional startups with strong traction score above 70.
Respond with ONLY the JSON object, no markdown or explanation.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[AI Analyze] No JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[AI Analyze] Generated score ${parsed.currentScore} for ${startup.name}`);
    return parsed;
  } catch (error) {
    console.error('[AI Analyze] Error analyzing startup:', error);
    return null;
  }
}

// AI Helper function to analyze founder response and generate follow-up
async function analyzeFounderResponse(
  startupData: {
    name: string;
    description?: string;
    founderName?: string;
    stage?: string;
    currentScore?: number;
    scoreBreakdown?: Record<string, unknown>;
    businessModelAnalysis?: Record<string, unknown>;
  },
  responseEmail: {
    subject: string;
    body: string;
    from: string;
  },
  previousEmails: Array<{ subject: string; body: string; direction: string; date: Date }>,
  attachmentContext?: string
): Promise<{
  responseQuality: {
    score: number; // 1-10
    clarity: number;
    responsiveness: number;
    substance: number;
    concerns: string[];
    positives: string[];
  };
  scoreAdjustment: {
    communication: number; // -5 to +5
    team: number;
    product: number;
    traction: number;
    momentum: number;
    reasoning: string;
  };
  recommendation: 'continue' | 'pass' | 'schedule_call';
  recommendationReason: string;
  draftReply: string;
  suggestedQuestions: string[];
} | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const conversationHistory = previousEmails
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(e => `[${e.direction === 'inbound' ? 'Founder' : 'You'}]: ${e.subject}\n${e.body.substring(0, 500)}`)
      .join('\n\n---\n\n');

    const prompt = `You are helping an individual angel investor draft a reply to a founder's email.
${attachmentContext ? `
########## INVESTOR'S COMPLETE ANALYSIS OF THIS STARTUP ##########
${attachmentContext}
########## END OF ANALYSIS ##########

IMPORTANT: The investor has ALREADY analyzed all pitch decks and documents. Use the analysis above to inform your reply. Reference specific details from the deck analysis (score, strengths, weaknesses) in your response.
` : ''}
PREVIOUS CONVERSATION:
${conversationHistory || 'No previous emails'}

NEW EMAIL FROM FOUNDER:
Subject: ${responseEmail.subject}
From: ${responseEmail.from}
Body: ${responseEmail.body}

Analyze and respond. Return ONLY a JSON object:

{
  "responseQuality": {
    "score": <1-10 overall quality>,
    "clarity": <1-10 how clear and well-structured>,
    "responsiveness": <1-10 how well they addressed questions>,
    "substance": <1-10 depth of information provided>,
    "concerns": ["<any red flags or concerns from this response>"],
    "positives": ["<positive signals from this response>"]
  },
  "scoreAdjustment": {
    "communication": <-5 to +5 adjustment>,
    "team": <-3 to +3 based on founder quality signals>,
    "product": <-3 to +3 if product details revealed>,
    "traction": <-3 to +3 if traction data shared>,
    "momentum": <-3 to +3 based on energy/progress>,
    "reasoning": "<brief explanation of adjustments>"
  },
  "recommendation": "<continue|pass|schedule_call>",
  "recommendationReason": "<why you recommend this action>",
  "draftReply": "<THE ACTUAL EMAIL TO SEND - must include your follow-up questions embedded naturally in the text, not as a separate list>",
  "suggestedQuestions": ["<same questions that appear in draftReply, listed here for reference>"]
}

RECOMMENDATION RULES (IMPORTANT):
- Default to "continue" - keep the conversation going via email
- Only recommend "schedule_call" if: founder has answered most questions well AND you're genuinely excited AND ready to discuss terms or serious next steps. The investor has LIMITED bandwidth for calls.
- Recommend "pass" only for clear red flags, fundamental misfit, or if the founder is unresponsive/evasive

CRITICAL - draftReply MUST contain your questions in a NUMBERED LIST:
- The draftReply field IS the email that will be sent to the founder
- Format questions as a numbered list (1. 2. 3.) - NOT embedded in prose
- If pitch deck analysis is provided above, START by acknowledging something specific from the deck (a metric, strength, or concern)
- Then list follow-up questions that dig deeper into areas identified in the deck analysis
- Example format (when pitch deck was analyzed):
  "Looked through the deck - the 40% MoM growth is solid. A few questions:

  1. How are you thinking about unit economics as you scale?
  2. What's the CAC/LTV ratio currently?
  3. Team seems lean - any key hires planned?

  - Nitish"

TONE GUIDELINES for draftReply:
- Be direct and to the point - no unnecessary pleasantries
- Write like you're texting a smart friend, not writing a business letter
- NO corporate speak: avoid "hope this finds you well", "thanks so much", "I really appreciate", "looking forward to"
- Keep the intro brief (1-2 sentences), then list questions in numbered format
- Don't over-explain or apologize
- Sound like a busy person who's interested but values their time
- Use "I" not "we" - this is a personal investor
- Sign off simply: "- Nitish" or just "Nitish"`;

    // Log whether attachment context is being passed
    console.log(`[AI Response Analysis] Has attachment context: ${!!attachmentContext}, length: ${attachmentContext?.length || 0}`);
    if (attachmentContext) {
      console.log(`[AI Response Analysis] Attachment context preview: ${attachmentContext.substring(0, 200)}...`);
    }

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Log the AI's draft reply to see if it references attachments
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[AI Response Analysis] No JSON found in response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[AI Response Analysis] Draft reply preview: ${parsed.draftReply?.substring(0, 200)}...`);

    return parsed;
  } catch (error) {
    console.error('[AI Response Analysis] Error:', error);
    return null;
  }
}

// Update the startup's persistent AI summary
// This consolidates all analysis (deck, emails, research) into one summary
async function updateStartupAISummary(startupId: string): Promise<void> {
  try {
    console.log(`[AI Summary] Updating summary for startup: ${startupId}`);

    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      console.log(`[AI Summary] Startup not found: ${startupId}`);
      return;
    }

    const startupData = startupDoc.data()!;

    // Fetch all analyzed decks
    const decksSnapshot = await db.collection('decks')
      .where('startupId', '==', startupId)
      .get();

    const deckAnalyses: string[] = [];
    let latestDeckScore = 0;

    decksSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.aiAnalysis) {
        const analysis = data.aiAnalysis;
        latestDeckScore = analysis.score || latestDeckScore;
        deckAnalyses.push(`
DECK: ${data.fileName} (Score: ${analysis.score}/100)
Summary: ${analysis.summary || 'N/A'}
Strengths: ${(analysis.strengths || []).join('; ')}
Weaknesses: ${(analysis.weaknesses || []).join('; ')}
Recommendation: ${analysis.recommendation || 'N/A'}
${analysis.keyMetrics ? `Key Metrics: TAM=${analysis.keyMetrics.tam || 'N/A'}, Revenue=${analysis.keyMetrics.revenue || 'N/A'}, Growth=${analysis.keyMetrics.growth || 'N/A'}` : ''}`);
      }
    });

    // Fetch all emails for this startup
    const emailsSnapshot = await db.collection('emails')
      .where('startupId', '==', startupId)
      .get();

    // Sort emails by date and get summaries
    const emailSummaries: string[] = [];
    const sortedEmails = emailsSnapshot.docs
      .map(doc => doc.data())
      .sort((a, b) => {
        const dateA = a.date?.toDate?.() || new Date(0);
        const dateB = b.date?.toDate?.() || new Date(0);
        return dateB.getTime() - dateA.getTime();
      })
      .slice(0, 10); // Last 10 emails

    sortedEmails.forEach(email => {
      const direction = email.direction === 'inbound' ? 'FROM FOUNDER' : 'TO FOUNDER';
      const analysis = email.aiAnalysis;
      let emailInfo = `[${direction}] ${email.subject || 'No subject'}`;

      // Include brief body preview
      const bodyPreview = (email.body || '').substring(0, 200).replace(/\n/g, ' ');
      emailInfo += `\nPreview: ${bodyPreview}...`;

      // Include AI analysis if available
      if (analysis) {
        emailInfo += `\nAI Analysis: Score ${analysis.responseQuality?.score || 'N/A'}/10, Recommendation: ${analysis.recommendation || 'N/A'}`;
      }

      emailSummaries.push(emailInfo);
    });

    // Build the consolidated AI summary
    const aiSummary = {
      lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      deckScore: latestDeckScore,
      deckCount: deckAnalyses.length,
      emailCount: sortedEmails.length,

      // Plain text summary for AI prompts
      summary: `
=== STARTUP: ${startupData.name} ===
Current Score: ${startupData.currentScore || 'Not scored'}/100
Stage: ${startupData.stage || 'Unknown'}
Founder: ${startupData.founderName || 'Unknown'}
Description: ${startupData.description || 'N/A'}

${deckAnalyses.length > 0 ? `=== PITCH DECK ANALYSIS (ALREADY REVIEWED) ===
${deckAnalyses.join('\n')}` : '=== NO PITCH DECK ANALYZED YET ==='}

${emailSummaries.length > 0 ? `=== EMAIL CONVERSATION HISTORY ===
${emailSummaries.join('\n\n')}` : '=== NO EMAILS YET ==='}
`.trim()
    };

    // Update startup document
    await db.collection('startups').doc(startupId).update({
      aiSummary,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[AI Summary] Updated summary for ${startupData.name}, deckCount: ${deckAnalyses.length}, emailCount: ${emailSummaries.length}`);
  } catch (error) {
    console.error(`[AI Summary] Error updating summary for ${startupId}:`, error);
  }
}

// AI Helper function to analyze an attachment (pitch deck, document)
async function analyzeAttachmentWithAI(fileName: string, mimeType: string, startupName: string): Promise<{
  score: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  keyMetrics: Record<string, string | null>;
} | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const fileType = mimeType.includes('pdf') ? 'PDF' :
                     mimeType.includes('presentation') || mimeType.includes('powerpoint') ? 'Pitch Deck' :
                     mimeType.includes('word') || mimeType.includes('document') ? 'Document' : 'File';

    const prompt = `Analyze this ${fileType} attachment from a startup pitch.

Startup Name: ${startupName}
File Name: ${fileName}
File Type: ${fileType}

Based on the file name, type, and the startup context, provide your best assessment of what this pitch deck/document likely contains and score it. Common pitch decks include: problem/solution, market size, team, traction, financials, ask.

Respond with ONLY a JSON object:
{
  "score": number (0-100, quality/completeness estimate based on typical pitch decks),
  "summary": string (2-3 sentence summary of what this document likely covers),
  "strengths": string[] (3-4 potential strengths based on typical pitch content),
  "weaknesses": string[] (3-4 areas that would need clarification or are commonly weak),
  "keyMetrics": {
    "tam": string or null (typical TAM question to ask),
    "revenue": string or null (revenue question to ask),
    "growth": string or null (growth question to ask),
    "funding": string or null (funding question to ask)
  }
}

Be realistic - without seeing the actual content, provide thoughtful questions based on what's typically missing from early-stage pitch decks.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('[AI Attachment] No JSON found in response');
      return null;
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('[AI Attachment] Error analyzing attachment:', error);
    return null;
  }
}

// Helper function to generate draft reply incorporating attachment analysis
function generateDraftReplyWithAttachments(
  baseDraftReply: string,
  attachmentAnalyses: Array<{ fileName: string; score: number; summary: string; weaknesses: string[] }>,
  startupName: string,
  founderName: string
): string {
  if (!attachmentAnalyses.length) return baseDraftReply;

  // Extract key questions from attachment weaknesses
  const attachmentQuestions = attachmentAnalyses
    .flatMap(a => a.weaknesses.slice(0, 2))
    .slice(0, 3);

  const attachmentMentions = attachmentAnalyses.map(a => a.fileName).join(', ');

  return `Hi ${founderName || 'there'},

Thank you for reaching out about ${startupName}. I've reviewed your email and the attached materials (${attachmentMentions}) with interest.

Based on my initial review, I have a few questions that would help me better understand your opportunity:

${attachmentQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

I'd also love to understand more about your team's background and what led you to focus on this problem.

Looking forward to learning more!

Best,
Nitish`;
}

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// JWT Secret (in production, use Secret Manager)
// Note: Using fallback for Firebase deployment compatibility, validate in production
const JWT_SECRET = process.env.JWT_SECRET || 'PLACEHOLDER_JWT_SECRET_SET_IN_PRODUCTION';

// ==================== ZOD VALIDATION SCHEMAS ====================

// Comment validation schema
const commentSchema = z.object({
  content: z.string().min(1, 'Comment content is required').max(10000, 'Comment is too long'),
  parentId: z.string().optional().nullable(),
  mentions: z.array(z.string()).optional().default([]),
});

// Invite validation schema
const inviteSchema = z.object({
  email: z.string().email('Valid email is required'),
  accessLevel: z.enum(['view', 'comment'], { errorMap: () => ({ message: 'Access level must be view or comment' }) }),
});

// Co-investor comment validation schema
const coInvestorCommentSchema = z.object({
  content: z.string().min(1, 'Comment content is required').max(10000, 'Comment is too long'),
  name: z.string().min(1, 'Name is required').max(100, 'Name is too long').optional(),
});

// HTML sanitization config - strip all HTML tags for plain text
const sanitizeConfig = {
  allowedTags: [],
  allowedAttributes: {},
  disallowedTagsMode: 'discard' as const,
};

// Helper to sanitize user content
function sanitizeContent(content: string): string {
  return sanitizeHtml(content, sanitizeConfig).trim();
}

// ==================== RESPONSE TRACKING ====================

const RESPONSE_TIMEOUT_DAYS = 3;

// Helper to compute if startup is awaiting founder response
function computeAwaitingResponse(startup: {
  status: string;
  lastEmailSentAt?: admin.firestore.Timestamp | null;
  lastEmailReceivedAt?: admin.firestore.Timestamp | null;
}): { isAwaitingResponse: boolean; daysSinceOutreach: number | null } {
  // Only flag startups in 'reviewing' or 'due_diligence' status
  if (startup.status !== 'reviewing' && startup.status !== 'due_diligence') {
    return { isAwaitingResponse: false, daysSinceOutreach: null };
  }

  // No outbound email sent yet
  if (!startup.lastEmailSentAt) {
    return { isAwaitingResponse: false, daysSinceOutreach: null };
  }

  const sentAt = startup.lastEmailSentAt.toDate();
  const now = new Date();
  const daysSinceSent = Math.floor((now.getTime() - sentAt.getTime()) / (1000 * 60 * 60 * 24));

  // Check if we received a response after sending
  if (startup.lastEmailReceivedAt) {
    const receivedAt = startup.lastEmailReceivedAt.toDate();
    if (receivedAt > sentAt) {
      // Response received after our last outreach
      return { isAwaitingResponse: false, daysSinceOutreach: null };
    }
  }

  // Check if timeout has passed
  if (daysSinceSent >= RESPONSE_TIMEOUT_DAYS) {
    return { isAwaitingResponse: true, daysSinceOutreach: daysSinceSent };
  }

  return { isAwaitingResponse: false, daysSinceOutreach: daysSinceSent };
}

const NEW_RESPONSE_HOURS = 48; // Highlight responses received in the last 48 hours

// Helper to compute if startup has a new (unread) response from founder
function computeHasNewResponse(startup: {
  lastEmailSentAt?: admin.firestore.Timestamp | null;
  lastEmailReceivedAt?: admin.firestore.Timestamp | null;
  lastResponseReadAt?: admin.firestore.Timestamp | null;
}): { hasNewResponse: boolean; hoursSinceResponse: number | null } {
  // No response received
  if (!startup.lastEmailReceivedAt) {
    return { hasNewResponse: false, hoursSinceResponse: null };
  }

  const receivedAt = startup.lastEmailReceivedAt.toDate();
  const now = new Date();
  const hoursSinceReceived = Math.floor((now.getTime() - receivedAt.getTime()) / (1000 * 60 * 60));

  // Check if response is after our last outreach (it's a reply to us)
  if (startup.lastEmailSentAt) {
    const sentAt = startup.lastEmailSentAt.toDate();
    if (receivedAt <= sentAt) {
      // This response came before our last email, not a new reply
      return { hasNewResponse: false, hoursSinceResponse: null };
    }
  }

  // Check if user has already read this response
  if (startup.lastResponseReadAt) {
    const readAt = startup.lastResponseReadAt.toDate();
    if (readAt >= receivedAt) {
      // User has read the response
      return { hasNewResponse: false, hoursSinceResponse: null };
    }
  }

  // Response is recent (within NEW_RESPONSE_HOURS) and unread
  if (hoursSinceReceived <= NEW_RESPONSE_HOURS) {
    return { hasNewResponse: true, hoursSinceResponse: hoursSinceReceived };
  }

  // Response is older but still unread - still show it
  return { hasNewResponse: true, hoursSinceResponse: hoursSinceReceived };
}

// Create Express app
const app = express();

// ==================== RATE LIMITING ====================

// General rate limiter (100 requests per 15 minutes)
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Auth rate limiter (5 requests per minute - stricter for login/register)
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: 'Too many authentication attempts, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Public endpoint rate limiter (for magic links - 20 per minute)
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), database: 'firestore', version: '2.0' });
});

// Debug middleware to log requests
app.use((req, _res, next) => {
  console.log(`Request: ${req.method} ${req.originalUrl} ${req.path}`);
  next();
});

// ==================== AUTH ROUTES ====================

// Apply stricter rate limiting to auth endpoints
app.post('/auth/register', authLimiter, async (req, res) => {
  try {
    const { email, password, name, organizationName } = req.body;

    if (!email || !password || !name || !organizationName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user exists
    const existingUser = await db.collection('users').where('email', '==', email).get();
    if (!existingUser.empty) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Create organization
    const orgRef = db.collection('organizations').doc();
    await orgRef.set({
      name: organizationName,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userRef = db.collection('users').doc();
    await userRef.set({
      email,
      password: hashedPassword,
      name,
      organizationId: orgRef.id,
      role: 'admin',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Generate tokens
    const accessToken = jwt.sign(
      { userId: userRef.id, email, organizationId: orgRef.id, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      user: { id: userRef.id, email, name, role: 'admin' },
      organization: { id: orgRef.id, name: organizationName },
      tokens: { accessToken, refreshToken: accessToken },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/auth/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;

    const usersSnapshot = await db.collection('users').where('email', '==', email).get();
    if (usersSnapshot.empty) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userDoc = usersSnapshot.docs[0];
    const userData = userDoc.data();

    const validPassword = await bcrypt.compare(password, userData.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
    const orgData = orgDoc.data();

    const accessToken = jwt.sign(
      { userId: userDoc.id, email, organizationId: userData.organizationId, role: userData.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      user: { id: userDoc.id, email: userData.email, name: userData.name, role: userData.role },
      organization: { id: orgDoc.id, name: orgData?.name },
      tokens: { accessToken, refreshToken: accessToken },
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/auth/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    const decoded = jwt.verify(refreshToken, JWT_SECRET) as any;

    const accessToken = jwt.sign(
      { userId: decoded.userId, email: decoded.email, organizationId: decoded.organizationId, role: decoded.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({ accessToken, refreshToken: accessToken });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }
});

app.get('/auth/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    const userDoc = await db.collection('users').doc(decoded.userId).get();
    if (!userDoc.exists) {
      return res.status(401).json({ error: 'User not found' });
    }

    const userData = userDoc.data()!;
    const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
    const orgData = orgDoc.data();

    return res.json({
      user: { id: userDoc.id, email: userData.email, name: userData.name, role: userData.role },
      organization: { id: orgDoc.id, name: orgData?.name },
    });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

// ==================== AUTH MIDDLEWARE ====================

interface AuthRequest extends express.Request {
  user?: {
    userId: string;
    email: string;
    organizationId: string;
    role: string;
  };
}

const authenticate = (req: AuthRequest, res: express.Response, next: express.NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ==================== STARTUPS ROUTES ====================

app.get('/startups', authenticate, async (req: AuthRequest, res) => {
  try {
    const { status, excludeStatus, stage, search, page = 1, pageSize = 50 } = req.query;

    // Simple query without complex ordering to avoid index requirements
    const snapshot = await db.collection('startups')
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    let startups = snapshot.docs.map(doc => {
      const data = doc.data();
      const awaitingResponse = computeAwaitingResponse({
        status: data.status,
        lastEmailSentAt: data.lastEmailSentAt,
        lastEmailReceivedAt: data.lastEmailReceivedAt,
      });
      const newResponse = computeHasNewResponse({
        lastEmailSentAt: data.lastEmailSentAt,
        lastEmailReceivedAt: data.lastEmailReceivedAt,
        lastResponseReadAt: data.lastResponseReadAt,
      });
      return {
        id: doc.id,
        name: data.name as string,
        website: data.website,
        description: data.description as string | null,
        status: data.status,
        stage: data.stage,
        sector: data.sector,
        score: data.score,
        currentScore: data.currentScore,
        baseScore: data.baseScore,
        scoreTrend: data.scoreTrend,
        scoreTrendDelta: data.scoreTrendDelta,
        founderEmail: data.founderEmail,
        founderName: data.founderName,
        organizationId: data.organizationId,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        isAwaitingResponse: awaitingResponse.isAwaitingResponse,
        daysSinceOutreach: awaitingResponse.daysSinceOutreach,
        hasNewResponse: newResponse.hasNewResponse,
        hoursSinceResponse: newResponse.hoursSinceResponse,
      };
    });

    // Client-side filtering
    if (status && status !== 'all') {
      startups = startups.filter(s => s.status === status);
    }

    // Exclude specific statuses (can be comma-separated, e.g., "passed,snoozed")
    if (excludeStatus) {
      const excludeList = (excludeStatus as string).split(',').map(s => s.trim());
      startups = startups.filter(s => !excludeList.includes(s.status));
    }

    if (stage && stage !== 'all') {
      startups = startups.filter(s => s.stage === stage);
    }

    if (search) {
      const searchLower = (search as string).toLowerCase();
      startups = startups.filter(s =>
        s.name?.toLowerCase().includes(searchLower) ||
        s.description?.toLowerCase().includes(searchLower)
      );
    }

    // Sort by createdAt descending
    startups.sort((a, b) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    const total = startups.length;
    const offset = (Number(page) - 1) * Number(pageSize);
    const paginatedStartups = startups.slice(offset, offset + Number(pageSize));

    return res.json({
      data: paginatedStartups,
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error) {
    console.error('List startups error:', error);
    return res.status(500).json({ error: 'Failed to list startups' });
  }
});

app.get('/startups/counts', authenticate, async (req: AuthRequest, res) => {
  try {
    const snapshot = await db.collection('startups')
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const counts = {
      reviewing: 0,
      due_diligence: 0,
      invested: 0,
      passed: 0,
    };

    snapshot.docs.forEach(doc => {
      const status = doc.data().status as keyof typeof counts;
      if (counts[status] !== undefined) {
        counts[status]++;
      }
    });

    return res.json(counts);
  } catch (error) {
    console.error('Get counts error:', error);
    return res.status(500).json({ error: 'Failed to get counts' });
  }
});

app.post('/startups', authenticate, async (req: AuthRequest, res) => {
  try {
    const { name, website, description, stage, founderEmail, founderName } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const startupRef = db.collection('startups').doc();
    const startupData = {
      name,
      website: website || null,
      description: description || null,
      stage: stage || 'seed',
      status: 'reviewing',
      score: null,
      founderEmail: founderEmail || null,
      founderName: founderName || null,
      organizationId: req.user!.organizationId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await startupRef.set(startupData);

    return res.status(201).json({
      id: startupRef.id,
      ...startupData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Create startup error:', error);
    return res.status(500).json({ error: 'Failed to create startup' });
  }
});

app.get('/startups/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupDoc = await db.collection('startups').doc(req.params.id as string).get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Helper to convert Firestore Timestamp to ISO string
    const toISOString = (val: unknown): string | undefined => {
      if (!val) return undefined;
      if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
        return (val as { toDate: () => Date }).toDate().toISOString();
      }
      if (val instanceof Date) {
        return val.toISOString();
      }
      if (typeof val === 'string') {
        return val;
      }
      return undefined;
    };

    const awaitingResponse = computeAwaitingResponse({
      status: data.status,
      lastEmailSentAt: data.lastEmailSentAt,
      lastEmailReceivedAt: data.lastEmailReceivedAt,
    });
    const newResponse = computeHasNewResponse({
      lastEmailSentAt: data.lastEmailSentAt,
      lastEmailReceivedAt: data.lastEmailReceivedAt,
      lastResponseReadAt: data.lastResponseReadAt,
    });

    return res.json({
      id: startupDoc.id,
      ...data,
      createdAt: toISOString(data.createdAt),
      updatedAt: toISOString(data.updatedAt),
      snoozedAt: toISOString(data.snoozedAt),
      snoozeFollowUpDate: toISOString(data.snoozeFollowUpDate),
      passedAt: toISOString(data.passedAt),
      snoozeEmailSentAt: toISOString(data.snoozeEmailSentAt),
      passEmailSentAt: toISOString(data.passEmailSentAt),
      isAwaitingResponse: awaitingResponse.isAwaitingResponse,
      daysSinceOutreach: awaitingResponse.daysSinceOutreach,
      hasNewResponse: newResponse.hasNewResponse,
      hoursSinceResponse: newResponse.hoursSinceResponse,
    });
  } catch (error) {
    console.error('Get startup error:', error);
    return res.status(500).json({ error: 'Failed to get startup' });
  }
});

app.patch('/startups/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const updates = {
      ...req.body,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    delete updates.id;
    delete updates.organizationId;
    delete updates.createdAt;

    await startupRef.update(updates);

    const updated = await startupRef.get();
    const updatedData = updated.data()!;

    return res.json({
      id: updated.id,
      ...updatedData,
      createdAt: updatedData.createdAt?.toDate?.()?.toISOString() || updatedData.createdAt,
      updatedAt: updatedData.updatedAt?.toDate?.()?.toISOString() || updatedData.updatedAt,
    });
  } catch (error) {
    console.error('Update startup error:', error);
    return res.status(500).json({ error: 'Failed to update startup' });
  }
});

app.patch('/startups/:id/status', authenticate, async (req: AuthRequest, res) => {
  try {
    const { status } = req.body;
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    await startupRef.update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ id: req.params.id, status });
  } catch (error) {
    console.error('Update status error:', error);
    return res.status(500).json({ error: 'Failed to update status' });
  }
});

// Mark founder response as read
app.post('/startups/:id/mark-response-read', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    await startupRef.update({
      lastResponseReadAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Mark response read error:', error);
    return res.status(500).json({ error: 'Failed to mark response as read' });
  }
});

// Snooze a startup deal with reason and schedule follow-up
app.post('/startups/:id/snooze', authenticate, async (req: AuthRequest, res) => {
  try {
    const { reason, followUpMonths = 3 } = req.body;
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Generate AI draft email for snooze
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const businessContext = data.businessModelAnalysis ? JSON.stringify(data.businessModelAnalysis) : data.description || '';

    const prompt = `You are an individual angel investor (NOT a fund) writing to a founder. Write a friendly but honest email explaining that you're putting their startup on hold for now but would like to follow up in ${followUpMonths} months.

Startup: ${data.name}
Founder: ${data.founderName || 'Founder'}
Business Context: ${businessContext}
Your Reason for Putting on Hold: ${reason}

TONE GUIDELINES:
- Write as "I" not "we" - you're a personal investor
- Keep it conversational and natural, not corporate
- Be warm and genuine, not formal VC-speak
- Avoid jargon like "circle back", "touch base", "synergies"
- Sound like a real person having a real conversation

The email should:
1. Be friendly and encouraging
2. Briefly acknowledge what you like about their business
3. Be honest about why now isn't the right time (based on your reason)
4. Ask them to keep you in the loop with updates
5. Mention you'll reach out again in ${followUpMonths} months
6. Keep it short - 3-5 sentences max

Write ONLY the email body, no subject line. Sign off casually like "Cheers" or "Best" without a name.`;

    const aiResult = await model.generateContent(prompt);
    const draftEmail = aiResult.response.text().trim();

    // Calculate follow-up date
    const followUpDate = new Date();
    followUpDate.setMonth(followUpDate.getMonth() + followUpMonths);

    // Update startup status and save snooze details
    await startupRef.update({
      status: 'snoozed',
      snoozeReason: reason,
      snoozedAt: admin.firestore.FieldValue.serverTimestamp(),
      snoozeFollowUpDate: followUpDate,
      snoozeDraftEmail: draftEmail,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Create a follow-up reminder
    await db.collection('reminders').add({
      organizationId: req.user!.organizationId,
      startupId: req.params.id,
      startupName: data.name,
      type: 'snooze_followup',
      dueDate: followUpDate,
      reason: reason,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      draftEmail,
      followUpDate: followUpDate.toISOString(),
      message: `Deal snoozed. Follow-up scheduled for ${followUpDate.toLocaleDateString()}`,
    });
  } catch (error) {
    console.error('Snooze startup error:', error);
    return res.status(500).json({ error: 'Failed to snooze startup' });
  }
});

// Pass on a startup deal with reason
app.post('/startups/:id/pass', authenticate, async (req: AuthRequest, res) => {
  try {
    const { reason } = req.body;
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Generate AI draft email for pass
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const businessContext = data.businessModelAnalysis ? JSON.stringify(data.businessModelAnalysis) : data.description || '';

    const prompt = `You are an individual angel investor (NOT a fund) writing to decline an investment opportunity. Write a kind but clear rejection email.

Startup: ${data.name}
Founder: ${data.founderName || 'Founder'}
Business Context: ${businessContext}
Your Reason for Passing: ${reason}

TONE GUIDELINES:
- Write as "I" not "we" - you're a personal investor
- Be genuine and human, not corporate
- Be kind but don't over-explain or apologize excessively
- Avoid VC jargon and buzzwords
- Sound like a real person, not a rejection template

The email should:
1. Thank them briefly for sharing their startup
2. Be honest but kind about why it's not a fit for you personally
3. Wish them well genuinely
4. Keep it SHORT - 2-3 sentences max. Less is more with rejections.
5. Don't leave the door open or give false hope

Write ONLY the email body, no subject line. Sign off simply like "Best" or "Wishing you well" without a name.`;

    const aiResult = await model.generateContent(prompt);
    const draftEmail = aiResult.response.text().trim();

    // Update startup status and save pass details
    await startupRef.update({
      status: 'passed',
      passReason: reason,
      passedAt: admin.firestore.FieldValue.serverTimestamp(),
      passDraftEmail: draftEmail,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      draftEmail,
      message: 'Deal passed. Draft email generated.',
    });
  } catch (error) {
    console.error('Pass startup error:', error);
    return res.status(500).json({ error: 'Failed to pass on startup' });
  }
});

// Send snooze or pass email
app.post('/startups/:id/send-decision-email', authenticate, async (req: AuthRequest, res) => {
  try {
    const { emailBody, emailSubject } = req.body;
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    if (!data.founderEmail) {
      return res.status(400).json({ error: 'No founder email available' });
    }

    // Get SMTP config
    const config = await getInboxConfig(req.user!.organizationId);
    if (!config) {
      return res.status(400).json({ error: 'No email configuration found. Please configure your inbox in Settings.' });
    }

    // Derive SMTP settings from IMAP config
    const smtpHost = config.host.replace('imap.', 'smtp.');
    const smtpPort = 587;

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false,
      auth: {
        user: config.user,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: true,  // SECURITY: Always verify TLS certificates
        minVersion: 'TLSv1.2',     // Enforce modern TLS version
      },
    });

    const mailOptions = {
      from: `"Nitish" <${config.user}>`,
      to: data.founderEmail,
      subject: emailSubject || `Re: ${data.name}`,
      text: emailBody,
    };

    const sendResult = await transporter.sendMail(mailOptions);

    // Record the sent email
    const emailRef = db.collection('emails').doc();
    await emailRef.set({
      startupId: req.params.id,
      organizationId: req.user!.organizationId,
      subject: mailOptions.subject,
      from: config.user,
      fromName: 'Nitish',
      to: data.founderEmail,
      body: emailBody,
      date: admin.firestore.FieldValue.serverTimestamp(),
      direction: 'outbound',
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      smtpMessageId: sendResult.messageId,
      emailType: data.status === 'snoozed' ? 'snooze' : 'pass',
    });

    // Update the startup to mark email as sent
    const updateData: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (data.status === 'snoozed') {
      updateData.snoozeEmailSent = true;
      updateData.snoozeEmailSentAt = admin.firestore.FieldValue.serverTimestamp();
    } else if (data.status === 'passed') {
      updateData.passEmailSent = true;
      updateData.passEmailSentAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await startupRef.update(updateData);

    return res.json({
      success: true,
      to: data.founderEmail,
      messageId: sendResult.messageId,
    });
  } catch (error) {
    console.error('Send decision email error:', error);
    return res.status(500).json({ error: 'Failed to send email' });
  }
});

// ==========================================
// AI Chat for Startup Discussion
// ==========================================

// Get chat history for a startup
app.get('/startups/:id/chat', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Get chat messages
    const chatSnapshot = await db.collection('startups').doc(req.params.id as string)
      .collection('chat')
      .orderBy('createdAt', 'asc')
      .limit(100)
      .get();

    const messages = chatSnapshot.docs.map(doc => {
      const msgData = doc.data();
      return {
        id: doc.id,
        role: msgData.role,
        content: msgData.content,
        createdAt: msgData.createdAt?.toDate?.()?.toISOString() || msgData.createdAt,
      };
    });

    return res.json({ messages });
  } catch (error) {
    console.error('Get chat history error:', error);
    return res.status(500).json({ error: 'Failed to get chat history' });
  }
});

// Send a chat message and get AI response
app.post('/startups/:id/chat', authenticate, async (req: AuthRequest, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const startupData = startupDoc.data()!;
    if (startupData.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const chatCollection = startupRef.collection('chat');

    // Save user message
    const userMsgRef = await chatCollection.add({
      role: 'user',
      content: message,
      userId: req.user!.userId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Get recent chat history for context (last 20 messages)
    const recentChatSnapshot = await chatCollection
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const chatHistory = recentChatSnapshot.docs
      .reverse()
      .slice(0, -1) // Exclude the message we just added
      .map(doc => {
        const d = doc.data();
        return { role: d.role, content: d.content };
      });

    // Use the persistent AI summary if available, otherwise generate it
    let aiSummary = startupData.aiSummary?.summary;
    if (!aiSummary) {
      console.log(`[Chat] No AI summary found for ${startupData.name}, generating now`);
      await updateStartupAISummary(req.params.id as string);
      const updatedDoc = await startupRef.get();
      aiSummary = updatedDoc.data()?.aiSummary?.summary;
    }

    // Build context about the startup using the AI summary
    const startupContext = `
${aiSummary || `
Startup Information:
- Name: ${startupData.name}
- Status: ${startupData.status}
- Stage: ${startupData.stage || 'Unknown'}
- Description: ${startupData.description || 'No description'}
- Current Score: ${startupData.currentScore ?? 'Not scored'}
`}

${startupData.businessModelAnalysis ? `
Business Model Analysis:
- Business Type: ${startupData.businessModelAnalysis.businessModel?.type || 'Unknown'}
- Value Proposition: ${startupData.businessModelAnalysis.businessModel?.valueProposition || 'Unknown'}
- Revenue Streams: ${startupData.businessModelAnalysis.businessModel?.revenueStreams?.join(', ') || 'Unknown'}
- Customer Segments: ${startupData.businessModelAnalysis.businessModel?.customerSegments?.join(', ') || 'Unknown'}
- Market Size: ${startupData.businessModelAnalysis.marketAnalysis?.marketSize || 'Unknown'}
- Competition: ${startupData.businessModelAnalysis.marketAnalysis?.competition || 'Unknown'}
- Strengths: ${startupData.businessModelAnalysis.strengths?.join('; ') || 'None identified'}
- Concerns: ${startupData.businessModelAnalysis.concerns?.join('; ') || 'None identified'}
` : ''}

${startupData.snoozeReason ? `Snooze Reason: ${startupData.snoozeReason}` : ''}
${startupData.passReason ? `Pass Reason: ${startupData.passReason}` : ''}
`;

    // Generate AI response with Google Search grounding for real-time info
    // Note: Gemini 2.0 requires 'google_search' instead of 'googleSearchRetrieval'
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      tools: [{
        google_search: {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any],
    });

    const systemPrompt = `You are an AI assistant helping an individual angel investor (NOT a VC fund) analyze startup investment opportunities. The investor makes personal investments, not through a fund.

${startupContext}

IMPORTANT CONTEXT:
- The investor invests their own money personally, not through a fund
- Use "you" and speak to them as an individual, not "your fund" or "your firm"
- Keep advice practical for a personal investor's perspective
- You have access to Google Search - use it to find websites, news, and other information about startups when needed

You should:
1. Provide thoughtful, practical analysis
2. Help identify risks and opportunities relevant to an individual investor
3. Suggest due diligence questions that a personal investor would ask
4. Be direct and conversational - avoid corporate/VC jargon
5. Keep responses concise and actionable
6. When asked about websites, news, or public information - search the web to find it
7. If information is in the startup context above, use that first before searching

Previous conversation context is provided to maintain continuity.`;

    // Build the conversation for Gemini
    const conversationParts = [
      { text: systemPrompt },
      ...chatHistory.flatMap(msg => [
        { text: `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}` }
      ]),
      { text: `User: ${message}` },
      { text: 'Assistant:' }
    ];

    const result = await model.generateContent(conversationParts.map(p => p.text).join('\n\n'));
    const aiResponse = result.response.text().trim();

    // Save AI response
    const aiMsgRef = await chatCollection.add({
      role: 'assistant',
      content: aiResponse,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      userMessage: {
        id: userMsgRef.id,
        role: 'user',
        content: message,
        createdAt: new Date().toISOString(),
      },
      aiMessage: {
        id: aiMsgRef.id,
        role: 'assistant',
        content: aiResponse,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Chat error:', error);
    return res.status(500).json({ error: 'Failed to process chat message' });
  }
});

// Clear chat history for a startup
app.delete('/startups/:id/chat', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Delete all chat messages
    const chatSnapshot = await startupRef.collection('chat').get();
    const batch = db.batch();
    chatSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();

    return res.json({ success: true, deletedCount: chatSnapshot.size });
  } catch (error) {
    console.error('Clear chat error:', error);
    return res.status(500).json({ error: 'Failed to clear chat history' });
  }
});

// ==========================================
// Auto-Enrichment Service
// ==========================================

interface EnrichmentData {
  // Company data
  website?: {
    title?: string;
    description?: string;
    teamMembers?: Array<{ name: string; role: string; linkedIn?: string }>;
    pricing?: string;
    features?: string[];
    techStack?: string[];
    scrapedAt: string;
  };
  // Crunchbase data
  crunchbase?: {
    name?: string;
    shortDescription?: string;
    foundedOn?: string;
    numEmployeesEnum?: string;
    totalFundingUsd?: number;
    lastFundingType?: string;
    lastFundingDate?: string;
    numFundingRounds?: number;
    investors?: string[];
    categories?: string[];
    headquarters?: string;
    websiteUrl?: string;
    linkedInUrl?: string;
    twitterUrl?: string;
    founders?: Array<{ name: string; title: string; linkedIn?: string }>;
    competitors?: Array<{ name: string; shortDescription?: string }>;
    fetchedAt: string;
  };
  // News data
  news?: {
    articles: Array<{
      title: string;
      source: string;
      url: string;
      publishedAt: string;
      snippet?: string;
    }>;
    fetchedAt: string;
  };
  // LinkedIn company data
  linkedin?: {
    companyName?: string;
    tagline?: string;
    description?: string;
    industry?: string;
    companySize?: string;
    headquarters?: string;
    foundedYear?: string;
    specialties?: string[];
    websiteUrl?: string;
    employeeCount?: string;
    followerCount?: number;
    companyUrl?: string;
    fetchedAt: string;
    source: 'linkedin_api' | 'ai_research';
  };
  // LinkedIn founder/team data
  founders?: Array<{
    name: string;
    linkedInUrl?: string;
    currentRole?: string;
    headline?: string;
    location?: string;
    previousCompanies?: Array<{ name: string; role: string; duration?: string }>;
    education?: Array<{ school: string; degree?: string; field?: string }>;
    skills?: string[];
    connections?: number;
    yearsExperience?: number;
  }>;
  // AI-generated summary
  aiSummary?: {
    teamStrength: string;
    marketPosition: string;
    competitiveAdvantage: string;
    concerns: string[];
    highlights: string[];
    generatedAt: string;
  };
  // Score impact from enrichment
  scoreImpact?: {
    teamAdjustment: number;
    marketAdjustment: number;
    tractionAdjustment: number;
    signals: Array<{ category: string; signal: string; impact: number }>;
  };
  // Enrichment metadata
  lastEnrichedAt: string;
  enrichmentStatus: 'pending' | 'in_progress' | 'completed' | 'failed';
  enrichmentError?: string;
}

// Helper: Fetch and parse website content
async function scrapeWebsite(url: string): Promise<EnrichmentData['website'] | null> {
  try {
    // Normalize URL
    let normalizedUrl = url;
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = `https://${normalizedUrl}`;
    }

    console.log(`[Enrichment] Scraping website: ${normalizedUrl}`);

    const response = await fetch(normalizedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StartupTracker/1.0; +https://startup-tracker-app.web.app)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      console.log(`[Enrichment] Website returned ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Use AI to extract structured data from HTML
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `Extract company information from this website HTML. Return ONLY a JSON object:

HTML (first 15000 chars):
${html.substring(0, 15000)}

Return JSON:
{
  "title": "company name from title/header",
  "description": "what the company does (1-2 sentences)",
  "teamMembers": [{"name": "...", "role": "...", "linkedIn": "url or null"}] (if team page visible),
  "pricing": "pricing info if visible (free, freemium, paid plans)",
  "features": ["key feature 1", "key feature 2"] (max 5),
  "techStack": ["technology mentioned"] (if any dev tools, languages visible)
}

If information not found, use null. Return ONLY valid JSON.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    // Clean JSON response
    let jsonStr = responseText;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    return {
      ...parsed,
      scrapedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Enrichment] Website scrape error:', error);
    return null;
  }
}

// Helper: Search Crunchbase API
async function fetchCrunchbaseData(companyName: string, website?: string): Promise<EnrichmentData['crunchbase'] | null> {
  try {
    // Crunchbase API key - you'll need to add this to your environment
    const CRUNCHBASE_API_KEY = process.env.CRUNCHBASE_API_KEY;

    if (!CRUNCHBASE_API_KEY) {
      console.log('[Enrichment] No Crunchbase API key configured');
      // Return mock/simulated data for now - will use AI to estimate
      return await simulateCrunchbaseWithAI(companyName, website);
    }

    console.log(`[Enrichment] Fetching Crunchbase data for: ${companyName}`);

    // Search for the company
    const searchUrl = `https://api.crunchbase.com/api/v4/autocompletes?query=${encodeURIComponent(companyName)}&collection_ids=organizations`;
    const searchResponse = await fetch(searchUrl, {
      headers: {
        'X-cb-user-key': CRUNCHBASE_API_KEY,
      },
    });

    if (!searchResponse.ok) {
      console.log(`[Enrichment] Crunchbase search returned ${searchResponse.status}`);
      return await simulateCrunchbaseWithAI(companyName, website);
    }

    const searchData = await searchResponse.json();
    if (!searchData.entities || searchData.entities.length === 0) {
      console.log('[Enrichment] No Crunchbase results found');
      return await simulateCrunchbaseWithAI(companyName, website);
    }

    // Get the first matching organization
    const org = searchData.entities[0];
    const orgId = org.identifier.permalink;

    // Fetch detailed organization data
    const detailUrl = `https://api.crunchbase.com/api/v4/entities/organizations/${orgId}?card_ids=founders,raised_funding_rounds,investors`;
    const detailResponse = await fetch(detailUrl, {
      headers: {
        'X-cb-user-key': CRUNCHBASE_API_KEY,
      },
    });

    if (!detailResponse.ok) {
      return await simulateCrunchbaseWithAI(companyName, website);
    }

    const detailData = await detailResponse.json();
    const props = detailData.properties || {};
    const cards = detailData.cards || {};

    return {
      name: props.name,
      shortDescription: props.short_description,
      foundedOn: props.founded_on,
      numEmployeesEnum: props.num_employees_enum,
      totalFundingUsd: props.total_funding_usd,
      lastFundingType: props.last_funding_type,
      lastFundingDate: props.last_funding_at,
      numFundingRounds: props.num_funding_rounds,
      investors: cards.investors?.map((i: { identifier: { value: string } }) => i.identifier.value) || [],
      categories: props.categories?.map((c: { value: string }) => c.value) || [],
      headquarters: props.headquarters_location?.value,
      websiteUrl: props.website_url,
      linkedInUrl: props.linkedin_url,
      twitterUrl: props.twitter_url,
      founders: cards.founders?.map((f: { identifier: { value: string }; title?: string; linkedin?: string }) => ({
        name: f.identifier.value,
        title: f.title,
        linkedIn: f.linkedin,
      })) || [],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Enrichment] Crunchbase fetch error:', error);
    return await simulateCrunchbaseWithAI(companyName, website);
  }
}

// Helper: Use AI to estimate Crunchbase-like data when API not available
async function simulateCrunchbaseWithAI(companyName: string, website?: string): Promise<EnrichmentData['crunchbase'] | null> {
  try {
    console.log(`[Enrichment] Using AI to research: ${companyName}`);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Research the startup "${companyName}"${website ? ` (website: ${website})` : ''} and provide available information.

Return ONLY a JSON object with what you know (use null for unknown fields):
{
  "name": "company name",
  "shortDescription": "what they do",
  "foundedOn": "YYYY or YYYY-MM-DD if known",
  "numEmployeesEnum": "1-10, 11-50, 51-100, 101-250, 251-500, 500+",
  "totalFundingUsd": number or null,
  "lastFundingType": "seed, series_a, series_b, etc or null",
  "categories": ["industry category"],
  "competitors": [{"name": "competitor name", "shortDescription": "what they do"}] (max 3),
  "marketInsights": "brief market analysis"
}

Be conservative - only include information you're confident about.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    let jsonStr = responseText;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    return {
      ...parsed,
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Enrichment] AI research error:', error);
    return null;
  }
}

// Helper: Fetch Google News
async function fetchGoogleNews(companyName: string): Promise<EnrichmentData['news'] | null> {
  try {
    console.log(`[Enrichment] Fetching news for: ${companyName}`);

    // Use Google Custom Search API or fallback to AI
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
    const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX;

    if (GOOGLE_API_KEY && GOOGLE_CX) {
      const query = encodeURIComponent(`${companyName} startup funding OR launch OR announcement`);
      const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${query}&dateRestrict=m6&num=5`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const articles = (data.items || []).map((item: { title: string; displayLink: string; link: string; snippet: string }) => ({
          title: item.title,
          source: item.displayLink,
          url: item.link,
          publishedAt: new Date().toISOString(), // Google doesn't return exact date
          snippet: item.snippet,
        }));

        return {
          articles,
          fetchedAt: new Date().toISOString(),
        };
      }
    }

    // Fallback: Use AI to provide known news/context
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = `What recent news or notable events do you know about the startup "${companyName}"?

Return ONLY a JSON array of news items you're aware of (max 3):
[
  {
    "title": "headline",
    "source": "publication name",
    "publishedAt": "approximate date YYYY-MM-DD",
    "snippet": "brief summary"
  }
]

If you don't know any specific news, return an empty array [].`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    let jsonStr = responseText;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const articles = JSON.parse(jsonStr);
    return {
      articles: articles || [],
      fetchedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Enrichment] News fetch error:', error);
    return { articles: [], fetchedAt: new Date().toISOString() };
  }
}

// Helper: Fetch LinkedIn company data using AI research
async function fetchLinkedInCompanyData(
  companyName: string,
  website?: string,
  linkedInUrl?: string
): Promise<EnrichmentData['linkedin'] | null> {
  try {
    console.log(`[Enrichment] Fetching LinkedIn data for: ${companyName}`);

    // Use AI to research LinkedIn company information
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Research the LinkedIn company profile for "${companyName}"${website ? ` (website: ${website})` : ''}${linkedInUrl ? ` (LinkedIn: ${linkedInUrl})` : ''}.

Based on publicly available information about this company's LinkedIn presence, provide:

Return ONLY a JSON object with this structure:
{
  "companyName": "official company name on LinkedIn",
  "tagline": "company tagline/slogan",
  "description": "company description/about section (2-3 sentences)",
  "industry": "primary industry",
  "companySize": "employee range (e.g., '11-50 employees', '51-200 employees')",
  "headquarters": "city, country",
  "foundedYear": "YYYY or null if unknown",
  "specialties": ["specialty1", "specialty2"],
  "employeeCount": "approximate number or range",
  "followerCount": null
}

Use your knowledge to provide accurate information. If you're uncertain about specific details, use null for those fields.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    let jsonStr = responseText;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    return {
      ...parsed,
      companyUrl: linkedInUrl || null,
      fetchedAt: new Date().toISOString(),
      source: 'ai_research' as const,
    };
  } catch (error) {
    console.error('[Enrichment] LinkedIn company data error:', error);
    return null;
  }
}

// Helper: Fetch LinkedIn founder/team data using AI research
async function fetchLinkedInFounderData(
  companyName: string,
  founderNames?: string[],
  founderLinkedIns?: string[]
): Promise<EnrichmentData['founders'] | null> {
  try {
    console.log(`[Enrichment] Fetching LinkedIn founder data for: ${companyName}`);

    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const founderContext = founderNames && founderNames.length > 0
      ? `Known founders: ${founderNames.join(', ')}`
      : '';

    const linkedInContext = founderLinkedIns && founderLinkedIns.length > 0
      ? `LinkedIn profiles: ${founderLinkedIns.join(', ')}`
      : '';

    const prompt = `Research the founders and key executives of "${companyName}".
${founderContext}
${linkedInContext}

Based on publicly available LinkedIn information, provide details about the founding team and key executives.

Return ONLY a JSON array with this structure:
[
  {
    "name": "Full Name",
    "currentRole": "their role at ${companyName}",
    "headline": "their LinkedIn headline",
    "location": "city, country",
    "previousCompanies": [
      {"name": "Company Name", "role": "Their role", "duration": "e.g., 2 years"}
    ],
    "education": [
      {"school": "University Name", "degree": "Degree Type", "field": "Field of Study"}
    ],
    "skills": ["skill1", "skill2", "skill3"],
    "yearsExperience": 10
  }
]

Provide information for up to 3 key founders/executives. Use your knowledge to provide accurate information.
If you're uncertain about specific details, omit those fields.
Focus on founders, CEOs, CTOs, and other C-level executives.`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    let jsonStr = responseText;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const founders = JSON.parse(jsonStr);

    // Attach LinkedIn URLs if provided
    if (founderLinkedIns && founders) {
      founders.forEach((founder: { name: string; linkedInUrl?: string }, idx: number) => {
        if (founderLinkedIns[idx]) {
          founder.linkedInUrl = founderLinkedIns[idx];
        }
      });
    }

    return founders && founders.length > 0 ? founders : null;
  } catch (error) {
    console.error('[Enrichment] LinkedIn founder data error:', error);
    return null;
  }
}

// Helper: Generate AI summary from all enrichment data
async function generateEnrichmentSummary(
  startupData: Record<string, unknown>,
  enrichmentData: EnrichmentData
): Promise<EnrichmentData['aiSummary'] | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Analyze this startup enrichment data and provide an investment-focused summary.

Startup: ${startupData.name}
Description: ${startupData.description || 'N/A'}
Stage: ${startupData.stage || 'Unknown'}

Website Data: ${JSON.stringify(enrichmentData.website || {}, null, 2)}
Market Data: ${JSON.stringify(enrichmentData.crunchbase || {}, null, 2)}
LinkedIn Company: ${JSON.stringify(enrichmentData.linkedin || {}, null, 2)}
Founder Profiles: ${JSON.stringify(enrichmentData.founders || [], null, 2)}
Recent News: ${JSON.stringify(enrichmentData.news?.articles || [], null, 2)}

Return ONLY a JSON object:
{
  "teamStrength": "Assessment of team based on available data (1-2 sentences)",
  "marketPosition": "Market positioning and competitive landscape (1-2 sentences)",
  "competitiveAdvantage": "What makes them unique (1-2 sentences)",
  "concerns": ["concern 1", "concern 2"] (investment concerns, max 3),
  "highlights": ["highlight 1", "highlight 2"] (positive signals, max 3)
}`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text().trim();

    let jsonStr = responseText;
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
    }

    const parsed = JSON.parse(jsonStr);
    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    console.error('[Enrichment] Summary generation error:', error);
    return null;
  }
}

// Helper: Calculate enrichment score impact
function calculateEnrichmentScoreImpact(enrichmentData: EnrichmentData): {
  teamAdjustment: number;
  marketAdjustment: number;
  tractionAdjustment: number;
  signals: Array<{ category: string; signal: string; impact: number }>;
} {
  const signals: Array<{ category: string; signal: string; impact: number }> = [];
  let teamAdjustment = 0;
  let marketAdjustment = 0;
  let tractionAdjustment = 0;

  // Crunchbase signals
  if (enrichmentData.crunchbase) {
    const cb = enrichmentData.crunchbase;

    // Funding signals
    if (cb.totalFundingUsd && cb.totalFundingUsd > 0) {
      if (cb.totalFundingUsd >= 10000000) {
        tractionAdjustment += 5;
        signals.push({ category: 'traction', signal: `Raised $${(cb.totalFundingUsd / 1000000).toFixed(1)}M in funding`, impact: 5 });
      } else if (cb.totalFundingUsd >= 1000000) {
        tractionAdjustment += 3;
        signals.push({ category: 'traction', signal: `Raised $${(cb.totalFundingUsd / 1000000).toFixed(1)}M in funding`, impact: 3 });
      }
    }

    // Notable investors
    if (cb.investors && cb.investors.length > 0) {
      const notableInvestors = ['Sequoia', 'a16z', 'Andreessen', 'Y Combinator', 'YC', 'Accel', 'Tiger Global', 'Lightspeed', 'Index'];
      const hasNotable = cb.investors.some(inv => notableInvestors.some(n => inv.toLowerCase().includes(n.toLowerCase())));
      if (hasNotable) {
        teamAdjustment += 3;
        signals.push({ category: 'team', signal: 'Backed by tier-1 investors', impact: 3 });
      }
    }

    // Team size
    if (cb.numEmployeesEnum) {
      if (cb.numEmployeesEnum.includes('51') || cb.numEmployeesEnum.includes('100')) {
        tractionAdjustment += 2;
        signals.push({ category: 'traction', signal: `Team size: ${cb.numEmployeesEnum} employees`, impact: 2 });
      }
    }

    // Competitors identified
    if (cb.competitors && cb.competitors.length > 0) {
      marketAdjustment += 1;
      signals.push({ category: 'market', signal: `${cb.competitors.length} competitors identified`, impact: 1 });
    }
  }

  // Website signals
  if (enrichmentData.website) {
    const web = enrichmentData.website;

    // Team visible
    if (web.teamMembers && web.teamMembers.length > 0) {
      teamAdjustment += 1;
      signals.push({ category: 'team', signal: `${web.teamMembers.length} team members identified`, impact: 1 });
    }

    // Clear pricing = market validation
    if (web.pricing && !web.pricing.toLowerCase().includes('contact')) {
      tractionAdjustment += 1;
      signals.push({ category: 'traction', signal: 'Public pricing available', impact: 1 });
    }
  }

  // News signals
  if (enrichmentData.news && enrichmentData.news.articles.length > 0) {
    marketAdjustment += 2;
    signals.push({ category: 'market', signal: `${enrichmentData.news.articles.length} recent news articles found`, impact: 2 });
  }

  // LinkedIn company signals
  if (enrichmentData.linkedin) {
    const li = enrichmentData.linkedin;

    // Company size from LinkedIn
    if (li.companySize) {
      const sizeMatch = li.companySize.match(/(\d+)/);
      if (sizeMatch) {
        const size = parseInt(sizeMatch[1]);
        if (size >= 50) {
          tractionAdjustment += 2;
          signals.push({ category: 'traction', signal: `LinkedIn shows ${li.companySize}`, impact: 2 });
        } else if (size >= 10) {
          tractionAdjustment += 1;
          signals.push({ category: 'traction', signal: `LinkedIn shows ${li.companySize}`, impact: 1 });
        }
      }
    }

    // Follower count indicates market presence
    if (li.followerCount && li.followerCount > 1000) {
      marketAdjustment += 1;
      signals.push({ category: 'market', signal: `${li.followerCount.toLocaleString()} LinkedIn followers`, impact: 1 });
    }
  }

  // LinkedIn founder signals
  if (enrichmentData.founders && enrichmentData.founders.length > 0) {
    const founders = enrichmentData.founders;

    // Strong founder backgrounds
    const experiencedFounders = founders.filter(f => f.yearsExperience && f.yearsExperience >= 10);
    if (experiencedFounders.length > 0) {
      teamAdjustment += 2;
      signals.push({ category: 'team', signal: `${experiencedFounders.length} founder(s) with 10+ years experience`, impact: 2 });
    }

    // Notable previous companies
    const notableCompanies = ['Google', 'Meta', 'Facebook', 'Amazon', 'Apple', 'Microsoft', 'Netflix', 'Uber', 'Airbnb', 'Stripe', 'LinkedIn', 'Twitter', 'Salesforce', 'Oracle', 'McKinsey', 'BCG', 'Bain', 'Goldman', 'Morgan Stanley'];
    const hasNotableBackground = founders.some(f =>
      f.previousCompanies?.some(pc =>
        notableCompanies.some(nc => pc.name.toLowerCase().includes(nc.toLowerCase()))
      )
    );
    if (hasNotableBackground) {
      teamAdjustment += 3;
      signals.push({ category: 'team', signal: 'Founder(s) from notable companies', impact: 3 });
    }

    // Strong education
    const topSchools = ['Stanford', 'MIT', 'Harvard', 'Berkeley', 'Yale', 'Princeton', 'Wharton', 'Carnegie Mellon', 'Oxford', 'Cambridge', 'IIT', 'INSEAD'];
    const hasTopEducation = founders.some(f =>
      f.education?.some(edu =>
        topSchools.some(school => edu.school.toLowerCase().includes(school.toLowerCase()))
      )
    );
    if (hasTopEducation) {
      teamAdjustment += 2;
      signals.push({ category: 'team', signal: 'Founder(s) from top-tier universities', impact: 2 });
    }
  }

  return {
    teamAdjustment,
    marketAdjustment,
    tractionAdjustment,
    signals,
  };
}

// Main enrichment function
async function enrichStartup(startupId: string, startupData: Record<string, unknown>): Promise<EnrichmentData> {
  console.log(`[Enrichment] Starting enrichment for: ${startupData.name}`);

  const enrichmentData: EnrichmentData = {
    lastEnrichedAt: new Date().toISOString(),
    enrichmentStatus: 'in_progress',
  };

  try {
    // Extract any known LinkedIn URLs from startup data
    const linkedInUrl = startupData.linkedInUrl as string | undefined;
    const founderLinkedIns = startupData.founderLinkedIns as string[] | undefined;
    const founderNames = startupData.founders as string[] | undefined;

    // Run all enrichment tasks in parallel (Phase 1: Basic data)
    const [websiteData, crunchbaseData, newsData] = await Promise.all([
      startupData.website ? scrapeWebsite(startupData.website as string) : Promise.resolve(null),
      fetchCrunchbaseData(startupData.name as string, startupData.website as string),
      fetchGoogleNews(startupData.name as string),
    ]);

    if (websiteData) enrichmentData.website = websiteData;
    if (crunchbaseData) enrichmentData.crunchbase = crunchbaseData;

    // Phase 2: LinkedIn enrichment (can use data from Phase 1)
    // Get LinkedIn URL from crunchbase if not provided
    const effectiveLinkedInUrl = linkedInUrl || crunchbaseData?.linkedInUrl;

    // Get founder names from website scrape if not provided
    const effectiveFounderNames = founderNames ||
      websiteData?.teamMembers?.map(m => m.name) ||
      crunchbaseData?.founders?.map(f => f.name);

    // Run LinkedIn enrichment in parallel
    const [linkedinCompanyData, linkedinFounderData] = await Promise.all([
      fetchLinkedInCompanyData(
        startupData.name as string,
        startupData.website as string | undefined,
        effectiveLinkedInUrl
      ),
      fetchLinkedInFounderData(
        startupData.name as string,
        effectiveFounderNames,
        founderLinkedIns
      ),
    ]);

    if (linkedinCompanyData) enrichmentData.linkedin = linkedinCompanyData;
    if (linkedinFounderData) enrichmentData.founders = linkedinFounderData;
    if (newsData) enrichmentData.news = newsData;

    // Generate AI summary
    const aiSummary = await generateEnrichmentSummary(startupData, enrichmentData);
    if (aiSummary) enrichmentData.aiSummary = aiSummary;

    // Calculate score impact and save to enrichmentData
    const scoreImpact = calculateEnrichmentScoreImpact(enrichmentData);
    enrichmentData.scoreImpact = scoreImpact;

    // Update startup with enrichment data
    const startupRef = db.collection('startups').doc(startupId);

    const updateData: Record<string, unknown> = {
      enrichmentData,
      enrichedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Auto-populate fields from enrichment
    if (crunchbaseData) {
      if (crunchbaseData.shortDescription && !startupData.description) {
        updateData.description = crunchbaseData.shortDescription;
      }
      if (crunchbaseData.categories && crunchbaseData.categories.length > 0 && !startupData.sector) {
        // Map categories to our sectors
        const categoryMap: Record<string, string> = {
          'fintech': 'fintech',
          'financial services': 'fintech',
          'health': 'healthtech',
          'healthcare': 'healthtech',
          'edtech': 'edtech',
          'education': 'edtech',
          'saas': 'saas',
          'software': 'saas',
          'e-commerce': 'ecommerce',
          'marketplace': 'marketplace',
          'consumer': 'consumer',
          'enterprise': 'enterprise',
          'artificial intelligence': 'deeptech',
          'machine learning': 'deeptech',
          'climate': 'climate',
          'sustainability': 'climate',
        };

        for (const cat of crunchbaseData.categories) {
          const lowerCat = cat.toLowerCase();
          for (const [key, value] of Object.entries(categoryMap)) {
            if (lowerCat.includes(key)) {
              updateData.sector = value;
              break;
            }
          }
          if (updateData.sector) break;
        }
      }
      if (crunchbaseData.founders && crunchbaseData.founders.length > 0 && !startupData.founders) {
        updateData.founders = crunchbaseData.founders;
      }
      if (crunchbaseData.linkedInUrl) {
        updateData.linkedInUrl = crunchbaseData.linkedInUrl;
      }
      if (crunchbaseData.twitterUrl) {
        updateData.twitterUrl = crunchbaseData.twitterUrl;
      }
    }

    // Apply score adjustments
    if (scoreImpact.signals.length > 0) {
      // Create score events for enrichment findings
      const batch = db.batch();
      for (const signal of scoreImpact.signals) {
        const eventRef = db.collection('scoreEvents').doc();
        batch.set(eventRef, {
          startupId,
          organizationId: startupData.organizationId,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          source: 'enrichment',
          category: signal.category,
          signal: signal.signal,
          impact: signal.impact,
          confidence: 0.8,
          analyzedBy: 'ai',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      // Update score breakdown
      const currentBreakdown = (startupData.scoreBreakdown as Record<string, { base: number; adjusted: number }>) || {};
      if (currentBreakdown.team) {
        currentBreakdown.team.adjusted = (currentBreakdown.team.adjusted || 0) + scoreImpact.teamAdjustment;
      }
      if (currentBreakdown.market) {
        currentBreakdown.market.adjusted = (currentBreakdown.market.adjusted || 0) + scoreImpact.marketAdjustment;
      }
      if (currentBreakdown.traction) {
        currentBreakdown.traction.adjusted = (currentBreakdown.traction.adjusted || 0) + scoreImpact.tractionAdjustment;
      }
      updateData.scoreBreakdown = currentBreakdown;

      // Recalculate total score
      const totalAdjustment = scoreImpact.teamAdjustment + scoreImpact.marketAdjustment + scoreImpact.tractionAdjustment;
      if (typeof startupData.currentScore === 'number') {
        updateData.currentScore = Math.min(100, Math.max(0, startupData.currentScore + totalAdjustment));
      }
    }

    enrichmentData.enrichmentStatus = 'completed';
    updateData.enrichmentData = enrichmentData;

    await startupRef.update(updateData);

    console.log(`[Enrichment] Completed enrichment for: ${startupData.name}`);
    return enrichmentData;
  } catch (error) {
    console.error('[Enrichment] Error:', error);
    enrichmentData.enrichmentStatus = 'failed';
    enrichmentData.enrichmentError = error instanceof Error ? error.message : 'Unknown error';

    // Save failed status
    await db.collection('startups').doc(startupId).update({
      enrichmentData,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return enrichmentData;
  }
}

// Endpoint: Trigger enrichment for a startup
app.post('/startups/:id/enrich', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Mark as in progress
    await startupRef.update({
      'enrichmentData.enrichmentStatus': 'in_progress',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Run enrichment (don't await - return immediately)
    enrichStartup(req.params.id as string, { id: startupDoc.id, ...data })
      .catch(err => console.error('[Enrichment] Background enrichment failed:', err));

    return res.json({
      success: true,
      message: 'Enrichment started. Data will be updated shortly.',
      status: 'in_progress',
    });
  } catch (error) {
    console.error('Enrich startup error:', error);
    return res.status(500).json({ error: 'Failed to start enrichment' });
  }
});

// Endpoint: Get enrichment data for a startup
app.get('/startups/:id/enrichment', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupDoc = await db.collection('startups').doc(req.params.id as string).get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const enrichmentData = data.enrichmentData;

    // If no enrichment data, return not_started status
    if (!enrichmentData) {
      return res.json({ status: 'not_started' });
    }

    // Format AI summary as a readable string
    let aiSummaryText: string | null = null;
    if (enrichmentData.aiSummary) {
      const summary = enrichmentData.aiSummary;
      const parts: string[] = [];
      if (summary.teamStrength) parts.push(`**Team:** ${summary.teamStrength}`);
      if (summary.marketPosition) parts.push(`**Market:** ${summary.marketPosition}`);
      if (summary.competitiveAdvantage) parts.push(`**Advantage:** ${summary.competitiveAdvantage}`);
      if (summary.highlights && summary.highlights.length > 0) {
        parts.push(`**Highlights:** ${summary.highlights.join(', ')}`);
      }
      if (summary.concerns && summary.concerns.length > 0) {
        parts.push(`**Concerns:** ${summary.concerns.join(', ')}`);
      }
      aiSummaryText = parts.join('\n\n');
    }

    // Format website data for frontend
    let websiteData = null;
    if (enrichmentData.website) {
      const web = enrichmentData.website;
      websiteData = {
        companyName: web.title || null,
        description: web.description || null,
        sector: null, // Not directly available from scrape
        productOffering: web.features?.join(', ') || null,
        targetMarket: null,
        teamSize: web.teamMembers?.length ? `${web.teamMembers.length}+ team members` : null,
        foundedYear: null,
        founders: web.teamMembers?.map((m: { name: string; role: string; linkedIn?: string }) => ({ name: m.name, role: m.role, linkedin: m.linkedIn })) || null,
        linkedinUrl: null,
        twitterUrl: null,
        techStack: web.techStack || null,
      };
    }

    // Format crunchbase data for frontend
    let crunchbaseData = null;
    if (enrichmentData.crunchbase) {
      const cb = enrichmentData.crunchbase;
      crunchbaseData = {
        shortDescription: cb.shortDescription || null,
        totalFundingUsd: cb.totalFundingUsd || null,
        lastFundingType: cb.lastFundingType || null,
        numEmployeesEnum: cb.numEmployeesEnum || null,
        foundedOn: cb.foundedOn || null,
        categories: cb.categories || null,
        investors: cb.investors || null,
        source: cb.source || 'crunchbase',
      };
    }

    // Format news articles for frontend
    let newsArticles = null;
    if (enrichmentData.news?.articles) {
      newsArticles = enrichmentData.news.articles;
    }

    // Format score impact for frontend (map from backend structure)
    let scoreImpact = null;
    if (enrichmentData.scoreImpact) {
      const si = enrichmentData.scoreImpact;
      scoreImpact = {
        team: si.team || si.teamAdjustment || 0,
        market: si.market || si.marketAdjustment || 0,
        traction: si.traction || si.tractionAdjustment || 0,
        product: si.product || 0,
      };
    }

    // Format LinkedIn company data for frontend
    let linkedinData = null;
    if (enrichmentData.linkedin) {
      const li = enrichmentData.linkedin;
      linkedinData = {
        companyName: li.companyName || null,
        tagline: li.tagline || null,
        description: li.description || null,
        industry: li.industry || null,
        companySize: li.companySize || null,
        headquarters: li.headquarters || null,
        foundedYear: li.foundedYear || null,
        specialties: li.specialties || null,
        employeeCount: li.employeeCount || null,
        followerCount: li.followerCount || null,
        companyUrl: li.companyUrl || null,
        source: li.source || 'ai_research',
      };
    }

    // Format founders data for frontend
    let foundersData = null;
    if (enrichmentData.founders && enrichmentData.founders.length > 0) {
      foundersData = enrichmentData.founders.map((f: NonNullable<EnrichmentData['founders']>[number]) => ({
        name: f.name,
        linkedInUrl: f.linkedInUrl || null,
        currentRole: f.currentRole || null,
        headline: f.headline || null,
        location: f.location || null,
        previousCompanies: f.previousCompanies || null,
        education: f.education || null,
        skills: f.skills || null,
        yearsExperience: f.yearsExperience || null,
      }));
    }

    // Map backend structure to frontend expected format
    return res.json({
      status: enrichmentData.enrichmentStatus || 'not_started',
      aiSummary: aiSummaryText,
      websiteData,
      crunchbaseData,
      linkedinData,
      foundersData,
      newsArticles,
      scoreImpact,
      enrichedAt: enrichmentData.lastEnrichedAt || data.enrichedAt?.toDate?.()?.toISOString() || null,
      error: enrichmentData.enrichmentError || null,
    });
  } catch (error) {
    console.error('Get enrichment error:', error);
    return res.status(500).json({ error: 'Failed to get enrichment data' });
  }
});

// Get pending reminders (for snoozed deals follow-up)
app.get('/reminders', authenticate, async (req: AuthRequest, res) => {
  try {
    const now = new Date();
    const remindersSnapshot = await db.collection('reminders')
      .where('organizationId', '==', req.user!.organizationId)
      .where('status', '==', 'pending')
      .where('dueDate', '<=', now)
      .orderBy('dueDate', 'asc')
      .limit(50)
      .get();

    const reminders = remindersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      dueDate: doc.data().dueDate?.toDate?.() || doc.data().dueDate,
    }));

    return res.json({ reminders });
  } catch (error) {
    console.error('Get reminders error:', error);
    return res.status(500).json({ error: 'Failed to get reminders' });
  }
});

// Dismiss a reminder
app.post('/reminders/:id/dismiss', authenticate, async (req: AuthRequest, res) => {
  try {
    const reminderRef = db.collection('reminders').doc(req.params.id as string);
    const reminderDoc = await reminderRef.get();

    if (!reminderDoc.exists) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    const data = reminderDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Reminder not found' });
    }

    await reminderRef.update({
      status: 'dismissed',
      dismissedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Dismiss reminder error:', error);
    return res.status(500).json({ error: 'Failed to dismiss reminder' });
  }
});

// Record founder update for snoozed startup
app.post('/startups/:id/founder-update', authenticate, async (req: AuthRequest, res) => {
  try {
    const { updateContent, source } = req.body;
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Add founder update
    const updateRef = db.collection('founderUpdates').doc();
    await updateRef.set({
      startupId: req.params.id,
      organizationId: req.user!.organizationId,
      content: updateContent,
      source: source || 'manual',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      reviewed: false,
    });

    // Create an alert for review
    await db.collection('alerts').add({
      organizationId: req.user!.organizationId,
      startupId: req.params.id,
      startupName: data.name,
      type: 'founder_update',
      message: `New update from ${data.founderName || 'founder'} for ${data.name}`,
      updateId: updateRef.id,
      status: 'unread',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      updateId: updateRef.id,
      message: 'Founder update recorded and alert created',
    });
  } catch (error) {
    console.error('Record founder update error:', error);
    return res.status(500).json({ error: 'Failed to record founder update' });
  }
});

// Get alerts for the organization
app.get('/alerts', authenticate, async (req: AuthRequest, res) => {
  try {
    const alertsSnapshot = await db.collection('alerts')
      .where('organizationId', '==', req.user!.organizationId)
      .where('status', '==', 'unread')
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();

    const alerts = alertsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.() || doc.data().createdAt,
    }));

    return res.json({ alerts });
  } catch (error) {
    console.error('Get alerts error:', error);
    return res.status(500).json({ error: 'Failed to get alerts' });
  }
});

// Mark alert as read
app.post('/alerts/:id/read', authenticate, async (req: AuthRequest, res) => {
  try {
    const alertRef = db.collection('alerts').doc(req.params.id as string);
    const alertDoc = await alertRef.get();

    if (!alertDoc.exists) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    const data = alertDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    await alertRef.update({
      status: 'read',
      readAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Mark alert as read error:', error);
    return res.status(500).json({ error: 'Failed to mark alert as read' });
  }
});

// Manually trigger AI analysis for a startup
app.post('/startups/:id/analyze', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    console.log(`[Analyze] Running AI analysis for ${data.name}...`);
    const aiAnalysis = await analyzeStartupWithAI({
      name: data.name,
      description: data.description,
      founderName: data.founderName,
      founderEmail: data.founderEmail,
      stage: data.stage,
    });

    if (!aiAnalysis) {
      return res.status(500).json({ error: 'AI analysis failed' });
    }

    // Update startup with AI analysis
    await startupRef.update({
      currentScore: aiAnalysis.currentScore,
      baseScore: aiAnalysis.currentScore,
      scoreBreakdown: aiAnalysis.scoreBreakdown,
      businessModelAnalysis: aiAnalysis.businessModelAnalysis,
      sector: aiAnalysis.businessModelAnalysis?.sector,
      draftReply: aiAnalysis.draftReply,
      draftReplyStatus: data.draftReplyStatus || 'pending',
      scoreUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`[Analyze] AI analysis complete. Score: ${aiAnalysis.currentScore}`);
    return res.json({
      success: true,
      score: aiAnalysis.currentScore,
      sector: aiAnalysis.businessModelAnalysis?.sector,
    });
  } catch (error) {
    console.error('Analyze startup error:', error);
    return res.status(500).json({ error: 'Failed to analyze startup' });
  }
});

app.delete('/startups/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupRef = db.collection('startups').doc(req.params.id as string);
    const startupDoc = await startupRef.get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    await startupRef.delete();
    return res.status(204).send();
  } catch (error) {
    console.error('Delete startup error:', error);
    return res.status(500).json({ error: 'Failed to delete startup' });
  }
});

// ==================== INBOX/QUEUE ROUTES ====================

// Helper function to get inbox config from either inboxConfig collection or organization settings
async function getInboxConfig(organizationId: string): Promise<{host: string; port: number; user: string; password: string; tls: boolean; folder: string} | null> {
  // First try the dedicated inboxConfig collection
  const configDoc = await db.collection('inboxConfig').doc(organizationId).get();
  if (configDoc.exists) {
    const data = configDoc.data()!;
    if (data.host && data.user && data.password) {
      return {
        host: data.host,
        port: data.port || 993,
        user: data.user,
        password: data.password,
        tls: data.tls !== false,
        folder: data.folder || 'INBOX',
      };
    }
  }

  // Fallback: check organization settings.emailInbox
  const orgDoc = await db.collection('organizations').doc(organizationId).get();
  if (orgDoc.exists) {
    const orgData = orgDoc.data()!;
    const emailInbox = orgData.settings?.emailInbox;
    if (emailInbox && emailInbox.host && emailInbox.user && emailInbox.password) {
      return {
        host: emailInbox.host,
        port: emailInbox.port || 993,
        user: emailInbox.user,
        password: emailInbox.password,
        tls: emailInbox.tls !== false,
        folder: emailInbox.folder || 'INBOX',
      };
    }
  }

  return null;
}

// Helper function to send email via SMTP
async function sendEmailViaSMTP(config: {host: string; port: number; user: string; password: string; tls: boolean}, options: {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  body: string;
  replyTo?: string;
}): Promise<{success: boolean; messageId?: string; error?: string}> {
  try {
    // For most email providers, SMTP port is typically:
    // - 587 for STARTTLS (submission)
    // - 465 for SSL/TLS (legacy but still used)
    // - 25 for unencrypted (rarely used now)
    // The IMAP host usually works for SMTP too (e.g., imap.gmail.com -> smtp.gmail.com)

    // Derive SMTP host from IMAP host if needed
    let smtpHost = config.host;
    if (smtpHost.startsWith('imap.')) {
      smtpHost = smtpHost.replace('imap.', 'smtp.');
    }

    // Use standard SMTP ports based on security
    const smtpPort = 587; // STARTTLS is most widely supported

    console.log(`[SMTP] Creating transporter for ${smtpHost}:${smtpPort}`);

    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false, // Use STARTTLS (upgrade connection)
      auth: {
        user: config.user,
        pass: config.password,
      },
      tls: {
        rejectUnauthorized: true,  // SECURITY: Always verify TLS certificates
        minVersion: 'TLSv1.2',     // Enforce modern TLS version
      },
    });

    // Verify the connection
    console.log(`[SMTP] Verifying connection...`);
    await transporter.verify();
    console.log(`[SMTP] Connection verified successfully`);

    // Format the "from" field with name if provided
    const fromField = options.fromName
      ? `"${options.fromName}" <${options.from}>`
      : options.from;

    // Send the email
    console.log(`[SMTP] Sending email to ${options.to}...`);
    const info = await transporter.sendMail({
      from: fromField,
      to: options.to,
      subject: options.subject,
      text: options.body,
      html: options.body.replace(/\n/g, '<br>'), // Simple HTML conversion
      replyTo: options.replyTo || options.from,
    });

    console.log(`[SMTP] Email sent successfully! MessageId: ${info.messageId}`);

    return {
      success: true,
      messageId: info.messageId,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown SMTP error';
    console.error(`[SMTP] Error sending email:`, error);
    return {
      success: false,
      error: errorMessage,
    };
  }
}

// Sync inbox - connects to IMAP and fetches emails (v2)
app.post('/inbox/sync', authenticate, async (req: AuthRequest, res) => {
  console.log(`[EmailSync] === SYNC STARTED v2 === org: ${req.user!.organizationId}, user: ${req.user!.userId}, time: ${new Date().toISOString()}`);
  try {
    // Get inbox config for this organization
    const config = await getInboxConfig(req.user!.organizationId);
    console.log(`[EmailSync] Config loaded: ${config ? 'YES' : 'NO'}`);

    if (!config) {
      return res.json({
        processed: 0,
        created: 0,
        skipped: 0,
        failed: 0,
        decksProcessed: 0,
        emailsLinked: 0,
        queued: 0,
        quotaExceeded: false,
        message: 'No inbox configured. Please configure your email inbox in Settings first.',
        results: []
      });
    }
    // Connect to IMAP
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.tls,
      auth: {
        user: config.user,
        pass: config.password,
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,  // SECURITY: Always verify TLS certificates
        minVersion: 'TLSv1.2',     // Enforce modern TLS version
      },
    });

    const results: Array<{
      messageId: string;
      subject: string;
      from: string;
      date: Date;
      status: string;
      attachments?: number;
      startupName?: string;
    }> = [];
    let queued = 0;
    let processed = 0;
    let skipped = 0;
    let decksProcessed = 0;

    try {
      await client.connect();
      console.log(`[EmailSync] Connected to ${config.host}`);

      await client.mailboxOpen(config.folder);
      console.log(`[EmailSync] Opened folder: ${config.folder}`);

      // Search for emails from the last 30 days (includes read emails)
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - 30);

      const searchResult = await client.search({ since: sinceDate });
      const recentMessages = Array.isArray(searchResult) ? searchResult : [];
      console.log(`[EmailSync] Found ${recentMessages.length} emails from last 30 days`);

      // Limit to 100 most recent
      const messagesToFetch = recentMessages.slice(-100);

      for (const uid of messagesToFetch) {
        try {
          const message = await client.fetchOne(uid, { source: true });
          if (message && typeof message === 'object' && 'source' in message && message.source) {
            const parsed: ParsedMail = await simpleParser(message.source as Buffer);
            const messageId = parsed.messageId || `${Date.now()}-${Math.random().toString(36).substring(7)}`;
            const fromAddress = parsed.from?.value?.[0];
            const fromEmail = fromAddress?.address || 'unknown@unknown.com';
            const fromName = fromAddress?.name || '';
            const subject = parsed.subject || 'No Subject';

            // Debug: Log every email being processed
            console.log(`[EmailSync] Processing email from: ${fromEmail}, subject: ${subject}`);

            // Debug: Log attachment info for ALL emails (before filtering)
            if (parsed.attachments && parsed.attachments.length > 0) {
              console.log(`[EmailSync] EMAIL HAS ATTACHMENTS: ${subject}`);
              console.log(`[EmailSync] Attachment count: ${parsed.attachments.length}`);
              parsed.attachments.forEach((att, i) => {
                console.log(`[EmailSync] Att[${i}]: ${att.filename} (${att.contentType}, ${att.size} bytes)`);
              });
            }

            // Check if already processed in proposal queue
            const existingSnapshot = await db.collection('proposalQueue')
              .where('emailMessageId', '==', messageId)
              .get();

            if (!existingSnapshot.empty) {
              console.log(`[EmailSync] ALREADY IN QUEUE: "${subject}" - messageId: ${messageId}`);
              skipped++;
              continue;
            }

            // Check if already processed in emails collection
            const existingEmailSnapshot = await db.collection('emails')
              .where('messageId', '==', messageId)
              .get();

            if (!existingEmailSnapshot.empty) {
              console.log(`[EmailSync] ALREADY IN EMAILS: "${subject}" - messageId: ${messageId}`);
              skipped++;
              continue;
            }

            // Check if this email is from a known startup founder (reply to our outreach)
            // First try exact match
            let startupByFounderEmail = await db.collection('startups')
              .where('organizationId', '==', req.user!.organizationId)
              .where('founderEmail', '==', fromEmail)
              .limit(1)
              .get();

            // If no exact match, try case-insensitive match
            if (startupByFounderEmail.empty) {
              const allStartups = await db.collection('startups')
                .where('organizationId', '==', req.user!.organizationId)
                .get();

              const fromEmailLower = fromEmail.toLowerCase();
              const matchingStartup = allStartups.docs.find(doc => {
                const founderEmail = doc.data().founderEmail;
                return founderEmail && founderEmail.toLowerCase() === fromEmailLower;
              });

              if (matchingStartup) {
                // Create a fake QuerySnapshot-like object
                startupByFounderEmail = {
                  empty: false,
                  docs: [matchingStartup],
                } as typeof startupByFounderEmail;
                console.log(`[EmailSync] Case-insensitive match found for ${fromEmail}`);
              }
            }

            if (!startupByFounderEmail.empty) {
              // This is a reply from a founder we're already tracking!
              const startupDoc = startupByFounderEmail.docs[0];
              const startupData = startupDoc.data();
              const emailBody = parsed.text || parsed.html || '';

              console.log(`[EmailSync] Found reply from founder: ${fromEmail} for startup: ${startupData.name}`);

              // Fetch previous emails for context (without orderBy to avoid index requirement)
              const previousEmailsSnapshot = await db.collection('emails')
                .where('startupId', '==', startupDoc.id)
                .get();

              const previousEmails = previousEmailsSnapshot.docs.map(doc => {
                const data = doc.data();
                return {
                  subject: data.subject || '',
                  body: data.body || '',
                  direction: data.direction || 'inbound',
                  date: data.date?.toDate?.() || new Date(data.date),
                };
              })
                .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Sort in memory
                .slice(0, 10); // Limit to 10

              // AI Analysis of founder response
              console.log(`[EmailSync] Analyzing founder response with AI for: ${startupData.name}`);
              const responseAnalysis = await analyzeFounderResponse(
                {
                  name: startupData.name,
                  description: startupData.description,
                  founderName: startupData.founderName,
                  stage: startupData.stage,
                  currentScore: startupData.currentScore,
                  scoreBreakdown: startupData.scoreBreakdown,
                  businessModelAnalysis: startupData.businessModelAnalysis,
                },
                {
                  subject,
                  body: emailBody,
                  from: `${fromName} <${fromEmail}>`,
                },
                previousEmails
              );

              // Store the email linked to this startup with AI analysis
              const emailRef = db.collection('emails').doc();
              await emailRef.set({
                startupId: startupDoc.id,
                organizationId: req.user!.organizationId,
                subject,
                from: fromEmail,
                fromName: fromName || startupData.founderName,
                to: config.user,
                body: emailBody,
                date: parsed.date || new Date(),
                direction: 'inbound',
                isRead: false,
                labels: ['reply', 'founder-response'],
                messageId,
                hasAttachments: (parsed.attachments?.length || 0) > 0,
                attachmentCount: parsed.attachments?.length || 0,
                // AI Analysis results
                aiAnalysis: responseAnalysis ? {
                  responseQuality: responseAnalysis.responseQuality,
                  recommendation: responseAnalysis.recommendation,
                  recommendationReason: responseAnalysis.recommendationReason,
                  suggestedQuestions: responseAnalysis.suggestedQuestions,
                  analyzedAt: new Date(),
                } : null,
                draftReply: responseAnalysis?.draftReply || null,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });

              // Update startup score based on AI analysis
              if (responseAnalysis && responseAnalysis.scoreAdjustment) {
                const adj = responseAnalysis.scoreAdjustment;
                const currentBreakdown = startupData.scoreBreakdown || {};

                // Calculate score adjustments
                const communicationAdj = adj.communication || 0;
                const teamAdj = adj.team || 0;
                const productAdj = adj.product || 0;
                const tractionAdj = adj.traction || 0;
                const momentumAdj = adj.momentum || 0;

                // Update score breakdown
                const newBreakdown = {
                  ...currentBreakdown,
                  communication: Math.max(0, Math.min(10, (currentBreakdown.communication || 5) + communicationAdj)),
                  momentum: Math.max(0, Math.min(10, (currentBreakdown.momentum || 5) + momentumAdj)),
                  team: currentBreakdown.team ? {
                    ...currentBreakdown.team,
                    adjusted: Math.max(0, Math.min(25, (currentBreakdown.team.adjusted || currentBreakdown.team.base || 15) + teamAdj)),
                  } : currentBreakdown.team,
                  product: currentBreakdown.product ? {
                    ...currentBreakdown.product,
                    adjusted: Math.max(0, Math.min(20, (currentBreakdown.product.adjusted || currentBreakdown.product.base || 12) + productAdj)),
                  } : currentBreakdown.product,
                  traction: currentBreakdown.traction ? {
                    ...currentBreakdown.traction,
                    adjusted: Math.max(0, Math.min(20, (currentBreakdown.traction.adjusted || currentBreakdown.traction.base || 10) + tractionAdj)),
                  } : currentBreakdown.traction,
                };

                // Recalculate total score
                const teamScore = newBreakdown.team?.adjusted || newBreakdown.team?.base || 0;
                const marketScore = newBreakdown.market?.adjusted || newBreakdown.market?.base || 0;
                const productScore = newBreakdown.product?.adjusted || newBreakdown.product?.base || 0;
                const tractionScore = newBreakdown.traction?.adjusted || newBreakdown.traction?.base || 0;
                const dealScore = newBreakdown.deal?.adjusted || newBreakdown.deal?.base || 0;
                const commScore = newBreakdown.communication || 5;
                const momScore = newBreakdown.momentum || 5;
                const redFlags = newBreakdown.redFlags || 0;

                const newTotalScore = Math.round(
                  teamScore + marketScore + productScore + tractionScore + dealScore +
                  commScore + momScore - redFlags
                );

                // Record score event
                await db.collection('startups').doc(startupDoc.id).collection('scoreEvents').add({
                  previousScore: startupData.currentScore || 0,
                  newScore: newTotalScore,
                  change: newTotalScore - (startupData.currentScore || 0),
                  reason: `Founder response analyzed: ${adj.reasoning}`,
                  source: 'founder_response',
                  aiAnalysis: responseAnalysis.responseQuality,
                  recommendation: responseAnalysis.recommendation,
                  createdAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                // Update startup with new score and draft reply
                await startupDoc.ref.update({
                  currentScore: newTotalScore,
                  scoreBreakdown: newBreakdown,
                  lastEmailReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
                  lastResponseAnalysis: {
                    quality: responseAnalysis.responseQuality,
                    recommendation: responseAnalysis.recommendation,
                    recommendationReason: responseAnalysis.recommendationReason,
                    suggestedQuestions: responseAnalysis.suggestedQuestions,
                    draftReply: responseAnalysis.draftReply,
                    analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
                  },
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });

                console.log(`[EmailSync] Updated score for ${startupData.name}: ${startupData.currentScore} -> ${newTotalScore} (${adj.reasoning})`);
              } else {
                // Just update last contact date if no AI analysis
                await startupDoc.ref.update({
                  lastEmailReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                });
              }

              // Update the startup's AI summary with new email analysis
              await updateStartupAISummary(startupDoc.id);

              console.log(`[EmailSync] Stored founder reply for startup: ${startupData.name}${responseAnalysis ? ` - AI recommends: ${responseAnalysis.recommendation}` : ''}`);
              processed++;
              results.push({
                messageId,
                subject,
                from: `${fromName} <${fromEmail}>`,
                date: parsed.date || new Date(),
                status: 'linked_to_startup',
                startupName: startupData.name,
              });
              continue;
            }

            // Use AI to analyze if this is a startup proposal
            const bodyText = parsed.text || '';

            // Call AI to extract startup info
            console.log(`[EmailSync] Calling AI to analyze: "${subject}" from ${fromEmail}`);
            const aiResult = await extractStartupFromEmail(subject, bodyText, `${fromName} <${fromEmail}>`);

            // Debug: Log AI result for every email
            if (aiResult) {
              console.log(`[EmailSync] AI Result for "${subject}": isProposal=${aiResult.isStartupProposal}, confidence=${aiResult.confidence}%, startupName=${aiResult.startupName}, reason=${aiResult.reason}`);
            } else {
              console.log(`[EmailSync] AI returned null for "${subject}" - check API key or error`);
            }

            if (aiResult && aiResult.isStartupProposal && aiResult.confidence >= 60) {
              const startupName = aiResult.startupName || subject.replace(/^(Re:|Fwd:|FW:)\s*/gi, '').trim().substring(0, 100) || 'Unknown Startup';

              // Extract and store attachments (PDFs, docs, etc.)
              const attachmentData: Array<{
                fileName: string;
                mimeType: string;
                size: number;
                storagePath?: string;
                storageUrl?: string;
              }> = [];

              // Debug: Log raw attachment info
              console.log(`[EmailSync] Checking attachments for: ${subject}`);
              console.log(`[EmailSync] parsed.attachments exists: ${!!parsed.attachments}, count: ${parsed.attachments?.length || 0}`);

              if (parsed.attachments && parsed.attachments.length > 0) {
                console.log(`[EmailSync] Found ${parsed.attachments.length} attachments in email: ${subject}`);
                parsed.attachments.forEach((att, i) => {
                  console.log(`[EmailSync] Attachment ${i}: filename=${att.filename}, contentType=${att.contentType}, size=${att.size}`);
                });

                for (const attachment of parsed.attachments) {
                  // Only process relevant file types (PDFs, docs, presentations)
                  const relevantMimeTypes = [
                    'application/pdf',
                    'application/vnd.ms-powerpoint',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    'application/msword',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  ];

                  const fileName = attachment.filename || 'attachment';
                  const isPDF = fileName.toLowerCase().endsWith('.pdf');
                  const isPPT = fileName.toLowerCase().endsWith('.ppt') || fileName.toLowerCase().endsWith('.pptx');
                  const isDOC = fileName.toLowerCase().endsWith('.doc') || fileName.toLowerCase().endsWith('.docx');

                  if (relevantMimeTypes.includes(attachment.contentType) || isPDF || isPPT || isDOC) {
                    try {
                      // Store attachment in Firebase Storage
                      const bucket = admin.storage().bucket();
                      const storagePath = `attachments/${req.user!.organizationId}/${messageId}/${Date.now()}-${fileName}`;
                      const file = bucket.file(storagePath);

                      await file.save(attachment.content, {
                        metadata: {
                          contentType: attachment.contentType,
                          metadata: {
                            originalName: fileName,
                            emailMessageId: messageId,
                          },
                        },
                      });

                      // Get signed URL
                      const [signedUrl] = await file.getSignedUrl({
                        action: 'read',
                        expires: '2030-01-01',
                      });

                      attachmentData.push({
                        fileName,
                        mimeType: attachment.contentType,
                        size: attachment.size || attachment.content.length,
                        storagePath,
                        storageUrl: signedUrl,
                      });

                      decksProcessed++;
                      console.log(`[EmailSync] Stored attachment: ${fileName} (${attachment.contentType})`);
                    } catch (attachmentError) {
                      console.error(`[EmailSync] Failed to store attachment ${fileName}:`, attachmentError);
                    }
                  }
                }
              }

              // Add to proposal queue with attachment data
              await db.collection('proposalQueue').add({
                organizationId: req.user!.organizationId,
                userId: req.user!.userId,
                emailMessageId: messageId,
                emailSubject: subject,
                emailFrom: fromEmail,
                emailFromName: fromName || null,
                emailDate: parsed.date || new Date(),
                emailPreview: bodyText.substring(0, 1000),
                startupName: startupName,
                description: aiResult.description || bodyText.substring(0, 500) || null,
                website: null,
                founderName: aiResult.founderName || fromName || null,
                founderEmail: fromEmail,
                stage: aiResult.stage || null,
                askAmount: aiResult.askAmount || null,
                confidence: aiResult.confidence / 100,
                aiReason: aiResult.reason || 'AI analysis',
                status: 'pending',
                attachments: attachmentData.length > 0 ? attachmentData : null,
                hasAttachments: attachmentData.length > 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });

              queued++;
              results.push({
                messageId,
                subject,
                from: `${fromName} <${fromEmail}>`,
                date: parsed.date || new Date(),
                status: 'queued',
                attachments: attachmentData.length,
              });
              console.log(`[EmailSync] AI identified startup proposal: ${startupName} (${aiResult.confidence}% confidence) with ${attachmentData.length} attachments`);
            } else {
              skipped++;
              if (aiResult) {
                if (aiResult.isStartupProposal && aiResult.confidence < 60) {
                  console.log(`[EmailSync] SKIPPED (low confidence): "${subject}" - ${aiResult.startupName || 'unknown'} - confidence ${aiResult.confidence}% < 60% threshold`);
                } else {
                  console.log(`[EmailSync] SKIPPED (not proposal): "${subject}" - ${aiResult.reason}`);
                }
              } else {
                console.log(`[EmailSync] SKIPPED (AI failed): "${subject}" - no AI result returned`);
              }
            }

            processed++;
          }
        } catch (fetchError) {
          console.error(`[EmailSync] Failed to fetch message ${uid}:`, fetchError);
        }
      }

      await client.logout();
    } catch (imapError) {
      console.error('[EmailSync] IMAP error:', imapError);
      try { await client.logout(); } catch { /* ignore */ }
      return res.status(500).json({
        error: `Failed to connect to inbox: ${imapError instanceof Error ? imapError.message : 'Unknown error'}`
      });
    }

    return res.json({
      processed,
      created: 0,
      skipped,
      failed: 0,
      decksProcessed,
      emailsLinked: 0,
      queued,
      quotaExceeded: false,
      message: queued > 0
        ? `Found ${queued} potential startup proposals to review!${decksProcessed > 0 ? ` (${decksProcessed} attachments saved)` : ''}`
        : 'No new startup proposals found in your inbox.',
      results
    });
  } catch (error) {
    console.error('Sync inbox error:', error);
    return res.status(500).json({ error: 'Failed to sync inbox' });
  }
});

// Process inbox - placeholder for now
app.post('/inbox/process', authenticate, async (_req: AuthRequest, res) => {
  try {
    return res.json({
      success: true,
      message: 'Inbox processing completed',
      processed: 0
    });
  } catch (error) {
    console.error('Process inbox error:', error);
    return res.status(500).json({ error: 'Failed to process inbox' });
  }
});

// Save inbox config
app.post('/inbox/config', authenticate, async (req: AuthRequest, res) => {
  try {
    const configRef = db.collection('inboxConfig').doc(req.user!.organizationId);
    await configRef.set({
      ...req.body,
      organizationId: req.user!.organizationId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ success: true });
  } catch (error) {
    console.error('Save inbox config error:', error);
    return res.status(500).json({ error: 'Failed to save inbox config' });
  }
});

// Test inbox connection - actually tests IMAP connection
app.post('/inbox/test', authenticate, async (req: AuthRequest, res) => {
  try {
    const { host, port, user, password, tls, folder } = req.body;

    if (!host || !user || !password) {
      return res.status(400).json({ error: 'Missing required fields: host, user, password' });
    }

    const client = new ImapFlow({
      host,
      port: port || 993,
      secure: tls !== false,
      auth: {
        user,
        pass: password,
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,  // SECURITY: Always verify TLS certificates
        minVersion: 'TLSv1.2',     // Enforce modern TLS version
      },
    });

    try {
      console.log(`[IMAP Test] Connecting to ${host}:${port} as ${user}...`);
      await client.connect();
      console.log(`[IMAP Test] Connected successfully, opening mailbox...`);
      const mailbox = await client.mailboxOpen(folder || 'INBOX');
      console.log(`[IMAP Test] Mailbox opened, getting status...`);
      const status = await client.status(folder || 'INBOX', { unseen: true });

      const result = {
        success: true,
        message: 'Connection successful!',
        mailboxInfo: {
          total: mailbox.exists,
          unseen: status.unseen ?? 0,
        },
      };

      await client.logout();
      console.log(`[IMAP Test] Success! ${mailbox.exists} total emails, ${status.unseen} unseen`);
      return res.json(result);
    } catch (imapError: any) {
      console.error(`[IMAP Test] Error:`, imapError);
      console.error(`[IMAP Test] Error details:`, {
        message: imapError?.message,
        responseText: imapError?.responseText,
        authenticationFailed: imapError?.authenticationFailed,
        code: imapError?.code,
      });
      try { await client.logout(); } catch { /* ignore */ }
      return res.json({
        success: false,
        error: imapError?.responseText || imapError?.message || 'Connection failed',
        details: imapError?.authenticationFailed ? 'Authentication failed - check username and password' : undefined,
      });
    }
  } catch (error) {
    console.error('Test inbox error:', error);
    return res.status(500).json({ error: 'Failed to test inbox connection' });
  }
});

// Parse email content - placeholder
app.post('/inbox/parse', authenticate, async (req: AuthRequest, res) => {
  try {
    const { content, subject, from } = req.body;
    // In a full implementation, this would parse the email and extract startup info
    return res.json({
      success: true,
      parsed: {
        subject,
        from,
        contentLength: content?.length || 0
      }
    });
  } catch (error) {
    console.error('Parse content error:', error);
    return res.status(500).json({ error: 'Failed to parse content' });
  }
});

app.get('/inbox/queue', authenticate, async (req: AuthRequest, res) => {
  try {
    // Get existing startups to filter out duplicates
    const startupsSnapshot = await db.collection('startups')
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const existingEmails = new Set<string>();
    const existingNames = new Set<string>();
    startupsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.founderEmail) existingEmails.add(data.founderEmail.toLowerCase());
      if (data.name) {
        const normalizedName = data.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (normalizedName.length > 3) existingNames.add(normalizedName);
      }
    });

    const snapshot = await db.collection('proposalQueue')
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    let proposals = snapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          emailSubject: data.emailSubject || '',
          emailFrom: data.emailFrom || '',
          emailFromName: data.emailFromName || null,
          emailDate: data.emailDate?.toDate?.()?.toISOString() || data.emailDate || new Date().toISOString(),
          emailPreview: data.emailPreview || '',
          startupName: data.startupName || 'Unknown',
          description: data.description || null,
          website: data.website || null,
          founderName: data.founderName || null,
          founderEmail: data.founderEmail || null,
          askAmount: data.askAmount || null,
          stage: data.stage || null,
          confidence: data.confidence || 0.5,
          aiReason: data.aiReason || null,
          status: data.status || 'pending',
          createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt || new Date().toISOString(),
        };
      })
      .filter((p: any) => p.status === 'pending');

    // Sort by createdAt descending
    proposals.sort((a: any, b: any) => {
      const dateA = new Date(a.createdAt || 0).getTime();
      const dateB = new Date(b.createdAt || 0).getTime();
      return dateB - dateA;
    });

    // Deduplicate proposals by founderEmail - keep the most recent one
    // Also filter out proposals for startups that already exist
    const seenEmails = new Set<string>();
    const seenNames = new Set<string>();
    proposals = proposals.filter((p: any) => {
      const normalizedName = p.startupName?.toLowerCase().replace(/[^a-z0-9]/g, '');
      const founderEmailLower = p.founderEmail?.toLowerCase();

      // Skip if startup already exists with this founder email
      if (founderEmailLower && existingEmails.has(founderEmailLower)) {
        return false;
      }

      // Skip if startup already exists with similar name
      if (normalizedName && normalizedName.length > 3 && existingNames.has(normalizedName)) {
        return false;
      }

      // Skip if we've seen this founder email in the queue
      if (founderEmailLower && seenEmails.has(founderEmailLower)) {
        return false;
      }

      // Skip if we've seen a very similar startup name in the queue
      if (normalizedName && normalizedName.length > 3 && seenNames.has(normalizedName)) {
        return false;
      }

      if (founderEmailLower) seenEmails.add(founderEmailLower);
      if (normalizedName && normalizedName.length > 3) seenNames.add(normalizedName);
      return true;
    });

    return res.json({ proposals });
  } catch (error) {
    console.error('Get queue error:', error);
    return res.json({ proposals: [] });
  }
});

app.post('/inbox/queue/:id/approve', authenticate, async (req: AuthRequest, res) => {
  try {
    const proposalRef = db.collection('proposalQueue').doc(req.params.id as string);
    const proposalDoc = await proposalRef.get();

    if (!proposalDoc.exists) {
      return res.status(404).json({ error: 'Proposal not found' });
    }

    const proposalData = proposalDoc.data()!;

    // Log attachment data for debugging
    console.log(`[Approve] Proposal ${req.params.id} for ${proposalData.startupName}`);
    console.log(`[Approve] hasAttachments: ${proposalData.hasAttachments}, attachments count: ${proposalData.attachments?.length || 0}`);
    if (proposalData.attachments && proposalData.attachments.length > 0) {
      proposalData.attachments.forEach((att: { fileName: string; storagePath?: string; storageUrl?: string }, i: number) => {
        console.log(`[Approve] Attachment ${i + 1}: ${att.fileName}, storagePath: ${att.storagePath ? 'yes' : 'no'}, storageUrl: ${att.storageUrl ? 'yes' : 'no'}`);
      });
    }

    // Check for existing startup with same founder email to prevent duplicates
    const existingByEmail = await db.collection('startups')
      .where('organizationId', '==', req.user!.organizationId)
      .where('founderEmail', '==', proposalData.founderEmail)
      .limit(1)
      .get();

    if (!existingByEmail.empty) {
      // Startup already exists - link proposal to existing startup and mark as approved
      const existingStartup = existingByEmail.docs[0];

      // Create email record for the new email thread
      const emailRef = db.collection('emails').doc();
      await emailRef.set({
        startupId: existingStartup.id,
        organizationId: req.user!.organizationId,
        subject: proposalData.emailSubject,
        from: proposalData.emailFrom,
        fromName: proposalData.emailFromName || proposalData.founderName,
        to: proposalData.emailTo || 'inbox',
        body: proposalData.emailPreview,
        date: proposalData.emailDate || admin.firestore.FieldValue.serverTimestamp(),
        direction: 'inbound',
        isRead: true,
        labels: ['proposal'],
        messageId: proposalData.messageId || `proposal-${req.params.id}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // If proposal has attachments, create deck records for them
      if (proposalData.attachments && proposalData.attachments.length > 0) {
        for (const attachment of proposalData.attachments) {
          const deckRef = db.collection('decks').doc();
          await deckRef.set({
            startupId: existingStartup.id,
            organizationId: req.user!.organizationId,
            fileName: attachment.fileName,
            fileSize: attachment.size,
            fileUrl: attachment.storageUrl,
            storagePath: attachment.storagePath,
            mimeType: attachment.mimeType,
            source: 'email_attachment',
            emailMessageId: proposalData.emailMessageId,
            status: 'uploaded',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          console.log(`[Approve] Created deck record for attachment: ${attachment.fileName}`);
        }
      }

      await proposalRef.update({ status: 'approved', linkedStartupId: existingStartup.id, emailId: emailRef.id });
      return res.json({
        success: true,
        startupId: existingStartup.id,
        score: existingStartup.data().currentScore,
        message: 'Linked to existing startup (same founder email)'
      });
    }

    // Also check for similar startup name (normalized)
    const normalizedName = proposalData.startupName?.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedName && normalizedName.length > 3) {
      const allStartups = await db.collection('startups')
        .where('organizationId', '==', req.user!.organizationId)
        .get();

      const duplicate = allStartups.docs.find(doc => {
        const existingName = doc.data().name?.toLowerCase().replace(/[^a-z0-9]/g, '');
        return existingName && (
          existingName === normalizedName ||
          existingName.includes(normalizedName) ||
          normalizedName.includes(existingName)
        );
      });

      if (duplicate) {
        // Create email record for the new email thread
        const emailRef = db.collection('emails').doc();
        await emailRef.set({
          startupId: duplicate.id,
          organizationId: req.user!.organizationId,
          subject: proposalData.emailSubject,
          from: proposalData.emailFrom,
          fromName: proposalData.emailFromName || proposalData.founderName,
          to: proposalData.emailTo || 'inbox',
          body: proposalData.emailPreview,
          date: proposalData.emailDate || admin.firestore.FieldValue.serverTimestamp(),
          direction: 'inbound',
          isRead: true,
          labels: ['proposal'],
          messageId: proposalData.messageId || `proposal-${req.params.id}`,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // If proposal has attachments, create deck records for them
        if (proposalData.attachments && proposalData.attachments.length > 0) {
          for (const attachment of proposalData.attachments) {
            const deckRef = db.collection('decks').doc();
            await deckRef.set({
              startupId: duplicate.id,
              organizationId: req.user!.organizationId,
              fileName: attachment.fileName,
              fileSize: attachment.size,
              fileUrl: attachment.storageUrl,
              storagePath: attachment.storagePath,
              mimeType: attachment.mimeType,
              source: 'email_attachment',
              emailMessageId: proposalData.emailMessageId,
              status: 'uploaded',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[Approve] Created deck record for attachment: ${attachment.fileName}`);
          }
        }

        await proposalRef.update({ status: 'approved', linkedStartupId: duplicate.id, emailId: emailRef.id });
        return res.json({
          success: true,
          startupId: duplicate.id,
          score: duplicate.data().currentScore,
          message: 'Linked to existing startup (similar name)'
        });
      }
    }

    // Analyze attachments with AI first (before email analysis for questions)
    let attachmentAnalyses: Array<{
      fileName: string;
      score: number;
      summary: string;
      strengths: string[];
      weaknesses: string[];
      keyMetrics: Record<string, string | null>;
    }> = [];

    if (proposalData.attachments && proposalData.attachments.length > 0) {
      console.log(`[Approve] Analyzing ${proposalData.attachments.length} attachments for ${proposalData.startupName}...`);

      for (const attachment of proposalData.attachments) {
        try {
          // Analyze the attachment with AI
          const analysis = await analyzeAttachmentWithAI(attachment.fileName, attachment.mimeType, proposalData.startupName);
          if (analysis) {
            attachmentAnalyses.push({
              fileName: attachment.fileName,
              ...analysis
            });
            console.log(`[Approve] Attachment analysis for ${attachment.fileName}: score ${analysis.score}`);
          }
        } catch (attachErr) {
          console.error(`[Approve] Error analyzing attachment ${attachment.fileName}:`, attachErr);
        }
      }
    }

    // Run AI analysis on the proposal, including attachment insights
    console.log(`[Approve] Running AI analysis for ${proposalData.startupName}...`);
    const aiAnalysis = await analyzeStartupWithAI({
      name: proposalData.startupName,
      description: proposalData.description,
      founderName: proposalData.founderName,
      founderEmail: proposalData.founderEmail,
      stage: proposalData.stage,
      emailContent: proposalData.emailPreview,
    });

    // Calculate combined score if we have attachment analyses
    let combinedScore = aiAnalysis?.currentScore || 50;
    if (attachmentAnalyses.length > 0) {
      const avgAttachmentScore = attachmentAnalyses.reduce((sum, a) => sum + a.score, 0) / attachmentAnalyses.length;
      // Weight: 60% email analysis, 40% attachment analysis
      combinedScore = Math.round((combinedScore * 0.6) + (avgAttachmentScore * 0.4));
      console.log(`[Approve] Combined score: ${combinedScore} (email: ${aiAnalysis?.currentScore}, attachments avg: ${avgAttachmentScore})`);
    }

    // Create startup from proposal with AI analysis
    const startupRef = db.collection('startups').doc();
    const startupData: Record<string, unknown> = {
      name: proposalData.startupName || 'Unknown Startup',
      description: proposalData.description || null,
      website: proposalData.website || null,
      founderEmail: proposalData.founderEmail || null,
      founderName: proposalData.founderName || null,
      stage: proposalData.stage || 'seed',
      status: 'reviewing',
      organizationId: req.user!.organizationId,
      hasAttachments: proposalData.hasAttachments || false,
      attachmentCount: proposalData.attachments?.length || 0,
      firstEmailDate: proposalData.emailDate || admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add AI analysis results if available
    if (aiAnalysis) {
      startupData.currentScore = combinedScore;
      startupData.baseScore = combinedScore;
      startupData.emailScore = aiAnalysis.currentScore;
      startupData.scoreBreakdown = aiAnalysis.scoreBreakdown;
      startupData.businessModelAnalysis = aiAnalysis.businessModelAnalysis;
      startupData.sector = aiAnalysis.businessModelAnalysis?.sector;
      startupData.draftReplyStatus = 'pending';
      startupData.scoreUpdatedAt = admin.firestore.FieldValue.serverTimestamp();

      // Add attachment analysis insights to key questions
      if (attachmentAnalyses.length > 0) {
        // Update draft reply to include attachment-informed questions
        const draftReplyWithAttachmentContext = generateDraftReplyWithAttachments(
          aiAnalysis.draftReply,
          attachmentAnalyses,
          proposalData.startupName,
          proposalData.founderName
        );
        startupData.draftReply = draftReplyWithAttachmentContext;

        // Store attachment analyses
        startupData.attachmentAnalyses = attachmentAnalyses;
      } else {
        startupData.draftReply = aiAnalysis.draftReply;
      }

      console.log(`[Approve] AI analysis complete. Combined Score: ${combinedScore}`);
    }

    await startupRef.set(startupData);

    // Create score events if AI analysis was performed
    if (aiAnalysis) {
      const scoreEvents: Array<{category: string; signal: string; impact: number; evidence: string}> = [];

      // Add initial proposal event
      scoreEvents.push({
        category: 'deal',
        signal: 'Startup proposal received',
        impact: 0,
        evidence: `Received pitch from ${proposalData.founderName || 'founder'} via email`,
      });

      // Add score breakdown events
      if (aiAnalysis.scoreBreakdown) {
        const breakdown = aiAnalysis.scoreBreakdown;
        if (breakdown.team?.base >= 7) {
          scoreEvents.push({
            category: 'team',
            signal: 'Strong team signal',
            impact: 5,
            evidence: `Team score: ${breakdown.team.base}/10`,
          });
        }
        if (breakdown.market?.base >= 7) {
          scoreEvents.push({
            category: 'market',
            signal: 'Attractive market',
            impact: 5,
            evidence: `Market score: ${breakdown.market.base}/10`,
          });
        }
        if (breakdown.product?.base >= 7) {
          scoreEvents.push({
            category: 'product',
            signal: 'Strong product/tech',
            impact: 5,
            evidence: `Product score: ${breakdown.product.base}/10`,
          });
        }
        if (breakdown.traction?.base >= 7) {
          scoreEvents.push({
            category: 'traction',
            signal: 'Good traction signals',
            impact: 5,
            evidence: `Traction score: ${breakdown.traction.base}/10`,
          });
        }
        if (breakdown.redFlags && breakdown.redFlags < -3) {
          scoreEvents.push({
            category: 'deal',
            signal: 'Red flags detected',
            impact: breakdown.redFlags,
            evidence: 'AI detected potential concerns in the pitch',
          });
        }
      }

      // Add business model event
      if (aiAnalysis.businessModelAnalysis) {
        const bma = aiAnalysis.businessModelAnalysis;
        scoreEvents.push({
          category: 'product',
          signal: 'Business model identified',
          impact: 2,
          evidence: `${bma.businessModel?.type || 'Unknown'} model in ${bma.sector || 'Unknown'} sector`,
        });
      }

      // Add attachment analysis events
      for (const attachmentAnalysis of attachmentAnalyses) {
        if (attachmentAnalysis.score >= 70) {
          scoreEvents.push({
            category: 'product',
            signal: 'Strong pitch deck',
            impact: 5,
            evidence: `Deck analysis score: ${attachmentAnalysis.score}/100. ${attachmentAnalysis.summary || ''}`,
          });
        } else if (attachmentAnalysis.score >= 50) {
          scoreEvents.push({
            category: 'product',
            signal: 'Pitch deck analyzed',
            impact: 2,
            evidence: `Deck analysis score: ${attachmentAnalysis.score}/100. ${attachmentAnalysis.summary || ''}`,
          });
        }
      }

      // Create all score events
      for (const event of scoreEvents) {
        await db.collection('scoreEvents').add({
          startupId: startupRef.id,
          organizationId: req.user!.organizationId,
          ...event,
          source: 'proposal_approval',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      console.log(`[Approve] Created ${scoreEvents.length} score events`);
    }

    // Create deck records from attachments
    if (proposalData.attachments && proposalData.attachments.length > 0) {
      console.log(`[Approve] Creating ${proposalData.attachments.length} deck records...`);
      for (let i = 0; i < proposalData.attachments.length; i++) {
        const attachment = proposalData.attachments[i];
        const analysis = attachmentAnalyses[i] || null;

        // Generate a fresh signed URL if storagePath exists
        let fileUrl = attachment.storageUrl;
        if (attachment.storagePath) {
          try {
            const bucket = admin.storage().bucket();
            const file = bucket.file(attachment.storagePath);
            const [exists] = await file.exists();
            if (exists) {
              // Use public URL format which doesn't expire
              const bucketName = bucket.name;
              fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(attachment.storagePath)}?alt=media`;
              console.log(`[Approve] Generated fresh URL for: ${attachment.fileName}`);
            } else {
              console.log(`[Approve] File not found in storage: ${attachment.storagePath}`);
            }
          } catch (urlError) {
            console.error(`[Approve] Failed to generate URL for ${attachment.fileName}:`, urlError);
          }
        }

        const deckRef = db.collection('decks').doc();
        await deckRef.set({
          startupId: startupRef.id,
          organizationId: req.user!.organizationId,
          fileName: attachment.fileName,
          fileSize: attachment.size,
          fileUrl: fileUrl,
          storagePath: attachment.storagePath,
          mimeType: attachment.mimeType,
          source: 'email_attachment',
          emailMessageId: proposalData.emailMessageId,
          aiAnalysis: analysis ? {
            score: analysis.score,
            summary: analysis.summary,
            strengths: analysis.strengths,
            weaknesses: analysis.weaknesses,
            keyMetrics: analysis.keyMetrics,
          } : null,
          status: analysis ? 'processed' : 'uploaded',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`[Approve] Created deck record for: ${attachment.fileName}`);
      }
    } else {
      console.log(`[Approve] No attachments found in proposal data`);
    }

    // Create email record from the proposal
    const emailRef = db.collection('emails').doc();
    await emailRef.set({
      startupId: startupRef.id,
      organizationId: req.user!.organizationId,
      subject: proposalData.emailSubject,
      from: proposalData.emailFrom,
      fromName: proposalData.emailFromName || proposalData.founderName,
      to: proposalData.emailTo || 'inbox',
      body: proposalData.emailPreview,
      date: proposalData.emailDate || admin.firestore.FieldValue.serverTimestamp(),
      direction: 'inbound',
      isRead: true,
      labels: ['proposal'],
      messageId: proposalData.messageId || `proposal-${req.params.id}`,
      hasAttachments: proposalData.hasAttachments || false,
      attachmentCount: proposalData.attachments?.length || 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update proposal status
    await proposalRef.update({ status: 'approved', linkedStartupId: startupRef.id, emailId: emailRef.id });

    // Auto-trigger enrichment in background
    console.log(`[Approve] Starting auto-enrichment for ${proposalData.startupName}...`);
    enrichStartup(startupRef.id, {
      id: startupRef.id,
      name: proposalData.startupName,
      website: proposalData.website || proposalData.extractedDomain,
      description: proposalData.description,
      stage: proposalData.stage,
      organizationId: req.user!.organizationId,
      currentScore: combinedScore,
      scoreBreakdown: aiAnalysis?.scoreBreakdown,
    }).catch(err => console.error('[Approve] Auto-enrichment failed:', err));

    return res.json({
      success: true,
      startupId: startupRef.id,
      score: combinedScore,
      attachmentsProcessed: proposalData.attachments?.length || 0,
    });
  } catch (error) {
    console.error('Approve proposal error:', error);
    return res.status(500).json({ error: 'Failed to approve proposal' });
  }
});

// Backfill emails for existing startups from approved proposals
app.post('/inbox/backfill-emails', authenticate, async (req: AuthRequest, res) => {
  try {
    // Find approved proposals that have linkedStartupId but no emailId
    const proposalSnapshot = await db.collection('proposalQueue')
      .where('organizationId', '==', req.user!.organizationId)
      .where('status', '==', 'approved')
      .get();

    let created = 0;
    for (const doc of proposalSnapshot.docs) {
      const data = doc.data();
      if (data.linkedStartupId && !data.emailId) {
        // Check if email already exists for this startup with same subject
        const existingEmail = await db.collection('emails')
          .where('startupId', '==', data.linkedStartupId)
          .where('subject', '==', data.emailSubject)
          .limit(1)
          .get();

        if (existingEmail.empty) {
          const emailRef = db.collection('emails').doc();
          await emailRef.set({
            startupId: data.linkedStartupId,
            organizationId: req.user!.organizationId,
            subject: data.emailSubject,
            from: data.emailFrom,
            fromName: data.emailFromName || data.founderName,
            to: 'inbox',
            body: data.emailPreview,
            date: data.emailDate || data.createdAt,
            direction: 'inbound',
            isRead: true,
            labels: ['proposal'],
            messageId: data.messageId || `proposal-${doc.id}`,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          await doc.ref.update({ emailId: emailRef.id });
          created++;
        }
      }
    }

    return res.json({ success: true, created });
  } catch (error) {
    console.error('Backfill emails error:', error);
    return res.status(500).json({ error: 'Failed to backfill emails' });
  }
});

app.post('/inbox/queue/:id/reject', authenticate, async (req: AuthRequest, res) => {
  try {
    const proposalRef = db.collection('proposalQueue').doc(req.params.id as string);
    await proposalRef.update({ status: 'rejected', rejectedAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ success: true });
  } catch (error) {
    console.error('Reject proposal error:', error);
    return res.status(500).json({ error: 'Failed to reject proposal' });
  }
});

app.post('/inbox/queue/:id/snooze', authenticate, async (req: AuthRequest, res) => {
  try {
    const proposalRef = db.collection('proposalQueue').doc(req.params.id as string);
    await proposalRef.update({ status: 'snoozed', snoozedAt: admin.firestore.FieldValue.serverTimestamp() });
    return res.json({ success: true });
  } catch (error) {
    console.error('Snooze proposal error:', error);
    return res.status(500).json({ error: 'Failed to snooze proposal' });
  }
});

// ==================== USERS ROUTES ====================

app.get('/users', authenticate, async (req: AuthRequest, res) => {
  try {
    const snapshot = await db.collection('users')
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const users = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        email: data.email,
        name: data.name,
        role: data.role,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      };
    });

    return res.json(users);
  } catch (error) {
    console.error('List users error:', error);
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

// ==================== EMAILS ROUTES ====================

app.get('/emails/startup/:startupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;
    const snapshot = await db.collection('emails')
      .where('startupId', '==', startupId)
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const emails = snapshot.docs.map(doc => {
      const data = doc.data();
      // Handle date - could be in date, sentAt, or receivedAt field
      const getDateValue = (val: unknown): string | null => {
        if (!val) return null;
        if (typeof val === 'object' && val !== null && 'toDate' in val && typeof (val as { toDate: () => Date }).toDate === 'function') {
          return (val as { toDate: () => Date }).toDate().toISOString();
        }
        if (val instanceof Date) {
          return val.toISOString();
        }
        if (typeof val === 'string') {
          return val;
        }
        return null;
      };
      const dateValue = getDateValue(data.date) || getDateValue(data.sentAt) || getDateValue(data.receivedAt) || getDateValue(data.createdAt);

      return {
        id: doc.id,
        subject: data.subject,
        // Frontend expected fields
        fromAddress: data.from,
        fromName: data.fromName,
        toAddresses: data.to ? [{ email: data.to }] : [],
        bodyPreview: data.body?.substring(0, 500) || '',
        bodyHtml: data.bodyHtml || null,
        receivedAt: dateValue,
        // Also include original fields for compatibility
        from: data.from,
        to: data.to,
        body: data.body,
        date: dateValue,
        direction: data.direction || 'inbound',
        isRead: data.isRead !== false,
        labels: data.labels || [],
        startupId: data.startupId,
        emailType: data.emailType || null,
        createdAt: getDateValue(data.createdAt),
      };
    });

    // Sort by date descending
    emails.sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());

    return res.json({ data: emails, total: emails.length });
  } catch (error) {
    console.error('Get emails error:', error);
    return res.json({ data: [], total: 0 });
  }
});

app.get('/emails/unmatched', authenticate, async (req: AuthRequest, res) => {
  try {
    const snapshot = await db.collection('emails')
      .where('organizationId', '==', req.user!.organizationId)
      .where('startupId', '==', null)
      .get();

    const emails = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        subject: data.subject,
        from: data.from,
        fromName: data.fromName,
        date: data.date?.toDate?.()?.toISOString() || data.date,
        direction: data.direction || 'inbound',
      };
    });

    return res.json({ data: emails, total: emails.length });
  } catch (error) {
    console.error('Get unmatched emails error:', error);
    return res.json({ data: [], total: 0 });
  }
});

app.post('/emails/:emailId/match', authenticate, async (req: AuthRequest, res) => {
  try {
    const { startupId } = req.body;
    const emailRef = db.collection('emails').doc(req.params.emailId as string);
    await emailRef.update({ startupId });
    return res.json({ success: true });
  } catch (error) {
    console.error('Match email error:', error);
    return res.status(500).json({ error: 'Failed to match email' });
  }
});

app.get('/emails/contacts/:startupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;
    const snapshot = await db.collection('contacts')
      .where('startupId', '==', startupId)
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const contacts = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    return res.json(contacts);
  } catch (error) {
    console.error('Get contacts error:', error);
    return res.json([]);
  }
});

app.post('/emails/contacts/:startupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const { email, name, role } = req.body;
    const contactRef = db.collection('contacts').doc();
    await contactRef.set({
      startupId: req.params.startupId,
      organizationId: req.user!.organizationId,
      email,
      name,
      role,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.json({ id: contactRef.id, success: true });
  } catch (error) {
    console.error('Create contact error:', error);
    return res.status(500).json({ error: 'Failed to create contact' });
  }
});

app.patch('/emails/contacts/:contactId', authenticate, async (req: AuthRequest, res) => {
  try {
    const contactRef = db.collection('contacts').doc(req.params.contactId as string);
    await contactRef.update(req.body);
    return res.json({ success: true });
  } catch (error) {
    console.error('Update contact error:', error);
    return res.status(500).json({ error: 'Failed to update contact' });
  }
});

app.delete('/emails/contacts/:contactId', authenticate, async (req: AuthRequest, res) => {
  try {
    await db.collection('contacts').doc(req.params.contactId as string).delete();
    return res.status(204).send();
  } catch (error) {
    console.error('Delete contact error:', error);
    return res.status(500).json({ error: 'Failed to delete contact' });
  }
});

app.get('/emails/metrics/:startupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;
    const snapshot = await db.collection('emails')
      .where('startupId', '==', startupId)
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const emails = snapshot.docs.map(doc => doc.data());
    const inboundEmails = emails.filter(e => e.direction === 'inbound').length;
    const outboundEmails = emails.filter(e => e.direction === 'outbound').length;

    // Find last email date
    let lastEmailDate = null;
    if (emails.length > 0) {
      const dates = emails.map(e => e.date?.toDate?.() || new Date(e.date)).filter(d => d);
      if (dates.length > 0) {
        lastEmailDate = new Date(Math.max(...dates.map(d => d.getTime()))).toISOString();
      }
    }

    return res.json({
      totalEmails: emails.length,
      inboundEmails,
      outboundEmails,
      avgResponseTime: null,
      lastEmailDate,
    });
  } catch (error) {
    console.error('Get email metrics error:', error);
    return res.json({
      totalEmails: 0,
      inboundEmails: 0,
      outboundEmails: 0,
      avgResponseTime: null,
      lastEmailDate: null,
    });
  }
});

app.post('/emails/:emailId/analyze', authenticate, async (req: AuthRequest, res) => {
  try {
    const emailId = req.params.emailId as string;

    // Get the email
    const emailDoc = await db.collection('emails').doc(emailId).get();
    if (!emailDoc.exists) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const emailData = emailDoc.data()!;

    // Only analyze inbound emails
    if (emailData.direction !== 'inbound') {
      return res.status(400).json({ error: 'Can only analyze inbound emails' });
    }

    // Get the associated startup
    const startupId = emailData.startupId;
    if (!startupId) {
      return res.status(400).json({ error: 'Email is not linked to a startup' });
    }

    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const startupData = startupDoc.data()!;
    if (startupData.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Fetch previous emails for context (without orderBy to avoid index requirement)
    const previousEmailsSnapshot = await db.collection('emails')
      .where('startupId', '==', startupId)
      .get();

    const previousEmails = previousEmailsSnapshot.docs
      .filter(doc => doc.id !== emailId) // Exclude current email
      .map(doc => {
        const data = doc.data();
        return {
          subject: data.subject || '',
          body: data.body || '',
          direction: data.direction || 'inbound',
          date: data.date?.toDate?.() || new Date(data.date),
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) // Sort in memory
      .slice(0, 10); // Limit to 10

    // Use the startup's persistent AI summary
    let aiSummary = startupData.aiSummary?.summary;
    if (!aiSummary) {
      console.log(`[Re-analyze] No AI summary found, generating for ${startupId}`);
      await updateStartupAISummary(startupId);
      const updatedDoc = await db.collection('startups').doc(startupId).get();
      aiSummary = updatedDoc.data()?.aiSummary?.summary;
    }

    // Analyze the founder response
    console.log(`[Re-analyze] Analyzing email ${emailId} for startup: ${startupData.name}, hasSummary: ${!!aiSummary}`);
    const responseAnalysis = await analyzeFounderResponse(
      {
        name: startupData.name,
        description: startupData.description,
        founderName: startupData.founderName,
        stage: startupData.stage,
        currentScore: startupData.currentScore,
        scoreBreakdown: startupData.scoreBreakdown,
        businessModelAnalysis: startupData.businessModelAnalysis,
      },
      {
        subject: emailData.subject || '',
        body: emailData.body || '',
        from: `${emailData.fromName || ''} <${emailData.from || ''}>`,
      },
      previousEmails,
      aiSummary || undefined
    );

    if (!responseAnalysis) {
      return res.status(500).json({ error: 'Failed to analyze email' });
    }

    // Update the email with AI analysis
    await emailDoc.ref.update({
      aiAnalysis: {
        responseQuality: responseAnalysis.responseQuality,
        recommendation: responseAnalysis.recommendation,
        recommendationReason: responseAnalysis.recommendationReason,
        suggestedQuestions: responseAnalysis.suggestedQuestions,
        analyzedAt: new Date(),
      },
      draftReply: responseAnalysis.draftReply,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update startup score based on AI analysis
    if (responseAnalysis.scoreAdjustment) {
      const adj = responseAnalysis.scoreAdjustment;
      const currentBreakdown = startupData.scoreBreakdown || {};

      // Calculate score adjustments
      const communicationAdj = adj.communication || 0;
      const teamAdj = adj.team || 0;
      const productAdj = adj.product || 0;
      const tractionAdj = adj.traction || 0;
      const momentumAdj = adj.momentum || 0;

      // Update score breakdown
      const newBreakdown = {
        ...currentBreakdown,
        communication: Math.max(0, Math.min(10, (currentBreakdown.communication || 5) + communicationAdj)),
        momentum: Math.max(0, Math.min(10, (currentBreakdown.momentum || 5) + momentumAdj)),
        team: currentBreakdown.team ? {
          ...currentBreakdown.team,
          adjusted: Math.max(0, Math.min(25, (currentBreakdown.team.adjusted || currentBreakdown.team.base || 15) + teamAdj)),
        } : currentBreakdown.team,
        product: currentBreakdown.product ? {
          ...currentBreakdown.product,
          adjusted: Math.max(0, Math.min(20, (currentBreakdown.product.adjusted || currentBreakdown.product.base || 12) + productAdj)),
        } : currentBreakdown.product,
        traction: currentBreakdown.traction ? {
          ...currentBreakdown.traction,
          adjusted: Math.max(0, Math.min(20, (currentBreakdown.traction.adjusted || currentBreakdown.traction.base || 10) + tractionAdj)),
        } : currentBreakdown.traction,
      };

      // Recalculate total score
      const teamScore = newBreakdown.team?.adjusted || newBreakdown.team?.base || 0;
      const marketScore = newBreakdown.market?.adjusted || newBreakdown.market?.base || 0;
      const productScore = newBreakdown.product?.adjusted || newBreakdown.product?.base || 0;
      const tractionScore = newBreakdown.traction?.adjusted || newBreakdown.traction?.base || 0;
      const dealScore = newBreakdown.deal?.adjusted || newBreakdown.deal?.base || 0;
      const commScore = newBreakdown.communication || 5;
      const momScore = newBreakdown.momentum || 5;
      const redFlags = newBreakdown.redFlags || 0;

      const newTotalScore = Math.round(
        teamScore + marketScore + productScore + tractionScore + dealScore +
        commScore + momScore - redFlags
      );

      // Record score event
      await db.collection('startups').doc(startupId).collection('scoreEvents').add({
        previousScore: startupData.currentScore || 0,
        newScore: newTotalScore,
        change: newTotalScore - (startupData.currentScore || 0),
        reason: `Email re-analyzed: ${adj.reasoning}`,
        source: 'email_reanalysis',
        emailId: emailId,
        aiAnalysis: responseAnalysis.responseQuality,
        recommendation: responseAnalysis.recommendation,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update startup with new score and draft reply
      await startupDoc.ref.update({
        currentScore: newTotalScore,
        scoreBreakdown: newBreakdown,
        lastResponseAnalysis: {
          quality: responseAnalysis.responseQuality,
          recommendation: responseAnalysis.recommendation,
          recommendationReason: responseAnalysis.recommendationReason,
          suggestedQuestions: responseAnalysis.suggestedQuestions,
          draftReply: responseAnalysis.draftReply,
          analyzedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`[Re-analyze] Updated score for ${startupData.name}: ${startupData.currentScore} -> ${newTotalScore}`);
    }

    // Update the startup's consolidated AI summary
    await updateStartupAISummary(startupId);

    return res.json({
      success: true,
      analysis: {
        responseQuality: responseAnalysis.responseQuality,
        recommendation: responseAnalysis.recommendation,
        recommendationReason: responseAnalysis.recommendationReason,
        suggestedQuestions: responseAnalysis.suggestedQuestions,
        draftReply: responseAnalysis.draftReply,
        scoreAdjustment: responseAnalysis.scoreAdjustment,
      },
    });
  } catch (error) {
    console.error('[Re-analyze] Error:', error);
    return res.status(500).json({ error: 'Failed to analyze email' });
  }
});

// Generate AI reply draft for an email
app.post('/emails/:emailId/generate-reply', authenticate, async (req: AuthRequest, res) => {
  try {
    const emailId = req.params.emailId as string;

    // Get the email
    const emailDoc = await db.collection('emails').doc(emailId).get();
    if (!emailDoc.exists) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const emailData = emailDoc.data()!;

    // Only generate replies for inbound emails
    if (emailData.direction !== 'inbound') {
      return res.status(400).json({ error: 'Can only generate replies for inbound emails' });
    }

    // Get the associated startup
    const startupId = emailData.startupId;
    if (!startupId) {
      return res.status(400).json({ error: 'Email is not linked to a startup' });
    }

    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const startupData = startupDoc.data()!;
    if (startupData.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Fetch all emails for conversation context (without orderBy to avoid index)
    const allEmailsSnapshot = await db.collection('emails')
      .where('startupId', '==', startupId)
      .get();

    const allEmails = allEmailsSnapshot.docs
      .map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          subject: data.subject || '',
          body: data.body || '',
          direction: data.direction || 'inbound',
          date: data.date?.toDate?.() || new Date(data.date),
        };
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Previous emails excludes the current one
    const previousEmails = allEmails.filter(e => e.id !== emailId).slice(0, 10);

    // Use the startup's persistent AI summary (updated whenever deck/email is analyzed)
    // If no summary exists yet, generate one now
    let aiSummary = startupData.aiSummary?.summary;
    if (!aiSummary) {
      console.log(`[Generate Reply] No AI summary found, generating now for ${startupId}`);
      await updateStartupAISummary(startupId);
      // Re-fetch the startup to get the new summary
      const updatedStartupDoc = await db.collection('startups').doc(startupId).get();
      aiSummary = updatedStartupDoc.data()?.aiSummary?.summary;
    }

    console.log(`[Generate Reply] Using AI summary for ${startupData.name}, length: ${aiSummary?.length || 0}`);

    // Generate AI reply using the consolidated summary
    const responseAnalysis = await analyzeFounderResponse(
      {
        name: startupData.name,
        description: startupData.description,
        founderName: startupData.founderName,
        stage: startupData.stage,
        currentScore: startupData.currentScore,
        scoreBreakdown: startupData.scoreBreakdown,
        businessModelAnalysis: startupData.businessModelAnalysis,
      },
      {
        subject: emailData.subject || '',
        body: emailData.body || '',
        from: `${emailData.fromName || ''} <${emailData.from || ''}>`,
      },
      previousEmails,
      aiSummary || undefined
    );

    if (!responseAnalysis) {
      return res.status(500).json({ error: 'Failed to generate reply. Please try again.' });
    }

    console.log(`[Generate Reply] Success - recommendation: ${responseAnalysis.recommendation}`);

    return res.json({
      success: true,
      recommendation: responseAnalysis.recommendation,
      recommendationReason: responseAnalysis.recommendationReason,
      draftReply: responseAnalysis.draftReply,
      suggestedQuestions: responseAnalysis.suggestedQuestions,
      responseQuality: responseAnalysis.responseQuality,
    });
  } catch (error) {
    console.error('[Generate Reply] Error:', error);
    return res.status(500).json({ error: 'Failed to generate reply' });
  }
});

// ==================== DECKS ROUTES ====================

app.get('/decks/startup/:startupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;
    const snapshot = await db.collection('decks')
      .where('startupId', '==', startupId)
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const decks = snapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        fileName: data.fileName,
        fileSize: data.fileSize,
        fileUrl: data.fileUrl,
        mimeType: data.mimeType,
        startupId: data.startupId,
        aiAnalysis: data.aiAnalysis || null,
        status: data.status || 'processed',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      };
    });

    // Sort by createdAt descending
    decks.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

    return res.json(decks);
  } catch (error) {
    console.error('Get decks error:', error);
    return res.json([]);
  }
});

app.get('/decks/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const deckDoc = await db.collection('decks').doc(req.params.id as string).get();

    if (!deckDoc.exists) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    const data = deckDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    return res.json({
      id: deckDoc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
    });
  } catch (error) {
    console.error('Get deck error:', error);
    return res.status(500).json({ error: 'Failed to get deck' });
  }
});

// Upload deck with file
app.post('/decks/startup/:startupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;

    // Verify startup exists and belongs to user's org
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists || startupDoc.data()?.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    // Parse multipart form data
    const busboy = Busboy({ headers: req.headers });
    let fileBuffer: Buffer | null = null;
    let fileName = '';
    let mimeType = '';

    const filePromise = new Promise<{ buffer: Buffer; fileName: string; mimeType: string }>((resolve, reject) => {
      busboy.on('file', (fieldname: string, file: NodeJS.ReadableStream, info: { filename: string; encoding: string; mimeType: string }) => {
        fileName = info.filename;
        mimeType = info.mimeType;
        const chunks: Buffer[] = [];

        file.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
        });

        file.on('end', () => {
          fileBuffer = Buffer.concat(chunks);
          resolve({ buffer: fileBuffer, fileName, mimeType });
        });

        file.on('error', reject);
      });

      busboy.on('error', reject);
      busboy.on('finish', () => {
        if (!fileBuffer) {
          reject(new Error('No file uploaded'));
        }
      });
    });

    // Pipe request to busboy
    req.pipe(busboy);

    const { buffer, fileName: uploadedFileName, mimeType: uploadedMimeType } = await filePromise;

    // Upload to Firebase Storage
    const bucket = admin.storage().bucket();
    const storagePath = `decks/${req.user!.organizationId}/${startupId}/${Date.now()}-${uploadedFileName}`;
    const file = bucket.file(storagePath);

    await file.save(buffer, {
      metadata: {
        contentType: uploadedMimeType,
      },
    });

    // Get signed URL for downloading
    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: '2030-01-01',
    });

    // Create deck record in Firestore
    const deckRef = db.collection('decks').doc();
    const deckData = {
      startupId,
      organizationId: req.user!.organizationId,
      fileName: uploadedFileName,
      fileSize: buffer.length,
      fileUrl: signedUrl,
      storagePath,
      mimeType: uploadedMimeType,
      status: 'uploaded',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await deckRef.set(deckData);

    // Run AI analysis on the deck (async, don't wait)
    analyzeDeckWithAI(deckRef.id, buffer, uploadedFileName, startupId).catch(err => {
      console.error('Deck analysis error:', err);
    });

    return res.json({
      id: deckRef.id,
      ...deckData,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Upload deck error:', error);
    return res.status(500).json({ error: 'Failed to upload deck' });
  }
});

// AI analysis helper for decks
async function analyzeDeckWithAI(deckId: string, fileBuffer: Buffer, fileName: string, startupId: string) {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `Analyze this startup pitch deck and provide a detailed analysis in this JSON format:
{
  "score": number (0-100, quality/investment potential score),
  "summary": string (2-3 sentence summary of the pitch),
  "strengths": string[] (3-5 key strengths),
  "weaknesses": string[] (3-5 areas for improvement),
  "keyMetrics": {
    "tam": string or null (total addressable market if mentioned),
    "revenue": string or null (revenue if mentioned),
    "growth": string or null (growth rate if mentioned),
    "funding": string or null (funding ask if mentioned)
  },
  "recommendation": string (brief investment recommendation)
}

Respond with ONLY the JSON object.`;

    let result;

    // If we have a PDF buffer, send it to Gemini for visual analysis
    if (fileBuffer && fileBuffer.length > 0 && fileName.toLowerCase().endsWith('.pdf')) {
      console.log(`[Deck Analysis] Analyzing PDF with ${fileBuffer.length} bytes`);
      result = await model.generateContent([
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: fileBuffer.toString('base64'),
          },
        },
        prompt,
      ]);
    } else {
      // Fallback to text-only prompt with filename
      console.log(`[Deck Analysis] Analyzing based on filename: ${fileName}`);
      result = await model.generateContent(`Analyze this startup pitch deck file named "${fileName}".\n\n${prompt}`);
    }
    const response = await result.response;
    const text = response.text();

    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const analysis = JSON.parse(jsonMatch[0]);

      // Update deck with analysis
      await db.collection('decks').doc(deckId).update({
        aiAnalysis: analysis,
        status: 'processed',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update startup score if analysis has a score
      if (analysis.score) {
        const startupRef = db.collection('startups').doc(startupId);
        const startupDoc = await startupRef.get();
        if (startupDoc.exists) {
          const startupData = startupDoc.data()!;
          const currentScore = startupData?.currentScore || 0;
          // Average with existing score or use deck score
          const newScore = currentScore > 0 ? Math.round((currentScore + analysis.score) / 2) : analysis.score;
          await startupRef.update({
            currentScore: newScore,
            deckScore: analysis.score,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });

          // Create score events based on analysis
          const scoreEvents: Array<{
            category: string;
            signal: string;
            impact: number;
            evidence: string;
          }> = [];

          // Add events for strengths (positive signals)
          if (analysis.strengths && Array.isArray(analysis.strengths)) {
            for (const strength of analysis.strengths.slice(0, 3)) {
              scoreEvents.push({
                category: 'product',
                signal: 'Pitch deck strength',
                impact: 3,
                evidence: strength,
              });
            }
          }

          // Add events for weaknesses (concerns)
          if (analysis.weaknesses && Array.isArray(analysis.weaknesses)) {
            for (const weakness of analysis.weaknesses.slice(0, 2)) {
              scoreEvents.push({
                category: 'deal',
                signal: 'Area of concern',
                impact: -2,
                evidence: weakness,
              });
            }
          }

          // Add overall deck analysis event
          scoreEvents.push({
            category: 'product',
            signal: 'Pitch deck analyzed',
            impact: analysis.score >= 70 ? 5 : analysis.score >= 50 ? 2 : 0,
            evidence: `AI analysis score: ${analysis.score}/100. ${analysis.summary || ''}`,
          });

          // Create all score events
          for (const event of scoreEvents) {
            await db.collection('scoreEvents').add({
              startupId,
              organizationId: startupData.organizationId,
              ...event,
              source: 'deck_analysis',
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
          }

          console.log(`[Deck Analysis] Created ${scoreEvents.length} score events for startup ${startupId}`);
        }
      }

      // Update the startup's consolidated AI summary
      await updateStartupAISummary(startupId);

      console.log(`[Deck Analysis] Completed for ${fileName}, score: ${analysis.score}`);
    }
  } catch (error) {
    console.error('[Deck Analysis] Error:', error);
    await db.collection('decks').doc(deckId).update({
      status: 'error',
      aiAnalysis: { error: 'Analysis failed' },
    });
  }
}

app.post('/decks/:id/reprocess', authenticate, async (req: AuthRequest, res) => {
  try {
    const deckId = req.params.id as string;
    const deckDoc = await db.collection('decks').doc(deckId).get();

    if (!deckDoc.exists) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    const data = deckDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    // Mark as processing
    await deckDoc.ref.update({ status: 'processing' });

    // Fetch file from storage if storagePath exists
    let fileBuffer: Buffer | null = null;
    if (data.storagePath) {
      try {
        const bucket = admin.storage().bucket();
        const file = bucket.file(data.storagePath);
        const [exists] = await file.exists();
        if (exists) {
          const [contents] = await file.download();
          fileBuffer = contents;
        }
      } catch (downloadError) {
        console.error('[Reprocess] Failed to download file:', downloadError);
      }
    }

    // Run AI analysis
    await analyzeDeckWithAI(deckId, fileBuffer || Buffer.from(''), data.fileName, data.startupId);

    return res.json({ success: true });
  } catch (error) {
    console.error('Reprocess deck error:', error);
    return res.status(500).json({ error: 'Failed to reprocess deck' });
  }
});

// Download deck file - serves the file through the backend
app.get('/decks/:id/download', authenticate, async (req: AuthRequest, res) => {
  try {
    const deckDoc = await db.collection('decks').doc(req.params.id as string).get();

    if (!deckDoc.exists) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    const data = deckDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    if (!data.storagePath) {
      return res.status(404).json({ error: 'File not found in storage' });
    }

    const bucket = admin.storage().bucket();
    const file = bucket.file(data.storagePath);

    const [exists] = await file.exists();
    if (!exists) {
      return res.status(404).json({ error: 'File not found in storage' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', data.mimeType || 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${data.fileName}"`);

    // Stream the file to the response
    const stream = file.createReadStream();
    stream.pipe(res);

    // Return a promise that resolves when stream completes
    return new Promise<void>((resolve, reject) => {
      stream.on('end', resolve);
      stream.on('error', reject);
    });
  } catch (error) {
    console.error('Download deck error:', error);
    return res.status(500).json({ error: 'Failed to download deck' });
  }
});

app.delete('/decks/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const deckDoc = await db.collection('decks').doc(req.params.id as string).get();

    if (!deckDoc.exists) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    const data = deckDoc.data()!;
    if (data.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Deck not found' });
    }

    // Delete from storage
    if (data.storagePath) {
      try {
        const bucket = admin.storage().bucket();
        await bucket.file(data.storagePath).delete();
      } catch (storageError) {
        console.error('Error deleting from storage:', storageError);
      }
    }

    // Delete from Firestore
    await deckDoc.ref.delete();

    return res.status(204).send();
  } catch (error) {
    console.error('Delete deck error:', error);
    return res.status(500).json({ error: 'Failed to delete deck' });
  }
});

// ==================== SCORE ROUTES ====================

app.get('/startups/:id/score-events', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const snapshot = await db.collection('scoreEvents')
      .where('startupId', '==', startupId)
      .get();

    const events = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
    }));

    return res.json({ data: events, total: events.length });
  } catch (error) {
    console.error('Get score events error:', error);
    return res.json({ data: [], total: 0 });
  }
});

app.get('/startups/:id/score-history', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const days = parseInt(req.query.days as string) || 90;

    // Get the startup to find its base score and creation date
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startup = startupDoc.data()!;
    const baseScore = startup.baseScore || startup.currentScore || 50;

    // Get all score events for this startup
    const eventsSnapshot = await db.collection('scoreEvents')
      .where('startupId', '==', startupId)
      .get();

    // Build daily history from events
    const today = new Date();
    const startDate = new Date();
    startDate.setDate(today.getDate() - days);

    // Group events by date
    const eventsByDate: Record<string, { totalImpact: number; count: number }> = {};

    eventsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const eventDate = data.createdAt?.toDate?.() || new Date(data.createdAt);
      const dateKey = eventDate.toISOString().split('T')[0];

      if (!eventsByDate[dateKey]) {
        eventsByDate[dateKey] = { totalImpact: 0, count: 0 };
      }
      eventsByDate[dateKey].totalImpact += data.impact || 0;
      eventsByDate[dateKey].count += 1;
    });

    // Generate daily history points
    const history: Array<{ date: string; score: number; events: number }> = [];
    let cumulativeImpact = 0;

    // Calculate cumulative impact up to startDate
    Object.entries(eventsByDate).forEach(([dateKey, data]) => {
      if (new Date(dateKey) < startDate) {
        cumulativeImpact += data.totalImpact;
      }
    });

    // Generate daily points
    for (let d = new Date(startDate); d <= today; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      const dayData = eventsByDate[dateKey] || { totalImpact: 0, count: 0 };

      cumulativeImpact += dayData.totalImpact;
      const score = Math.max(0, Math.min(100, baseScore + cumulativeImpact));

      history.push({
        date: dateKey,
        score: Math.round(score),
        events: dayData.count,
      });
    }

    return res.json(history);
  } catch (error) {
    console.error('Get score history error:', error);
    return res.json([]);
  }
});

app.post('/startups/:id/score-events', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const { category, signal, impact, evidence } = req.body;

    const eventRef = db.collection('scoreEvents').doc();
    await eventRef.set({
      startupId,
      category,
      signal,
      impact,
      evidence: evidence || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update startup score
    const startupRef = db.collection('startups').doc(startupId);
    const startupDoc = await startupRef.get();
    if (startupDoc.exists) {
      const currentScore = startupDoc.data()?.score || 50;
      const newScore = Math.max(0, Math.min(100, currentScore + impact));
      await startupRef.update({
        score: newScore,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    return res.json({ id: eventRef.id, success: true });
  } catch (error) {
    console.error('Add score event error:', error);
    return res.status(500).json({ error: 'Failed to add score event' });
  }
});

// Generate score events for existing startup (backfill)
app.post('/startups/:id/generate-score-events', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const startupDoc = await db.collection('startups').doc(startupId).get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const startup = startupDoc.data()!;

    // Check if already has score events
    const existingEvents = await db.collection('scoreEvents')
      .where('startupId', '==', startupId)
      .limit(1)
      .get();

    if (!existingEvents.empty) {
      return res.json({ message: 'Score events already exist', eventsCreated: 0 });
    }

    const scoreEvents: Array<{category: string; signal: string; impact: number; evidence: string}> = [];

    // Add initial event
    scoreEvents.push({
      category: 'deal',
      signal: 'Startup added to pipeline',
      impact: 0,
      evidence: `${startup.name} added for evaluation`,
    });

    // Generate events from score breakdown if available
    if (startup.scoreBreakdown) {
      const breakdown = startup.scoreBreakdown;
      if (breakdown.team?.base >= 7) {
        scoreEvents.push({
          category: 'team',
          signal: 'Strong team signal',
          impact: 5,
          evidence: `Team score: ${breakdown.team.base}/10`,
        });
      } else if (breakdown.team?.base >= 5) {
        scoreEvents.push({
          category: 'team',
          signal: 'Team evaluated',
          impact: 2,
          evidence: `Team score: ${breakdown.team.base}/10`,
        });
      }

      if (breakdown.market?.base >= 7) {
        scoreEvents.push({
          category: 'market',
          signal: 'Attractive market',
          impact: 5,
          evidence: `Market score: ${breakdown.market.base}/10`,
        });
      } else if (breakdown.market?.base >= 5) {
        scoreEvents.push({
          category: 'market',
          signal: 'Market evaluated',
          impact: 2,
          evidence: `Market score: ${breakdown.market.base}/10`,
        });
      }

      if (breakdown.product?.base >= 7) {
        scoreEvents.push({
          category: 'product',
          signal: 'Strong product/tech',
          impact: 5,
          evidence: `Product score: ${breakdown.product.base}/10`,
        });
      } else if (breakdown.product?.base >= 5) {
        scoreEvents.push({
          category: 'product',
          signal: 'Product evaluated',
          impact: 2,
          evidence: `Product score: ${breakdown.product.base}/10`,
        });
      }

      if (breakdown.traction?.base >= 7) {
        scoreEvents.push({
          category: 'traction',
          signal: 'Good traction signals',
          impact: 5,
          evidence: `Traction score: ${breakdown.traction.base}/10`,
        });
      }

      if (breakdown.redFlags && breakdown.redFlags < -3) {
        scoreEvents.push({
          category: 'deal',
          signal: 'Red flags detected',
          impact: breakdown.redFlags,
          evidence: 'AI detected potential concerns',
        });
      }
    }

    // Add business model event
    if (startup.businessModelAnalysis) {
      const bma = startup.businessModelAnalysis;
      scoreEvents.push({
        category: 'product',
        signal: 'Business model identified',
        impact: 2,
        evidence: `${bma.businessModel?.type || 'Unknown'} model in ${bma.sector || startup.sector || 'Unknown'} sector`,
      });
    }

    // Add overall score event
    if (startup.currentScore) {
      scoreEvents.push({
        category: 'deal',
        signal: 'AI score generated',
        impact: startup.currentScore >= 70 ? 5 : startup.currentScore >= 50 ? 2 : 0,
        evidence: `Overall investment score: ${startup.currentScore}/100`,
      });
    }

    // Create all events
    for (const event of scoreEvents) {
      await db.collection('scoreEvents').add({
        startupId,
        organizationId: startup.organizationId,
        ...event,
        source: 'backfill',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    console.log(`[GenerateScoreEvents] Created ${scoreEvents.length} events for ${startup.name}`);

    return res.json({
      success: true,
      eventsCreated: scoreEvents.length,
      events: scoreEvents,
    });
  } catch (error) {
    console.error('Generate score events error:', error);
    return res.status(500).json({ error: 'Failed to generate score events' });
  }
});

// ==================== EVALUATION ROUTES ====================

app.get('/evaluation/:startupId', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;
    const evalDoc = await db.collection('evaluations').doc(startupId).get();

    if (!evalDoc.exists) {
      return res.json(null);
    }

    return res.json({ id: evalDoc.id, ...evalDoc.data() });
  } catch (error) {
    console.error('Get evaluation error:', error);
    return res.json(null);
  }
});

app.post('/evaluation/:startupId/initialize', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;
    const { isPostRevenue } = req.body;

    await db.collection('evaluations').doc(startupId).set({
      startupId,
      isPostRevenue,
      status: 'initialized',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('Initialize evaluation error:', error);
    return res.status(500).json({ error: 'Failed to initialize evaluation' });
  }
});

app.post('/evaluation/:startupId/generate-questions', authenticate, async (_req, res) => {
  return res.json({ questions: [], qaRoundId: 'placeholder' });
});

app.post('/evaluation/:startupId/send-questions', authenticate, async (_req, res) => {
  return res.json({ success: true, emailSent: false });
});

app.post('/evaluation/:startupId/record-response', authenticate, async (_req, res) => {
  return res.json({ success: true });
});

app.post('/evaluation/:startupId/score', authenticate, async (_req, res) => {
  return res.json({ score: 50, breakdown: {} });
});

app.get('/evaluation/:startupId/score-breakdown', authenticate, async (_req, res) => {
  return res.json({ breakdown: {}, score: 50 });
});

// ==================== DRAFT REPLY ROUTES ====================

app.post('/startups/:id/send-reply', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const startupDoc = await db.collection('startups').doc(startupId).get();

    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const data = startupDoc.data()!;
    const toEmail = data.founderEmail || 'unknown@email.com';
    const draftReply = data.draftReply || '';

    if (!draftReply) {
      return res.status(400).json({ error: 'No draft reply to send' });
    }

    // Get inbox config for SMTP
    const config = await getInboxConfig(req.user!.organizationId);
    if (!config) {
      return res.status(400).json({ error: 'No email configuration found. Please configure your email inbox first.' });
    }
    const fromEmail = config.user;
    const emailSubject = `Re: ${data.name} - Follow Up`;

    console.log(`[SendReply] Attempting to send email to ${toEmail} for ${data.name}`);

    // Actually send the email via SMTP
    const sendResult = await sendEmailViaSMTP(config, {
      from: fromEmail,
      fromName: 'Nitish',
      to: toEmail,
      subject: emailSubject,
      body: draftReply,
    });

    if (!sendResult.success) {
      console.error(`[SendReply] SMTP send failed: ${sendResult.error}`);
      return res.status(500).json({
        error: 'Failed to send email via SMTP',
        details: sendResult.error
      });
    }

    // Record the outgoing email in the emails collection
    const emailRef = db.collection('emails').doc();
    await emailRef.set({
      startupId,
      organizationId: req.user!.organizationId,
      subject: emailSubject,
      from: fromEmail,
      fromName: 'Nitish',
      to: toEmail,
      body: draftReply,
      date: admin.firestore.FieldValue.serverTimestamp(),
      direction: 'outbound',
      isRead: true,
      labels: ['reply', 'sent'],
      messageId: sendResult.messageId || `sent-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      smtpMessageId: sendResult.messageId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update startup draft reply status
    await startupDoc.ref.update({
      draftReplyStatus: 'sent',
      lastEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update the startup's AI summary with the new outbound email
    await updateStartupAISummary(startupId);

    console.log(`[SendReply] Email sent successfully to ${toEmail} for ${data.name}, messageId: ${sendResult.messageId}`);

    return res.json({
      success: true,
      to: toEmail,
      emailId: emailRef.id,
      smtpMessageId: sendResult.messageId,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('Send reply error:', error);
    return res.status(500).json({ error: 'Failed to send reply' });
  }
});

// Create a new outgoing email (compose)
app.post('/emails/startup/:startupId/compose', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.startupId as string;
    const { to, subject, body, replyToEmailId } = req.body;

    // Verify startup exists and belongs to user's org
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists || startupDoc.data()?.organizationId !== req.user!.organizationId) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const startupData = startupDoc.data()!;

    // Get inbox config for SMTP
    const config = await getInboxConfig(req.user!.organizationId);
    if (!config) {
      return res.status(400).json({ error: 'No email configuration found. Please configure your email inbox first.' });
    }
    const fromEmail = config.user;

    // Determine recipient email
    const toEmail = to || startupData.founderEmail;
    if (!toEmail) {
      return res.status(400).json({ error: 'No recipient email provided' });
    }

    const emailSubject = subject || `Re: ${startupData.name}`;
    const emailBody = body || '';

    if (!emailBody.trim()) {
      return res.status(400).json({ error: 'Email body cannot be empty' });
    }

    console.log(`[ComposeEmail] Attempting to send email to ${toEmail} for startup ${startupData.name}`);

    // Actually send the email via SMTP
    const sendResult = await sendEmailViaSMTP(config, {
      from: fromEmail,
      fromName: 'Nitish',
      to: toEmail,
      subject: emailSubject,
      body: emailBody,
    });

    if (!sendResult.success) {
      console.error(`[ComposeEmail] SMTP send failed: ${sendResult.error}`);
      return res.status(500).json({
        error: 'Failed to send email via SMTP',
        details: sendResult.error
      });
    }

    // Create the email record
    const emailRef = db.collection('emails').doc();
    await emailRef.set({
      startupId,
      organizationId: req.user!.organizationId,
      subject: emailSubject,
      from: fromEmail,
      fromName: 'Nitish',
      to: toEmail,
      body: emailBody,
      date: admin.firestore.FieldValue.serverTimestamp(),
      direction: 'outbound',
      isRead: true,
      labels: replyToEmailId ? ['reply', 'sent'] : ['sent'],
      replyToEmailId: replyToEmailId || null,
      messageId: sendResult.messageId || `sent-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      smtpMessageId: sendResult.messageId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update startup's last contact
    await startupDoc.ref.update({
      lastEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Update the startup's AI summary with the new outbound email
    await updateStartupAISummary(startupId);

    console.log(`[ComposeEmail] Email sent successfully to ${toEmail} for startup ${startupData.name}, messageId: ${sendResult.messageId}`);

    return res.json({
      success: true,
      emailId: emailRef.id,
      to: toEmail,
      subject: emailSubject,
      smtpMessageId: sendResult.messageId,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('Compose email error:', error);
    return res.status(500).json({ error: 'Failed to compose email' });
  }
});

app.patch('/startups/:id/draft-reply', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const { draftReply, draftReplyStatus } = req.body;

    const updateData: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (draftReply !== undefined) {
      updateData.draftReply = draftReply;
    }

    if (draftReplyStatus !== undefined) {
      updateData.draftReplyStatus = draftReplyStatus;
    }

    await db.collection('startups').doc(startupId).update(updateData);

    return res.json({ success: true });
  } catch (error) {
    console.error('Update draft reply error:', error);
    return res.status(500).json({ error: 'Failed to update draft reply' });
  }
});

// ==================== BACKUP ROUTES ====================

app.get('/backup/list', authenticate, async (_req, res) => {
  return res.json([]);
});

app.post('/backup/create', authenticate, async (_req, res) => {
  return res.json({ success: true, message: 'Backup not needed for Firestore' });
});

app.get('/backup/integrity', authenticate, async (_req, res) => {
  return res.json({ healthy: true });
});

app.post('/backup/restore', authenticate, async (_req, res) => {
  return res.json({ success: false, message: 'Restore not available for Firestore' });
});

// ==================== CONFIG ROUTES ====================

app.get('/inbox/config', authenticate, async (req: AuthRequest, res) => {
  try {
    // First try the dedicated inboxConfig collection
    const configDoc = await db.collection('inboxConfig').doc(req.user!.organizationId).get();
    if (configDoc.exists) {
      const data = configDoc.data()!;
      return res.json({
        host: data.host,
        port: data.port,
        user: data.user,
        tls: data.tls,
        folder: data.folder,
        pollingEnabled: data.pollingEnabled,
        pollingInterval: data.pollingInterval,
        hasPassword: !!data.password,
      });
    }

    // Fallback: check organization settings.emailInbox
    const orgDoc = await db.collection('organizations').doc(req.user!.organizationId).get();
    if (orgDoc.exists) {
      const orgData = orgDoc.data()!;
      const emailInbox = orgData.settings?.emailInbox;
      if (emailInbox) {
        return res.json({
          host: emailInbox.host,
          port: emailInbox.port,
          user: emailInbox.user,
          tls: emailInbox.tls,
          folder: emailInbox.folder,
          pollingEnabled: emailInbox.pollingEnabled,
          pollingInterval: emailInbox.pollingInterval,
          hasPassword: !!emailInbox.password,
        });
      }
    }

    return res.json(null);
  } catch (error) {
    console.error('Get inbox config error:', error);
    return res.json(null);
  }
});

// Re-scan attachments for a startup by re-fetching original email
app.post('/startups/:id/rescan-attachments', authenticate, async (req: AuthRequest, res) => {
  try {
    const id = req.params.id as string;

    // Get the startup
    const startupDoc = await db.collection('startups').doc(id).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }

    const startup = startupDoc.data()!;
    if (startup.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get ALL inbound email records for this startup (not just the first one)
    const emailsSnapshot = await db.collection('emails')
      .where('startupId', '==', id)
      .where('direction', '==', 'inbound')
      .orderBy('date', 'asc')
      .get();

    if (emailsSnapshot.empty) {
      return res.status(404).json({ error: 'No inbound emails found for this startup' });
    }

    console.log(`[RescanAttachments] Found ${emailsSnapshot.docs.length} inbound email(s) for startup ${id}`);

    // Get IMAP config using the shared helper function
    console.log(`[RescanAttachments] Getting IMAP config for org: ${req.user!.organizationId}`);
    const config = await getInboxConfig(req.user!.organizationId);
    if (!config) {
      console.log(`[RescanAttachments] No inbox config found`);
      return res.status(400).json({ error: 'No inbox configured' });
    }
    console.log(`[RescanAttachments] Connecting to IMAP: ${config.host}:${config.port}, folder: ${config.folder}`);

    // Connect to IMAP once for all emails
    const client = new ImapFlow({
      host: config.host,
      port: config.port,
      secure: config.tls,
      auth: {
        user: config.user,
        pass: config.password,
      },
      logger: false,
      tls: {
        rejectUnauthorized: true,  // SECURITY: Always verify TLS certificates
        minVersion: 'TLSv1.2',     // Enforce modern TLS version
      },
    });

    let attachmentsFound = 0;
    let emailsScanned = 0;
    const attachmentData: Array<{
      fileName: string;
      mimeType: string;
      size: number;
      storagePath?: string;
      storageUrl?: string;
    }> = [];

    try {
      console.log(`[RescanAttachments] Attempting IMAP connect...`);
      await client.connect();
      console.log(`[RescanAttachments] Connected, opening mailbox: ${config.folder}`);
      await client.mailboxOpen(config.folder);
      console.log(`[RescanAttachments] Mailbox opened`);

      // Process each inbound email
      for (const emailDoc of emailsSnapshot.docs) {
        const emailData = emailDoc.data();

        // Only use messageId if it looks like a real IMAP Message-ID (contains @ or angle brackets)
        const rawMessageId = emailData.messageId;
        const isRealMessageId = rawMessageId && (rawMessageId.includes('@') || rawMessageId.includes('<'));
        const messageId = isRealMessageId ? rawMessageId : null;

        // Handle Firestore Timestamp for date
        let emailDate: Date;
        if (emailData.date && typeof emailData.date.toDate === 'function') {
          emailDate = emailData.date.toDate();
        } else if (emailData.date instanceof Date) {
          emailDate = emailData.date;
        } else if (typeof emailData.date === 'string') {
          emailDate = new Date(emailData.date);
        } else {
          emailDate = new Date(); // fallback
        }

        console.log(`[RescanAttachments] Processing email ${emailsScanned + 1}/${emailsSnapshot.docs.length}: subject="${emailData.subject}", messageId="${rawMessageId || 'NONE'}" (real=${isRealMessageId}), date="${emailDate.toISOString()}", from="${emailData.from}"`);

        let uidsToCheck: number[] = [];

        // First try to search by message-id if available
        if (messageId) {
          console.log(`[RescanAttachments] Searching for email with messageId: ${messageId}`);
          const searchResult = await client.search({ header: { 'Message-ID': messageId } });
          uidsToCheck = Array.isArray(searchResult) ? searchResult : [];
        }

        // If no results or no messageId, try broader search by subject and date
        if (uidsToCheck.length === 0) {
          const sinceDate = new Date(emailDate);
          sinceDate.setDate(sinceDate.getDate() - 7); // Search wider date range (7 days before)

          // Try searching by subject first - use shorter substring and remove special chars
          const subjectStr = typeof emailData.subject === 'string'
            ? emailData.subject.substring(0, 30).replace(/[|&@#$%^*(){}[\]]/g, ' ').trim()
            : '';

          if (subjectStr.length > 5) {
            console.log(`[RescanAttachments] Searching by subject: "${subjectStr}" since ${sinceDate.toISOString()}`);
            const searchBySubject = await client.search({
              since: sinceDate,
              subject: subjectStr
            });
            uidsToCheck = Array.isArray(searchBySubject) ? searchBySubject : [];
            console.log(`[RescanAttachments] Found ${uidsToCheck.length} emails matching subject`);
          }

          // If still no results, try searching by sender email
          if (uidsToCheck.length === 0 && emailData.from) {
            console.log(`[RescanAttachments] Searching by sender: "${emailData.from}" since ${sinceDate.toISOString()}`);
            const searchByFrom = await client.search({
              since: sinceDate,
              from: emailData.from
            });
            uidsToCheck = Array.isArray(searchByFrom) ? searchByFrom : [];
            console.log(`[RescanAttachments] Found ${uidsToCheck.length} emails from sender`);

            // If multiple results, try to match by subject similarity
            if (uidsToCheck.length > 1 && subjectStr) {
              console.log(`[RescanAttachments] Multiple emails found, will check ${Math.min(uidsToCheck.length, 5)} for subject match`);
              // Check first few emails to find best match
              for (const checkUid of uidsToCheck.slice(0, 5)) {
                const checkMsg = await client.fetchOne(checkUid, { envelope: true });
                if (checkMsg && typeof checkMsg === 'object' && 'envelope' in checkMsg) {
                  const envelope = checkMsg.envelope as { subject?: string };
                  if (envelope.subject && envelope.subject.toLowerCase().includes(subjectStr.toLowerCase().substring(0, 15))) {
                    console.log(`[RescanAttachments] Found matching email: "${envelope.subject}"`);
                    uidsToCheck = [checkUid];
                    break;
                  }
                }
              }
            }
          }

          if (uidsToCheck.length === 0) {
            console.log(`[RescanAttachments] Could not find email in inbox, skipping: ${emailData.subject}`);
            emailsScanned++;
            continue; // Skip this email but continue with others
          }
        }

        const uid = uidsToCheck[0];
        const message = await client.fetchOne(uid, { source: true });

        if (message && typeof message === 'object' && 'source' in message && message.source) {
          const parsed: ParsedMail = await simpleParser(message.source as Buffer);

          console.log(`[RescanAttachments] Found email: ${parsed.subject}`);
          console.log(`[RescanAttachments] Attachments: ${parsed.attachments?.length || 0}`);

          if (parsed.attachments && parsed.attachments.length > 0) {
            for (const attachment of parsed.attachments) {
              const relevantMimeTypes = [
                'application/pdf',
                'application/vnd.ms-powerpoint',
                'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ];

              const fileName = attachment.filename || 'attachment';
              const isPDF = fileName.toLowerCase().endsWith('.pdf');
              const isPPT = fileName.toLowerCase().endsWith('.ppt') || fileName.toLowerCase().endsWith('.pptx');
              const isDOC = fileName.toLowerCase().endsWith('.doc') || fileName.toLowerCase().endsWith('.docx');

              if (relevantMimeTypes.includes(attachment.contentType) || isPDF || isPPT || isDOC) {
                try {
                  // Check if deck already exists for this file
                  const existingDeck = await db.collection('decks')
                    .where('startupId', '==', id)
                    .where('fileName', '==', fileName)
                    .get();

                  if (!existingDeck.empty) {
                    console.log(`[RescanAttachments] Deck already exists for ${fileName}, skipping`);
                    continue;
                  }

                  // Store attachment in Firebase Storage
                  const bucket = admin.storage().bucket();
                  const storagePath = `attachments/${req.user!.organizationId}/${id}/${Date.now()}-${fileName}`;
                  const file = bucket.file(storagePath);

                  await file.save(attachment.content, {
                    metadata: {
                      contentType: attachment.contentType,
                      metadata: {
                        originalName: fileName,
                        startupId: id,
                      },
                    },
                    public: true, // Make file publicly readable
                  });

                  // Use the public URL format for Firebase Storage
                  const bucketName = bucket.name;
                  const fileUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
                  console.log(`[RescanAttachments] Stored file with public URL: ${fileName}`);

                  // Create deck record
                  const deckRef = db.collection('decks').doc();
                  await deckRef.set({
                    startupId: id,
                    organizationId: req.user!.organizationId,
                    fileName,
                    fileSize: attachment.size || attachment.content.length,
                    fileUrl,
                    storagePath,
                    mimeType: attachment.contentType,
                    source: 'email_rescan',
                    status: 'processing',
                    createdAt: admin.firestore.FieldValue.serverTimestamp(),
                  });

                  // Run AI analysis on the attachment
                  console.log(`[RescanAttachments] Analyzing attachment: ${fileName}`);
                  analyzeDeckWithAI(deckRef.id, attachment.content, fileName, id).catch(err => {
                    console.error(`[RescanAttachments] AI analysis failed for ${fileName}:`, err);
                  });

                  attachmentData.push({
                    fileName,
                    mimeType: attachment.contentType,
                    size: attachment.size || attachment.content.length,
                    storagePath,
                    storageUrl: fileUrl,
                  });

                  attachmentsFound++;
                  console.log(`[RescanAttachments] Stored and queued analysis for: ${fileName}`);
                } catch (attachmentError) {
                  console.error(`[RescanAttachments] Failed to store attachment ${fileName}:`, attachmentError);
                }
              }
            }
          }
        }

        emailsScanned++;
      }

      await client.logout();
    } catch (imapError) {
      console.error('[RescanAttachments] IMAP error:', imapError);
      return res.status(500).json({ error: 'Failed to connect to email inbox' });
    }

    // Update startup hasAttachments flag if we found any
    if (attachmentsFound > 0) {
      await db.collection('startups').doc(id).update({
        hasAttachments: true,
        attachmentCount: admin.firestore.FieldValue.increment(attachmentsFound),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    return res.json({
      success: true,
      attachmentsFound,
      emailsScanned,
      attachments: attachmentData,
      message: attachmentsFound > 0
        ? `Found and stored ${attachmentsFound} attachment(s) from ${emailsScanned} email(s)`
        : `No new attachments found in ${emailsScanned} email(s)`
    });
  } catch (error) {
    console.error('[RescanAttachments] Error:', error);
    return res.status(500).json({ error: 'Failed to rescan attachments' });
  }
});

app.get('/backup/status', authenticate, async (_req, res) => {
  return res.json({ enabled: false, database: 'firestore' });
});

// ==================== COMMENTS ROUTES ====================

// Get comments for a startup
app.get('/startups/:id/comments', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;

    // Verify startup exists and user has access
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startup = startupDoc.data()!;
    if (startup.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get all comments for this startup
    const commentsSnapshot = await db.collection('comments')
      .where('startupId', '==', startupId)
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const comments = commentsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
      updatedAt: doc.data().updatedAt?.toDate?.()?.toISOString() || doc.data().updatedAt,
    }));

    // Sort by createdAt ascending (oldest first for threading)
    comments.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    return res.json({ comments });
  } catch (error) {
    console.error('[Comments] Error fetching comments:', error);
    return res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// Add a comment
app.post('/startups/:id/comments', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;

    // Validate input with Zod
    const validationResult = commentSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: validationResult.error.errors[0]?.message || 'Invalid input'
      });
    }

    const { content, parentId, mentions } = validationResult.data;

    // Sanitize content to prevent XSS
    const sanitizedContent = sanitizeContent(content);
    if (sanitizedContent.length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    // Verify startup exists and user has access
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startup = startupDoc.data()!;
    if (startup.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get user info for author details
    const userDoc = await db.collection('users').doc(req.user!.userId).get();
    const userData = userDoc.data();

    const commentRef = db.collection('comments').doc();
    const comment = {
      startupId,
      organizationId: req.user!.organizationId,
      authorId: req.user!.userId,
      authorName: userData?.name || 'Unknown User',
      authorEmail: userData?.email || '',
      content: sanitizedContent,
      parentId: parentId || null,
      mentions: mentions || [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await commentRef.set(comment);

    // Create notifications for mentioned users
    if (mentions && mentions.length > 0) {
      for (const mentionedUserId of mentions) {
        if (mentionedUserId !== req.user!.userId) {
          const notifRef = db.collection('notifications').doc();
          await notifRef.set({
            userId: mentionedUserId,
            organizationId: req.user!.organizationId,
            type: 'mention',
            startupId,
            startupName: startup.name,
            referenceId: commentRef.id,
            message: `${userData?.name || 'Someone'} mentioned you in a comment on ${startup.name}`,
            isRead: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    return res.json({
      success: true,
      comment: {
        id: commentRef.id,
        ...comment,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Comments] Error adding comment:', error);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Update a comment
app.put('/comments/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const commentId = req.params.id as string;

    // Validate content with Zod schema (only content field needed for update)
    const contentSchema = z.object({
      content: z.string().min(1, 'Comment content is required').max(10000, 'Comment is too long'),
    });
    const validationResult = contentSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: validationResult.error.errors[0]?.message || 'Invalid input'
      });
    }

    // Sanitize content
    const sanitizedContent = sanitizeContent(validationResult.data.content);
    if (sanitizedContent.length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const commentDoc = await db.collection('comments').doc(commentId).get();
    if (!commentDoc.exists) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = commentDoc.data()!;

    // Only author can edit their own comment
    if (comment.authorId !== req.user!.userId) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }

    await db.collection('comments').doc(commentId).update({
      content: sanitizedContent,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      editedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true });
  } catch (error) {
    console.error('[Comments] Error updating comment:', error);
    return res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete a comment
app.delete('/comments/:id', authenticate, async (req: AuthRequest, res) => {
  try {
    const commentId = req.params.id as string;

    const commentDoc = await db.collection('comments').doc(commentId).get();
    if (!commentDoc.exists) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = commentDoc.data()!;

    // Only author or admin can delete
    if (comment.authorId !== req.user!.userId && req.user!.role !== 'admin') {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    await db.collection('comments').doc(commentId).delete();

    return res.json({ success: true });
  } catch (error) {
    console.error('[Comments] Error deleting comment:', error);
    return res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// ==================== DEAL INVITES ROUTES ====================

// Get invites for a startup
app.get('/startups/:id/invites', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;

    // Verify startup exists and user has access
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startup = startupDoc.data()!;
    if (startup.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const invitesSnapshot = await db.collection('deal_invites')
      .where('startupId', '==', startupId)
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const invites = invitesSnapshot.docs.map(doc => ({
      id: doc.id,
      email: doc.data().email,
      accessLevel: doc.data().accessLevel,
      invitedBy: doc.data().invitedByName,
      acceptedAt: doc.data().acceptedAt?.toDate?.()?.toISOString() || null,
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
    }));

    return res.json({ invites });
  } catch (error) {
    console.error('[Invites] Error fetching invites:', error);
    return res.status(500).json({ error: 'Failed to fetch invites' });
  }
});

// Send invite to co-investor
app.post('/startups/:id/invite', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;

    // Validate input with Zod
    const validationResult = inviteSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: validationResult.error.errors[0]?.message || 'Invalid input'
      });
    }

    const { email, accessLevel } = validationResult.data;

    // Verify startup exists and user has access
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startup = startupDoc.data()!;
    if (startup.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if invite already exists
    const existingInvite = await db.collection('deal_invites')
      .where('startupId', '==', startupId)
      .where('email', '==', email.toLowerCase())
      .get();

    if (!existingInvite.empty) {
      return res.status(400).json({ error: 'This email has already been invited to this deal' });
    }

    // Get user info
    const userDoc = await db.collection('users').doc(req.user!.userId).get();
    const userData = userDoc.data();

    // Generate magic link token
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 day expiry

    const inviteRef = db.collection('deal_invites').doc();
    await inviteRef.set({
      startupId,
      organizationId: req.user!.organizationId,
      email: email.toLowerCase(),
      accessLevel,
      token,
      invitedBy: req.user!.userId,
      invitedByName: userData?.name || 'Unknown',
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      acceptedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Generate magic link URL
    const baseUrl = 'https://startup-tracker-app.web.app';
    const magicLink = `${baseUrl}/invite/${token}`;

    // Send email invitation
    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER || 'nitishvm@gmail.com',
        pass: process.env.SMTP_PASSWORD,
      },
    });

    try {
      await transporter.sendMail({
        from: `"${userData?.name || 'Startup Tracker'}" <${process.env.SMTP_USER || 'nitishvm@gmail.com'}>`,
        to: email,
        subject: `You've been invited to view ${startup.name}`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>You've been invited to view a deal</h2>
            <p>${userData?.name || 'Someone'} has invited you to ${accessLevel === 'comment' ? 'view and comment on' : 'view'} <strong>${startup.name}</strong>.</p>
            <p style="margin: 24px 0;">
              <a href="${magicLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px;">View Deal</a>
            </p>
            <p style="color: #666; font-size: 14px;">This link expires in 30 days.</p>
          </div>
        `,
      });
      console.log(`[Invites] Sent invite email to ${email}`);
    } catch (emailError) {
      console.error('[Invites] Failed to send email:', emailError);
      // Continue - invite is still created
    }

    return res.json({
      success: true,
      invite: {
        id: inviteRef.id,
        email: email.toLowerCase(),
        accessLevel,
        magicLink,
      },
    });
  } catch (error) {
    console.error('[Invites] Error sending invite:', error);
    return res.status(500).json({ error: 'Failed to send invite' });
  }
});

// Validate magic link and get deal access (public endpoint with rate limiting)
app.get('/invite/:token', publicLimiter, async (req, res) => {
  try {
    const token = req.params.token as string;

    const inviteSnapshot = await db.collection('deal_invites')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (inviteSnapshot.empty) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }

    const inviteDoc = inviteSnapshot.docs[0];
    const invite = inviteDoc.data();

    // Check expiry
    const expiresAt = invite.expiresAt?.toDate?.() || new Date(invite.expiresAt);
    if (new Date() > expiresAt) {
      return res.status(410).json({ error: 'This invite link has expired' });
    }

    // Get startup details
    const startupDoc = await db.collection('startups').doc(invite.startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Deal not found' });
    }

    const startup = startupDoc.data()!;

    // Mark as accepted if first time
    if (!invite.acceptedAt) {
      await inviteDoc.ref.update({
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Get comments if access level allows
    let comments: Array<Record<string, unknown>> = [];
    if (invite.accessLevel === 'comment') {
      const commentsSnapshot = await db.collection('comments')
        .where('startupId', '==', invite.startupId)
        .get();

      comments = commentsSnapshot.docs.map(doc => ({
        id: doc.id,
        authorName: doc.data().authorName,
        content: doc.data().content,
        parentId: doc.data().parentId,
        createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
      }));
      comments.sort((a, b) => new Date(a.createdAt as string).getTime() - new Date(b.createdAt as string).getTime());
    }

    return res.json({
      success: true,
      accessLevel: invite.accessLevel,
      inviteId: inviteDoc.id,
      startup: {
        id: startupDoc.id,
        name: startup.name,
        description: startup.description,
        website: startup.website,
        stage: startup.stage,
        sector: startup.sector,
        currentScore: startup.currentScore,
        status: startup.status,
        founderName: startup.founderName,
      },
      comments,
    });
  } catch (error) {
    console.error('[Invites] Error validating invite:', error);
    return res.status(500).json({ error: 'Failed to validate invite' });
  }
});

// Add comment via magic link (for co-investors) - public endpoint with rate limiting
app.post('/invite/:token/comment', publicLimiter, async (req, res) => {
  try {
    const token = req.params.token as string;

    // Validate input with Zod
    const validationResult = coInvestorCommentSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: validationResult.error.errors[0]?.message || 'Invalid input'
      });
    }

    const { content, name } = validationResult.data;

    // Sanitize content and name
    const sanitizedContent = sanitizeContent(content);
    const sanitizedName = name ? sanitizeContent(name) : undefined;

    if (sanitizedContent.length === 0) {
      return res.status(400).json({ error: 'Comment content is required' });
    }

    const inviteSnapshot = await db.collection('deal_invites')
      .where('token', '==', token)
      .limit(1)
      .get();

    if (inviteSnapshot.empty) {
      return res.status(404).json({ error: 'Invalid or expired invite link' });
    }

    const inviteDoc = inviteSnapshot.docs[0];
    const invite = inviteDoc.data();

    // Check expiry
    const expiresAt = invite.expiresAt?.toDate?.() || new Date(invite.expiresAt);
    if (new Date() > expiresAt) {
      return res.status(410).json({ error: 'This invite link has expired' });
    }

    // Check access level
    if (invite.accessLevel !== 'comment') {
      return res.status(403).json({ error: 'You do not have permission to comment' });
    }

    // Get startup for notification
    const startupDoc = await db.collection('startups').doc(invite.startupId).get();
    const startup = startupDoc.data();

    const commentRef = db.collection('comments').doc();
    const comment = {
      startupId: invite.startupId,
      organizationId: invite.organizationId,
      authorId: `invite:${inviteDoc.id}`,
      authorName: sanitizedName || invite.email.split('@')[0],
      authorEmail: invite.email,
      isCoInvestor: true,
      content: sanitizedContent,
      parentId: null,
      mentions: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await commentRef.set(comment);

    // Notify the person who sent the invite
    const notifRef = db.collection('notifications').doc();
    await notifRef.set({
      userId: invite.invitedBy,
      organizationId: invite.organizationId,
      type: 'comment',
      startupId: invite.startupId,
      startupName: startup?.name || 'Unknown',
      referenceId: commentRef.id,
      message: `${comment.authorName} (co-investor) commented on ${startup?.name || 'a deal'}`,
      isRead: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({
      success: true,
      comment: {
        id: commentRef.id,
        authorName: comment.authorName,
        content: comment.content,
        createdAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('[Invites] Error adding comment:', error);
    return res.status(500).json({ error: 'Failed to add comment' });
  }
});

// Revoke invite
app.delete('/startups/:id/invite/:inviteId', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const inviteId = req.params.inviteId as string;

    // Verify startup exists and user has access
    const startupDoc = await db.collection('startups').doc(startupId).get();
    if (!startupDoc.exists) {
      return res.status(404).json({ error: 'Startup not found' });
    }
    const startup = startupDoc.data()!;
    if (startup.organizationId !== req.user!.organizationId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.collection('deal_invites').doc(inviteId).delete();

    return res.json({ success: true });
  } catch (error) {
    console.error('[Invites] Error revoking invite:', error);
    return res.status(500).json({ error: 'Failed to revoke invite' });
  }
});

// ==================== NOTIFICATIONS ROUTES ====================

// Get notifications for current user
app.get('/notifications', authenticate, async (req: AuthRequest, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', req.user!.userId)
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const notifications = notificationsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
    }));

    // Sort by createdAt descending and limit
    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const limitedNotifications = notifications.slice(0, limit);

    return res.json({ notifications: limitedNotifications });
  } catch (error) {
    console.error('[Notifications] Error fetching notifications:', error);
    return res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// Get unread notification count
app.get('/notifications/unread-count', authenticate, async (req: AuthRequest, res) => {
  try {
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', req.user!.userId)
      .where('organizationId', '==', req.user!.organizationId)
      .where('isRead', '==', false)
      .get();

    return res.json({ count: notificationsSnapshot.size });
  } catch (error) {
    console.error('[Notifications] Error fetching unread count:', error);
    return res.status(500).json({ error: 'Failed to fetch notification count' });
  }
});

// Mark notification as read
app.put('/notifications/:id/read', authenticate, async (req: AuthRequest, res) => {
  try {
    const notificationId = req.params.id as string;

    const notifDoc = await db.collection('notifications').doc(notificationId).get();
    if (!notifDoc.exists) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notif = notifDoc.data()!;
    if (notif.userId !== req.user!.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await db.collection('notifications').doc(notificationId).update({ isRead: true });

    return res.json({ success: true });
  } catch (error) {
    console.error('[Notifications] Error marking notification as read:', error);
    return res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
app.put('/notifications/read-all', authenticate, async (req: AuthRequest, res) => {
  try {
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', req.user!.userId)
      .where('organizationId', '==', req.user!.organizationId)
      .where('isRead', '==', false)
      .get();

    const batch = db.batch();
    notificationsSnapshot.docs.forEach(doc => {
      batch.update(doc.ref, { isRead: true });
    });
    await batch.commit();

    return res.json({ success: true, count: notificationsSnapshot.size });
  } catch (error) {
    console.error('[Notifications] Error marking all as read:', error);
    return res.status(500).json({ error: 'Failed to mark all notifications as read' });
  }
});

// Get list of users in organization (for @mentions)
app.get('/users/list', authenticate, async (req: AuthRequest, res) => {
  try {
    const usersSnapshot = await db.collection('users')
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    const users = usersSnapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().name,
      email: doc.data().email,
      role: doc.data().role,
    }));

    return res.json({ users });
  } catch (error) {
    console.error('[Users] Error fetching users:', error);
    return res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Catch-all for unhandled routes
app.use('*', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

// Export the Express app as a Firebase Cloud Function with extended timeout
export const api = functionsV1
  .runWith({
    timeoutSeconds: 540, // 9 minutes (max for Gen 1)
    memory: '1GB',
  })
  .https.onRequest(app);
