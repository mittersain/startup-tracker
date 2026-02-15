import { useState } from 'react';
import ScoreBreakdownModal from './ScoreBreakdownModal';

interface Props {
  score: number | null | undefined;
  startupId: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

function getScoreStyle(score: number): { bg: string; text: string; label: string } {
  if (score >= 85) {
    return { bg: 'bg-green-100', text: 'text-green-700', label: 'Exceptional' };
  } else if (score >= 70) {
    return { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Strong' };
  } else if (score >= 55) {
    return { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Promising' };
  } else {
    return { bg: 'bg-red-100', text: 'text-red-700', label: 'Weak' };
  }
}

export default function ScoreBadge({ score, startupId, size = 'md', showLabel = false }: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (score === null || score === undefined) {
    return (
      <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-500">
        Not scored
      </span>
    );
  }

  const style = getScoreStyle(score);

  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
    lg: 'px-3 py-1.5 text-base',
  };

  return (
    <>
      <button
        onClick={() => setIsModalOpen(true)}
        className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${style.bg} ${style.text} ${sizeClasses[size]} hover:opacity-80 transition-opacity cursor-pointer`}
        title="Click to view score breakdown"
      >
        <span>{score}</span>
        {showLabel && <span className="text-xs font-normal opacity-75">/ 100</span>}
      </button>

      <ScoreBreakdownModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        startupId={startupId}
        totalScore={score}
      />
    </>
  );
}
