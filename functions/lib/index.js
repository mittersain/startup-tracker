"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.api = void 0;
const functionsV1 = __importStar(require("firebase-functions/v1"));
const admin = __importStar(require("firebase-admin"));
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const bcrypt = __importStar(require("bcryptjs"));
const jwt = __importStar(require("jsonwebtoken"));
const imapflow_1 = require("imapflow");
const mailparser_1 = require("mailparser");
const generative_ai_1 = require("@google/generative-ai");
const busboy_1 = __importDefault(require("busboy"));
// Initialize Gemini AI
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'AIzaSyDKa5BFPHy90jOtOsWv2pmD7UDo2sy-HY8';
const genAI = new generative_ai_1.GoogleGenerativeAI(GEMINI_API_KEY);
// AI Helper function to extract startup proposal from email
async function extractStartupFromEmail(subject, body, from) {
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
    }
    catch (error) {
        console.error('[AI] Error extracting startup from email:', error);
        return null;
    }
}
// AI Helper function to analyze a startup and generate scores + business model
async function analyzeStartupWithAI(startup) {
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
    }
    catch (error) {
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
const app = (0, express_1.default)();
// Middleware
app.use((0, helmet_1.default)({ contentSecurityPolicy: false }));
app.use((0, cors_1.default)({ origin: true, credentials: true }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
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
        const accessToken = jwt.sign({ userId: userRef.id, email, organizationId: orgRef.id, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({
            user: { id: userRef.id, email, name, role: 'admin' },
            organization: { id: orgRef.id, name: organizationName },
            tokens: { accessToken, refreshToken: accessToken },
        });
    }
    catch (error) {
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
        const accessToken = jwt.sign({ userId: userDoc.id, email, organizationId: userData.organizationId, role: userData.role }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({
            user: { id: userDoc.id, email: userData.email, name: userData.name, role: userData.role },
            organization: { id: orgDoc.id, name: orgData?.name },
            tokens: { accessToken, refreshToken: accessToken },
        });
    }
    catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ error: 'Login failed' });
    }
});
app.post('/auth/refresh', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        const accessToken = jwt.sign({ userId: decoded.userId, email: decoded.email, organizationId: decoded.organizationId, role: decoded.role }, JWT_SECRET, { expiresIn: '7d' });
        return res.json({ accessToken, refreshToken: accessToken });
    }
    catch (error) {
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
        const decoded = jwt.verify(token, JWT_SECRET);
        const userDoc = await db.collection('users').doc(decoded.userId).get();
        if (!userDoc.exists) {
            return res.status(401).json({ error: 'User not found' });
        }
        const userData = userDoc.data();
        const orgDoc = await db.collection('organizations').doc(userData.organizationId).get();
        const orgData = orgDoc.data();
        return res.json({
            user: { id: userDoc.id, email: userData.email, name: userData.name, role: userData.role },
            organization: { id: orgDoc.id, name: orgData?.name },
        });
    }
    catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
});
const authenticate = (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'No token provided' });
        }
        const token = authHeader.slice(7);
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        return next();
    }
    catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};
// ==================== STARTUPS ROUTES ====================
app.get('/startups', authenticate, async (req, res) => {
    try {
        const { status, stage, search, page = 1, pageSize = 50 } = req.query;
        // Simple query without complex ordering to avoid index requirements
        const snapshot = await db.collection('startups')
            .where('organizationId', '==', req.user.organizationId)
            .get();
        let startups = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                name: data.name,
                website: data.website,
                description: data.description,
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
            const searchLower = search.toLowerCase();
            startups = startups.filter(s => s.name?.toLowerCase().includes(searchLower) ||
                s.description?.toLowerCase().includes(searchLower));
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
    }
    catch (error) {
        console.error('List startups error:', error);
        return res.status(500).json({ error: 'Failed to list startups' });
    }
});
app.get('/startups/counts', authenticate, async (req, res) => {
    try {
        const snapshot = await db.collection('startups')
            .where('organizationId', '==', req.user.organizationId)
            .get();
        const counts = {
            reviewing: 0,
            due_diligence: 0,
            invested: 0,
            passed: 0,
        };
        snapshot.docs.forEach(doc => {
            const status = doc.data().status;
            if (counts[status] !== undefined) {
                counts[status]++;
            }
        });
        return res.json(counts);
    }
    catch (error) {
        console.error('Get counts error:', error);
        return res.status(500).json({ error: 'Failed to get counts' });
    }
});
app.post('/startups', authenticate, async (req, res) => {
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
            organizationId: req.user.organizationId,
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
    }
    catch (error) {
        console.error('Create startup error:', error);
        return res.status(500).json({ error: 'Failed to create startup' });
    }
});
app.get('/startups/:id', authenticate, async (req, res) => {
    try {
        const startupDoc = await db.collection('startups').doc(req.params.id).get();
        if (!startupDoc.exists) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        const data = startupDoc.data();
        if (data.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        return res.json({
            id: startupDoc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        });
    }
    catch (error) {
        console.error('Get startup error:', error);
        return res.status(500).json({ error: 'Failed to get startup' });
    }
});
app.patch('/startups/:id', authenticate, async (req, res) => {
    try {
        const startupRef = db.collection('startups').doc(req.params.id);
        const startupDoc = await startupRef.get();
        if (!startupDoc.exists) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        const data = startupDoc.data();
        if (data.organizationId !== req.user.organizationId) {
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
        const updatedData = updated.data();
        return res.json({
            id: updated.id,
            ...updatedData,
            createdAt: updatedData.createdAt?.toDate?.()?.toISOString() || updatedData.createdAt,
            updatedAt: updatedData.updatedAt?.toDate?.()?.toISOString() || updatedData.updatedAt,
        });
    }
    catch (error) {
        console.error('Update startup error:', error);
        return res.status(500).json({ error: 'Failed to update startup' });
    }
});
app.patch('/startups/:id/status', authenticate, async (req, res) => {
    try {
        const { status } = req.body;
        const startupRef = db.collection('startups').doc(req.params.id);
        const startupDoc = await startupRef.get();
        if (!startupDoc.exists) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        const data = startupDoc.data();
        if (data.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        await startupRef.update({
            status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ id: req.params.id, status });
    }
    catch (error) {
        console.error('Update status error:', error);
        return res.status(500).json({ error: 'Failed to update status' });
    }
});
// Manually trigger AI analysis for a startup
app.post('/startups/:id/analyze', authenticate, async (req, res) => {
    try {
        const startupRef = db.collection('startups').doc(req.params.id);
        const startupDoc = await startupRef.get();
        if (!startupDoc.exists) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        const data = startupDoc.data();
        if (data.organizationId !== req.user.organizationId) {
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
    }
    catch (error) {
        console.error('Analyze startup error:', error);
        return res.status(500).json({ error: 'Failed to analyze startup' });
    }
});
app.delete('/startups/:id', authenticate, async (req, res) => {
    try {
        const startupRef = db.collection('startups').doc(req.params.id);
        const startupDoc = await startupRef.get();
        if (!startupDoc.exists) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        const data = startupDoc.data();
        if (data.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        await startupRef.delete();
        return res.status(204).send();
    }
    catch (error) {
        console.error('Delete startup error:', error);
        return res.status(500).json({ error: 'Failed to delete startup' });
    }
});
// ==================== INBOX/QUEUE ROUTES ====================
// Helper function to get inbox config from either inboxConfig collection or organization settings
async function getInboxConfig(organizationId) {
    // First try the dedicated inboxConfig collection
    const configDoc = await db.collection('inboxConfig').doc(organizationId).get();
    if (configDoc.exists) {
        const data = configDoc.data();
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
        const orgData = orgDoc.data();
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
app.post('/inbox/sync', authenticate, async (req, res) => {
    try {
        // Get inbox config for this organization
        const config = await getInboxConfig(req.user.organizationId);
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
        const client = new imapflow_1.ImapFlow({
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
        const results = [];
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
                        const parsed = await (0, mailparser_1.simpleParser)(message.source);
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
                                organizationId: req.user.organizationId,
                                userId: req.user.userId,
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
                        }
                        else {
                            skipped++;
                            if (aiResult) {
                                console.log(`[EmailSync] AI skipped email: ${subject} - ${aiResult.reason} (${aiResult.confidence}% confidence)`);
                            }
                        }
                        processed++;
                    }
                }
                catch (fetchError) {
                    console.error(`[EmailSync] Failed to fetch message ${uid}:`, fetchError);
                }
            }
            await client.logout();
        }
        catch (imapError) {
            console.error('[EmailSync] IMAP error:', imapError);
            try {
                await client.logout();
            }
            catch { /* ignore */ }
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
    }
    catch (error) {
        console.error('Sync inbox error:', error);
        return res.status(500).json({ error: 'Failed to sync inbox' });
    }
});
// Process inbox - placeholder for now
app.post('/inbox/process', authenticate, async (_req, res) => {
    try {
        return res.json({
            success: true,
            message: 'Inbox processing completed',
            processed: 0
        });
    }
    catch (error) {
        console.error('Process inbox error:', error);
        return res.status(500).json({ error: 'Failed to process inbox' });
    }
});
// Save inbox config
app.post('/inbox/config', authenticate, async (req, res) => {
    try {
        const configRef = db.collection('inboxConfig').doc(req.user.organizationId);
        await configRef.set({
            ...req.body,
            organizationId: req.user.organizationId,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Save inbox config error:', error);
        return res.status(500).json({ error: 'Failed to save inbox config' });
    }
});
// Test inbox connection - actually tests IMAP connection
app.post('/inbox/test', authenticate, async (req, res) => {
    try {
        const { host, port, user, password, tls, folder } = req.body;
        if (!host || !user || !password) {
            return res.status(400).json({ error: 'Missing required fields: host, user, password' });
        }
        const client = new imapflow_1.ImapFlow({
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
        }
        catch (imapError) {
            console.error(`[IMAP Test] Error:`, imapError);
            console.error(`[IMAP Test] Error details:`, {
                message: imapError?.message,
                responseText: imapError?.responseText,
                authenticationFailed: imapError?.authenticationFailed,
                code: imapError?.code,
            });
            try {
                await client.logout();
            }
            catch { /* ignore */ }
            return res.json({
                success: false,
                error: imapError?.responseText || imapError?.message || 'Connection failed',
                details: imapError?.authenticationFailed ? 'Authentication failed - check username and password' : undefined,
            });
        }
    }
    catch (error) {
        console.error('Test inbox error:', error);
        return res.status(500).json({ error: 'Failed to test inbox connection' });
    }
});
// Parse email content - placeholder
app.post('/inbox/parse', authenticate, async (req, res) => {
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
    }
    catch (error) {
        console.error('Parse content error:', error);
        return res.status(500).json({ error: 'Failed to parse content' });
    }
});
app.get('/inbox/queue', authenticate, async (req, res) => {
    try {
        const snapshot = await db.collection('proposalQueue')
            .where('organizationId', '==', req.user.organizationId)
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
            .filter((p) => p.status === 'pending');
        // Sort by createdAt descending
        proposals.sort((a, b) => {
            const dateA = new Date(a.createdAt || 0).getTime();
            const dateB = new Date(b.createdAt || 0).getTime();
            return dateB - dateA;
        });
        // Deduplicate proposals by founderEmail - keep the most recent one
        const seenEmails = new Set();
        const seenNames = new Set();
        proposals = proposals.filter((p) => {
            const normalizedName = p.startupName?.toLowerCase().replace(/[^a-z0-9]/g, '');
            // Skip if we've seen this founder email
            if (p.founderEmail && seenEmails.has(p.founderEmail)) {
                return false;
            }
            // Skip if we've seen a very similar startup name
            if (normalizedName && normalizedName.length > 3 && seenNames.has(normalizedName)) {
                return false;
            }
            if (p.founderEmail)
                seenEmails.add(p.founderEmail);
            if (normalizedName && normalizedName.length > 3)
                seenNames.add(normalizedName);
            return true;
        });
        return res.json({ proposals });
    }
    catch (error) {
        console.error('Get queue error:', error);
        return res.json({ proposals: [] });
    }
});
app.post('/inbox/queue/:id/approve', authenticate, async (req, res) => {
    try {
        const proposalRef = db.collection('proposalQueue').doc(req.params.id);
        const proposalDoc = await proposalRef.get();
        if (!proposalDoc.exists) {
            return res.status(404).json({ error: 'Proposal not found' });
        }
        const proposalData = proposalDoc.data();
        // Check for existing startup with same founder email to prevent duplicates
        const existingByEmail = await db.collection('startups')
            .where('organizationId', '==', req.user.organizationId)
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
                organizationId: req.user.organizationId,
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
                .where('organizationId', '==', req.user.organizationId)
                .get();
            const duplicate = allStartups.docs.find(doc => {
                const existingName = doc.data().name?.toLowerCase().replace(/[^a-z0-9]/g, '');
                return existingName && (existingName === normalizedName ||
                    existingName.includes(normalizedName) ||
                    normalizedName.includes(existingName));
            });
            if (duplicate) {
                // Create email record for the new email thread
                const emailRef = db.collection('emails').doc();
                await emailRef.set({
                    startupId: duplicate.id,
                    organizationId: req.user.organizationId,
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
                await proposalRef.update({ status: 'approved', linkedStartupId: duplicate.id, emailId: emailRef.id });
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
        const startupData = {
            name: proposalData.startupName,
            description: proposalData.description,
            website: proposalData.website,
            founderEmail: proposalData.founderEmail,
            founderName: proposalData.founderName,
            stage: proposalData.stage || 'seed',
            status: 'reviewing',
            organizationId: req.user.organizationId,
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
        // Create email record from the proposal
        const emailRef = db.collection('emails').doc();
        await emailRef.set({
            startupId: startupRef.id,
            organizationId: req.user.organizationId,
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
        // Update proposal status
        await proposalRef.update({ status: 'approved', linkedStartupId: startupRef.id, emailId: emailRef.id });
        return res.json({ success: true, startupId: startupRef.id, score: aiAnalysis?.currentScore });
    }
    catch (error) {
        console.error('Approve proposal error:', error);
        return res.status(500).json({ error: 'Failed to approve proposal' });
    }
});
// Backfill emails for existing startups from approved proposals
app.post('/inbox/backfill-emails', authenticate, async (req, res) => {
    try {
        // Find approved proposals that have linkedStartupId but no emailId
        const proposalSnapshot = await db.collection('proposalQueue')
            .where('organizationId', '==', req.user.organizationId)
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
                        organizationId: req.user.organizationId,
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
    }
    catch (error) {
        console.error('Backfill emails error:', error);
        return res.status(500).json({ error: 'Failed to backfill emails' });
    }
});
app.post('/inbox/queue/:id/reject', authenticate, async (req, res) => {
    try {
        const proposalRef = db.collection('proposalQueue').doc(req.params.id);
        await proposalRef.update({ status: 'rejected', rejectedAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Reject proposal error:', error);
        return res.status(500).json({ error: 'Failed to reject proposal' });
    }
});
app.post('/inbox/queue/:id/snooze', authenticate, async (req, res) => {
    try {
        const proposalRef = db.collection('proposalQueue').doc(req.params.id);
        await proposalRef.update({ status: 'snoozed', snoozedAt: admin.firestore.FieldValue.serverTimestamp() });
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Snooze proposal error:', error);
        return res.status(500).json({ error: 'Failed to snooze proposal' });
    }
});
// ==================== USERS ROUTES ====================
app.get('/users', authenticate, async (req, res) => {
    try {
        const snapshot = await db.collection('users')
            .where('organizationId', '==', req.user.organizationId)
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
    }
    catch (error) {
        console.error('List users error:', error);
        return res.status(500).json({ error: 'Failed to list users' });
    }
});
// ==================== EMAILS ROUTES ====================
app.get('/emails/startup/:startupId', authenticate, async (req, res) => {
    try {
        const startupId = req.params.startupId;
        const snapshot = await db.collection('emails')
            .where('startupId', '==', startupId)
            .where('organizationId', '==', req.user.organizationId)
            .get();
        const emails = snapshot.docs.map(doc => {
            const data = doc.data();
            const dateValue = data.date?.toDate?.()?.toISOString() || data.date;
            return {
                id: doc.id,
                subject: data.subject,
                // Frontend expected fields
                fromAddress: data.from,
                fromName: data.fromName,
                toAddresses: data.to ? [{ email: data.to }] : [],
                bodyPreview: data.body,
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
                createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
            };
        });
        // Sort by date descending
        emails.sort((a, b) => new Date(b.receivedAt || 0).getTime() - new Date(a.receivedAt || 0).getTime());
        return res.json({ data: emails, total: emails.length });
    }
    catch (error) {
        console.error('Get emails error:', error);
        return res.json({ data: [], total: 0 });
    }
});
app.get('/emails/unmatched', authenticate, async (req, res) => {
    try {
        const snapshot = await db.collection('emails')
            .where('organizationId', '==', req.user.organizationId)
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
    }
    catch (error) {
        console.error('Get unmatched emails error:', error);
        return res.json({ data: [], total: 0 });
    }
});
app.post('/emails/:emailId/match', authenticate, async (req, res) => {
    try {
        const { startupId } = req.body;
        const emailRef = db.collection('emails').doc(req.params.emailId);
        await emailRef.update({ startupId });
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Match email error:', error);
        return res.status(500).json({ error: 'Failed to match email' });
    }
});
app.get('/emails/contacts/:startupId', authenticate, async (req, res) => {
    try {
        const startupId = req.params.startupId;
        const snapshot = await db.collection('contacts')
            .where('startupId', '==', startupId)
            .where('organizationId', '==', req.user.organizationId)
            .get();
        const contacts = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
        }));
        return res.json(contacts);
    }
    catch (error) {
        console.error('Get contacts error:', error);
        return res.json([]);
    }
});
app.post('/emails/contacts/:startupId', authenticate, async (req, res) => {
    try {
        const { email, name, role } = req.body;
        const contactRef = db.collection('contacts').doc();
        await contactRef.set({
            startupId: req.params.startupId,
            organizationId: req.user.organizationId,
            email,
            name,
            role,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ id: contactRef.id, success: true });
    }
    catch (error) {
        console.error('Create contact error:', error);
        return res.status(500).json({ error: 'Failed to create contact' });
    }
});
app.patch('/emails/contacts/:contactId', authenticate, async (req, res) => {
    try {
        const contactRef = db.collection('contacts').doc(req.params.contactId);
        await contactRef.update(req.body);
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Update contact error:', error);
        return res.status(500).json({ error: 'Failed to update contact' });
    }
});
app.delete('/emails/contacts/:contactId', authenticate, async (req, res) => {
    try {
        await db.collection('contacts').doc(req.params.contactId).delete();
        return res.status(204).send();
    }
    catch (error) {
        console.error('Delete contact error:', error);
        return res.status(500).json({ error: 'Failed to delete contact' });
    }
});
app.get('/emails/metrics/:startupId', authenticate, async (req, res) => {
    try {
        const startupId = req.params.startupId;
        const snapshot = await db.collection('emails')
            .where('startupId', '==', startupId)
            .where('organizationId', '==', req.user.organizationId)
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
    }
    catch (error) {
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
app.post('/emails/:emailId/analyze', authenticate, async (_req, res) => {
    return res.json({ success: true, analysis: null });
});
// ==================== DECKS ROUTES ====================
app.get('/decks/startup/:startupId', authenticate, async (req, res) => {
    try {
        const startupId = req.params.startupId;
        const snapshot = await db.collection('decks')
            .where('startupId', '==', startupId)
            .where('organizationId', '==', req.user.organizationId)
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
    }
    catch (error) {
        console.error('Get decks error:', error);
        return res.json([]);
    }
});
app.get('/decks/:id', authenticate, async (req, res) => {
    try {
        const deckDoc = await db.collection('decks').doc(req.params.id).get();
        if (!deckDoc.exists) {
            return res.status(404).json({ error: 'Deck not found' });
        }
        const data = deckDoc.data();
        if (data.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Deck not found' });
        }
        return res.json({
            id: deckDoc.id,
            ...data,
            createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        });
    }
    catch (error) {
        console.error('Get deck error:', error);
        return res.status(500).json({ error: 'Failed to get deck' });
    }
});
// Upload deck with file
app.post('/decks/startup/:startupId', authenticate, async (req, res) => {
    try {
        const startupId = req.params.startupId;
        // Verify startup exists and belongs to user's org
        const startupDoc = await db.collection('startups').doc(startupId).get();
        if (!startupDoc.exists || startupDoc.data()?.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        // Parse multipart form data
        const busboy = (0, busboy_1.default)({ headers: req.headers });
        let fileBuffer = null;
        let fileName = '';
        let mimeType = '';
        const filePromise = new Promise((resolve, reject) => {
            busboy.on('file', (fieldname, file, info) => {
                fileName = info.filename;
                mimeType = info.mimeType;
                const chunks = [];
                file.on('data', (chunk) => {
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
        const storagePath = `decks/${req.user.organizationId}/${startupId}/${Date.now()}-${uploadedFileName}`;
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
            organizationId: req.user.organizationId,
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
    }
    catch (error) {
        console.error('Upload deck error:', error);
        return res.status(500).json({ error: 'Failed to upload deck' });
    }
});
// AI analysis helper for decks
async function analyzeDeckWithAI(deckId, fileBuffer, fileName, startupId) {
    try {
        const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
        // For PDFs, we'll analyze based on text extraction
        // Note: Full PDF parsing would require additional libraries
        const prompt = `Analyze this startup pitch deck file named "${fileName}".

Based on the file name and any context you have, provide an analysis in this JSON format:
{
  "score": number (0-100, estimated quality score),
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
        const result = await model.generateContent(prompt);
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
                    const currentScore = startupDoc.data()?.currentScore || 0;
                    // Average with existing score or use deck score
                    const newScore = currentScore > 0 ? Math.round((currentScore + analysis.score) / 2) : analysis.score;
                    await startupRef.update({
                        currentScore: newScore,
                        deckScore: analysis.score,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                }
            }
            console.log(`[Deck Analysis] Completed for ${fileName}, score: ${analysis.score}`);
        }
    }
    catch (error) {
        console.error('[Deck Analysis] Error:', error);
        await db.collection('decks').doc(deckId).update({
            status: 'error',
            aiAnalysis: { error: 'Analysis failed' },
        });
    }
}
app.post('/decks/:id/reprocess', authenticate, async (req, res) => {
    try {
        const deckDoc = await db.collection('decks').doc(req.params.id).get();
        if (!deckDoc.exists) {
            return res.status(404).json({ error: 'Deck not found' });
        }
        const data = deckDoc.data();
        if (data.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Deck not found' });
        }
        // Mark as processing
        await deckDoc.ref.update({ status: 'processing' });
        // Re-run analysis (would need to re-fetch file from storage)
        // For now, just mark as processed
        await deckDoc.ref.update({ status: 'processed' });
        return res.json({ success: true });
    }
    catch (error) {
        console.error('Reprocess deck error:', error);
        return res.status(500).json({ error: 'Failed to reprocess deck' });
    }
});
app.delete('/decks/:id', authenticate, async (req, res) => {
    try {
        const deckDoc = await db.collection('decks').doc(req.params.id).get();
        if (!deckDoc.exists) {
            return res.status(404).json({ error: 'Deck not found' });
        }
        const data = deckDoc.data();
        if (data.organizationId !== req.user.organizationId) {
            return res.status(404).json({ error: 'Deck not found' });
        }
        // Delete from storage
        if (data.storagePath) {
            try {
                const bucket = admin.storage().bucket();
                await bucket.file(data.storagePath).delete();
            }
            catch (storageError) {
                console.error('Error deleting from storage:', storageError);
            }
        }
        // Delete from Firestore
        await deckDoc.ref.delete();
        return res.status(204).send();
    }
    catch (error) {
        console.error('Delete deck error:', error);
        return res.status(500).json({ error: 'Failed to delete deck' });
    }
});
// ==================== SCORE ROUTES ====================
app.get('/startups/:id/score-events', authenticate, async (req, res) => {
    try {
        const startupId = req.params.id;
        const snapshot = await db.collection('scoreEvents')
            .where('startupId', '==', startupId)
            .get();
        const events = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toDate?.()?.toISOString() || doc.data().createdAt,
        }));
        return res.json({ data: events, total: events.length });
    }
    catch (error) {
        console.error('Get score events error:', error);
        return res.json({ data: [], total: 0 });
    }
});
app.get('/startups/:id/score-history', authenticate, async (req, res) => {
    try {
        const startupId = req.params.id;
        const snapshot = await db.collection('scoreHistory')
            .where('startupId', '==', startupId)
            .get();
        const history = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            date: doc.data().date?.toDate?.()?.toISOString() || doc.data().date,
        }));
        return res.json(history);
    }
    catch (error) {
        console.error('Get score history error:', error);
        return res.json([]);
    }
});
app.post('/startups/:id/score-events', authenticate, async (req, res) => {
    try {
        const startupId = req.params.id;
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
    }
    catch (error) {
        console.error('Add score event error:', error);
        return res.status(500).json({ error: 'Failed to add score event' });
    }
});
// ==================== EVALUATION ROUTES ====================
app.get('/evaluation/:startupId', authenticate, async (req, res) => {
    try {
        const startupId = req.params.startupId;
        const evalDoc = await db.collection('evaluations').doc(startupId).get();
        if (!evalDoc.exists) {
            return res.json(null);
        }
        return res.json({ id: evalDoc.id, ...evalDoc.data() });
    }
    catch (error) {
        console.error('Get evaluation error:', error);
        return res.json(null);
    }
});
app.post('/evaluation/:startupId/initialize', authenticate, async (req, res) => {
    try {
        const startupId = req.params.startupId;
        const { isPostRevenue } = req.body;
        await db.collection('evaluations').doc(startupId).set({
            startupId,
            isPostRevenue,
            status: 'initialized',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true });
    }
    catch (error) {
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
app.post('/startups/:id/send-reply', authenticate, async (req, res) => {
    try {
        const startupId = req.params.id;
        const startupDoc = await db.collection('startups').doc(startupId).get();
        if (!startupDoc.exists) {
            return res.status(404).json({ error: 'Startup not found' });
        }
        const data = startupDoc.data();
        // In a real implementation, this would send an email
        return res.json({
            success: true,
            to: data.founderEmail || 'unknown@email.com',
            message: 'Email sending not implemented in cloud version'
        });
    }
    catch (error) {
        console.error('Send reply error:', error);
        return res.status(500).json({ error: 'Failed to send reply' });
    }
});
app.patch('/startups/:id/draft-reply', authenticate, async (req, res) => {
    try {
        const startupId = req.params.id;
        const { draftReply } = req.body;
        await db.collection('startups').doc(startupId).update({
            draftReply,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ success: true });
    }
    catch (error) {
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
app.get('/inbox/config', authenticate, async (req, res) => {
    try {
        // First try the dedicated inboxConfig collection
        const configDoc = await db.collection('inboxConfig').doc(req.user.organizationId).get();
        if (configDoc.exists) {
            const data = configDoc.data();
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
        const orgDoc = await db.collection('organizations').doc(req.user.organizationId).get();
        if (orgDoc.exists) {
            const orgData = orgDoc.data();
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
    }
    catch (error) {
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
exports.api = functionsV1
    .runWith({
    timeoutSeconds: 540, // 9 minutes (max for Gen 1)
    memory: '1GB',
})
    .https.onRequest(app);
//# sourceMappingURL=index.js.map