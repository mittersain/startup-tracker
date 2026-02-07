import { useMemo, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';

interface ScoreHistoryPoint {
  date: string;
  score: number;
  events: number;
}

interface ScoreTimelineChartProps {
  data: ScoreHistoryPoint[];
  height?: number;
}

const CustomTooltip = ({ active, payload }: {
  active?: boolean;
  payload?: Array<{ value: number; payload: ScoreHistoryPoint }>;
}) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
        <p className="text-sm font-medium text-gray-900">
          {format(parseISO(data.date), 'MMM d, yyyy')}
        </p>
        <p className="text-sm text-gray-600">
          Score: <span className="font-semibold text-primary-600">{data.score}</span>
        </p>
        {data.events > 0 && (
          <p className="text-sm text-gray-600">
            Events: <span className="font-medium">{data.events}</span>
          </p>
        )}
      </div>
    );
  }
  return null;
};

export function ScoreTimelineChart({ data, height = 250 }: ScoreTimelineChartProps) {
  const [selectedDays, setSelectedDays] = useState<30 | 60 | 90>(30);

  const filteredData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const cutoffDate = subDays(new Date(), selectedDays);
    return data
      .filter(point => parseISO(point.date) >= cutoffDate)
      .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime());
  }, [data, selectedDays]);

  const latestScore = filteredData.length > 0 ? filteredData[filteredData.length - 1].score : 0;

  // Color based on score level
  const getChartColor = (score: number) => {
    if (score >= 70) return '#10B981'; // green
    if (score >= 50) return '#3B82F6'; // blue
    if (score >= 40) return '#F59E0B'; // yellow
    return '#EF4444'; // red
  };

  const chartColor = getChartColor(latestScore);

  if (!data || data.length === 0) {
    return (
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Score History</h3>
        </div>
        <div className="flex items-center justify-center h-48 text-gray-500">
          <p>No score history available yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Score History</h3>
        <div className="flex gap-1">
          {([30, 60, 90] as const).map((days) => (
            <button
              key={days}
              onClick={() => setSelectedDays(days)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                selectedDays === days
                  ? 'bg-primary-100 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {days}d
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={filteredData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="scoreGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={chartColor} stopOpacity={0.3} />
              <stop offset="95%" stopColor={chartColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
          <XAxis
            dataKey="date"
            tickFormatter={(date) => format(parseISO(date), 'MMM d')}
            stroke="#9CA3AF"
            fontSize={12}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            stroke="#9CA3AF"
            fontSize={12}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={70} stroke="#10B981" strokeDasharray="5 5" strokeOpacity={0.5} />
          <ReferenceLine y={50} stroke="#F59E0B" strokeDasharray="5 5" strokeOpacity={0.5} />
          <Area
            type="monotone"
            dataKey="score"
            stroke={chartColor}
            strokeWidth={2}
            fill="url(#scoreGradient)"
            dot={{ fill: chartColor, strokeWidth: 0, r: 3 }}
            activeDot={{ fill: chartColor, strokeWidth: 2, stroke: '#fff', r: 5 }}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex justify-center gap-6 mt-3 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 bg-green-500" style={{ borderTop: '2px dashed' }} />
          <span>Strong (70+)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-0.5 bg-yellow-500" style={{ borderTop: '2px dashed' }} />
          <span>Promising (50+)</span>
        </div>
      </div>
    </div>
  );
}
