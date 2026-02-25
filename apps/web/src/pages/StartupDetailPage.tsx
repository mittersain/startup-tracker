import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startupsApi, decksApi, emailsApi, commentsApi, invitesApi, usersApi } from '@/services/api';
import { useAuthStore } from '@/stores/auth.store';
import { useDropzone } from 'react-dropzone';
import DOMPurify from 'isomorphic-dompurify';
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
  Building2,
  Target,
  Users,
  Lightbulb,
  HelpCircle,
  X,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  PauseCircle,
  XCircle,
  Calendar,
  MessageSquare,
  Trash2,
  Bot,
  User,
  Globe,
  Newspaper,
  Database,
  Link,
  Sparkles,
  TrendingUp as TrendUp,
  FileDown,
  Copy,
  Share2,
  Activity,
  Info,
  FileSearch,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { format } from 'date-fns';
import type { DealStatus, ScoreBreakdown } from '@startup-tracker/shared';
import { ScoreTimelineChart } from '@/components/ScoreTimelineChart';

/** Safely parse dates that may be ISO strings, Firestore Timestamps ({_seconds}), or Date objects */
function safeParseDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'number') {
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
  }
  // Firestore Timestamp object { _seconds, _nanoseconds } or { seconds, nanoseconds }
  if (typeof value === 'object' && value !== null) {
    const obj = value as Record<string, unknown>;
    const seconds = (obj._seconds ?? obj.seconds) as number | undefined;
    if (typeof seconds === 'number') {
      return new Date(seconds * 1000);
    }
    // Has toDate() method (Firestore Timestamp)
    if ('toDate' in obj && typeof obj.toDate === 'function') {
      return obj.toDate() as Date;
    }
  }
  return null;
}

/** Format a date safely — returns fallback string if date is invalid */
function safeFormat(value: unknown, formatStr: string, fallback = 'Unknown date'): string {
  const d = safeParseDate(value);
  if (!d) return fallback;
  try {
    return format(d, formatStr);
  } catch {
    return fallback;
  }
}

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
  { value: 'snoozed', label: 'Snoozed' },
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
  body: string;
}

export default function StartupDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'evaluate' | 'research' | 'docs' | 'emails' | 'notes'>('evaluate');
  const [gpNotes, setGpNotes] = useState<string>('');
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [isComposingEmail, setIsComposingEmail] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [replyToEmail, setReplyToEmail] = useState<Email | null>(null);
  const [analyzingDeckId, setAnalyzingDeckId] = useState<string | null>(null);
  const [analyzingDeckName, setAnalyzingDeckName] = useState<string | null>(null);

  // Snooze/Pass modal state
  const [decisionModalType, setDecisionModalType] = useState<'snooze' | 'pass' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [snoozeMonths, setSnoozeMonths] = useState(3);
  const [draftDecisionEmail, setDraftDecisionEmail] = useState('');
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [showEmailPreview, setShowEmailPreview] = useState(false);

  // AI Chat state
  const [chatMessage, setChatMessage] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ id: string; role: 'user' | 'assistant'; content: string; createdAt: string }>>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);

  // Investment Memo state
  const [showMemo, setShowMemo] = useState(false);
  const [memoContent, setMemoContent] = useState<string | null>(null);
  const [isGeneratingMemo, setIsGeneratingMemo] = useState(false);

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

  const { data: scoreHistory } = useQuery({
    queryKey: ['startup-score-history', id],
    queryFn: () => startupsApi.getScoreHistory(id!, 90),
    enabled: !!id,
  });

  const { data: emails } = useQuery({
    queryKey: ['startup-emails', id],
    queryFn: () => emailsApi.getByStartup(id!, { limit: 20 }),
    enabled: !!id,
  });

  // commMetrics kept for future use (Communication Health removed from UI per Phase 1.1 plan)
  const { data: _commMetrics } = useQuery({
    queryKey: ['startup-comm-metrics', id],
    queryFn: () => emailsApi.getMetrics(id!),
    enabled: !!id,
  });

  const { data: analysisHistory } = useQuery({
    queryKey: ['startup-analysis-history', id],
    queryFn: () => startupsApi.getAnalysisHistory(id!),
    enabled: !!id,
  });

  // Fetch chat history
  const { data: chatHistory } = useQuery({
    queryKey: ['startup-chat', id],
    queryFn: () => startupsApi.getChatHistory(id!),
    enabled: !!id,
  });

  // Fetch enrichment data (poll every 5s while in progress)
  const { data: enrichment, isLoading: isEnrichmentLoading } = useQuery({
    queryKey: ['startup-enrichment', id],
    queryFn: () => startupsApi.getEnrichment(id!),
    enabled: !!id,
    refetchInterval: (query) => {
      // Poll every 5 seconds while enrichment is in progress
      const data = query.state.data as { status?: string } | undefined;
      return data?.status === 'in_progress' ? 5000 : false;
    },
  });

  // Fetch comments for team discussion
  const { data: commentsData } = useQuery({
    queryKey: ['startup-comments', id],
    queryFn: () => commentsApi.getByStartup(id!),
    enabled: !!id,
  });

  // Fetch team members for @mentions
  const { data: teamData } = useQuery({
    queryKey: ['team-users'],
    queryFn: () => usersApi.listForMentions(),
  });

  // Fetch invites for this deal
  const { data: invitesData } = useQuery({
    queryKey: ['startup-invites', id],
    queryFn: () => invitesApi.getByStartup(id!),
    enabled: !!id,
  });

  // Mark response as read mutation
  const markResponseReadMutation = useMutation({
    mutationFn: () => startupsApi.markResponseRead(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      queryClient.invalidateQueries({ queryKey: ['startups'] });
    },
  });

  // Auto-mark response as read when viewing a startup with new response
  useEffect(() => {
    if (startup?.hasNewResponse && id) {
      markResponseReadMutation.mutate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startup?.hasNewResponse, id]);

  // Update chat messages when history loads
  useEffect(() => {
    if (chatHistory?.messages) {
      setChatMessages(chatHistory.messages);
    }
  }, [chatHistory]);

  // Sync GP notes from startup data
  useEffect(() => {
    if (startup?.gpNotes !== undefined) {
      setGpNotes(startup.gpNotes || '');
    }
  }, [startup?.gpNotes]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Send chat message mutation
  const sendChatMutation = useMutation({
    mutationFn: (message: string) => startupsApi.sendChatMessage(id!, message),
    onSuccess: (data) => {
      setChatMessages(prev => [...prev, data.userMessage, data.aiMessage]);
      setChatMessage('');
      setIsChatLoading(false);
    },
    onError: () => {
      setIsChatLoading(false);
      toast.error('Failed to send message');
    },
  });

  // Clear chat mutation
  const clearChatMutation = useMutation({
    mutationFn: () => startupsApi.clearChatHistory(id!),
    onSuccess: () => {
      setChatMessages([]);
      queryClient.invalidateQueries({ queryKey: ['startup-chat', id] });
      toast.success('Chat history cleared');
    },
    onError: () => {
      toast.error('Failed to clear chat history');
    },
  });

  // Trigger enrichment mutation
  const triggerEnrichmentMutation = useMutation({
    mutationFn: () => startupsApi.triggerEnrichment(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-enrichment', id] });
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      toast.success('Enrichment started! Data will update shortly.');
    },
    onError: () => {
      toast.error('Failed to start enrichment');
    },
  });

  const handleSendChat = () => {
    if (!chatMessage.trim() || isChatLoading) return;
    setIsChatLoading(true);
    sendChatMutation.mutate(chatMessage.trim());
  };

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

  const generateScoreEventsMutation = useMutation({
    mutationFn: () => startupsApi.generateScoreEvents(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['startup-events', id] });
      toast.success(`Generated ${data.eventsCreated} score events!`);
    },
    onError: () => {
      toast.error('Failed to generate score events');
    },
  });

  const reprocessDeckMutation = useMutation({
    mutationFn: (deckId: string) => decksApi.reprocess(deckId),
    onSuccess: () => {
      setAnalyzingDeckId(null);
      setAnalyzingDeckName(null);
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      queryClient.invalidateQueries({ queryKey: ['startup-decks', id] });
      toast.success('AI analysis complete!');
    },
    onError: () => {
      setAnalyzingDeckId(null);
      setAnalyzingDeckName(null);
      toast.error('Failed to analyze document');
    },
  });

  const rescanAttachmentsMutation = useMutation({
    mutationFn: () => startupsApi.rescanAttachments(id!),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      queryClient.invalidateQueries({ queryKey: ['startup-decks', id] });
      if (data.attachmentsFound > 0) {
        toast.success(`Found ${data.attachmentsFound} attachment(s) from ${data.emailsScanned || 1} email(s)!`);
      } else {
        toast(data.message || `No new attachments found in ${data.emailsScanned || 1} email(s)`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to rescan attachments');
    },
  });

  const composeEmailMutation = useMutation({
    mutationFn: (data: { subject: string; body: string; replyToEmailId?: string }) =>
      emailsApi.compose(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-emails', id] });
      queryClient.invalidateQueries({ queryKey: ['startup-comm-metrics', id] });
      setIsComposingEmail(false);
      setComposeSubject('');
      setComposeBody('');
      setReplyToEmail(null);
      setReplyRecommendation(null);
      toast.success('Email sent and recorded');
    },
    onError: () => {
      toast.error('Failed to send email');
    },
  });

  // Generate AI reply mutation (also analyzes the email)
  const [replyRecommendation, setReplyRecommendation] = useState<{
    recommendation: 'continue' | 'pass' | 'schedule_call';
    recommendationReason: string;
    suggestedQuestions: string[];
    responseQuality?: {
      score: number;
      concerns: string[];
      positives: string[];
    };
  } | null>(null);

  const generateReplyMutation = useMutation({
    mutationFn: (emailId: string) => emailsApi.generateReply(emailId),
    onSuccess: (data) => {
      setComposeBody(data.draftReply);
      setReplyRecommendation({
        recommendation: data.recommendation,
        recommendationReason: data.recommendationReason,
        suggestedQuestions: data.suggestedQuestions,
        responseQuality: data.responseQuality,
      });
    },
    onError: () => {
      toast.error('Failed to generate AI reply. You can still compose manually.');
    },
  });

  // Comments state and mutations
  const [newComment, setNewComment] = useState('');
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteAccessLevel, setInviteAccessLevel] = useState<'view' | 'comment'>('comment');

  const addCommentMutation = useMutation({
    mutationFn: (data: { content: string; parentId?: string; mentions?: string[] }) =>
      commentsApi.add(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-comments', id] });
      setNewComment('');
      setReplyingTo(null);
      toast.success('Comment added');
    },
    onError: () => {
      toast.error('Failed to add comment');
    },
  });

  const updateCommentMutation = useMutation({
    mutationFn: ({ commentId, content }: { commentId: string; content: string }) =>
      commentsApi.update(commentId, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-comments', id] });
      setEditingComment(null);
      setEditContent('');
      toast.success('Comment updated');
    },
    onError: () => {
      toast.error('Failed to update comment');
    },
  });

  const deleteCommentMutation = useMutation({
    mutationFn: (commentId: string) => commentsApi.delete(commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-comments', id] });
      toast.success('Comment deleted');
    },
    onError: () => {
      toast.error('Failed to delete comment');
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: (data: { email: string; accessLevel: 'view' | 'comment' }) =>
      invitesApi.send(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-invites', id] });
      setShowInviteModal(false);
      setInviteEmail('');
      toast.success('Invite sent!');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send invite');
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => invitesApi.revoke(id!, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup-invites', id] });
      toast.success('Invite revoked');
    },
    onError: () => {
      toast.error('Failed to revoke invite');
    },
  });

  // GP Notes mutation — saves to startup.gpNotes via PATCH
  const saveGpNotesMutation = useMutation({
    mutationFn: (notes: string) => startupsApi.update(id!, { gpNotes: notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
    },
    onError: () => {
      toast.error('Failed to save notes');
    },
  });

  // Snooze mutation - generates AI email and schedules follow-up
  const snoozeMutation = useMutation({
    mutationFn: ({ reason, followUpMonths }: { reason: string; followUpMonths: number }) =>
      startupsApi.snooze(id!, reason, followUpMonths),
    onSuccess: (data) => {
      setIsGeneratingEmail(false);
      setDraftDecisionEmail(data.draftEmail);
      setShowEmailPreview(true);
      toast.success(data.message);
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      setIsGeneratingEmail(false);
      const message = error.response?.data?.message || 'Failed to snooze deal';
      toast.error(message);
    },
  });

  // Pass mutation - generates AI rejection email
  const passMutation = useMutation({
    mutationFn: (reason: string) => startupsApi.pass(id!, reason),
    onSuccess: (data) => {
      setIsGeneratingEmail(false);
      setDraftDecisionEmail(data.draftEmail);
      setShowEmailPreview(true);
      toast.success('Deal marked as passed. Review and send the email.');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      setIsGeneratingEmail(false);
      const message = error.response?.data?.message || 'Failed to pass on deal';
      toast.error(message);
    },
  });

  // Send decision email mutation
  const sendDecisionEmailMutation = useMutation({
    mutationFn: ({ emailBody, emailSubject }: { emailBody: string; emailSubject?: string }) =>
      startupsApi.sendDecisionEmail(id!, emailBody, emailSubject),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startup', id] });
      queryClient.invalidateQueries({ queryKey: ['startup-emails', id] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      setShowEmailPreview(false);
      setDecisionModalType(null);
      setDecisionReason('');
      setDraftDecisionEmail('');
      toast.success('Email sent successfully');
    },
    onError: (error: Error & { response?: { data?: { message?: string } } }) => {
      const message = error.response?.data?.message || 'Failed to send email';
      toast.error(message);
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
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-start gap-3 sm:gap-4">
          <button
            onClick={() => navigate('/startups')}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 min-h-[44px] min-w-[44px] flex items-center justify-center flex-shrink-0"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center justify-center w-12 sm:w-16 h-12 sm:h-16 bg-primary-100 rounded-xl flex-shrink-0">
            <span className="text-xl sm:text-2xl font-bold text-primary-600">
              {startup.name.charAt(0)}
            </span>
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 sm:gap-3">
              <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate">{startup.name}</h1>
              {startup.sector && (
                <span className="badge bg-primary-100 text-primary-700 text-xs">
                  {sectorLabels[startup.sector] || startup.sector}
                </span>
              )}
              {startup.stage && (
                <span className="badge bg-gray-100 text-gray-700 text-xs">
                  {stageLabels[startup.stage] || startup.stage}
                </span>
              )}
            </div>
            {startup.website && (
              <a
                href={startup.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 truncate"
              >
                <span className="truncate">{startup.website}</span>
                <ExternalLink className="w-3 h-3 flex-shrink-0" />
              </a>
            )}
            {startup.description && (
              <p className="text-sm sm:text-base text-gray-600 mt-1 line-clamp-2 sm:line-clamp-none">{startup.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 ml-auto sm:ml-0">
          <select
            value={startup.status}
            onChange={(e) => statusMutation.mutate({ status: e.target.value as DealStatus })}
            className="input w-auto font-medium min-h-[44px]"
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Awaiting Response Banner */}
      {startup.isAwaitingResponse && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                <Clock className="w-5 h-5 text-amber-600" />
              </div>
              <div>
                <h3 className="font-medium text-amber-800">No Response Received</h3>
                <p className="text-sm text-amber-700">
                  {startup.daysSinceOutreach} day{startup.daysSinceOutreach !== 1 ? 's' : ''} since last outreach with no response
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 ml-13 sm:ml-0">
              <button
                onClick={() => {
                  setDecisionModalType('snooze');
                  setDecisionReason('No response to outreach');
                  setSnoozeMonths(3);
                  setDraftDecisionEmail('');
                  setShowEmailPreview(false);
                }}
                className="px-3 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors text-sm font-medium flex items-center gap-1"
              >
                <PauseCircle className="w-4 h-4" />
                Snooze
              </button>
              <button
                onClick={() => {
                  setDecisionModalType('pass');
                  setDecisionReason('No response to outreach');
                  setDraftDecisionEmail('');
                  setShowEmailPreview(false);
                }}
                className="px-3 py-2 bg-amber-100 text-amber-700 rounded-lg hover:bg-amber-200 transition-colors text-sm font-medium flex items-center gap-1"
              >
                <XCircle className="w-4 h-4" />
                Pass
              </button>
              <button
                onClick={() => {
                  setActiveTab('emails' as const);
                  setIsComposingEmail(true);
                  setReplyToEmail(null);
                  setComposeSubject(`Following up - ${startup.name}`);
                  setComposeBody('');
                }}
                className="px-3 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm font-medium flex items-center gap-1"
              >
                <Send className="w-4 h-4" />
                Follow Up
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Score card */}
      <div className="card p-4 sm:p-6">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 lg:gap-0">
          <div>
            <p className="text-sm text-gray-500 mb-1">Investibility Score</p>
            <div className="flex items-center gap-2">
              <span className="text-3xl sm:text-4xl font-bold text-gray-900">
                {startup.currentScore ?? '-'}
              </span>
              <span className="text-xl sm:text-2xl text-gray-400">/100</span>
              {startup.scoreTrend === 'up' && (
                <TrendingUp className="w-5 sm:w-6 h-5 sm:h-6 text-success-500" />
              )}
              {startup.scoreTrend === 'down' && (
                <TrendingDown className="w-5 sm:w-6 h-5 sm:h-6 text-danger-500" />
              )}
              {startup.scoreTrend === 'stable' && (
                <Minus className="w-5 sm:w-6 h-5 sm:h-6 text-gray-400" />
              )}
            </div>
            {startup.scoreTrendDelta != null && startup.scoreTrendDelta !== 0 && (
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
            {(startup.firstEmailDate || startup.createdAt) && (
              <div className="flex items-center gap-2 mt-2 text-sm text-gray-500">
                <Clock className="w-4 h-4" />
                <span>
                  {(() => {
                    const startDate = safeParseDate(startup.firstEmailDate) || safeParseDate(startup.createdAt);
                    if (!startDate) return 'New in pipeline';
                    const days = Math.floor((Date.now() - startDate.getTime()) / (1000 * 60 * 60 * 24));
                    return `${days} ${days === 1 ? 'day' : 'days'} in pipeline`;
                  })()}
                </span>
              </div>
            )}
          </div>

          {/* Score breakdown bars */}
          {breakdown && (
            <div className="flex-1 max-w-md lg:ml-8">
              <div className="space-y-3">
                {(['team', 'market', 'product', 'traction', 'deal'] as const).map((key) => {
                  const category = breakdown[key];
                  if (!category) return null;  // Skip if category is undefined
                  // Score = base + adjusted (adjusted is the incremental change on top of base)
                  const total = (category.base ?? 0) + (category.adjusted ?? 0);
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

              {/* Additional signals — only show comm/momentum if non-default (not 5.0 baseline) */}
              {((breakdown.communication ?? 5) !== 5 || (breakdown.momentum ?? 5) !== 5 || (breakdown.redFlags ?? 0) !== 0) && (
                <div className="flex items-center gap-4 mt-4 pt-4 border-t border-gray-200">
                  {(breakdown.communication ?? 5) !== 5 && (
                    <div className="flex items-center gap-1 text-sm">
                      <Mail className="w-4 h-4 text-primary-500" />
                      <span className={(breakdown.communication ?? 0) > 0 ? 'text-success-600' : 'text-danger-600'}>
                        {(breakdown.communication ?? 0) > 0 ? '+' : ''}{(breakdown.communication ?? 0).toFixed(1)} comm
                      </span>
                    </div>
                  )}
                  {(breakdown.momentum ?? 5) !== 5 && (
                    <div className="flex items-center gap-1 text-sm">
                      <TrendingUp className="w-4 h-4 text-primary-500" />
                      <span className={(breakdown.momentum ?? 0) > 0 ? 'text-success-600' : 'text-danger-600'}>
                        {(breakdown.momentum ?? 0) > 0 ? '+' : ''}{(breakdown.momentum ?? 0).toFixed(1)} momentum
                      </span>
                    </div>
                  )}
                  {(breakdown.redFlags ?? 0) !== 0 && (
                    <div className="flex items-center gap-1 text-sm">
                      <AlertTriangle className="w-4 h-4 text-danger-500" />
                      <span className="text-danger-600">
                        {(breakdown.redFlags ?? 0).toFixed(1)} red flags
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Score Analysis Summary */}
        {startup.scoreBreakdown && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="flex items-start gap-3">
              <Brain className="w-5 h-5 text-primary-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900 mb-1">Score Analysis</p>
                <p className="text-sm text-gray-600">
                  {(() => {
                    const score = startup.currentScore ?? 0;
                    const breakdown = startup.scoreBreakdown as ScoreBreakdown;

                    // Identify strongest and weakest areas (with null checks)
                    // Score = base + adjusted (adjusted is incremental on top of base)
                    const categories = [
                      { name: 'Team', score: (breakdown.team?.base ?? 0) + (breakdown.team?.adjusted ?? 0), max: 25 },
                      { name: 'Market', score: (breakdown.market?.base ?? 0) + (breakdown.market?.adjusted ?? 0), max: 25 },
                      { name: 'Product', score: (breakdown.product?.base ?? 0) + (breakdown.product?.adjusted ?? 0), max: 20 },
                      { name: 'Traction', score: (breakdown.traction?.base ?? 0) + (breakdown.traction?.adjusted ?? 0), max: 20 },
                      { name: 'Deal', score: (breakdown.deal?.base ?? 0) + (breakdown.deal?.adjusted ?? 0), max: 10 },
                    ];

                    const sortedByPercentage = [...categories].sort((a, b) => (b.score / b.max) - (a.score / a.max));
                    const strongest = sortedByPercentage[0];
                    const weakest = sortedByPercentage[sortedByPercentage.length - 1];

                    // Generate summary
                    const parts: string[] = [];

                    // Overall assessment
                    if (score >= 75) {
                      parts.push(`This startup scores ${score}/100, indicating strong investment potential.`);
                    } else if (score >= 60) {
                      parts.push(`This startup scores ${score}/100, showing moderate promise with room for improvement.`);
                    } else if (score >= 45) {
                      parts.push(`This startup scores ${score}/100, suggesting it needs significant development before investment.`);
                    } else {
                      parts.push(`This startup scores ${score}/100, indicating high risk factors that require careful consideration.`);
                    }

                    // Strongest area
                    const strongestPct = Math.round((strongest.score / strongest.max) * 100);
                    parts.push(`${strongest.name} is the strongest area (${strongestPct}%)`);

                    // Weakest area if significantly lower
                    const weakestPct = Math.round((weakest.score / weakest.max) * 100);
                    if (strongestPct - weakestPct > 20) {
                      parts.push(`while ${weakest.name} needs attention (${weakestPct}%).`);
                    } else {
                      parts.push(`with balanced scores across categories.`);
                    }

                    // Communication bonus — only mention if it's meaningfully different from 5.0 baseline
                    const commVal = breakdown.communication ?? 5;
                    if (commVal !== 5 && commVal > 2) {
                      parts.push(`Strong founder communication adds +${commVal.toFixed(1)} points.`);
                    } else if (commVal !== 5 && commVal < -2) {
                      parts.push(`Poor communication responsiveness deducts ${Math.abs(commVal).toFixed(1)} points.`);
                    }

                    // Red flags (with null checks)
                    if ((breakdown.redFlags ?? 0) < -3) {
                      parts.push(`Notable red flags detected (${Math.abs(breakdown.redFlags ?? 0).toFixed(1)} point penalty).`);
                    }

                    return parts.join(' ');
                  })()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 -mx-4 sm:mx-0 px-4 sm:px-0 overflow-x-auto">
        <nav className="flex gap-4 sm:gap-8 min-w-max">
          {[
            { id: 'evaluate', label: 'Evaluate', icon: Brain },
            { id: 'research', label: 'Research', icon: Sparkles },
            { id: 'docs', label: 'Docs', icon: FileText },
            { id: 'emails', label: 'Emails', icon: Mail },
            { id: 'notes', label: 'Notes & Team', icon: MessageSquare },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={clsx(
                'flex items-center gap-1.5 sm:gap-2 px-1 py-3 text-xs sm:text-sm font-medium border-b-2 transition-colors whitespace-nowrap min-h-[44px]',
                activeTab === tab.id
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 active:text-gray-900'
              )}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden xs:inline sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'evaluate' && (
        <div className="space-y-6">

          {/* ===== PERSISTENT ANALYSIS HEADER ===== */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary-600" />
                <h3 className="font-semibold text-gray-900">Persistent Analysis</h3>
              </div>
              <div className="flex items-center gap-3">
                {analysisHistory?.lastUpdated && (
                  <div className="flex items-center gap-1.5 text-sm text-gray-500">
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Last updated: {(() => {
                      try { return format(new Date(analysisHistory.lastUpdated), 'MMM d, yyyy h:mm a'); }
                      catch { return 'N/A'; }
                    })()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Data Sources Summary */}
            {analysisHistory?.dataSources && (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <FileSearch className="w-4 h-4 text-blue-600" />
                    <span className="text-lg font-bold text-blue-700">{analysisHistory.dataSources.decks}</span>
                  </div>
                  <p className="text-xs text-blue-600 font-medium">Decks Analyzed</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Mail className="w-4 h-4 text-purple-600" />
                    <span className="text-lg font-bold text-purple-700">{analysisHistory.dataSources.emails}</span>
                  </div>
                  <p className="text-xs text-purple-600 font-medium">
                    {analysisHistory.dataSources.emails === 1 ? 'Email' : 'Emails'}{' '}
                    {analysisHistory.dataSources.emailsAnalyzed > 0
                      ? `(${analysisHistory.dataSources.emailsAnalyzed} analyzed)`
                      : ''}
                  </p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 mb-1">
                    <Globe className="w-4 h-4 text-emerald-600" />
                    <span className="text-lg font-bold text-emerald-700">{analysisHistory.dataSources.enrichment}</span>
                  </div>
                  <p className="text-xs text-emerald-600 font-medium">Research Sources</p>
                </div>
              </div>
            )}

            {/* AI Summary */}
            {analysisHistory?.aiSummary ? (
              <div className="bg-gray-50 rounded-lg p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="w-4 h-4 text-primary-500" />
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">Consolidated AI Summary</p>
                </div>
                <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed max-h-64 overflow-y-auto">
                  {analysisHistory.aiSummary}
                </pre>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <Info className="w-5 h-5 text-gray-400 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No consolidated analysis yet. Run AI analysis or add documents to build the persistent analysis.</p>
              </div>
            )}
          </div>

          {/* ===== ANALYSIS TIMELINE ===== */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-primary-600" />
              <h3 className="font-semibold text-gray-900">Analysis Timeline</h3>
              <span className="text-xs text-gray-400 ml-auto">
                {analysisHistory?.timeline?.length || 0} events
              </span>
            </div>

            {analysisHistory?.timeline && analysisHistory.timeline.length > 0 ? (
              <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-4 top-2 bottom-2 w-0.5 bg-gray-200" />

                <div className="space-y-0">
                  {analysisHistory.timeline.map((event: {
                    date: string;
                    type: string;
                    title: string;
                    details: string;
                    source: string;
                    scoreAfter?: number;
                  }, i: number) => {
                    const iconMap: Record<string, { icon: typeof Brain; color: string; bg: string }> = {
                      created: { icon: CheckCircle, color: 'text-gray-500', bg: 'bg-gray-100' },
                      deck_analysis: { icon: FileText, color: 'text-blue-600', bg: 'bg-blue-100' },
                      email_received: { icon: ArrowDownLeft, color: 'text-purple-600', bg: 'bg-purple-100' },
                      email_sent: { icon: ArrowUpRight, color: 'text-indigo-600', bg: 'bg-indigo-100' },
                      enrichment: { icon: Globe, color: 'text-emerald-600', bg: 'bg-emerald-100' },
                      score_update: { icon: Activity, color: 'text-orange-600', bg: 'bg-orange-100' },
                    };
                    const config = iconMap[event.type] || { icon: Brain, color: 'text-gray-500', bg: 'bg-gray-100' };
                    const IconComponent = config.icon;

                    return (
                      <div key={i} className="relative flex gap-4 py-3">
                        {/* Timeline dot */}
                        <div className={clsx('relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center', config.bg)}>
                          <IconComponent className={clsx('w-4 h-4', config.color)} />
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pb-3 border-b border-gray-100 last:border-0">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate">{event.title}</p>
                              <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{event.details}</p>
                            </div>
                            <div className="flex-shrink-0 text-right">
                              {event.scoreAfter !== undefined && event.scoreAfter !== null && (
                                <span className="inline-block px-2 py-0.5 text-xs font-bold rounded-full bg-primary-100 text-primary-700 mb-1">
                                  {event.scoreAfter}/100
                                </span>
                              )}
                              <p className="text-xs text-gray-400 whitespace-nowrap">
                                {(() => {
                                  try { return format(new Date(event.date), 'MMM d, yyyy'); }
                                  catch { return 'N/A'; }
                                })()}
                              </p>
                              <p className="text-xs text-gray-400">
                                {(() => {
                                  try { return format(new Date(event.date), 'h:mm a'); }
                                  catch { return ''; }
                                })()}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-center py-8">
                <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No analysis events yet.</p>
              </div>
            )}
          </div>

          {/* ===== BUSINESS MODEL ANALYSIS ===== */}
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
          ) : !analysisHistory?.aiSummary && (
            <div className="card p-12 text-center">
              <Brain className="w-12 h-12 mx-auto text-gray-400 mb-4" />
              <p className="text-gray-600">No business model analysis available.</p>
              <p className="text-sm text-gray-500 mt-1">Analysis is automatically generated when startups are added from email proposals.</p>
            </div>
          )}

          {/* Investment Memo Section */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <FileDown className="w-5 h-5 text-primary-600" />
                <h3 className="font-semibold text-gray-900">Investment Memo</h3>
              </div>
              <div className="flex items-center gap-2">
                {memoContent && (
                  <>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(memoContent);
                        toast.success('Memo copied to clipboard');
                      }}
                      className="btn btn-secondary btn-sm flex items-center gap-1"
                    >
                      <Copy className="w-4 h-4" />
                      Copy
                    </button>
                    <button
                      onClick={() => setShowMemo(!showMemo)}
                      className="btn btn-secondary btn-sm"
                    >
                      {showMemo ? 'Hide' : 'Show'}
                    </button>
                  </>
                )}
                <button
                  onClick={async () => {
                    setIsGeneratingMemo(true);
                    try {
                      const result = await startupsApi.generateMemo(id!);
                      setMemoContent(result.memo);
                      setShowMemo(true);
                      toast.success('Investment memo generated');
                    } catch (error) {
                      toast.error('Failed to generate memo');
                      console.error('Generate memo error:', error);
                    } finally {
                      setIsGeneratingMemo(false);
                    }
                  }}
                  disabled={isGeneratingMemo}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {isGeneratingMemo ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Share2 className="w-4 h-4" />
                      {memoContent ? 'Regenerate' : 'Generate Memo'}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Existing memo from startup data */}
            {!memoContent && startup.investmentMemo?.content && (
              <div className="mb-4">
                <button
                  onClick={() => {
                    setMemoContent(startup.investmentMemo.content);
                    setShowMemo(true);
                  }}
                  className="text-sm text-primary-600 hover:text-primary-700"
                >
                  Load previously generated memo {startup.investmentMemo.generatedAt ? (() => {
                    try {
                      const date = typeof startup.investmentMemo.generatedAt === 'object' && 'toDate' in startup.investmentMemo.generatedAt
                        ? startup.investmentMemo.generatedAt.toDate()
                        : new Date(startup.investmentMemo.generatedAt);
                      return `(from ${format(date, 'MMM d, yyyy')})`;
                    } catch {
                      return '';
                    }
                  })() : ''}
                </button>
              </div>
            )}

            <p className="text-sm text-gray-600 mb-4">
              Generate a professional investment memo to share with potential co-investors. The memo includes business overview, investment thesis, key metrics, and risk assessment.
            </p>

            {showMemo && memoContent && (
              <div className="mt-4 border-t border-gray-200 pt-4">
                <div className="bg-gray-50 rounded-lg p-6 prose prose-sm max-w-none">
                  <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
                    {memoContent}
                  </pre>
                </div>
              </div>
            )}
          </div>

          {/* Snooze / Pass Decision Section */}
          <div className="card p-5">
            <h3 className="font-semibold text-gray-900 mb-4">Deal Decision</h3>

            {startup.status === 'snoozed' ? (
              <div className="bg-warning-50 border border-warning-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <PauseCircle className="w-6 h-6 text-warning-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-warning-800">This deal is snoozed</p>
                    {startup.snoozeReason && (
                      <p className="text-sm text-warning-700 mt-1">
                        <span className="font-medium">Reason:</span> {startup.snoozeReason}
                      </p>
                    )}
                    {startup.snoozeFollowUpDate && (
                      <p className="text-sm text-warning-700 mt-1 flex items-center gap-1">
                        <Calendar className="w-4 h-4" />
                        Follow-up scheduled for {(() => {
                          try {
                            // Handle both Firestore Timestamp and regular date string/Date
                            const date = typeof startup.snoozeFollowUpDate === 'object' && 'toDate' in startup.snoozeFollowUpDate
                              ? startup.snoozeFollowUpDate.toDate()
                              : new Date(startup.snoozeFollowUpDate);
                            return format(date, 'MMMM d, yyyy');
                          } catch {
                            return 'Date unavailable';
                          }
                        })()}
                      </p>
                    )}
                    <button
                      onClick={() => statusMutation.mutate({ status: 'reviewing' })}
                      className="btn btn-secondary btn-sm mt-3"
                    >
                      Reactivate Deal
                    </button>
                  </div>
                </div>
              </div>
            ) : startup.status === 'passed' ? (
              <div className="bg-danger-50 border border-danger-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <XCircle className="w-6 h-6 text-danger-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-danger-800">This deal has been passed</p>
                    {startup.passReason && (
                      <p className="text-sm text-danger-700 mt-1">
                        <span className="font-medium">Reason:</span> {startup.passReason}
                      </p>
                    )}
                    <button
                      onClick={() => statusMutation.mutate({ status: 'reviewing' })}
                      className="btn btn-secondary btn-sm mt-3"
                    >
                      Reactivate Deal
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row gap-4">
                <button
                  onClick={() => {
                    setDecisionModalType('snooze');
                    setDecisionReason('');
                    setSnoozeMonths(3);
                    setDraftDecisionEmail('');
                    setShowEmailPreview(false);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-warning-50 text-warning-700 border border-warning-200 rounded-lg hover:bg-warning-100 transition-colors font-medium"
                >
                  <PauseCircle className="w-5 h-5" />
                  Snooze Deal
                </button>
                <button
                  onClick={() => {
                    setDecisionModalType('pass');
                    setDecisionReason('');
                    setDraftDecisionEmail('');
                    setShowEmailPreview(false);
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-danger-50 text-danger-700 border border-danger-200 rounded-lg hover:bg-danger-100 transition-colors font-medium"
                >
                  <XCircle className="w-5 h-5" />
                  Pass on Deal
                </button>
              </div>
            )}

            <p className="text-xs text-gray-500 mt-3">
              {startup.status === 'snoozed' || startup.status === 'passed'
                ? 'You can reactivate the deal to continue reviewing it.'
                : 'Snoozing schedules an automatic follow-up. Passing sends a polite rejection email.'}
            </p>
          </div>

          {/* Score Timeline Chart — from former Events tab */}
          <ScoreTimelineChart data={scoreHistory || []} />

          {/* Recent Score Events — combined from Overview + Events */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className="w-5 h-5 text-primary-600" />
                <h3 className="font-semibold text-gray-900">Score Events</h3>
              </div>
              {(scoreEvents?.data?.length ?? 0) === 0 && (
                <button
                  onClick={() => generateScoreEventsMutation.mutate()}
                  disabled={generateScoreEventsMutation.isPending}
                  className="btn btn-secondary btn-sm flex items-center gap-1"
                >
                  {generateScoreEventsMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <RefreshCw className="w-3 h-3" />
                  )}
                  Generate
                </button>
              )}
            </div>
            {(scoreEvents?.data?.length ?? 0) > 0 ? (
              <div className="divide-y divide-gray-100">
                {scoreEvents?.data.map((event: {
                  id: string;
                  timestamp: string;
                  createdAt?: string;
                  signal: string;
                  impact: number;
                  category: string;
                  source?: string;
                  evidence?: string;
                }) => (
                  <div key={event.id} className="py-3 flex items-start gap-3">
                    <div
                      className={clsx(
                        'mt-1 w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0',
                        event.impact > 0 ? 'bg-success-100' : 'bg-danger-100'
                      )}
                    >
                      {event.impact > 0 ? (
                        <TrendingUp className="w-3.5 h-3.5 text-success-600" />
                      ) : (
                        <TrendingDown className="w-3.5 h-3.5 text-danger-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{event.signal}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-500">
                          {safeFormat(event.timestamp || event.createdAt, 'MMM d, yyyy')}
                        </span>
                        <span className="badge bg-gray-100 text-gray-600 text-xs">{event.category}</span>
                        {event.source && <span className="text-xs text-gray-400">via {event.source}</span>}
                      </div>
                      {event.evidence && (
                        <p className="text-xs text-gray-500 mt-1 italic">"{event.evidence}"</p>
                      )}
                    </div>
                    <span
                      className={clsx(
                        'text-sm font-bold flex-shrink-0',
                        event.impact > 0 ? 'text-success-600' : 'text-danger-600'
                      )}
                    >
                      {event.impact > 0 ? '+' : ''}{event.impact.toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">No score events yet.</p>
              </div>
            )}
          </div>

          {/* AI Chat Section */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-primary-600" />
                <h3 className="font-semibold text-gray-900">AI Discussion</h3>
              </div>
              {chatMessages.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm('Clear all chat history for this startup?')) {
                      clearChatMutation.mutate();
                    }
                  }}
                  disabled={clearChatMutation.isPending}
                  className="btn btn-secondary btn-sm flex items-center gap-1 text-xs"
                >
                  <Trash2 className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>

            {/* Chat Messages */}
            <div
              ref={chatContainerRef}
              className="bg-gray-50 rounded-lg p-4 h-80 overflow-y-auto mb-4 space-y-4"
            >
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500">
                  <Bot className="w-12 h-12 mb-3 text-gray-300" />
                  <p className="text-sm font-medium">Start a conversation about {startup.name}</p>
                  <p className="text-xs mt-1">Ask questions, explore concerns, or discuss strategy</p>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={clsx(
                      'flex gap-3',
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    )}
                  >
                    {msg.role === 'assistant' && (
                      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <Bot className="w-4 h-4 text-primary-600" />
                      </div>
                    )}
                    <div
                      className={clsx(
                        'max-w-[80%] rounded-lg px-4 py-2',
                        msg.role === 'user'
                          ? 'bg-primary-600 text-white'
                          : 'bg-white border border-gray-200 text-gray-800'
                      )}
                    >
                      <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      <p
                        className={clsx(
                          'text-xs mt-1',
                          msg.role === 'user' ? 'text-primary-200' : 'text-gray-400'
                        )}
                      >
                        {msg.createdAt ? format(new Date(msg.createdAt), 'h:mm a') : ''}
                      </p>
                    </div>
                    {msg.role === 'user' && (
                      <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                        <User className="w-4 h-4 text-gray-600" />
                      </div>
                    )}
                  </div>
                ))
              )}
              {isChatLoading && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-primary-600" />
                  </div>
                  <div className="bg-white border border-gray-200 rounded-lg px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />
                      <span className="text-sm text-gray-500">Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Chat Input */}
            <div className="flex gap-2">
              <input
                type="text"
                value={chatMessage}
                onChange={(e) => setChatMessage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendChat();
                  }
                }}
                placeholder="Ask about this startup..."
                className="input flex-1"
                disabled={isChatLoading}
              />
              <button
                onClick={handleSendChat}
                disabled={!chatMessage.trim() || isChatLoading}
                className="btn btn-primary flex items-center gap-2"
              >
                {isChatLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Suggested Questions */}
            {chatMessages.length === 0 && (
              <div className="mt-4 pt-4 border-t border-gray-200">
                <p className="text-xs text-gray-500 mb-2">Suggested questions:</p>
                <div className="flex flex-wrap gap-2">
                  {[
                    'What are the main risks?',
                    'How does this compare to competitors?',
                    'What due diligence should I do?',
                    'Is the valuation reasonable?',
                  ].map((question) => (
                    <button
                      key={question}
                      onClick={() => {
                        setChatMessage(question);
                      }}
                      className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Research Tab */}
      {activeTab === 'research' && (
        <div className="space-y-6">
          {/* Header with refresh button */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Research & Enrichment</h2>
              <p className="text-sm text-gray-500">Auto-enriched data from website, Crunchbase, and news sources</p>
            </div>
            <button
              onClick={() => triggerEnrichmentMutation.mutate()}
              disabled={triggerEnrichmentMutation.isPending || enrichment?.status === 'in_progress'}
              className="btn btn-secondary flex items-center gap-2"
            >
              {triggerEnrichmentMutation.isPending || enrichment?.status === 'in_progress' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enriching...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4" />
                  Refresh Data
                </>
              )}
            </button>
          </div>

          {isEnrichmentLoading ? (
            <div className="card p-12 flex items-center justify-center">
              <Loader2 className="w-8 h-8 text-primary-600 animate-spin" />
            </div>
          ) : !enrichment || enrichment.status === 'not_started' ? (
            <div className="card p-12 text-center">
              <Database className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Research Data Yet</h3>
              <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
                Click below to automatically gather data from the startup's website, Crunchbase, and recent news articles.
              </p>
              <button
                onClick={() => triggerEnrichmentMutation.mutate()}
                disabled={triggerEnrichmentMutation.isPending}
                className="btn btn-primary"
              >
                {triggerEnrichmentMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Starting Enrichment...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Start Enrichment
                  </>
                )}
              </button>
            </div>
          ) : enrichment.status === 'in_progress' ? (
            <div className="card p-12 text-center bg-primary-50">
              <Loader2 className="w-16 h-16 text-primary-600 animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-medium text-primary-900 mb-2">Enrichment in Progress</h3>
              <p className="text-sm text-primary-700">Gathering data from multiple sources. This may take a minute...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* AI Summary - Full width */}
              {enrichment.aiSummary && (
                <div className="lg:col-span-2 card p-6 bg-gradient-to-r from-primary-50 to-purple-50">
                  <div className="flex items-center gap-2 mb-3">
                    <Brain className="w-5 h-5 text-primary-600" />
                    <h3 className="font-semibold text-gray-900">AI Research Summary</h3>
                  </div>
                  <p className="text-gray-700 whitespace-pre-wrap">{enrichment.aiSummary}</p>
                </div>
              )}

              {/* Score Impact */}
              {enrichment.scoreImpact && (
                <div className="lg:col-span-2 card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <TrendUp className="w-5 h-5 text-gray-600" />
                    <h3 className="font-semibold text-gray-900">Score Impact from Research</h3>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {Object.entries(enrichment.scoreImpact as Record<string, number>).map(([key, value]) => (
                      <div key={key} className="text-center p-4 bg-gray-50 rounded-lg">
                        <p className={clsx(
                          'text-2xl font-bold',
                          value > 0 ? 'text-success-600' : value < 0 ? 'text-danger-600' : 'text-gray-400'
                        )}>
                          {value > 0 ? '+' : ''}{value}
                        </p>
                        <p className="text-sm text-gray-500 capitalize mt-1">{key.replace(/([A-Z])/g, ' $1').trim()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Website Data */}
              {enrichment.websiteData && (
                <div className="card p-6">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-blue-600" />
                      <h3 className="font-semibold text-gray-900">Website Data</h3>
                    </div>
                    {startup.website && (
                      <a
                        href={startup.website.startsWith('http') ? startup.website : `https://${startup.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary-600 hover:underline flex items-center gap-1"
                      >
                        Visit site <ExternalLink className="w-4 h-4" />
                      </a>
                    )}
                  </div>
                  <div className="space-y-3">
                    {enrichment.websiteData.companyName && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Company</p>
                        <p className="text-gray-900">{enrichment.websiteData.companyName}</p>
                      </div>
                    )}
                    {enrichment.websiteData.description && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Description</p>
                        <p className="text-gray-900">{enrichment.websiteData.description}</p>
                      </div>
                    )}
                    {enrichment.websiteData.sector && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Sector</p>
                        <p className="text-gray-900">{enrichment.websiteData.sector}</p>
                      </div>
                    )}
                    {enrichment.websiteData.productOffering && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Product</p>
                        <p className="text-gray-900">{enrichment.websiteData.productOffering}</p>
                      </div>
                    )}
                    {enrichment.websiteData.targetMarket && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Target Market</p>
                        <p className="text-gray-900">{enrichment.websiteData.targetMarket}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {enrichment.websiteData.teamSize && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Team Size</p>
                          <p className="text-gray-900">{enrichment.websiteData.teamSize}</p>
                        </div>
                      )}
                      {enrichment.websiteData.foundedYear && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Founded</p>
                          <p className="text-gray-900">{enrichment.websiteData.foundedYear}</p>
                        </div>
                      )}
                    </div>
                    {enrichment.websiteData.founders && enrichment.websiteData.founders.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Founders</p>
                        <div className="space-y-2">
                          {enrichment.websiteData.founders.map((founder: { name: string; role?: string; linkedin?: string }, idx: number) => (
                            <div key={idx} className="flex items-center gap-2">
                              <span className="text-gray-900">{founder.name}</span>
                              {founder.role && <span className="text-gray-400 text-sm">({founder.role})</span>}
                              {founder.linkedin && (
                                <a href={founder.linkedin} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:text-blue-700">
                                  <Link className="w-4 h-4" />
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {(enrichment.websiteData.linkedinUrl || enrichment.websiteData.twitterUrl) && (
                      <div className="flex items-center gap-4 pt-3 border-t border-gray-200">
                        {enrichment.websiteData.linkedinUrl && (
                          <a
                            href={enrichment.websiteData.linkedinUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          >
                            LinkedIn <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                        {enrichment.websiteData.twitterUrl && (
                          <a
                            href={enrichment.websiteData.twitterUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                          >
                            Twitter <ExternalLink className="w-4 h-4" />
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Crunchbase / AI Research Data */}
              {enrichment.crunchbaseData && (
                <div className="card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Database className="w-5 h-5 text-orange-600" />
                    <h3 className="font-semibold text-gray-900">
                      {enrichment.crunchbaseData.source === 'ai_research' ? 'AI Research Data' : 'Crunchbase Data'}
                    </h3>
                    {enrichment.crunchbaseData.source === 'ai_research' && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">AI Generated</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {enrichment.crunchbaseData.shortDescription && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Description</p>
                        <p className="text-gray-900">{enrichment.crunchbaseData.shortDescription}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {enrichment.crunchbaseData.totalFundingUsd && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Total Funding</p>
                          <p className="text-gray-900 font-medium">${(enrichment.crunchbaseData.totalFundingUsd / 1000000).toFixed(1)}M</p>
                        </div>
                      )}
                      {enrichment.crunchbaseData.lastFundingType && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Last Round</p>
                          <p className="text-gray-900">{enrichment.crunchbaseData.lastFundingType}</p>
                        </div>
                      )}
                      {enrichment.crunchbaseData.numEmployeesEnum && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Employees</p>
                          <p className="text-gray-900">{enrichment.crunchbaseData.numEmployeesEnum}</p>
                        </div>
                      )}
                      {enrichment.crunchbaseData.foundedOn && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Founded</p>
                          <p className="text-gray-900">{enrichment.crunchbaseData.foundedOn}</p>
                        </div>
                      )}
                    </div>
                    {enrichment.crunchbaseData.categories && enrichment.crunchbaseData.categories.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Categories</p>
                        <div className="flex flex-wrap gap-1">
                          {enrichment.crunchbaseData.categories.map((cat: string, idx: number) => (
                            <span key={idx} className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">{cat}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {enrichment.crunchbaseData.investors && enrichment.crunchbaseData.investors.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Investors</p>
                        <div className="flex flex-wrap gap-1">
                          {enrichment.crunchbaseData.investors.map((investor: string, idx: number) => (
                            <span key={idx} className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded-full">{investor}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* LinkedIn Company Data */}
              {enrichment.linkedinData && (
                <div className="card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Link className="w-5 h-5 text-blue-600" />
                    <h3 className="font-semibold text-gray-900">LinkedIn Company</h3>
                    {enrichment.linkedinData.source === 'ai_research' && (
                      <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">AI Research</span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {enrichment.linkedinData.tagline && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">Tagline</p>
                        <p className="text-gray-900 italic">"{enrichment.linkedinData.tagline}"</p>
                      </div>
                    )}
                    {enrichment.linkedinData.description && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide">About</p>
                        <p className="text-gray-900">{enrichment.linkedinData.description}</p>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      {enrichment.linkedinData.industry && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Industry</p>
                          <p className="text-gray-900">{enrichment.linkedinData.industry}</p>
                        </div>
                      )}
                      {enrichment.linkedinData.companySize && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Company Size</p>
                          <p className="text-gray-900">{enrichment.linkedinData.companySize}</p>
                        </div>
                      )}
                      {enrichment.linkedinData.headquarters && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Headquarters</p>
                          <p className="text-gray-900">{enrichment.linkedinData.headquarters}</p>
                        </div>
                      )}
                      {enrichment.linkedinData.foundedYear && (
                        <div>
                          <p className="text-xs text-gray-500 uppercase tracking-wide">Founded</p>
                          <p className="text-gray-900">{enrichment.linkedinData.foundedYear}</p>
                        </div>
                      )}
                    </div>
                    {enrichment.linkedinData.specialties && enrichment.linkedinData.specialties.length > 0 && (
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Specialties</p>
                        <div className="flex flex-wrap gap-1">
                          {enrichment.linkedinData.specialties.map((specialty: string, idx: number) => (
                            <span key={idx} className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">{specialty}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {enrichment.linkedinData.companyUrl && (
                      <div className="pt-3 border-t border-gray-200">
                        <a
                          href={enrichment.linkedinData.companyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1"
                        >
                          View on LinkedIn <ExternalLink className="w-4 h-4" />
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Founders & Team - Full width */}
              {enrichment.foundersData && enrichment.foundersData.length > 0 && (
                <div className="lg:col-span-2 card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Users className="w-5 h-5 text-indigo-600" />
                    <h3 className="font-semibold text-gray-900">Founders & Key Team</h3>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{enrichment.foundersData.length} people</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {enrichment.foundersData.map((founder: {
                      name: string;
                      linkedInUrl?: string;
                      currentRole?: string;
                      headline?: string;
                      location?: string;
                      previousCompanies?: Array<{ name: string; role: string; duration?: string }>;
                      education?: Array<{ school: string; degree?: string; field?: string }>;
                      skills?: string[];
                      yearsExperience?: number;
                    }, idx: number) => (
                      <div key={idx} className="bg-gray-50 rounded-lg p-4">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            {founder.linkedInUrl ? (
                              <a
                                href={founder.linkedInUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-gray-900 hover:text-blue-600 flex items-center gap-1.5 group"
                              >
                                {founder.name}
                                <svg className="w-4 h-4 text-blue-500 group-hover:text-blue-700" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                                </svg>
                              </a>
                            ) : (
                              <p className="font-medium text-gray-900">{founder.name}</p>
                            )}
                            {founder.currentRole && (
                              <p className="text-sm text-primary-600">{founder.currentRole}</p>
                            )}
                          </div>
                          {founder.linkedInUrl && (
                            <a
                              href={founder.linkedInUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-700 hover:underline"
                            >
                              View Profile →
                            </a>
                          )}
                        </div>
                        {founder.headline && (
                          <p className="text-xs text-gray-500 mb-2 line-clamp-2">{founder.headline}</p>
                        )}
                        <div className="space-y-2 text-xs">
                          {founder.location && (
                            <p className="text-gray-600">📍 {founder.location}</p>
                          )}
                          {founder.yearsExperience && (
                            <p className="text-gray-600">💼 {founder.yearsExperience}+ years experience</p>
                          )}
                          {founder.previousCompanies && founder.previousCompanies.length > 0 && (
                            <div>
                              <p className="text-gray-500 font-medium mb-1">Previous:</p>
                              <div className="space-y-0.5">
                                {founder.previousCompanies.slice(0, 2).map((company, cidx: number) => (
                                  <p key={cidx} className="text-gray-600">
                                    {company.role} @ {company.name}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                          {founder.education && founder.education.length > 0 && (
                            <div>
                              <p className="text-gray-500 font-medium mb-1">Education:</p>
                              <div className="space-y-0.5">
                                {founder.education.slice(0, 2).map((edu, eidx: number) => (
                                  <p key={eidx} className="text-gray-600">
                                    {edu.school}{edu.degree ? `, ${edu.degree}` : ''}
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                          {founder.skills && founder.skills.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                              {founder.skills.slice(0, 4).map((skill: string, sidx: number) => (
                                <span key={sidx} className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">{skill}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* News Articles - Full width */}
              {enrichment.newsArticles && enrichment.newsArticles.length > 0 && (
                <div className="lg:col-span-2 card p-6">
                  <div className="flex items-center gap-2 mb-4">
                    <Newspaper className="w-5 h-5 text-green-600" />
                    <h3 className="font-semibold text-gray-900">Recent News</h3>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{enrichment.newsArticles.length} articles</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {enrichment.newsArticles.slice(0, 6).map((article: { title: string; url: string; source: string; publishedAt?: string }, idx: number) => (
                      <a
                        key={idx}
                        href={article.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                      >
                        <p className="text-gray-900 font-medium hover:text-primary-600 line-clamp-2">{article.title}</p>
                        <div className="flex items-center gap-2 mt-2">
                          <span className="text-xs text-gray-500">{article.source}</span>
                          {article.publishedAt && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span className="text-xs text-gray-500">
                                {(() => {
                                  try {
                                    return format(new Date(article.publishedAt), 'MMM d, yyyy');
                                  } catch {
                                    return '';
                                  }
                                })()}
                              </span>
                            </>
                          )}
                        </div>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Last Updated */}
              {enrichment.enrichedAt && (
                <div className="lg:col-span-2 text-right">
                  <p className="text-sm text-gray-400">
                    Last updated: {(() => {
                      try {
                        return format(new Date(enrichment.enrichedAt), 'MMMM d, yyyy \'at\' h:mm a');
                      } catch {
                        return 'Unknown';
                      }
                    })()}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Snooze/Pass Decision Modal */}
      {decisionModalType && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-gray-200">
              <div className="flex items-center gap-3">
                {decisionModalType === 'snooze' ? (
                  <div className="w-10 h-10 rounded-full bg-warning-100 flex items-center justify-center">
                    <PauseCircle className="w-5 h-5 text-warning-600" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-full bg-danger-100 flex items-center justify-center">
                    <XCircle className="w-5 h-5 text-danger-600" />
                  </div>
                )}
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {decisionModalType === 'snooze' ? 'Snooze Deal' : 'Pass on Deal'}
                  </h3>
                  <p className="text-sm text-gray-500">{startup.name}</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setDecisionModalType(null);
                  setDecisionReason('');
                  setDraftDecisionEmail('');
                  setShowEmailPreview(false);
                }}
                className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {!showEmailPreview ? (
                <>
                  {/* Reason input */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {decisionModalType === 'snooze'
                        ? 'Why are you snoozing this deal?'
                        : 'Why are you passing on this deal?'}
                    </label>
                    <textarea
                      value={decisionReason}
                      onChange={(e) => setDecisionReason(e.target.value)}
                      className="input min-h-[120px] resize-y"
                      placeholder={decisionModalType === 'snooze'
                        ? 'e.g., Too early stage, need to see more traction, timing not right...'
                        : 'e.g., Not a fit for our thesis, market concerns, team concerns...'}
                    />
                  </div>

                  {/* Snooze duration selector */}
                  {decisionModalType === 'snooze' && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Follow-up in
                      </label>
                      <div className="flex gap-2">
                        {[1, 3, 6, 12].map((months) => (
                          <button
                            key={months}
                            onClick={() => setSnoozeMonths(months)}
                            className={clsx(
                              'flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors',
                              snoozeMonths === months
                                ? 'bg-warning-100 border-warning-500 text-warning-700'
                                : 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                            )}
                          >
                            {months} {months === 1 ? 'month' : 'months'}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-gray-500 mt-2">
                        The founder will be asked to send progress updates. You'll be alerted when updates come in.
                      </p>
                    </div>
                  )}

                  {/* Info box */}
                  <div className={clsx(
                    'rounded-lg p-4',
                    decisionModalType === 'snooze' ? 'bg-warning-50' : 'bg-danger-50'
                  )}>
                    <p className={clsx(
                      'text-sm',
                      decisionModalType === 'snooze' ? 'text-warning-800' : 'text-danger-800'
                    )}>
                      {decisionModalType === 'snooze' ? (
                        <>
                          <strong>What happens next:</strong>
                          <ul className="mt-2 space-y-1 list-disc list-inside">
                            <li>AI will draft a polite email explaining you're putting the deal on hold</li>
                            <li>The founder will be encouraged to send progress updates</li>
                            <li>A reminder will be scheduled for {snoozeMonths} months from now</li>
                            <li>You'll be alerted when the founder sends updates</li>
                          </ul>
                        </>
                      ) : (
                        <>
                          <strong>What happens next:</strong>
                          <ul className="mt-2 space-y-1 list-disc list-inside">
                            <li>AI will draft a professional rejection email</li>
                            <li>You can review and edit the email before sending</li>
                            <li>The deal will be marked as "Passed"</li>
                          </ul>
                        </>
                      )}
                    </p>
                  </div>
                </>
              ) : (
                <>
                  {/* Email preview and edit */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Draft Email to Founder
                      </label>
                      <span className="text-xs text-gray-500">You can edit before sending</span>
                    </div>
                    <textarea
                      value={draftDecisionEmail}
                      onChange={(e) => setDraftDecisionEmail(e.target.value)}
                      className="input min-h-[300px] resize-y font-mono text-sm"
                    />
                  </div>

                  <div className="bg-gray-50 rounded-lg p-3 flex items-start gap-2">
                    <Mail className="w-4 h-4 text-gray-500 mt-0.5 flex-shrink-0" />
                    <div className="text-sm text-gray-600">
                      <p>
                        <strong>To:</strong> {startup.founderEmail || 'Founder email not found'}
                      </p>
                      <p>
                        <strong>Subject:</strong> Re: {startup.name}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex justify-between items-center gap-3 p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              {showEmailPreview && (
                <button
                  onClick={() => setShowEmailPreview(false)}
                  className="btn btn-secondary flex items-center gap-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                  Back
                </button>
              )}
              <div className="flex gap-3 ml-auto">
                <button
                  onClick={() => {
                    setDecisionModalType(null);
                    setDecisionReason('');
                    setDraftDecisionEmail('');
                    setShowEmailPreview(false);
                  }}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                {!showEmailPreview ? (
                  <button
                    onClick={() => {
                      if (!decisionReason.trim()) {
                        toast.error('Please provide a reason');
                        return;
                      }
                      setIsGeneratingEmail(true);
                      if (decisionModalType === 'snooze') {
                        snoozeMutation.mutate({ reason: decisionReason, followUpMonths: snoozeMonths });
                      } else {
                        passMutation.mutate(decisionReason);
                      }
                    }}
                    disabled={isGeneratingEmail || !decisionReason.trim()}
                    className={clsx(
                      'btn flex items-center gap-2',
                      decisionModalType === 'snooze'
                        ? 'bg-warning-600 text-white hover:bg-warning-700'
                        : 'bg-danger-600 text-white hover:bg-danger-700'
                    )}
                  >
                    {isGeneratingEmail ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating Email...
                      </>
                    ) : (
                      <>
                        <Brain className="w-4 h-4" />
                        Generate Email with AI
                      </>
                    )}
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      if (!draftDecisionEmail.trim()) {
                        toast.error('Email content is required');
                        return;
                      }
                      sendDecisionEmailMutation.mutate({
                        emailBody: draftDecisionEmail,
                        emailSubject: `Re: ${startup.name}`,
                      });
                    }}
                    disabled={sendDecisionEmailMutation.isPending}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {sendDecisionEmailMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send Email
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'docs' && (
        <div className="space-y-6">
          {/* Document list */}
          {decks && decks.length > 0 && (
            <div className="card p-5">
              <h3 className="font-semibold text-gray-900 mb-4">Uploaded Documents</h3>
              <div className="space-y-3">
                {decks.map((deck: { id: string; fileName: string; fileSize: number; fileUrl?: string; storagePath?: string; createdAt: string; status?: string; aiAnalysis?: { score?: number } }) => (
                  <div key={deck.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <button
                      onClick={async () => {
                        try {
                          const response = await fetch(
                            `${import.meta.env.VITE_API_URL || '/api'}/decks/${deck.id}/download`,
                            {
                              headers: {
                                Authorization: `Bearer ${useAuthStore.getState().tokens?.accessToken}`,
                              },
                            }
                          );
                          if (!response.ok) throw new Error('Download failed');
                          const blob = await response.blob();
                          const url = URL.createObjectURL(blob);
                          window.open(url, '_blank');
                        } catch {
                          toast.error('Failed to open document');
                        }
                      }}
                      className="flex items-center gap-3 flex-1 hover:opacity-80 transition-opacity cursor-pointer text-left"
                    >
                      <FileText className="w-8 h-8 text-primary-600" />
                      <div>
                        <p className="font-medium text-gray-900 hover:text-primary-600">{deck.fileName}</p>
                        <p className="text-sm text-gray-500">
                          {(deck.fileSize / 1024).toFixed(1)} KB · Uploaded {format(new Date(deck.createdAt), 'MMM d, yyyy')}
                          {deck.status === 'uploaded' && !deck.aiAnalysis && ' · Pending analysis'}
                        </p>
                      </div>
                    </button>
                    <div className="flex items-center gap-3">
                      {deck.aiAnalysis?.score !== undefined ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setAnalyzingDeckId(deck.id);
                              setAnalyzingDeckName(deck.fileName);
                              reprocessDeckMutation.mutate(deck.id);
                            }}
                            disabled={reprocessDeckMutation.isPending || analyzingDeckId !== null}
                            className="text-xs px-2 py-1 text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors disabled:opacity-50"
                            title="Re-analyze this document"
                          >
                            <RefreshCw className="w-4 h-4" />
                          </button>
                          <div className="text-right">
                            <span className="text-lg font-bold text-primary-600">{deck.aiAnalysis.score}</span>
                            <span className="text-sm text-gray-500">/100</span>
                          </div>
                        </div>
                      ) : analyzingDeckId === deck.id ? (
                        <div className="flex items-center gap-2 text-primary-600">
                          <Loader2 className="w-4 h-4 animate-spin" />
                          <span className="text-xs">Analyzing...</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setAnalyzingDeckId(deck.id);
                            setAnalyzingDeckName(deck.fileName);
                            reprocessDeckMutation.mutate(deck.id);
                          }}
                          disabled={reprocessDeckMutation.isPending || analyzingDeckId !== null}
                          className="text-xs px-2 py-1 bg-primary-100 text-primary-700 rounded hover:bg-primary-200 transition-colors disabled:opacity-50"
                          title="Analyze this document with AI"
                        >
                          Analyze
                        </button>
                      )}
                    </div>
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

          {/* Rescan from original email */}
          <div className="card p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Mail className="w-5 h-5 text-gray-400" />
                <div>
                  <p className="text-sm font-medium text-gray-700">Missing attachments from emails?</p>
                  <p className="text-xs text-gray-500">Re-fetch attachments from all inbound emails</p>
                </div>
              </div>
              <button
                onClick={() => rescanAttachmentsMutation.mutate()}
                disabled={rescanAttachmentsMutation.isPending}
                className="btn-secondary text-sm flex items-center gap-2"
              >
                {rescanAttachmentsMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Rescan from Email
              </button>
            </div>
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
          {/* Compose Email Button */}
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-gray-900">Email Thread</h3>
            <button
              onClick={() => {
                setIsComposingEmail(true);
                setReplyToEmail(null);
                setComposeSubject(`Re: ${startup.name}`);
                setComposeBody('');
              }}
              className="btn btn-primary btn-sm flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Compose Email
            </button>
          </div>

          <div className="card">
            {(emails?.data?.length ?? 0) > 0 ? (
              <div className="divide-y divide-gray-200">
                {emails?.data.map((email: Email) => (
                  <div
                    key={email.id}
                    className="p-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div
                        className="flex items-start gap-3 flex-1 cursor-pointer"
                        onClick={() => setSelectedEmail(email)}
                      >
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
                      <div className="flex items-start gap-3">
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
                        {email.direction === 'inbound' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setIsComposingEmail(true);
                              setReplyToEmail(email);
                              setComposeSubject(`Re: ${email.subject}`);
                              setComposeBody('');
                              setReplyRecommendation(null);
                              // Trigger AI to analyze and generate reply draft
                              generateReplyMutation.mutate(email.id);
                            }}
                            disabled={generateReplyMutation.isPending}
                            className="btn btn-primary btn-sm flex items-center gap-1"
                            title="Analyze email and generate AI reply"
                          >
                            {generateReplyMutation.isPending ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Brain className="w-3 h-3" />
                            )}
                            Analyze & Reply
                          </button>
                        )}
                      </div>
                    </div>
                    <p
                      className="text-sm text-gray-600 mt-2 ml-11 line-clamp-2 cursor-pointer"
                      onClick={() => setSelectedEmail(email)}
                    >
                      {email.bodyPreview}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-12 text-center">
                <Mail className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                <p className="text-gray-600">No emails synced yet.</p>
                <p className="text-sm text-gray-500 mt-1">Connect your email in Settings to sync communications.</p>
                <button
                  onClick={() => {
                    setIsComposingEmail(true);
                    setReplyToEmail(null);
                    setComposeSubject(`Re: ${startup.name}`);
                    setComposeBody('');
                  }}
                  className="btn btn-primary mt-4"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Send First Email
                </button>
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
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(selectedEmail.bodyHtml, {
                          ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'div', 'span'],
                          ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'style']
                        })
                      }}
                    />
                  ) : (
                    <p className="text-gray-700 whitespace-pre-wrap">{selectedEmail.body || selectedEmail.bodyPreview}</p>
                  )}
                </div>

                {/* Modal Footer */}
                <div className="flex justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                  {selectedEmail.direction === 'inbound' && (
                    <button
                      onClick={() => {
                        const emailToReply = selectedEmail;
                        setSelectedEmail(null);
                        setIsComposingEmail(true);
                        setReplyToEmail(emailToReply);
                        setComposeSubject(`Re: ${emailToReply.subject}`);
                        setComposeBody('');
                        setReplyRecommendation(null);
                        // Trigger AI to analyze and generate reply draft
                        generateReplyMutation.mutate(emailToReply.id);
                      }}
                      disabled={generateReplyMutation.isPending}
                      className="btn btn-primary flex items-center gap-2"
                    >
                      {generateReplyMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Brain className="w-4 h-4" />
                      )}
                      Analyze & Reply
                    </button>
                  )}
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

          {/* Compose Email Modal */}
          {isComposingEmail && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
                {/* Modal Header */}
                <div className="flex items-center justify-between p-5 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">
                    {replyToEmail ? 'Reply to Email' : 'Compose Email'}
                  </h3>
                  <button
                    onClick={() => {
                      setIsComposingEmail(false);
                      setReplyToEmail(null);
                    }}
                    className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {/* To field */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
                    <input
                      type="text"
                      value={startup.founderEmail || ''}
                      disabled
                      className="input bg-gray-50"
                    />
                  </div>

                  {/* Subject */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
                    <input
                      type="text"
                      value={composeSubject}
                      onChange={(e) => setComposeSubject(e.target.value)}
                      className="input"
                      placeholder="Enter subject..."
                    />
                  </div>

                  {/* Reply context */}
                  {replyToEmail && (
                    <div className="bg-gray-50 rounded-lg p-3 border-l-4 border-primary-500">
                      <p className="text-xs text-gray-500 mb-1">Replying to:</p>
                      <p className="text-sm text-gray-700 line-clamp-3">{replyToEmail.bodyPreview}</p>
                    </div>
                  )}

                  {/* AI Recommendation Banner */}
                  {replyToEmail && (generateReplyMutation.isPending || replyRecommendation) && (
                    <div className={clsx(
                      'rounded-lg p-4 border',
                      generateReplyMutation.isPending ? 'bg-gray-50 border-gray-200' :
                      replyRecommendation?.recommendation === 'continue' ? 'bg-green-50 border-green-200' :
                      replyRecommendation?.recommendation === 'schedule_call' ? 'bg-blue-50 border-blue-200' :
                      replyRecommendation?.recommendation === 'pass' ? 'bg-red-50 border-red-200' :
                      'bg-gray-50 border-gray-200'
                    )}>
                      {generateReplyMutation.isPending ? (
                        <div className="flex items-center gap-3">
                          <Loader2 className="w-5 h-5 animate-spin text-primary-600" />
                          <div>
                            <p className="font-medium text-gray-700">Analyzing email & generating reply...</p>
                            <p className="text-sm text-gray-500">AI is reviewing context and drafting response</p>
                          </div>
                        </div>
                      ) : replyRecommendation && (
                        <div className="space-y-3">
                          <div className="flex items-center gap-2">
                            <span className={clsx(
                              'px-2 py-1 rounded-full text-xs font-semibold',
                              replyRecommendation.recommendation === 'continue' ? 'bg-green-100 text-green-700' :
                              replyRecommendation.recommendation === 'schedule_call' ? 'bg-blue-100 text-blue-700' :
                              'bg-red-100 text-red-700'
                            )}>
                              {replyRecommendation.recommendation === 'continue' ? '✓ Continue Discussion' :
                               replyRecommendation.recommendation === 'schedule_call' ? '📞 Schedule Call' :
                               '✗ Consider Passing'}
                            </span>
                            {replyRecommendation.responseQuality && (
                              <span className="text-xs text-gray-500">
                                Response Quality: {replyRecommendation.responseQuality.score}/10
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700">{replyRecommendation.recommendationReason}</p>

                          {replyRecommendation.suggestedQuestions && replyRecommendation.suggestedQuestions.length > 0 && (
                            <details className="text-sm">
                              <summary className="cursor-pointer text-primary-600 hover:text-primary-700 font-medium">
                                Suggested follow-up questions ({replyRecommendation.suggestedQuestions.length})
                              </summary>
                              <ul className="mt-2 space-y-1 pl-4">
                                {replyRecommendation.suggestedQuestions.map((q, i) => (
                                  <li key={i} className="text-gray-600 list-disc">{q}</li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Body */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Message</label>
                    {generateReplyMutation.isPending ? (
                      <div className="input min-h-[200px] bg-gray-50 flex items-center justify-center">
                        <div className="text-center text-gray-500">
                          <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
                          <p>Generating AI draft...</p>
                        </div>
                      </div>
                    ) : (
                      <textarea
                        value={composeBody}
                        onChange={(e) => setComposeBody(e.target.value)}
                        className="input min-h-[200px] resize-y"
                        placeholder="Write your message..."
                      />
                    )}
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex justify-end gap-3 p-4 border-t border-gray-200 bg-gray-50 rounded-b-xl">
                  <button
                    onClick={() => {
                      setIsComposingEmail(false);
                      setReplyToEmail(null);
                      setReplyRecommendation(null);
                    }}
                    className="btn btn-secondary"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      if (!composeSubject.trim() || !composeBody.trim()) {
                        toast.error('Please fill in subject and message');
                        return;
                      }
                      composeEmailMutation.mutate({
                        subject: composeSubject,
                        body: composeBody,
                        replyToEmailId: replyToEmail?.id,
                      });
                    }}
                    disabled={composeEmailMutation.isPending}
                    className="btn btn-primary flex items-center gap-2"
                  >
                    {composeEmailMutation.isPending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    {composeEmailMutation.isPending ? 'Sending...' : 'Send Email'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'notes' && (
        <div className="space-y-6">
          {/* GP Notes — private free-text notes, auto-saved on blur */}
          <div className="card p-5">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-5 h-5 text-primary-600" />
              <h3 className="font-semibold text-gray-900">My Notes</h3>
              <span className="text-xs text-gray-400 ml-auto">Private · auto-saved</span>
            </div>
            <textarea
              value={gpNotes}
              onChange={(e) => setGpNotes(e.target.value)}
              onBlur={() => saveGpNotesMutation.mutate(gpNotes)}
              placeholder="Add private notes about this deal — meeting notes, red flags, thesis fit, key questions answered..."
              className="input w-full min-h-[140px] resize-y text-sm"
              rows={5}
            />
            {saveGpNotesMutation.isPending && (
              <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Saving...
              </p>
            )}
          </div>

          {/* Invite Co-investors Section */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Co-Investors</h3>
                <p className="text-sm text-gray-500">Invite external co-investors to view and discuss this deal</p>
              </div>
              <button
                onClick={() => setShowInviteModal(true)}
                className="btn btn-primary btn-sm"
              >
                Invite Co-investor
              </button>
            </div>
            {(invitesData?.invites?.length ?? 0) > 0 ? (
              <div className="space-y-2">
                {invitesData?.invites.map((invite: { id: string; email: string; accessLevel: string; acceptedAt?: string; createdAt: string }) => (
                  <div key={invite.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                        <User className="w-4 h-4 text-primary-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{invite.email}</p>
                        <p className="text-xs text-gray-500">
                          {invite.accessLevel === 'comment' ? 'Can view & comment' : 'View only'}
                          {invite.acceptedAt && ' · Accessed'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => revokeInviteMutation.mutate(invite.id)}
                      className="text-sm text-danger-600 hover:text-danger-700"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No co-investors invited yet</p>
            )}
          </div>

          {/* Team Discussion */}
          <div className="card p-4">
            <h3 className="font-semibold text-gray-900 mb-4">Team Discussion</h3>

            {/* Comment Input */}
            <div className="mb-6">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment... Use @name to mention team members"
                className="input w-full min-h-[80px] resize-none"
                rows={3}
              />
              <div className="flex items-center justify-between mt-2">
                <p className="text-xs text-gray-500">
                  Team members: {teamData?.users?.map((u: { name: string }) => `@${u.name}`).join(', ') || 'Loading...'}
                </p>
                <button
                  onClick={() => {
                    if (newComment.trim()) {
                      // Extract mentions from comment (simple @name pattern)
                      const mentionPattern = /@(\w+)/g;
                      const mentionNames = [...newComment.matchAll(mentionPattern)].map(m => m[1]);
                      const mentionedUserIds = teamData?.users
                        ?.filter((u: { name: string; id: string }) =>
                          mentionNames.some(name => u.name.toLowerCase().includes(name.toLowerCase()))
                        )
                        .map((u: { id: string }) => u.id) || [];

                      addCommentMutation.mutate({
                        content: newComment,
                        parentId: replyingTo || undefined,
                        mentions: mentionedUserIds,
                      });
                    }
                  }}
                  disabled={!newComment.trim() || addCommentMutation.isPending}
                  className="btn btn-primary btn-sm"
                >
                  {addCommentMutation.isPending ? 'Posting...' : 'Post Comment'}
                </button>
              </div>
            </div>

            {/* Comments List */}
            <div className="space-y-4">
              {(commentsData?.comments?.length ?? 0) > 0 ? (
                commentsData?.comments
                  .filter((c: { parentId: string | null }) => !c.parentId) // Top-level comments only
                  .map((comment: {
                    id: string;
                    authorName: string;
                    authorEmail: string;
                    content: string;
                    isCoInvestor?: boolean;
                    createdAt: string;
                    editedAt?: string;
                    authorId: string;
                  }) => {
                    const { user } = useAuthStore.getState();
                    const isOwner = comment.authorId === user?.id || comment.authorId === `user:${user?.id}`;
                    const replies = commentsData?.comments.filter((c: { parentId: string | null }) => c.parentId === comment.id) || [];

                    return (
                      <div key={comment.id} className="border-b border-gray-100 pb-4 last:border-0">
                        <div className="flex items-start gap-3">
                          <div className={clsx(
                            "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                            comment.isCoInvestor ? "bg-orange-100" : "bg-primary-100"
                          )}>
                            <span className={clsx(
                              "text-sm font-medium",
                              comment.isCoInvestor ? "text-orange-600" : "text-primary-600"
                            )}>
                              {comment.authorName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-gray-900">{comment.authorName}</span>
                              {comment.isCoInvestor && (
                                <span className="badge bg-orange-100 text-orange-700 text-xs">Co-investor</span>
                              )}
                              <span className="text-xs text-gray-500">
                                {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                                {comment.editedAt && ' (edited)'}
                              </span>
                            </div>

                            {editingComment === comment.id ? (
                              <div className="mt-2">
                                <textarea
                                  value={editContent}
                                  onChange={(e) => setEditContent(e.target.value)}
                                  className="input w-full min-h-[60px] resize-none"
                                  rows={2}
                                />
                                <div className="flex gap-2 mt-2">
                                  <button
                                    onClick={() => updateCommentMutation.mutate({ commentId: comment.id, content: editContent })}
                                    disabled={updateCommentMutation.isPending}
                                    className="btn btn-primary btn-sm"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => { setEditingComment(null); setEditContent(''); }}
                                    className="btn btn-secondary btn-sm"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-gray-700 mt-1 whitespace-pre-wrap">{comment.content}</p>
                            )}

                            {!editingComment && (
                              <div className="flex items-center gap-3 mt-2">
                                <button
                                  onClick={() => {
                                    setReplyingTo(comment.id);
                                    setNewComment(`@${comment.authorName} `);
                                  }}
                                  className="text-xs text-gray-500 hover:text-gray-700"
                                >
                                  Reply
                                </button>
                                {isOwner && (
                                  <>
                                    <button
                                      onClick={() => { setEditingComment(comment.id); setEditContent(comment.content); }}
                                      className="text-xs text-gray-500 hover:text-gray-700"
                                    >
                                      Edit
                                    </button>
                                    <button
                                      onClick={() => {
                                        if (confirm('Delete this comment?')) {
                                          deleteCommentMutation.mutate(comment.id);
                                        }
                                      }}
                                      className="text-xs text-danger-500 hover:text-danger-700"
                                    >
                                      Delete
                                    </button>
                                  </>
                                )}
                              </div>
                            )}

                            {/* Replies */}
                            {replies.length > 0 && (
                              <div className="mt-4 ml-4 pl-4 border-l-2 border-gray-200 space-y-3">
                                {replies.map((reply: typeof comment) => (
                                  <div key={reply.id} className="flex items-start gap-2">
                                    <div className={clsx(
                                      "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0",
                                      reply.isCoInvestor ? "bg-orange-100" : "bg-gray-100"
                                    )}>
                                      <span className="text-xs font-medium text-gray-600">
                                        {reply.authorName.charAt(0).toUpperCase()}
                                      </span>
                                    </div>
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-sm font-medium text-gray-900">{reply.authorName}</span>
                                        {reply.isCoInvestor && (
                                          <span className="badge bg-orange-100 text-orange-700 text-xs">Co-investor</span>
                                        )}
                                        <span className="text-xs text-gray-500">
                                          {format(new Date(reply.createdAt), 'MMM d, h:mm a')}
                                        </span>
                                      </div>
                                      <p className="text-sm text-gray-700 mt-0.5">{reply.content}</p>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
              ) : (
                <p className="text-center text-gray-500 py-8">
                  No comments yet. Start the discussion!
                </p>
              )}
            </div>
          </div>

          {/* Invite Modal */}
          {showInviteModal && (
            <div className="fixed inset-0 z-50 overflow-y-auto">
              <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowInviteModal(false)} />
              <div className="flex min-h-full items-center justify-center p-4">
                <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-gray-900">Invite Co-investor</h3>
                    <button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-gray-600">
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="co-investor@example.com"
                        className="input w-full"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Access Level</label>
                      <select
                        value={inviteAccessLevel}
                        onChange={(e) => setInviteAccessLevel(e.target.value as 'view' | 'comment')}
                        className="input w-full"
                      >
                        <option value="comment">Can view & comment</option>
                        <option value="view">View only</option>
                      </select>
                    </div>

                    <p className="text-sm text-gray-500">
                      They'll receive an email with a magic link to access this deal. No password required.
                    </p>
                  </div>

                  <div className="flex gap-3 mt-6">
                    <button
                      onClick={() => setShowInviteModal(false)}
                      className="btn btn-secondary flex-1"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => sendInviteMutation.mutate({ email: inviteEmail, accessLevel: inviteAccessLevel })}
                      disabled={!inviteEmail.trim() || sendInviteMutation.isPending}
                      className="btn btn-primary flex-1"
                    >
                      {sendInviteMutation.isPending ? 'Sending...' : 'Send Invite'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}


      {/* Document Analysis Progress Modal */}
      {analyzingDeckId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="text-center">
              {/* Animated icon */}
              <div className="mx-auto w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
                <Brain className="w-8 h-8 text-primary-600 animate-pulse" />
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Analyzing Document
              </h3>

              <p className="text-gray-600 mb-2">
                {analyzingDeckName}
              </p>

              <p className="text-sm text-gray-500 mb-6">
                AI is extracting insights and generating a score...
              </p>

              {/* Progress steps */}
              <div className="space-y-3 mb-6 text-left">
                <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg">
                  <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
                  <span className="text-sm text-primary-700">Extracting text from document</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg opacity-60">
                  <FileText className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-500">Analyzing business model & market</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg opacity-60">
                  <BarChart3 className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-500">Generating investment score</span>
                </div>
              </div>

              {/* Loading bar */}
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary-500 rounded-full transition-all duration-1000"
                  style={{
                    width: '60%',
                    animation: 'progress 2s ease-in-out infinite'
                  }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                This typically takes 10-30 seconds
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
