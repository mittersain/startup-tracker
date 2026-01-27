// ==========================================
// Core Entity Types
// ==========================================

export interface Organization {
  id: string;
  name: string;
  plan: 'free' | 'pro' | 'enterprise';
  settings: OrganizationSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationSettings {
  scoringWeights: ScoringWeights;
  dealStages: string[];
  customFields: CustomField[];
  emailSyncEnabled: boolean;
  aiAnalysisEnabled: boolean;
}

export interface CustomField {
  id: string;
  name: string;
  type: 'text' | 'number' | 'date' | 'select' | 'multiselect';
  options?: string[];
  required: boolean;
}

// ==========================================
// User & Authentication
// ==========================================

export type UserRole = 'admin' | 'partner' | 'analyst' | 'viewer';

export interface User {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl?: string;
  outlookConnected: boolean;
  outlookConnectedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserPermissions {
  canViewAllDeals: boolean;
  canAddDeals: boolean;
  canEditDeals: boolean;
  canDeleteDeals: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canExportData: boolean;
}

export const ROLE_PERMISSIONS: Record<UserRole, UserPermissions> = {
  admin: {
    canViewAllDeals: true,
    canAddDeals: true,
    canEditDeals: true,
    canDeleteDeals: true,
    canManageUsers: true,
    canManageSettings: true,
    canExportData: true,
  },
  partner: {
    canViewAllDeals: true,
    canAddDeals: true,
    canEditDeals: true,
    canDeleteDeals: false,
    canManageUsers: false,
    canManageSettings: false,
    canExportData: true,
  },
  analyst: {
    canViewAllDeals: false,
    canAddDeals: true,
    canEditDeals: false, // Only assigned deals
    canDeleteDeals: false,
    canManageUsers: false,
    canManageSettings: false,
    canExportData: false,
  },
  viewer: {
    canViewAllDeals: false,
    canAddDeals: false,
    canEditDeals: false,
    canDeleteDeals: false,
    canManageUsers: false,
    canManageSettings: false,
    canExportData: false,
  },
};

// ==========================================
// Startup & Deal
// ==========================================

export type DealStatus = 'reviewing' | 'due_diligence' | 'invested' | 'passed' | 'archived';
export type FundingStage = 'pre_seed' | 'seed' | 'series_a' | 'series_b' | 'series_c' | 'growth';

export interface Startup {
  id: string;
  organizationId: string;
  name: string;
  website?: string;
  domain?: string;
  description?: string;
  status: DealStatus;
  stage?: FundingStage;
  ownerId: string;

  // Scoring
  baseScore?: number;
  currentScore?: number;
  scoreTrend: 'up' | 'down' | 'stable';
  scoreTrendDelta: number;
  scoreBreakdown?: ScoreBreakdown;
  scoreUpdatedAt?: Date;

  // Extracted data
  founders?: Founder[];
  metrics?: Record<string, unknown>;
  tags?: string[];

  // Metadata
  notes?: string;
  customFields?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Founder {
  name: string;
  role: string;
  linkedinUrl?: string;
  email?: string;
  background?: string;
}

export interface StartupAssignment {
  userId: string;
  startupId: string;
  accessLevel: 'view' | 'edit';
  assignedBy: string;
  assignedAt: Date;
}

// ==========================================
// Scoring System
// ==========================================

export interface ScoringWeights {
  team: number;      // Default 25
  market: number;    // Default 25
  product: number;   // Default 20
  traction: number;  // Default 20
  deal: number;      // Default 10
}

export interface ScoreBreakdown {
  team: CategoryScore;
  market: CategoryScore;
  product: CategoryScore;
  traction: CategoryScore;
  deal: CategoryScore;
  communication: number;
  momentum: number;
  redFlags: number;
}

export interface CategoryScore {
  base: number;
  adjusted: number;
  subcriteria: Record<string, number>;
}

export type ScoreEventSource = 'deck' | 'email' | 'meeting' | 'research' | 'manual' | 'system';
export type ScoreCategory =
  | 'team'
  | 'market'
  | 'product'
  | 'traction'
  | 'deal'
  | 'communication'
  | 'momentum'
  | 'red_flag';

export interface ScoreEvent {
  id: string;
  startupId: string;
  timestamp: Date;
  source: ScoreEventSource;
  sourceId?: string;
  category: ScoreCategory;
  signal: string;
  impact: number;        // -10 to +10
  confidence: number;    // 0 to 1
  evidence?: string;
  analyzedBy: 'ai' | 'user';
  userId?: string;
  createdAt: Date;
}

export interface StartupMetric {
  id: string;
  startupId: string;
  metricName: string;
  value: number;
  unit?: string;
  reportedAt: Date;
  source: string;
  sourceId?: string;
  createdAt: Date;
}

// ==========================================
// Pitch Deck
// ==========================================

export interface PitchDeck {
  id: string;
  startupId: string;
  fileUrl: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  extractedText?: string;
  extractedData?: DeckExtractedData;
  aiAnalysis?: DeckAnalysis;
  uploadedBy: string;
  uploadedAt: Date;
}

export interface DeckExtractedData {
  companyName?: string;
  tagline?: string;
  problem?: string;
  solution?: string;
  market?: {
    tam?: number;
    sam?: number;
    som?: number;
    description?: string;
  };
  businessModel?: string;
  traction?: {
    revenue?: number;
    users?: number;
    growth?: string;
    customers?: string[];
  };
  team?: Founder[];
  competition?: string[];
  funding?: {
    asking?: number;
    valuation?: number;
    instrument?: string;
    useOfFunds?: string[];
  };
  timeline?: string;
}

export interface DeckAnalysis {
  score: number;
  breakdown: ScoreBreakdown;
  strengths: string[];
  weaknesses: string[];
  questions: string[];
  summary: string;
}

// ==========================================
// Email Integration
// ==========================================

export type EmailMatchType = 'confirmed' | 'domain' | 'inferred' | 'pending';
export type EmailDirection = 'inbound' | 'outbound';

export interface StartupContact {
  id: string;
  startupId: string;
  email: string;
  name?: string;
  role?: string;
  matchType: EmailMatchType;
  confirmedBy?: string;
  confirmedAt?: Date;
  createdAt: Date;
}

export interface Email {
  id: string;
  organizationId: string;
  startupId?: string;
  userId: string;
  outlookId: string;
  conversationId?: string;
  subject: string;
  fromAddress: string;
  fromName?: string;
  toAddresses: string[];
  ccAddresses?: string[];
  bodyPreview: string;
  bodyHtml?: string;
  receivedAt: Date;
  direction: EmailDirection;
  matchConfidence: number;
  hasAttachments: boolean;
  isRead: boolean;
  syncedAt: Date;
}

export interface EmailAnalysis {
  emailId: string;
  signals: EmailSignal[];
  sentiment: 'positive' | 'neutral' | 'negative';
  topics: string[];
  actionItems: string[];
  metricsExtracted: ExtractedMetric[];
  summary: string;
}

export interface EmailSignal {
  type: SignalType;
  description: string;
  impact: number;
  confidence: number;
  quote: string;
}

export type SignalType =
  // Positive
  | 'traction_growth'
  | 'revenue_update'
  | 'customer_win'
  | 'partnership_announced'
  | 'team_hire'
  | 'product_milestone'
  | 'fundraising_momentum'
  | 'quick_response'
  | 'proactive_update'
  | 'transparent_communication'
  | 'detailed_metrics'
  // Negative
  | 'metric_inconsistency'
  | 'missed_deadline'
  | 'evasive_answer'
  | 'slow_response'
  | 'team_departure'
  | 'pivot_announced'
  | 'runway_concern'
  | 'legal_issue'
  | 'customer_churn';

export interface ExtractedMetric {
  metric: string;
  value: number;
  previousValue?: number;
  unit?: string;
  date: Date;
  source: string;
}

// ==========================================
// Communication Metrics
// ==========================================

export interface CommunicationMetrics {
  startupId: string;
  responsiveness: {
    score: number;
    avgResponseTimeHours: number;
    responseRate: number;
    totalEmailsReceived: number;
    totalEmailsRepliedTo: number;
  };
  transparency: {
    score: number;
    proactiveUpdates: number;
    metricsShared: string[];
    directAnswerRate: number;
  };
  consistency: {
    score: number;
    inconsistencies: MetricInconsistency[];
    missedDeadlines: number;
  };
  professionalism: {
    score: number;
    avgSentiment: number;
    followThroughRate: number;
  };
  lastCalculated: Date;
}

export interface MetricInconsistency {
  metric: string;
  valueBefore: number;
  valueAfter: number;
  dateBefore: Date;
  dateAfter: Date;
  severity: 'minor' | 'moderate' | 'major';
}

// ==========================================
// Investment
// ==========================================

export type InvestmentInstrument = 'safe' | 'equity' | 'convertible_note' | 'other';

export interface Investment {
  id: string;
  startupId: string;
  amount: number;
  currency: string;
  valuation?: number;
  instrument: InvestmentInstrument;
  date: Date;
  terms?: Record<string, unknown>;
  notes?: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

// ==========================================
// Activity & Notifications
// ==========================================

export interface ActivityLog {
  id: string;
  organizationId: string;
  userId: string;
  startupId?: string;
  action: string;
  details: Record<string, unknown>;
  createdAt: Date;
}

export interface ScoreAlert {
  id: string;
  organizationId: string;
  startupId: string;
  type: 'major_increase' | 'major_decrease' | 'red_flag' | 'milestone';
  previousScore: number;
  newScore: number;
  trigger: string;
  urgency: 'low' | 'medium' | 'high';
  read: boolean;
  createdAt: Date;
}

// ==========================================
// API Types
// ==========================================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
