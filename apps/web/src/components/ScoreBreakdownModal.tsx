import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { evaluationApi } from '@/services/api';
import {
  X,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  AlertTriangle,
  Lightbulb,
  Trophy,
} from 'lucide-react';

interface ScoreCriteria {
  name: string;
  score: number;
  maxScore: number;
  commentary: string;
}

interface ScoreSection {
  name: string;
  score: number | null;
  maxScore: number;
  weight: string;
  criteria: ScoreCriteria[];
}

interface ScoreBreakdown {
  startupName: string;
  totalScore: number;
  isPostRevenue: boolean;
  recommendation: string;
  overallCommentary: string;
  strengths: string[];
  concerns: string[];
  sections: ScoreSection[];
  qaHistory: {
    roundsCompleted: number;
    questionsAsked: number;
    questionsAnswered: number;
  };
  scoredAt: string;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  startupId: string;
  totalScore?: number | null;
}

function getScoreColor(score: number, maxScore: number): string {
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
  if (percentage >= 80) return 'text-green-600 bg-green-100';
  if (percentage >= 60) return 'text-blue-600 bg-blue-100';
  if (percentage >= 40) return 'text-yellow-600 bg-yellow-100';
  return 'text-red-600 bg-red-100';
}

function getRecommendationStyle(recommendation: string): { color: string; Icon: typeof Trophy; label: string } {
  switch (recommendation) {
    case 'strong_invest':
      return { color: 'text-green-700 bg-green-100', Icon: Trophy, label: 'Strong Invest' };
    case 'invest':
      return { color: 'text-blue-700 bg-blue-100', Icon: CheckCircle, label: 'Invest' };
    case 'consider':
      return { color: 'text-yellow-700 bg-yellow-100', Icon: Lightbulb, label: 'Consider' };
    default:
      return { color: 'text-red-700 bg-red-100', Icon: AlertTriangle, label: 'Pass' };
  }
}

function ScoreBar({ score, maxScore }: { score: number; maxScore: number }) {
  const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;
  const barColor =
    percentage >= 80
      ? 'bg-green-500'
      : percentage >= 60
        ? 'bg-blue-500'
        : percentage >= 40
          ? 'bg-yellow-500'
          : 'bg-red-500';

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${percentage}%` }} />
      </div>
      <span className="text-sm font-medium text-gray-700 w-16 text-right">
        {score}/{maxScore}
      </span>
    </div>
  );
}

function SectionCard({ section, defaultOpen = false }: { section: ScoreSection; defaultOpen?: boolean }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-gray-900">{section.name}</span>
          <span className="text-sm text-gray-500">({section.weight})</span>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`px-2 py-1 rounded text-sm font-semibold ${getScoreColor(section.score || 0, section.maxScore)}`}
          >
            {section.score || 0}/{section.maxScore}
          </span>
          {isOpen ? (
            <ChevronUp className="h-5 w-5 text-gray-400" />
          ) : (
            <ChevronDown className="h-5 w-5 text-gray-400" />
          )}
        </div>
      </button>

      {isOpen && (
        <div className="p-4 space-y-4">
          {section.criteria.map((criterion, idx) => (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{criterion.name}</span>
                <span className="text-xs text-gray-500">
                  {criterion.score}/{criterion.maxScore}
                </span>
              </div>
              <ScoreBar score={criterion.score} maxScore={criterion.maxScore} />
              <p className="text-xs text-gray-600 mt-1">{criterion.commentary}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ScoreBreakdownModal({ isOpen, onClose, startupId, totalScore }: Props) {
  const { data: breakdown, isLoading } = useQuery<ScoreBreakdown>({
    queryKey: ['evaluation-breakdown', startupId],
    queryFn: () => evaluationApi.getScoreBreakdown(startupId),
    enabled: isOpen && !!startupId && totalScore !== null && totalScore !== undefined,
  });

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const recommendationStyle = breakdown ? getRecommendationStyle(breakdown.recommendation) : null;
  const RecommendationIcon = recommendationStyle?.Icon;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={onClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
            <h3 className="text-xl font-semibold text-gray-900">Score Breakdown</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
              </div>
            ) : !breakdown ? (
              <div className="text-center py-12 text-gray-500">
                <p>No score available yet.</p>
                <p className="text-sm mt-2">Complete the evaluation process to see the breakdown.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {/* Header with total score */}
                <div className="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-xl p-6 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-lg font-medium opacity-90">{breakdown.startupName}</h4>
                      <p className="text-sm opacity-75">
                        {breakdown.isPostRevenue ? 'Post-Revenue' : 'Pre-Revenue'} Evaluation
                      </p>
                    </div>
                    <div className="text-right">
                      <div className="text-5xl font-bold">{breakdown.totalScore}</div>
                      <div className="text-sm opacity-75">out of 100</div>
                    </div>
                  </div>

                  {recommendationStyle && RecommendationIcon && (
                    <div className="mt-4 flex items-center gap-2">
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${recommendationStyle.color}`}
                      >
                        <RecommendationIcon className="h-4 w-4" />
                        {recommendationStyle.label}
                      </span>
                    </div>
                  )}
                </div>

                {/* Overall commentary */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h5 className="text-sm font-medium text-gray-700 mb-2">Overall Assessment</h5>
                  <p className="text-gray-600">{breakdown.overallCommentary}</p>
                </div>

                {/* Strengths & Concerns */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="bg-green-50 rounded-lg p-4">
                    <h5 className="text-sm font-medium text-green-700 mb-2 flex items-center gap-1">
                      <CheckCircle className="h-4 w-4" />
                      Key Strengths
                    </h5>
                    <ul className="space-y-1">
                      {(breakdown.strengths as string[])?.map((strength, idx) => (
                        <li key={idx} className="text-sm text-green-600 flex items-start gap-2">
                          <span className="text-green-400 mt-1">+</span>
                          {strength}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4">
                    <h5 className="text-sm font-medium text-red-700 mb-2 flex items-center gap-1">
                      <AlertTriangle className="h-4 w-4" />
                      Key Concerns
                    </h5>
                    <ul className="space-y-1">
                      {(breakdown.concerns as string[])?.map((concern, idx) => (
                        <li key={idx} className="text-sm text-red-600 flex items-start gap-2">
                          <span className="text-red-400 mt-1">-</span>
                          {concern}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Score sections */}
                <div className="space-y-3">
                  <h5 className="text-sm font-medium text-gray-700">Detailed Breakdown</h5>
                  {breakdown.sections.map((section, idx) => (
                    <SectionCard key={idx} section={section} defaultOpen={idx === 0} />
                  ))}
                </div>

                {/* Q&A History */}
                <div className="bg-gray-50 rounded-lg p-4">
                  <h5 className="text-sm font-medium text-gray-700 mb-2">Evaluation Process</h5>
                  <div className="flex flex-wrap gap-4 text-sm text-gray-600">
                    <span>
                      <strong>{breakdown.qaHistory.roundsCompleted}</strong> Q&A rounds completed
                    </span>
                    <span>
                      <strong>{breakdown.qaHistory.questionsAsked}</strong> questions asked
                    </span>
                    <span>
                      <strong>{breakdown.qaHistory.questionsAnswered}</strong> questions answered
                    </span>
                  </div>
                  {breakdown.scoredAt && (
                    <p className="text-xs text-gray-400 mt-2">
                      Scored on {new Date(breakdown.scoredAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
