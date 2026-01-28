import * as functionsV1 from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDKa5BFPHy90jOtOsWv2pmD7UDo2sy-HY8';
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

    const prompt = `Analyze this email and determine if it's a startup investment proposal or pitch.

Email Subject: ${subject}
From: ${from}
Body: ${body.substring(0, 3000)}

Respond with ONLY a JSON object (no markdown, no explanation):
{
  "isStartupProposal": boolean (true if this is a startup pitch/investment proposal),
  "startupName": string or null (the startup/company name if found),
  "description": string or null (brief description of what the startup does),
  "founderName": string or null (founder's name if mentioned),
  "stage": string or null (seed, pre-seed, series-a, etc),
  "askAmount": string or null (funding amount if mentioned),
  "confidence": number (0-100, how confident you are this is a real startup proposal),
  "reason": string (brief reason for your classification)
}

Important: Return false for newsletters, marketing emails, automated notifications, spam, and general correspondence that is not a startup pitch.`;

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
    "keyQuestions": string[] (3-5 questions to ask the founders)
  },
  "draftReply": string (a professional, personalized email reply to the founder acknowledging their pitch, asking 2-3 clarifying questions, and expressing interest in learning more. Sign as "Nitish" and keep it warm but professional.)
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

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

// JWT Secret (in production, use Secret Manager)
const JWT_SECRET = process.env.JWT_SECRET || 'startup-tracker-jwt-secret-2026';

// Create Express app
const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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

app.post('/auth/register', async (req, res) => {
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

app.post('/auth/login', async (req, res) => {
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
    const { status, stage, search, page = 1, pageSize = 50 } = req.query;

    // Simple query without complex ordering to avoid index requirements
    const snapshot = await db.collection('startups')
      .where('organizationId', '==', req.user!.organizationId)
      .get();

    let startups = snapshot.docs.map(doc => {
      const data = doc.data();
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
      };
    });

    // Client-side filtering
    if (status && status !== 'all') {
      startups = startups.filter(s => s.status === status);
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

    return res.json({
      id: startupDoc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
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

// Sync inbox - connects to IMAP and fetches emails
app.post('/inbox/sync', authenticate, async (req: AuthRequest, res) => {
  try {
    // Get inbox config for this organization
    const config = await getInboxConfig(req.user!.organizationId);

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
        rejectUnauthorized: false,
      },
    });

    const results: Array<{
      messageId: string;
      subject: string;
      from: string;
      date: Date;
      status: string;
    }> = [];
    let queued = 0;
    let processed = 0;
    let skipped = 0;

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

            // Check if already processed
            const existingSnapshot = await db.collection('proposalQueue')
              .where('emailMessageId', '==', messageId)
              .get();

            if (!existingSnapshot.empty) {
              skipped++;
              continue;
            }

            // Use AI to analyze if this is a startup proposal
            const bodyText = parsed.text || '';

            // Call AI to extract startup info
            const aiResult = await extractStartupFromEmail(subject, bodyText, `${fromName} <${fromEmail}>`);

            if (aiResult && aiResult.isStartupProposal && aiResult.confidence >= 60) {
              const startupName = aiResult.startupName || subject.replace(/^(Re:|Fwd:|FW:)\s*/gi, '').trim().substring(0, 100) || 'Unknown Startup';

              // Add to proposal queue
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
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
              });

              queued++;
              results.push({
                messageId,
                subject,
                from: `${fromName} <${fromEmail}>`,
                date: parsed.date || new Date(),
                status: 'queued'
              });
              console.log(`[EmailSync] AI identified startup proposal: ${startupName} (${aiResult.confidence}% confidence)`);
            } else {
              skipped++;
              if (aiResult) {
                console.log(`[EmailSync] AI skipped email: ${subject} - ${aiResult.reason} (${aiResult.confidence}% confidence)`);
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
      decksProcessed: 0,
      emailsLinked: 0,
      queued,
      quotaExceeded: false,
      message: queued > 0
        ? `Found ${queued} potential startup proposals to review!`
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
        rejectUnauthorized: false,
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
    const seenEmails = new Set<string>();
    const seenNames = new Set<string>();
    proposals = proposals.filter((p: any) => {
      const normalizedName = p.startupName?.toLowerCase().replace(/[^a-z0-9]/g, '');

      // Skip if we've seen this founder email
      if (p.founderEmail && seenEmails.has(p.founderEmail)) {
        return false;
      }

      // Skip if we've seen a very similar startup name
      if (normalizedName && normalizedName.length > 3 && seenNames.has(normalizedName)) {
        return false;
      }

      if (p.founderEmail) seenEmails.add(p.founderEmail);
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

    // Check for existing startup with same founder email to prevent duplicates
    const existingByEmail = await db.collection('startups')
      .where('organizationId', '==', req.user!.organizationId)
      .where('founderEmail', '==', proposalData.founderEmail)
      .limit(1)
      .get();

    if (!existingByEmail.empty) {
      // Startup already exists - link proposal to existing startup and mark as approved
      const existingStartup = existingByEmail.docs[0];
      await proposalRef.update({ status: 'approved', linkedStartupId: existingStartup.id });
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
        await proposalRef.update({ status: 'approved', linkedStartupId: duplicate.id });
        return res.json({
          success: true,
          startupId: duplicate.id,
          score: duplicate.data().currentScore,
          message: 'Linked to existing startup (similar name)'
        });
      }
    }

    // Run AI analysis on the proposal
    console.log(`[Approve] Running AI analysis for ${proposalData.startupName}...`);
    const aiAnalysis = await analyzeStartupWithAI({
      name: proposalData.startupName,
      description: proposalData.description,
      founderName: proposalData.founderName,
      founderEmail: proposalData.founderEmail,
      stage: proposalData.stage,
      emailContent: proposalData.emailPreview,
    });

    // Create startup from proposal with AI analysis
    const startupRef = db.collection('startups').doc();
    const startupData: Record<string, unknown> = {
      name: proposalData.startupName,
      description: proposalData.description,
      website: proposalData.website,
      founderEmail: proposalData.founderEmail,
      founderName: proposalData.founderName,
      stage: proposalData.stage || 'seed',
      status: 'reviewing',
      organizationId: req.user!.organizationId,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Add AI analysis results if available
    if (aiAnalysis) {
      startupData.currentScore = aiAnalysis.currentScore;
      startupData.baseScore = aiAnalysis.currentScore;
      startupData.scoreBreakdown = aiAnalysis.scoreBreakdown;
      startupData.businessModelAnalysis = aiAnalysis.businessModelAnalysis;
      startupData.sector = aiAnalysis.businessModelAnalysis?.sector;
      startupData.draftReply = aiAnalysis.draftReply;
      startupData.draftReplyStatus = 'pending';
      startupData.scoreUpdatedAt = admin.firestore.FieldValue.serverTimestamp();
      console.log(`[Approve] AI analysis complete. Score: ${aiAnalysis.currentScore}`);
    }

    await startupRef.set(startupData);

    // Update proposal status
    await proposalRef.update({ status: 'approved', linkedStartupId: startupRef.id });

    return res.json({ success: true, startupId: startupRef.id, score: aiAnalysis?.currentScore });
  } catch (error) {
    console.error('Approve proposal error:', error);
    return res.status(500).json({ error: 'Failed to approve proposal' });
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

app.get('/emails/startup/:startupId', authenticate, async (_req, res) => {
  return res.json({ data: [], total: 0 });
});

app.get('/emails/unmatched', authenticate, async (_req, res) => {
  return res.json({ data: [], total: 0 });
});

app.post('/emails/:emailId/match', authenticate, async (_req, res) => {
  return res.json({ success: true });
});

app.get('/emails/contacts/:startupId', authenticate, async (_req, res) => {
  return res.json([]);
});

app.post('/emails/contacts/:startupId', authenticate, async (_req, res) => {
  return res.json({ id: 'placeholder', success: true });
});

app.patch('/emails/contacts/:contactId', authenticate, async (_req, res) => {
  return res.json({ success: true });
});

app.delete('/emails/contacts/:contactId', authenticate, async (_req, res) => {
  return res.status(204).send();
});

app.get('/emails/metrics/:startupId', authenticate, async (_req, res) => {
  return res.json({
    totalEmails: 0,
    inboundEmails: 0,
    outboundEmails: 0,
    avgResponseTime: null,
    lastEmailDate: null,
  });
});

app.post('/emails/:emailId/analyze', authenticate, async (_req, res) => {
  return res.json({ success: true, analysis: null });
});

// ==================== DECKS ROUTES ====================

app.get('/decks/startup/:startupId', authenticate, async (_req, res) => {
  return res.json([]);
});

app.get('/decks/:id', authenticate, async (_req, res) => {
  return res.status(404).json({ error: 'Deck not found' });
});

app.post('/decks/startup/:startupId', authenticate, async (_req, res) => {
  return res.json({ id: 'placeholder', success: true });
});

app.post('/decks/:id/reprocess', authenticate, async (_req, res) => {
  return res.json({ success: true });
});

app.delete('/decks/:id', authenticate, async (_req, res) => {
  return res.status(204).send();
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
    const snapshot = await db.collection('scoreHistory')
      .where('startupId', '==', startupId)
      .get();

    const history = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
      date: doc.data().date?.toDate?.()?.toISOString() || doc.data().date,
    }));

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
    // In a real implementation, this would send an email
    return res.json({
      success: true,
      to: data.founderEmail || 'unknown@email.com',
      message: 'Email sending not implemented in cloud version'
    });
  } catch (error) {
    console.error('Send reply error:', error);
    return res.status(500).json({ error: 'Failed to send reply' });
  }
});

app.patch('/startups/:id/draft-reply', authenticate, async (req: AuthRequest, res) => {
  try {
    const startupId = req.params.id as string;
    const { draftReply } = req.body;

    await db.collection('startups').doc(startupId).update({
      draftReply,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

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

app.get('/backup/status', authenticate, async (_req, res) => {
  return res.json({ enabled: false, database: 'firestore' });
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
