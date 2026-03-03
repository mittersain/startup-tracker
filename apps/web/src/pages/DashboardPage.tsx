import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { startupsApi, inboxApi } from '@/services/api';
import {
  ArrowRight,
  Upload,
  AlertTriangle,
  Mail,
  Loader2,
  CheckCircle,
  XCircle,
  FileText,
  LinkIcon,
  Check,
  X,
  Inbox,
  Clock,
  Globe,
  User,
  DollarSign,
  Server,
  Brain,
  Filter,
  Pause,
  Target,
  ThumbsDown,
  ChevronRight,
  AlertCircle,
  BarChart2,
  Percent,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { DealStatus, Startup } from '@startup-tracker/shared';
import ScoreBadge from '@/components/ScoreBadge';

interface SyncResultData {
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  decksProcessed: number;
  emailsLinked: number;
  queued: number;
  quotaExceeded?: boolean;
  message?: string;
  results: Array<{
    subject: string;
    from: string;
    date: string;
    startupName?: string;
    startupId?: string;
    error?: string;
  }>;
}

interface QueuedProposal {
  id: string;
  emailSubject: string;
  emailFrom: string;
  emailFromName?: string;
  emailDate: string;
  emailPreview: string;
  startupName: string;
  description?: string;
  website?: string;
  founderName?: string;
  founderEmail?: string;
  askAmount?: string;
  stage?: string;
  confidence: number;
  aiReason?: string;
  status: string;
  createdAt: string;
}

const statusConfig: Record<string, { label: string; color: string }> = {
  new: { label: 'New', color: 'bg-purple-100 text-purple-700' },
  reviewing: { label: 'Reviewing', color: 'bg-blue-100 text-blue-700' },
  due_diligence: { label: 'Due Diligence', color: 'bg-yellow-100 text-yellow-700' },
  invested: { label: 'Invested', color: 'bg-green-100 text-green-700' },
  snoozed: { label: 'Snoozed', color: 'bg-orange-100 text-orange-700' },
  passed: { label: 'Passed', color: 'bg-gray-100 text-gray-700' },
  archived: { label: 'Archived', color: 'bg-gray-100 text-gray-500' },
};

const PASS_REASONS = [
  'Too early stage',
  'Wrong sector / not our thesis',
  'Weak team / founders',
  'No traction or proof points',
  'Competitive market',
  'Valuation or terms concern',
  'Business model concerns',
  'Not a fit',
];

// Scanning progress steps
const SCAN_STEPS = [
  { id: 'connect', label: 'Connecting to inbox', icon: Server, duration: 2000 },
  { id: 'fetch', label: 'Fetching recent emails', icon: Mail, duration: 3000 },
  { id: 'analyze', label: 'Analyzing with AI', icon: Brain, duration: 8000 },
  { id: 'filter', label: 'Filtering proposals', icon: Filter, duration: 2000 },
];

const getNextStatus = (status: string): string => {
  const flow: Record<string, string> = {
    reviewing: 'due_diligence',
    due_diligence: 'invested',
    snoozed: 'reviewing',
  };
  return flow[status] ?? 'reviewing';
};

const getAdvanceLabel = (status: string): string => {
  const labels: Record<string, string> = {
    reviewing: 'Move to DD',
    due_diligence: 'Mark Invested',
    snoozed: 'Unsnooze',
  };
  return labels[status] ?? 'Advance';
};

const getActionInfo = (startup: Startup) => {
  const days = startup.daysSinceOutreach ?? 0;
  if (startup.hasNewResponse) return {
    label: 'Founder replied',
    description: 'Review their response now',
    borderColor: 'border-green-400',
    badgeColor: 'bg-green-100 text-green-700',
    dotColor: 'bg-green-500',
  };
  if (startup.isAwaitingResponse && days > 7) return {
    label: `No reply — ${days}d`,
    description: 'Consider following up or passing',
    borderColor: 'border-red-400',
    badgeColor: 'bg-red-100 text-red-700',
    dotColor: 'bg-red-500',
  };
  if (startup.isAwaitingResponse) return {
    label: `Awaiting reply — ${days}d`,
    description: 'Waiting for founder response',
    borderColor: 'border-amber-400',
    badgeColor: 'bg-amber-100 text-amber-700',
    dotColor: 'bg-amber-500',
  };
  return {
    label: `Stuck ${days}d in pipeline`,
    description: 'No activity — make a decision',
    borderColor: 'border-orange-400',
    badgeColor: 'bg-orange-100 text-orange-700',
    dotColor: 'bg-orange-500',
  };
};

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const [syncResult, setSyncResult] = useState<SyncResultData | null>(null);
  const [showResultsModal, setShowResultsModal] = useState(false);
  const [expandedProposal, setExpandedProposal] = useState<string | null>(null);
  const [scanStep, setScanStep] = useState(0);
  const [scanStartTime, setScanStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [processingProposalId, setProcessingProposalId] = useState<string | null>(null);
  const [processingProposalName, setProcessingProposalName] = useState<string | null>(null);

  // Pass modal state
  const [passModal, setPassModal] = useState<{ id: string; name: string } | null>(null);
  const [passReason, setPassReason] = useState(PASS_REASONS[0]);

  const { data: counts } = useQuery({
    queryKey: ['startup-counts'],
    queryFn: startupsApi.getCounts,
  });

  // Fetch all active startups for action items + stats
  const { data: allStartupsData } = useQuery({
    queryKey: ['startups', 'all-active'],
    queryFn: () => startupsApi.list({ pageSize: 200 }),
  });
  const allStartups: Startup[] = allStartupsData?.data ?? [];

  // Fetch proposal queue
  const { data: queueData } = useQuery({
    queryKey: ['proposal-queue'],
    queryFn: inboxApi.getQueue,
  });

  const proposalQueue: QueuedProposal[] = queueData?.proposals ?? [];

  const syncMutation = useMutation({
    mutationFn: inboxApi.syncInbox,
    onMutate: () => {
      setScanStep(0);
      setScanStartTime(Date.now());
      setElapsedTime(0);
    },
    onSuccess: (result: SyncResultData) => {
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      queryClient.invalidateQueries({ queryKey: ['proposal-queue'] });

      setSyncResult(result);
      setShowResultsModal(true);
      setScanStartTime(null);

      if (result.quotaExceeded) {
        toast.error('AI quota exceeded. Please check your API billing.');
      } else if (result.queued > 0) {
        toast.success(`Found ${result.queued} potential startup proposals to review!`);
      } else {
        toast('No new startup proposals found in your inbox.');
      }
    },
    onError: (error: Error) => {
      setScanStartTime(null);
      toast.error(error.message || 'Failed to sync inbox. Please check your inbox configuration in Settings.');
    },
  });

  // Progress step animation
  useEffect(() => {
    if (!syncMutation.isPending) return;

    const stepTimers: ReturnType<typeof setTimeout>[] = [];
    let cumulativeTime = 0;

    SCAN_STEPS.forEach((step, index) => {
      const timer = setTimeout(() => {
        setScanStep(index);
      }, cumulativeTime);
      stepTimers.push(timer);
      cumulativeTime += step.duration;
    });

    return () => {
      stepTimers.forEach(clearTimeout);
    };
  }, [syncMutation.isPending]);

  // Elapsed time counter
  useEffect(() => {
    if (!scanStartTime) return;

    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - scanStartTime) / 1000));
    }, 1000);

    return () => clearInterval(interval);
  }, [scanStartTime]);

  const approveMutation = useMutation({
    mutationFn: inboxApi.approveProposal,
    onSuccess: (data) => {
      setProcessingProposalId(null);
      setProcessingProposalName(null);
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      toast.success(`Startup approved with score ${data.score || 'N/A'}!`);
    },
    onError: (error: Error) => {
      setProcessingProposalId(null);
      setProcessingProposalName(null);
      toast.error(error.message || 'Failed to approve proposal');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => inboxApi.rejectProposal(id),
    onSuccess: (data: { emailSent?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['proposal-queue'] });
      toast.success(data.emailSent
        ? 'Proposal rejected and polite decline email sent'
        : 'Proposal rejected');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to reject proposal');
    },
  });

  const snoozeMutation = useMutation({
    mutationFn: (id: string) => inboxApi.snoozeProposal(id),
    onSuccess: (data: { emailSent?: boolean }) => {
      queryClient.invalidateQueries({ queryKey: ['proposal-queue'] });
      toast.success(data.emailSent
        ? 'Proposal snoozed - founder asked to share progress updates'
        : 'Proposal snoozed');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to snooze proposal');
    },
  });

  // Quick triage mutations
  const quickAdvanceMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: string }) =>
      startupsApi.updateStatus(id, nextStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      toast.success('Status updated');
    },
    onError: () => toast.error('Failed to update status'),
  });

  const quickSnoozeMutation = useMutation({
    mutationFn: (id: string) => startupsApi.snooze(id, 'Follow up later', 1),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      toast.success('Snoozed for 1 month');
    },
    onError: () => toast.error('Failed to snooze'),
  });

  const quickPassMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      startupsApi.pass(id, reason),
    onSuccess: () => {
      setPassModal(null);
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      toast.success('Startup passed');
    },
    onError: () => toast.error('Failed to pass startup'),
  });

  // Compute action items: startups needing attention
  const actionItems = allStartups
    .filter((s) => s.status !== 'passed' && s.status !== 'archived')
    .filter((s) =>
      s.hasNewResponse ||
      (s.isAwaitingResponse && (s.daysSinceOutreach ?? 0) > 3) ||
      (s.status === 'reviewing' && (s.daysSinceOutreach ?? 0) > 7)
    )
    .sort((a, b) => {
      if (a.hasNewResponse && !b.hasNewResponse) return -1;
      if (!a.hasNewResponse && b.hasNewResponse) return 1;
      return (b.daysSinceOutreach ?? 0) - (a.daysSinceOutreach ?? 0);
    })
    .slice(0, 10);

  // Compute quick stats
  const activeCount = (['reviewing', 'due_diligence', 'snoozed'] as DealStatus[])
    .reduce((sum, s) => sum + (counts?.[s] ?? 0), 0);
  const totalTracked = activeCount + (counts?.invested ?? 0) + (counts?.passed ?? 0);
  const passRate = totalTracked > 0
    ? Math.round(((counts?.passed ?? 0) / totalTracked) * 100)
    : 0;
  const activeWithScore = allStartups.filter(
    (s) => s.status !== 'passed' && s.status !== 'archived' && s.currentScore
  );
  const avgScore = activeWithScore.length > 0
    ? Math.round(
        activeWithScore.reduce((sum, s) => sum + (s.currentScore ?? 0), 0) /
          activeWithScore.length
      )
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm sm:text-base text-gray-600">Your investment decision cockpit</p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="btn-secondary flex items-center flex-1 sm:flex-none justify-center min-h-[44px]"
          >
            {syncMutation.isPending ? (
              <Loader2 className="w-4 h-4 sm:mr-2 animate-spin" />
            ) : (
              <Mail className="w-4 h-4 sm:mr-2" />
            )}
            <span className="hidden sm:inline">{syncMutation.isPending ? 'Checking...' : 'Check Emails'}</span>
          </button>
          <Link to="/startups" className="btn-primary flex-1 sm:flex-none justify-center min-h-[44px]">
            <Upload className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Add Startup</span>
          </Link>
        </div>
      </div>

      {/* Zone 1: Needs Your Decision */}
      <div className="card">
        <div className="p-4 sm:p-5 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-primary-600" />
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Needs Your Decision</h2>
            {actionItems.length > 0 && (
              <span className="px-2 py-0.5 bg-primary-100 text-primary-700 rounded-full text-sm font-medium">
                {actionItems.length}
              </span>
            )}
            <Link
              to="/startups?sortBy=needs_response"
              className="ml-auto text-sm text-primary-600 hover:text-primary-700"
            >
              View all
            </Link>
          </div>
        </div>

        {actionItems.length === 0 ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-10 h-10 mx-auto text-green-400 mb-3" />
            <p className="text-gray-700 font-medium">You're all caught up!</p>
            <p className="text-sm text-gray-400 mt-1">No startups need your attention right now.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {actionItems.map((startup) => {
              const info = getActionInfo(startup);
              const canAdvance = ['reviewing', 'due_diligence', 'snoozed'].includes(startup.status);
              return (
                <div
                  key={startup.id}
                  className={clsx(
                    'flex items-center gap-3 p-3 sm:p-4 border-l-4',
                    info.borderColor
                  )}
                >
                  {/* Dot */}
                  <div className={clsx('w-2 h-2 rounded-full flex-shrink-0', info.dotColor)} />

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-gray-900 truncate">{startup.name}</span>
                      <span className={clsx('px-2 py-0.5 rounded text-xs font-medium', info.badgeColor)}>
                        {info.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">{info.description}</p>
                  </div>

                  {/* Score */}
                  <div className="hidden sm:block flex-shrink-0">
                    <ScoreBadge score={startup.currentScore} startupId={startup.id} size="sm" />
                  </div>

                  {/* Quick actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {canAdvance && (
                      <button
                        onClick={() =>
                          quickAdvanceMutation.mutate({
                            id: startup.id!,
                            nextStatus: getNextStatus(startup.status),
                          })
                        }
                        disabled={quickAdvanceMutation.isPending}
                        className="hidden sm:inline-flex px-2.5 py-1.5 text-xs font-medium bg-primary-50 text-primary-700 hover:bg-primary-100 rounded-lg transition-colors disabled:opacity-50 whitespace-nowrap"
                      >
                        {getAdvanceLabel(startup.status)}
                      </button>
                    )}
                    <button
                      onClick={() => quickSnoozeMutation.mutate(startup.id!)}
                      disabled={quickSnoozeMutation.isPending || startup.status === 'snoozed'}
                      className="p-1.5 text-gray-400 hover:text-amber-600 hover:bg-amber-50 rounded-lg transition-colors disabled:opacity-50"
                      title="Snooze 1 month"
                    >
                      <Pause className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => {
                        setPassModal({ id: startup.id!, name: startup.name });
                        setPassReason(PASS_REASONS[0]);
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Pass on this startup"
                    >
                      <ThumbsDown className="w-4 h-4" />
                    </button>
                    <Link
                      to={`/startups/${startup.id}`}
                      className="p-1.5 text-gray-400 hover:text-primary-600 hover:bg-primary-50 rounded-lg transition-colors"
                      title="Open"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Zone 2 + Zone 3: Pipeline Funnel + Quick Stats */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 sm:gap-6">
        {/* Zone 2: Pipeline Funnel (3/5 width) */}
        <div className="lg:col-span-3 card">
          <div className="p-4 border-b border-gray-200">
            <h2 className="text-base font-semibold text-gray-900">Pipeline</h2>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {(['reviewing', 'due_diligence', 'invested', 'snoozed', 'passed'] as DealStatus[]).map(
              (status) => {
                const config = statusConfig[status];
                const count = counts?.[status] ?? 0;
                return (
                  <Link
                    key={status}
                    to={`/startups?status=${status}`}
                    className="p-3 sm:p-4 rounded-lg border border-gray-200 hover:border-primary-300 hover:shadow-sm transition-all group"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className={clsx('badge text-xs', config.color)}>
                        {config.label}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-primary-400 transition-colors" />
                    </div>
                    <p className="text-2xl sm:text-3xl font-bold text-gray-900">{count}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {count === 1 ? 'startup' : 'startups'}
                    </p>
                  </Link>
                );
              }
            )}
          </div>
        </div>

        {/* Zone 3: Quick Stats (2/5 width) */}
        <div className="lg:col-span-2 grid grid-cols-2 gap-3 content-start">
          {/* Total Active */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart2 className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">Total Active</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{activeCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">in pipeline</p>
          </div>

          {/* Avg Score */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">Avg Score</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{avgScore ?? '—'}</p>
            <p className="text-xs text-gray-400 mt-0.5">active deals</p>
          </div>

          {/* Pass Rate */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Percent className="w-4 h-4 text-gray-400" />
              <span className="text-xs text-gray-500 font-medium">Pass Rate</span>
            </div>
            <p className="text-3xl font-bold text-gray-900">{passRate}%</p>
            <p className="text-xs text-gray-400 mt-0.5">{counts?.passed ?? 0} passed</p>
          </div>

          {/* Needs Action */}
          <div className="card p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className={clsx('w-4 h-4', actionItems.length > 0 ? 'text-amber-500' : 'text-gray-400')} />
              <span className="text-xs text-gray-500 font-medium">Needs Action</span>
            </div>
            <p className={clsx('text-3xl font-bold', actionItems.length > 0 ? 'text-amber-600' : 'text-gray-900')}>
              {actionItems.length}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">items above</p>
          </div>
        </div>
      </div>

      {/* Proposal Queue */}
      {proposalQueue.length > 0 && (
        <div className="card">
          <div className="p-5 border-b border-gray-200 bg-amber-50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Inbox className="w-5 h-5 text-amber-600" />
                <h2 className="text-lg font-semibold text-gray-900">
                  Proposals to Review
                </h2>
                <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-full text-sm font-medium">
                  {proposalQueue.length} pending
                </span>
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              Review these proposals before adding them to your startup tracker.
            </p>
          </div>

          <div className="divide-y divide-gray-200">
            {proposalQueue.map((proposal) => (
              <div key={proposal.id} className="p-4 sm:p-5">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    {/* Startup name and confidence */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                      <h3 className="text-base sm:text-lg font-semibold text-gray-900">
                        {proposal.startupName}
                      </h3>
                      {(() => {
                        const confidencePercent = proposal.confidence <= 1 ? proposal.confidence * 100 : proposal.confidence;
                        return (
                          <span
                            className={clsx(
                              'px-2 py-0.5 rounded text-xs font-medium',
                              confidencePercent >= 80
                                ? 'bg-green-100 text-green-700'
                                : confidencePercent >= 60
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-orange-100 text-orange-700'
                            )}
                          >
                            {Math.round(confidencePercent)}%
                          </span>
                        );
                      })()}
                    </div>

                    {/* Key info */}
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-sm text-gray-600 mb-2">
                      {proposal.website && (
                        <a
                          href={proposal.website.startsWith('http') ? proposal.website : `https://${proposal.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-primary-600 hover:text-primary-700"
                        >
                          <Globe className="w-4 h-4" />
                          {proposal.website.replace(/^https?:\/\//, '')}
                        </a>
                      )}
                      {proposal.founderName && (
                        <span className="flex items-center gap-1">
                          <User className="w-4 h-4" />
                          {proposal.founderName}
                        </span>
                      )}
                      {proposal.askAmount && (
                        <span className="flex items-center gap-1">
                          <DollarSign className="w-4 h-4" />
                          {proposal.askAmount}
                        </span>
                      )}
                      {proposal.stage && (
                        <span className="px-2 py-0.5 bg-gray-100 rounded text-xs capitalize">
                          {proposal.stage.replace('_', ' ')}
                        </span>
                      )}
                    </div>

                    {proposal.description && (
                      <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                        {proposal.description}
                      </p>
                    )}

                    <button
                      onClick={() => setExpandedProposal(expandedProposal === proposal.id ? null : proposal.id)}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                      <Mail className="w-3 h-3" />
                      From: {proposal.emailFromName || proposal.emailFrom} - "{proposal.emailSubject}"
                      <Clock className="w-3 h-3 ml-2" />
                      {new Date(proposal.emailDate).toLocaleDateString()}
                    </button>

                    {expandedProposal === proposal.id && (
                      <div className="mt-3 p-3 bg-gray-50 rounded-lg text-sm text-gray-600">
                        <p className="font-medium text-gray-700 mb-1">Email Preview:</p>
                        <p className="whitespace-pre-wrap line-clamp-6">{proposal.emailPreview}</p>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-1 sm:gap-2 flex-shrink-0 mt-3 sm:mt-0">
                    {processingProposalId === proposal.id ? (
                      <div className="flex items-center gap-2 px-3 py-2 bg-primary-50 rounded-lg">
                        <Loader2 className="w-4 h-4 text-primary-600 animate-spin" />
                        <span className="text-sm text-primary-700">Processing...</span>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => rejectMutation.mutate(proposal.id)}
                          disabled={rejectMutation.isPending || approveMutation.isPending || snoozeMutation.isPending}
                          className="p-3 text-red-600 hover:bg-red-50 active:bg-red-100 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
                          title="Reject - sends polite decline email"
                        >
                          <X className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => snoozeMutation.mutate(proposal.id)}
                          disabled={rejectMutation.isPending || approveMutation.isPending || snoozeMutation.isPending}
                          className="p-3 text-amber-600 hover:bg-amber-50 active:bg-amber-100 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
                          title="Snooze - asks founder to share progress"
                        >
                          <Pause className="w-5 h-5" />
                        </button>
                        <button
                          onClick={() => {
                            setProcessingProposalId(proposal.id);
                            setProcessingProposalName(proposal.startupName);
                            approveMutation.mutate(proposal.id);
                          }}
                          disabled={rejectMutation.isPending || approveMutation.isPending || snoozeMutation.isPending}
                          className="p-3 text-green-600 hover:bg-green-50 active:bg-green-100 rounded-lg transition-colors disabled:opacity-50 min-h-[44px] min-w-[44px] flex items-center justify-center"
                          title="Approve - add to evaluation"
                        >
                          <Check className="w-5 h-5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pass Confirmation Modal */}
      {passModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              Pass on {passModal.name}
            </h3>
            <p className="text-sm text-gray-500 mb-4">Select a reason for passing.</p>

            <div className="space-y-1.5 mb-5 max-h-64 overflow-y-auto">
              {PASS_REASONS.map((reason) => (
                <label
                  key={reason}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-gray-50 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="passReason"
                    value={reason}
                    checked={passReason === reason}
                    onChange={(e) => setPassReason(e.target.value)}
                    className="text-primary-600"
                  />
                  <span className="text-sm text-gray-700">{reason}</span>
                </label>
              ))}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setPassModal(null)}
                className="flex-1 btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => quickPassMutation.mutate({ id: passModal.id, reason: passReason })}
                disabled={quickPassMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50 font-medium text-sm flex items-center justify-center"
              >
                {quickPassMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Pass'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Scanning Overlay */}
      {syncMutation.isPending && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">Scanning Your Inbox</h3>
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-mono text-gray-600">
                  {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>

            <div className="space-y-4 mb-6">
              {SCAN_STEPS.map((step, index) => {
                const StepIcon = step.icon;
                const isActive = index === scanStep;
                const isComplete = index < scanStep;
                const isPending = index > scanStep;

                return (
                  <div
                    key={step.id}
                    className={clsx(
                      'flex items-center gap-4 p-3 rounded-lg transition-all duration-300',
                      isActive && 'bg-primary-50 border border-primary-200',
                      isComplete && 'bg-green-50',
                      isPending && 'opacity-40'
                    )}
                  >
                    <div
                      className={clsx(
                        'flex items-center justify-center w-10 h-10 rounded-full transition-all',
                        isActive && 'bg-primary-100',
                        isComplete && 'bg-green-100',
                        isPending && 'bg-gray-100'
                      )}
                    >
                      {isComplete ? (
                        <CheckCircle className="w-5 h-5 text-green-600" />
                      ) : isActive ? (
                        <StepIcon className="w-5 h-5 text-primary-600 animate-pulse" />
                      ) : (
                        <StepIcon className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1">
                      <p
                        className={clsx(
                          'font-medium transition-colors',
                          isActive && 'text-primary-700',
                          isComplete && 'text-green-700',
                          isPending && 'text-gray-400'
                        )}
                      >
                        {step.label}
                      </p>
                      {isActive && (
                        <div className="mt-1 h-1 bg-primary-100 rounded-full overflow-hidden">
                          <div className="h-full bg-primary-500 rounded-full animate-progress" />
                        </div>
                      )}
                    </div>
                    {isActive && (
                      <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600">
                {scanStep === 0 && 'Establishing secure connection to your email server...'}
                {scanStep === 1 && 'Retrieving emails from the last 7 days...'}
                {scanStep === 2 && 'AI is analyzing each email for startup proposals...'}
                {scanStep === 3 && 'Filtering out newsletters and non-proposals...'}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Please wait, this usually takes 15-30 seconds
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Approval Processing Overlay */}
      {processingProposalId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
            <div className="text-center">
              <div className="mx-auto w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
                <Brain className="w-8 h-8 text-primary-600 animate-pulse" />
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Analyzing {processingProposalName}
              </h3>

              <p className="text-gray-600 mb-6">
                AI is evaluating the startup and generating an investment score...
              </p>

              <div className="space-y-3 mb-6">
                <div className="flex items-center gap-3 p-3 bg-primary-50 rounded-lg">
                  <Loader2 className="w-5 h-5 text-primary-600 animate-spin" />
                  <span className="text-sm text-primary-700">Extracting startup information</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg opacity-60">
                  <Brain className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-500">Analyzing business model & market</span>
                </div>
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg opacity-60">
                  <Target className="w-5 h-5 text-gray-400" />
                  <span className="text-sm text-gray-500">Generating investment score</span>
                </div>
              </div>

              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full animate-progress" style={{ width: '60%' }} />
              </div>
              <p className="text-xs text-gray-400 mt-2">
                This typically takes 5-10 seconds
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Results Modal */}
      {showResultsModal && syncResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Email Scan Complete</h3>
                <button
                  onClick={() => setShowResultsModal(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <XCircle className="w-6 h-6" />
                </button>
              </div>
            </div>

            <div className="p-6 border-b border-gray-200">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-900">{syncResult.processed}</div>
                  <div className="text-sm text-gray-500">Emails Scanned</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-amber-600">{syncResult.queued}</div>
                  <div className="text-sm text-gray-500">Proposals Queued</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-400">{syncResult.skipped}</div>
                  <div className="text-sm text-gray-500">Skipped</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-red-600">{syncResult.failed}</div>
                  <div className="text-sm text-gray-500">Failed</div>
                </div>
              </div>
            </div>

            {syncResult.quotaExceeded && (
              <div className="px-6 py-4 bg-amber-50 border-b border-amber-200">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-amber-800">AI Quota Exceeded</p>
                    <p className="text-sm text-amber-700">
                      Your Gemini API quota has been exceeded. Please upgrade your plan at{' '}
                      <a
                        href="https://aistudio.google.com/apikey"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline hover:no-underline"
                      >
                        Google AI Studio
                      </a>{' '}
                      or wait for the daily quota to reset.
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6">
              {syncResult.results.length === 0 ? (
                <div className="text-center py-8">
                  <Mail className="w-12 h-12 mx-auto text-gray-300 mb-4" />
                  <p className="text-gray-500">No new emails found in the last 7 days.</p>
                  <p className="text-sm text-gray-400 mt-2">
                    Make sure your inbox is configured in Settings.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <h4 className="font-medium text-gray-700 mb-3">Processed Emails:</h4>
                  {syncResult.results.map((result, index) => (
                    <div
                      key={index}
                      className={clsx(
                        'p-4 rounded-lg border',
                        result.startupId
                          ? 'bg-green-50 border-green-200'
                          : result.error
                          ? 'bg-red-50 border-red-200'
                          : 'bg-gray-50 border-gray-200'
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-1">
                          {result.startupId ? (
                            <CheckCircle className="w-5 h-5 text-green-600" />
                          ) : result.error ? (
                            <XCircle className="w-5 h-5 text-red-600" />
                          ) : (
                            <Mail className="w-5 h-5 text-gray-400" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900 truncate">{result.subject}</p>
                          <p className="text-sm text-gray-500 truncate">From: {result.from}</p>
                          {result.startupName && (
                            <div className="flex items-center gap-2 mt-2">
                              <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded text-sm">
                                <FileText className="w-3 h-3" />
                                {result.startupName}
                              </span>
                              {result.startupId && (
                                <Link
                                  to={`/startups/${result.startupId}`}
                                  className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 text-sm"
                                  onClick={() => setShowResultsModal(false)}
                                >
                                  <LinkIcon className="w-3 h-3" />
                                  View
                                </Link>
                              )}
                            </div>
                          )}
                          {result.error && (
                            <p className="text-sm text-red-600 mt-1">{result.error}</p>
                          )}
                          {!result.startupName && !result.error && (
                            <p className="text-sm text-gray-400 mt-1">No startup proposal detected</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200 bg-gray-50 rounded-b-xl">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Scanned emails from the last 7 days
                </p>
                <button
                  onClick={() => setShowResultsModal(false)}
                  className="btn-primary"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
