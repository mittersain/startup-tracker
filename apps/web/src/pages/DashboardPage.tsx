import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { startupsApi, inboxApi } from '@/services/api';
import {
  TrendingUp,
  TrendingDown,
  Minus,
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

// Scanning progress steps
const SCAN_STEPS = [
  { id: 'connect', label: 'Connecting to inbox', icon: Server, duration: 2000 },
  { id: 'fetch', label: 'Fetching recent emails', icon: Mail, duration: 3000 },
  { id: 'analyze', label: 'Analyzing with AI', icon: Brain, duration: 8000 },
  { id: 'filter', label: 'Filtering proposals', icon: Filter, duration: 2000 },
];

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

  const { data: counts } = useQuery({
    queryKey: ['startup-counts'],
    queryFn: startupsApi.getCounts,
  });

  const { data: startups } = useQuery({
    queryKey: ['startups', { sortBy: 'currentScore', sortOrder: 'desc', pageSize: 10, excludeStatus: 'passed' }],
    queryFn: () => startupsApi.list({ sortBy: 'currentScore', sortOrder: 'desc', pageSize: 10, excludeStatus: 'passed' }),
  });

  // Fetch proposal queue
  const { data: queueData } = useQuery({
    queryKey: ['proposal-queue'],
    queryFn: inboxApi.getQueue,
  });

  const proposalQueue: QueuedProposal[] = queueData?.proposals ?? [];

  const syncMutation = useMutation({
    mutationFn: inboxApi.syncInbox,
    onMutate: () => {
      // Reset and start progress tracking
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
      queryClient.invalidateQueries({ queryKey: ['proposal-queue'] });
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

  const recentStartups = startups?.data ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm sm:text-base text-gray-600">Track your startup investment pipeline</p>
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

      {/* Pipeline Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        {(['reviewing', 'due_diligence', 'invested', 'snoozed', 'passed'] as DealStatus[]).map((status) => {
          const config = statusConfig[status];
          const count = counts?.[status] ?? 0;

          return (
            <Link
              key={status}
              to={`/startups?status=${status}`}
              className="card p-3 sm:p-5 hover:shadow-md transition-shadow active:bg-gray-50"
            >
              <div className="flex items-center justify-between">
                <span className={clsx('badge text-xs', config.color)}>
                  {config.label}
                </span>
                <ArrowRight className="w-4 h-4 text-gray-400 hidden sm:block" />
              </div>
              <p className="mt-2 sm:mt-3 text-2xl sm:text-3xl font-bold text-gray-900">{count}</p>
              <p className="text-xs sm:text-sm text-gray-500">
                {count === 1 ? 'startup' : 'startups'}
              </p>
            </Link>
          );
        })}
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
                        // Normalize confidence: if <= 1, it's a decimal (0.95 = 95%), otherwise it's already a percentage
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

                    {/* Description */}
                    {proposal.description && (
                      <p className="text-sm text-gray-600 mb-2 line-clamp-2">
                        {proposal.description}
                      </p>
                    )}

                    {/* Email source */}
                    <button
                      onClick={() => setExpandedProposal(expandedProposal === proposal.id ? null : proposal.id)}
                      className="text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
                    >
                      <Mail className="w-3 h-3" />
                      From: {proposal.emailFromName || proposal.emailFrom} - "{proposal.emailSubject}"
                      <Clock className="w-3 h-3 ml-2" />
                      {new Date(proposal.emailDate).toLocaleDateString()}
                    </button>

                    {/* Expanded email preview */}
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

      {/* Recent Startups */}
      <div className="card">
        <div className="p-4 sm:p-5 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900">Top Scored Startups</h2>
            <Link to="/startups" className="text-sm text-primary-600 hover:text-primary-700 active:text-primary-800 min-h-[44px] flex items-center">
              View all
            </Link>
          </div>
        </div>

        {recentStartups.length === 0 ? (
          <div className="p-12 text-center">
            <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No startups yet</h3>
            <p className="text-gray-600 mb-4">
              Upload a pitch deck to get started with AI-powered analysis
            </p>
            <Link to="/startups" className="btn-primary">
              Add your first startup
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {recentStartups.map((startup: Startup) => (
              <Link
                key={startup.id}
                to={`/startups/${startup.id}`}
                className={clsx(
                  "flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 hover:bg-gray-50 active:bg-gray-100 transition-colors gap-3",
                  startup.hasNewResponse && "bg-green-50 border-l-4 border-green-500"
                )}
              >
                <div className="flex items-center gap-3 sm:gap-4">
                  <div className={clsx(
                    "flex items-center justify-center w-10 h-10 rounded-lg flex-shrink-0 relative",
                    startup.hasNewResponse ? "bg-green-100" : "bg-primary-100"
                  )}>
                    <span className={clsx(
                      "text-lg font-bold",
                      startup.hasNewResponse ? "text-green-600" : "text-primary-600"
                    )}>
                      {startup.name.charAt(0)}
                    </span>
                    {startup.hasNewResponse && (
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full animate-pulse" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 truncate">{startup.name}</p>
                      {startup.hasNewResponse && (
                        <span className="badge bg-green-100 text-green-700 text-xs flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          New response
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={clsx('badge text-xs', statusConfig[startup.status]?.color || 'bg-gray-100 text-gray-700')}>
                        {statusConfig[startup.status]?.label || startup.status}
                      </span>
                      {startup.stage && (
                        <span className="text-xs text-gray-500 capitalize">
                          {startup.stage.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 sm:gap-4 pl-13 sm:pl-0" onClick={(e) => e.preventDefault()}>
                  {/* Score with breakdown modal */}
                  <div className="flex items-center gap-2">
                    <ScoreBadge score={startup.currentScore} startupId={startup.id} size="lg" />
                    {startup.scoreTrend === 'up' && (
                      <TrendingUp className="w-4 h-4 text-success-500" />
                    )}
                    {startup.scoreTrend === 'down' && (
                      <TrendingDown className="w-4 h-4 text-danger-500" />
                    )}
                    {startup.scoreTrend === 'stable' && startup.currentScore && (
                      <Minus className="w-4 h-4 text-gray-400" />
                    )}
                  </div>

                  {/* Score bar */}
                  {startup.currentScore && (
                    <div className="w-20 sm:w-24">
                      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className={clsx(
                            'h-full rounded-full transition-all',
                            startup.currentScore >= 70
                              ? 'bg-success-500'
                              : startup.currentScore >= 50
                              ? 'bg-warning-500'
                              : 'bg-danger-500'
                          )}
                          style={{ width: `${startup.currentScore}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Alerts placeholder */}
      <div className="card p-5">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle className="w-5 h-5 text-warning-500" />
          <h2 className="text-lg font-semibold text-gray-900">Recent Alerts</h2>
        </div>
        <p className="text-gray-500">
          Score changes and red flags will appear here when detected from email communications.
        </p>
      </div>

      {/* Scanning Overlay - Enhanced with progress steps */}
      {syncMutation.isPending && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full mx-4">
            {/* Header with timer */}
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-gray-900">Scanning Your Inbox</h3>
              <div className="flex items-center gap-2 px-3 py-1 bg-gray-100 rounded-full">
                <Clock className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-mono text-gray-600">
                  {Math.floor(elapsedTime / 60)}:{(elapsedTime % 60).toString().padStart(2, '0')}
                </span>
              </div>
            </div>

            {/* Progress steps */}
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

            {/* Status message */}
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
              {/* Animated icon */}
              <div className="mx-auto w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mb-4">
                <Brain className="w-8 h-8 text-primary-600 animate-pulse" />
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-2">
                Analyzing {processingProposalName}
              </h3>

              <p className="text-gray-600 mb-6">
                AI is evaluating the startup and generating an investment score...
              </p>

              {/* Progress indicator */}
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

              {/* Loading bar */}
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
            {/* Header */}
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

            {/* Stats */}
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

            {/* Quota Warning */}
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

            {/* Results List */}
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

            {/* Footer */}
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
