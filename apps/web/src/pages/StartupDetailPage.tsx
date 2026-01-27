import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startupsApi, decksApi, emailsApi } from '@/services/api';
import { useDropzone } from 'react-dropzone';
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Minus,
  Upload,
  FileText,
  Mail,
  BarChart3,
  Clock,
  AlertTriangle,
  CheckCircle,
  ExternalLink,
  Loader2,
  Brain,
  Send,
  Copy,
  Building2,
  Target,
  Users,
  Lightbulb,
  HelpCircle,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  Pencil,
  Save,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import type { DealStatus, ScoreBreakdown } from '@startup-tracker/shared';

interface BusinessModelAnalysis {
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

const statusOptions: { value: DealStatus; label: string }[] = [
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'due_diligence', label: 'Due Diligence' },
  { value: 'invested', label: 'Invested' },
  { value: 'passed', label: 'Passed' },
];

const categoryLabels: Record<string, string> = {
  team: 'Team',
  market: 'Market',
  product: 'Product',
  traction: 'Traction',
  deal: 'Deal',
};

interface Email {
  id: string;
  subject: string;
  fromName: string | null;
  fromAddress: string;
  toAddresses: Array<{ email: string; name?: string }>;
  receivedAt: string;
  direction: string;
  bodyPreview: string;
  bodyHtml: string | null;
}

export default function StartupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'overview' | 'analysis' | 'deck' | 'emails' | 'events'>('analysis');
  const [copiedReply, setCopiedReply] = useState(false);
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [isEditingReply, setIsEditingReply] = useState(false);
  const [editedReply, setEditedReply] = useState('');

  const { data: startup, isLoading } = useQuery({
    queryKey: ['startup', id],
    queryFn: () => startupsApi.getById(id!),
    enabled: !!id,
  });

  const { data: decks } = useQuery({
    queryKey: ['startup-decks', id],
    queryFn: () => decksApi.getByStartup(id!),
    enabled: !!id,
  });

  const { data: scoreEvents } = useQuery({
    queryKey: ['startup-events', id],
    queryFn: () => startupsApi.getScoreEvents(id!, { limit: 20 }),
    enabled: !!id,
  });

  const { data: emails } = useQuery({
    queryKey: ['startup-emails', id],
    queryFn: () => emailsApi.getByStartup(id!, { limit: 20 }),
    enabled: !!id,
  });

  const { data: commMetrics } = useQuery({
    queryKey: ['startup-comm-metrics', id],
    queryFn: () => emailsApi.getMetrics(id!),
    enabled: !!id,
  });

  const statusMutation = useMutation({
    mutationFn: ({ status }: { status: DealStatus }) =>
      startupsApi.updateStatus(id!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      toast.success('Status updated');
    },
    onError: () => {
      toast.error('Failed to update status');
    },
  });

  const sendReplyMutation = useMutation({
    mutationFn: () => startupsApi.sendDraftReply(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      toast.success(`Email sent to ${data.to}`);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      const message = error.response?.data?.message || 'Failed to send email';
      toast.error(message);
    },
  });

  const updateReplyMutation = useMutation({
    mutationFn: (draftReply: string) => startupsApi.updateDraftReply(id!, draftReply),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      setIsEditingReply(false);
      toast.success('Draft reply updated');
    },
    onError: () => {
      toast.error('Failed to update draft reply');
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => decksApi.upload(id!, file),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      queryClient.invalidateQueries({ queryKey: ['startup-decks', id] });
      toast.success('Deck uploaded! AI analysis in progress...');
    },
    onError: () => {
      toast.error('Failed to upload deck');
    },
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    onDrop: (files) => {
      if (files.length > 0) {
        uploadMutation.mutate(files[0]!);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
      </div>
    );
  }

  if (!startup) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">Startup not found</p>
      </div>
    );
  }

  const breakdown = startup.scoreBreakdown as ScoreBreakdown | undefined;
  const latestDeck = decks?.[0];
  const businessAnalysis = startup.businessModelAnalysis as BusinessModelAnalysis | undefined;

  const copyDraftReply = () => {
    if (startup.draftReply) {
      navigator.clipboard.writeText(startup.draftReply);
      setCopiedReply(true);
      toast.success('Draft reply copied to clipboard');
      setTimeout(() => setCopiedReply(false), 2000);
    }
  };

  // Sector display helpers
  const sectorLabels: Record<string, string> = {
    fintech: 'FinTech',
    healthtech: 'HealthTech',
    saas: 'SaaS',
    ecommerce: 'E-Commerce',
    edtech: 'EdTech',
    deeptech: 'DeepTech',
    consumer: 'Consumer',
    enterprise: 'Enterprise',
    marketplace: 'Marketplace',
    climate: 'Climate',
    other: 'Other',
  };

  const stageLabels: Record<string, string> = {
    pre_seed: 'Pre-Seed',
    seed: 'Seed',
    series_a: 'Series A',
    series_b: 'Series B',
    series_c: 'Series C',
    growth: 'Growth',
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => navigate('/startups')}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center justify-center w-16 h-16 bg-primary-100 rounded-xl">
            <span className="text-2xl font-bold text-primary-600">
              {startup.name.charAt(0)}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{startup.name}</h1>
              {startup.sector && (
                <span className="badge bg-primary-100 text-primary-700">
                  {sectorLabels[startup.sector] || startup.sector}
                </span>
              )}
              {startup.stage && (
                <span className="badge bg-gray-100 text-gray-700">
                  {stageLabels[startup.stage] || startup.stage}
                </span>
              )}
            </div>
            {startup.website && (
              <a
                href={startup.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                {startup.website}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {startup.description && (
              <p className="text-gray-600 mt-1 max-w-xl">{startup.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={startup.status}
            onChange={(e) => statusMutation.mutate({ status: e.target.value as DealStatus })}
            className="input w-auto font-medium"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Score card */}
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500 mb-1">Investibility Score</p>
            <div className="flex items-center gap-2">
              <span className="text-4xl font-bold text-gray-900">
                {startup.currentScore ?? '-'}
              </span>
              <span className="text-2xl text-gray-400">/100</span>
              {startup.scoreTrend === 'up' && (
                <TrendingUp className="w-6 h-6 text-success-500" />
              )}
              {startup.scoreTrend === 'down' && (
                <TrendingDown className="w-6 h-6 text-danger-500" />
              )}
              {startup.scoreTrend === 'stable' && (
                <Minus className="w-6 h-6 text-gray-400" />
              )}
            </div>
            {startup.scoreTrendDelta !== 0 && (
              <p
                className={clsx(
                  'text-sm font-medium mt-1',
                  startup.scoreTrendDelta > 0 ? 'text-success-600' : 'text-danger-600'
                )}
              >
                {startup.scoreTrendDelta > 0 ? '+' : ''}
                {startup.scoreTrendDelta.toFixed(1)} points in the last 30 days
              </p>
            )}
          </div>

          {/* Score breakdown bars */}
          {breakdown && (
            <div className="flex-1 max-w-md ml-8">
              <div className="space-y-3">
                {(['team', 'market', 'product', 'traction', 'deal'] as const).map((key) => {
                  const category = breakdown[key];
                  const total = category.base + category.adjusted;
                  const maxScore = key === 'deal' ? 10 : key === 'product' || key === 'traction' ? 20 : 25;
                  const percentage = (total / maxScore) * 100;

                  return (
                    <div key={key} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-16">
                        {categoryLabels[key]}
                      </span>
                      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            'h-full rounded-full',
                            percentage >= 70
                              ? 'bg-success-500'
                              : percentage >= 50
                              ? 'bg-warning-500'
                              : 'bg-danger-500'
                          )}
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm font-medium text-gray-900 w-12 text-right">
                        {total.toFixed(0)}/{maxScore}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Additional signals */}
              <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-200">
                {breakdown.communication !== 0 && (
                  <div className="flex items-center gap-1 text-sm">
                    <Mail className="w-4 h-4 text-primary-500" />
                    <span className={breakdown.communication > 0 ? 'text-success-600' : 'text-danger-600'}>
                      {breakdown.communication > 0 ? '+' : ''}{breakdown.communication.toFixed(1)} comm
                    </span>
                  </div>
                )}
                {breakdown.momentum !== 0 && (
                  <div className="flex items-center gap-1 text-sm">
                    <TrendingUp className="w-4 h-4 text-primary-500" />
                    <span className={breakdown.momentum > 0 ? 'text-success-600' : 'text-danger-600'}>
                      {breakdown.momentum > 0 ? '+' : ''}{breakdown.momentum.toFixed(1)} momentum
                    </span>
                  </div>
                )}
                {breakdown.redFlags !== 0 && (
                  <div className="flex items-center gap-1 text-sm">
                    <AlertTriangle className="w-4 h-4 text-danger-500" />
                    <span className="text-danger-600">
                      {breakdown.redFlags.toFixed(1)} red flags
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-8">
          {[
            { id: 'overview', label: 'Overview', icon: BarChart3 },
            { id: 'analysis', label: 'Analysis & Reply', icon: Brain },
            { id: 'deck', label: 'Documents', icon: FileText },
            { id: 'emails', label: 'Emails', icon: Mail },
            { id: 'events', label: 'Score Events', icon: Clock },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={clsx(
                'flex items-center gap-2 px-1 py-3 text-sm font-medium border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              )}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Communication metrics */}
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Communication Health</h3>
            {commMetrics?.totalEmails > 0 ? (
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Response Time</span>
                    <span className="font-medium">
                      {commMetrics.avgResponseTimeHours?.toFixed(1) ?? '-'} hours avg
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full',
                        (commMetrics.avgResponseTimeHours ?? 99) < 12
                          ? 'bg-success-500'
                          : (commMetrics.avgResponseTimeHours ?? 99) < 48
                          ? 'bg-warning-500'
                          : 'bg-danger-500'
                      )}
                      style={{
                        width: `${Math.max(0, 100 - (commMetrics.avgResponseTimeHours ?? 0) * 2)}%`,
                      }}
                    />
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600">Response Rate</span>
                    <span className="font-medium">
                      {((commMetrics.responseRate ?? 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary-500 rounded-full"
                      style={{ width: `${(commMetrics.responseRate ?? 0) * 100}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-sm pt-2 border-t border-gray-200">
                  <span className="text-gray-600">Total Emails</span>
                  <span className="font-medium">{commMetrics.totalEmails}</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Proactive Updates</span>
                  <span className="font-medium">{commMetrics.proactiveUpdates}</span>
                </div>
              </div>
            ) : (
              <p className="text-gray-500">No email data yet. Connect Gmail to track communications.</p>
            )}
          </div>

          {/* Recent activity */}
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Recent Score Changes</h3>
            {(scoreEvents?.events?.length ?? 0) > 0 ? (
              <div className="space-y-3">
                {scoreEvents?.events.slice(0, 5).map((event: {
                  id: string;
                  timestamp: string;
                  signal: string;
                  impact: number;
                  category: string;
                }) => (
                  <div key={event.id} className="flex items-start gap-3">
                    <div
                      className={clsx(
                        'mt-1 w-5 h-5 rounded-full flex items-center justify-center',
                        event.impact > 0 ? 'bg-success-100' : 'bg-danger-100'
                      )}
                    >
                      {event.impact > 0 ? (
                        <CheckCircle className="w-3 h-3 text-success-600" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 text-danger-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900 truncate">{event.signal}</p>
                      <p className="text-xs text-gray-500">
                        {format(new Date(event.timestamp), 'MMM d, yyyy')} · {event.category}
                      </p>
                    </div>
                    <span
                      className={clsx(
                        'text-sm font-medium',
                        event.impact > 0 ? 'text-success-600' : 'text-danger-600'
                      )}
                    >
                      {event.impact > 0 ? '+' : ''}{event.impact.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-500">No score events yet.</p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'analysis' && (
        <div className="space-y-6">
          {businessAnalysis ? (
            <>
              {/* Business Model Overview */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Business Model Type */}
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="w-5 h-5 text-primary-600" />
                    <h3 className="font-semibold text-gray-900">Business Model</h3>
                  </div>
                  <p className="text-lg font-medium text-gray-800 capitalize mb-2">
                    {businessAnalysis.businessModel.type.replace(/_/g, ' ')}
                  </p>
                  <p className="text-sm text-gray-600">{businessAnalysis.businessModel.valueProposition}</p>

                  <div className="mt-4 pt-4 border-t border-gray-200">
                    <p className="text-xs font-medium text-gray-500 mb-2">Revenue Streams</p>
                    <div className="flex flex-wrap gap-1">
                      {businessAnalysis.businessModel.revenueStreams.map((stream, i) => (
                        <span key={i} className="badge bg-gray-100 text-gray-600 text-xs">{stream}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Target Market */}
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="w-5 h-5 text-primary-600" />
                    <h3 className="font-semibold text-gray-900">Market Analysis</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-gray-500">Market Size</p>
                      <p className="text-sm text-gray-800">{businessAnalysis.marketAnalysis.marketSize}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">Competition</p>
                      <p className="text-sm text-gray-800">{businessAnalysis.marketAnalysis.competition}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">Why Now?</p>
                      <p className="text-sm text-gray-800">{businessAnalysis.marketAnalysis.timing}</p>
                    </div>
                  </div>
                </div>

                {/* Customer Segments */}
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Users className="w-5 h-5 text-primary-600" />
                    <h3 className="font-semibold text-gray-900">Customer Segments</h3>
                  </div>
                  <ul className="space-y-2">
                    {businessAnalysis.businessModel.customerSegments.map((segment, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-700">
                        <span className="text-primary-500 mt-1">•</span>
                        {segment}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Strengths & Concerns */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Lightbulb className="w-5 h-5 text-success-600" />
                    <h3 className="font-semibold text-gray-900">Strengths</h3>
                  </div>
                  <ul className="space-y-3">
                    {businessAnalysis.strengths.map((strength, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-success-500 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{strength}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="card p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="w-5 h-5 text-warning-600" />
                    <h3 className="font-semibold text-gray-900">Concerns / Questions</h3>
                  </div>
                  <ul className="space-y-3">
                    {businessAnalysis.concerns.map((concern, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <HelpCircle className="w-4 h-4 text-warning-500 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{concern}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Key Questions */}
              <div className="card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <HelpCircle className="w-5 h-5 text-primary-600" />
                  <h3 className="font-semibold text-gray-900">Key Questions to Ask</h3>
                </div>
                <ol className="space-y-2">
                  {businessAnalysis.keyQuestions.map((question, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-medium">
                        {i + 1}
                      </span>
                      <span className="text-gray-700 pt-0.5">{question}</span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Stage Assessment */}
              {businessAnalysis.stageReasoning && (
                <div className="card p-5 bg-gray-50">
                  <h3 className="font-semibold text-gray-900 mb-2">Stage Assessment</h3>
                  <p className="text-sm text-gray-700">{businessAnalysis.stageReasoning}</p>
                </div>
              )}
            </>
          ) : (
            <div className="card p-12 text-center">
              <Brain className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No business model analysis available.</p>
              <p className="text-sm text-gray-500 mt-1">Analysis is automatically generated when startups are added from email proposals.</p>
            </div>
          )}

          {/* Draft Reply Section */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Send className="w-5 h-5 text-primary-600" />
                <h3 className="font-semibold text-gray-900">Draft Reply to Founder</h3>
              </div>
              {startup.draftReply && !isEditingReply && (
                <div className="flex items-center gap-2">
                  <span className={clsx(
                    'badge text-xs',
                    startup.draftReplyStatus === 'sent' ? 'bg-success-100 text-success-700' :
                    startup.draftReplyStatus === 'approved' ? 'bg-primary-100 text-primary-700' :
                    'bg-warning-100 text-warning-700'
                  )}>
                    {startup.draftReplyStatus === 'sent' ? 'Sent' :
                     startup.draftReplyStatus === 'approved' ? 'Approved' : 'Pending Review'}
                  </span>
                  {startup.draftReplyStatus !== 'sent' && (
                    <button
                      onClick={() => {
                        setEditedReply(startup.draftReply || '');
                        setIsEditingReply(true);
                      }}
                      className="btn btn-secondary btn-sm flex items-center gap-1"
                    >
                      <Pencil className="w-4 h-4" />
                      Edit
                    </button>
                  )}
                  <button
                    onClick={copyDraftReply}
                    className="btn btn-secondary btn-sm flex items-center gap-1"
                  >
                    <Copy className="w-4 h-4" />
                    {copiedReply ? 'Copied!' : 'Copy'}
                  </button>
                  {startup.draftReplyStatus !== 'sent' && (
                    <button
                      onClick={() => sendReplyMutation.mutate()}
                      disabled={sendReplyMutation.isPending}
                      className="btn btn-primary btn-sm flex items-center gap-1"
                    >
                      {sendReplyMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Send className="w-4 h-4" />
                      )}
                      {sendReplyMutation.isPending ? 'Sending...' : 'Send Email'}
                    </button>
                  )}
                </div>
              )}
              {isEditingReply && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setIsEditingReply(false)}
                    className="btn btn-secondary btn-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => updateReplyMutation.mutate(editedReply)}
                    disabled={updateReplyMutation.isPending}
                    className="btn btn-primary btn-sm flex items-center gap-1"
                  >
                    {updateReplyMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Save className="w-4 h-4" />
                    )}
                    {updateReplyMutation.isPending ? 'Saving...' : 'Save'}
                  </button>
                </div>
              )}
            </div>

            {startup.draftReply || isEditingReply ? (
              isEditingReply ? (
                <textarea
                  value={editedReply}
                  onChange={(e) => setEditedReply(e.target.value)}
                  className="w-full h-64 p-4 font-mono text-sm text-gray-700 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y"
                  placeholder="Write your reply here..."
                />
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 font-mono text-sm text-gray-700 whitespace-pre-wrap">
                  {startup.draftReply}
                </div>
              )
            ) : (
              <div className="text-center py-8">
                <Mail className="w-10 h-10 mx-auto text-gray-400 mb-3" />
                <p className="text-gray-500">No draft reply generated.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'deck' && (
        <div className="space-y-6">
          {/* Document list */}
          {decks && decks.length > 0 && (
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Uploaded Documents</h3>
              <div className="space-y-3">
                {decks.map((deck: { id: string; fileName: string; fileSize: number; createdAt: string; aiAnalysis?: { score?: number } }) => (
                  <div key={deck.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <FileText className="w-8 h-8 text-primary-600" />
                      <div>
                        <p className="font-medium text-gray-900">{deck.fileName}</p>
                        <p className="text-sm text-gray-500">
                          {(deck.fileSize / 1024).toFixed(1)} KB · Uploaded {format(new Date(deck.createdAt), 'MMM d, yyyy')}
                        </p>
                      </div>
                    </div>
                    {deck.aiAnalysis?.score !== undefined && (
                      <div className="text-right">
                        <span className="text-lg font-bold text-primary-600">{deck.aiAnalysis.score}</span>
                        <span className="text-sm text-gray-500">/100</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upload area */}
          <div
            {...getRootProps()}
            className={clsx(
              'card border-2 border-dashed p-8 text-center cursor-pointer transition-colors',
              isDragActive
                ? 'border-primary-500 bg-primary-50'
                : 'border-gray-300 hover:border-primary-400'
            )}
          >
            <input {...getInputProps()} />
            {uploadMutation.isPending ? (
              <>
                <Loader2 className="w-10 h-10 mx-auto text-primary-600 animate-spin mb-3" />
                <p className="text-gray-900 font-medium">Uploading and analyzing...</p>
              </>
            ) : (
              <>
                <Upload className="w-10 h-10 mx-auto text-gray-400 mb-3" />
                <p className="text-gray-900 font-medium">
                  {isDragActive ? 'Drop the PDF here' : 'Upload a document'}
                </p>
                <p className="text-sm text-gray-500 mt-1">Drag & drop or click to browse (PDF)</p>
              </>
            )}
          </div>

          {/* Latest deck analysis */}
          {latestDeck?.aiAnalysis && !latestDeck.aiAnalysis.error && (
            <div className="card p-6">
              <h3 className="font-semibold text-gray-900 mb-4">AI Analysis</h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Strengths */}
                <div>
                  <h4 className="text-sm font-medium text-success-700 mb-2">Strengths</h4>
                  <ul className="space-y-2">
                    {latestDeck.aiAnalysis.strengths?.map((s: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <CheckCircle className="w-4 h-4 text-success-500 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{s}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Weaknesses */}
                <div>
                  <h4 className="text-sm font-medium text-danger-700 mb-2">Areas of Concern</h4>
                  <ul className="space-y-2">
                    {latestDeck.aiAnalysis.weaknesses?.map((w: string, i: number) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <AlertTriangle className="w-4 h-4 text-danger-500 mt-0.5 flex-shrink-0" />
                        <span className="text-gray-700">{w}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Questions */}
              {latestDeck.aiAnalysis.questions?.length > 0 && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Questions to Ask</h4>
                  <ul className="space-y-2">
                    {latestDeck.aiAnalysis.questions.map((q: string, i: number) => (
                      <li key={i} className="text-sm text-gray-700">
                        {i + 1}. {q}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Summary */}
              {latestDeck.aiAnalysis.summary && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-sm font-medium text-gray-900 mb-2">Summary</h4>
                  <p className="text-gray-700">{latestDeck.aiAnalysis.summary}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'emails' && (
        <>
          <div className="card">
            {(emails?.data?.length ?? 0) > 0 ? (
              <div className="divide-y divide-gray-200">
                {emails?.data.map((email: Email) => (
                  <div
                    key={email.id}
                    className="p-4 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => setSelectedEmail(email)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <div className={clsx(
                          'mt-1 w-8 h-8 rounded-full flex items-center justify-center',
                          email.direction === 'inbound' ? 'bg-primary-100' : 'bg-success-100'
                        )}>
                          {email.direction === 'inbound' ? (
                            <ArrowDownLeft className="w-4 h-4 text-primary-600" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4 text-success-600" />
                          )}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{email.subject}</p>
                          <p className="text-sm text-gray-500">
                            {email.direction === 'inbound' ? 'From' : 'To'}:{' '}
                            {email.direction === 'inbound'
                              ? (email.fromName ?? email.fromAddress)
                              : (email.toAddresses?.[0]?.email ?? email.fromAddress)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={clsx(
                          'badge text-xs mb-1',
                          email.direction === 'inbound' ? 'bg-primary-100 text-primary-700' : 'bg-success-100 text-success-700'
                        )}>
                          {email.direction === 'inbound' ? 'Received' : 'Sent'}
                        </span>
                        <p className="text-sm text-gray-500">
                          {format(new Date(email.receivedAt), 'MMM d, yyyy h:mm a')}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 ml-11 line-clamp-2">{email.bodyPreview}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <Mail className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600">No emails synced yet.</p>
                <p className="text-sm text-gray-500 mt-1">Connect your email in Settings to sync communications.</p>
              </div>
            )}
          </div>

          {/* Email Detail Modal */}
          {selectedEmail && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] flex flex-col">
                {/* Modal Header */}
                <div className="flex items-start justify-between p-5 border-b border-gray-200">
                  <div className="flex-1 pr-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={clsx(
                        'badge text-xs',
                        selectedEmail.direction === 'inbound' ? 'bg-primary-100 text-primary-700' : 'bg-success-100 text-success-700'
                      )}>
                        {selectedEmail.direction === 'inbound' ? 'Received' : 'Sent'}
                      </span>
                      <span className="text-sm text-gray-500">
                        {format(new Date(selectedEmail.receivedAt), 'MMMM d, yyyy \'at\' h:mm a')}
                      </span>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900">{selectedEmail.subject}</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      {selectedEmail.direction === 'inbound' ? (
                        <>
                          <span className="font-medium">From:</span>{' '}
                          {selectedEmail.fromName ? `${selectedEmail.fromName} <${selectedEmail.fromAddress}>` : selectedEmail.fromAddress}
                        </>
                      ) : (
                        <>
                          <span className="font-medium">From:</span> {selectedEmail.fromName ?? 'Agent Jarvis'} &lt;{selectedEmail.fromAddress}&gt;
                          <br />
                          <span className="font-medium">To:</span>{' '}
                          {selectedEmail.toAddresses?.[0]?.email ?? 'Unknown recipient'}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedEmail(null)}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto p-5">
                  {selectedEmail.bodyHtml ? (
                    <div
                      className="prose prose-sm max-w-none"
                      dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }}
                    />
                  ) : (
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedEmail.bodyPreview}</p>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="flex justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                  <button
                    onClick={() => setSelectedEmail(null)}
                    className="btn btn-secondary"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'events' && (
        <div className="card">
          {(scoreEvents?.events?.length ?? 0) > 0 ? (
            <div className="divide-y divide-gray-200">
              {scoreEvents?.events.map((event: {
                id: string;
                timestamp: string;
                signal: string;
                impact: number;
                category: string;
                source: string;
                evidence: string;
                confidence: number;
              }) => (
                <div key={event.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3">
                      <div
                        className={clsx(
                          'mt-1 w-8 h-8 rounded-full flex items-center justify-center',
                          event.impact > 0 ? 'bg-success-100' : 'bg-danger-100'
                        )}
                      >
                        {event.impact > 0 ? (
                          <TrendingUp className="w-4 h-4 text-success-600" />
                        ) : (
                          <TrendingDown className="w-4 h-4 text-danger-600" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{event.signal}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="badge bg-gray-100 text-gray-600">{event.category}</span>
                          <span className="text-sm text-gray-500">via {event.source}</span>
                        </div>
                        {event.evidence && (
                          <p className="text-sm text-gray-500 mt-2 italic">"{event.evidence}"</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <span
                        className={clsx(
                          'text-lg font-bold',
                          event.impact > 0 ? 'text-success-600' : 'text-danger-600'
                        )}
                      >
                        {event.impact > 0 ? '+' : ''}{event.impact.toFixed(1)}
                      </span>
                      <p className="text-xs text-gray-500">
                        {(event.confidence * 100).toFixed(0)}% confidence
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {format(new Date(event.timestamp), 'MMM d, yyyy h:mm a')}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-12 text-center">
              <Clock className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No score events yet.</p>
              <p className="text-sm text-gray-500 mt-1">
                Upload a deck or sync emails to start tracking signals.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
