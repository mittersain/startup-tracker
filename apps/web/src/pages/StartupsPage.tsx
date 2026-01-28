import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { startupsApi, decksApi } from '@/services/api';
import { useDropzone } from 'react-dropzone';
import {
  Plus,
  Search,
  Upload,
  TrendingUp,
  TrendingDown,
  Minus,
  X,
  Loader2,
  FileText,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import type { DealStatus, Startup, FundingStage } from '@startup-tracker/shared';

const statusOptions: { value: DealStatus; label: string }[] = [
  { value: 'reviewing', label: 'Reviewing' },
  { value: 'due_diligence', label: 'Due Diligence' },
  { value: 'invested', label: 'Invested' },
  { value: 'passed', label: 'Passed' },
];

const stageOptions: { value: FundingStage; label: string }[] = [
  { value: 'pre_seed', label: 'Pre-seed' },
  { value: 'seed', label: 'Seed' },
  { value: 'series_a', label: 'Series A' },
  { value: 'series_b', label: 'Series B' },
  { value: 'series_c', label: 'Series C' },
  { value: 'growth', label: 'Growth' },
];

const statusColors: Record<DealStatus, string> = {
  reviewing: 'bg-blue-100 text-blue-700',
  due_diligence: 'bg-yellow-100 text-yellow-700',
  invested: 'bg-green-100 text-green-700',
  passed: 'bg-gray-100 text-gray-700',
  archived: 'bg-gray-100 text-gray-500',
};

export default function StartupsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');

  const status = searchParams.get('status') as DealStatus | null;
  const stage = searchParams.get('stage') as FundingStage | null;

  const { data, isLoading } = useQuery({
    queryKey: ['startups', { status, stage, search: searchParams.get('search') }],
    queryFn: () =>
      startupsApi.list({
        status: status ?? undefined,
        stage: stage ?? undefined,
        search: searchParams.get('search') ?? undefined,
        sortBy: 'currentScore',
        sortOrder: 'desc',
      }),
  });

  const startups = data?.data ?? [];

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams(searchParams);
    if (search) {
      params.set('search', search);
    } else {
      params.delete('search');
    }
    setSearchParams(params);
  };

  const handleFilterChange = (key: string, value: string | null) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    setSearchParams(params);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Startups</h1>
          <p className="text-gray-600">
            {data?.total ?? 0} startup{(data?.total ?? 0) !== 1 ? 's' : ''} in your pipeline
          </p>
        </div>
        <button onClick={() => setShowCreateModal(true)} className="btn-primary">
          <Plus className="w-4 h-4 mr-2" />
          Add Startup
        </button>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-4">
          {/* Search */}
          <form onSubmit={handleSearch} className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search startups..."
                className="input pl-10"
              />
            </div>
          </form>

          {/* Status filter */}
          <select
            value={status ?? ''}
            onChange={(e) => handleFilterChange('status', e.target.value || null)}
            className="input w-auto"
          >
            <option value="">All statuses</option>
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Stage filter */}
          <select
            value={stage ?? ''}
            onChange={(e) => handleFilterChange('stage', e.target.value || null)}
            className="input w-auto"
          >
            <option value="">All stages</option>
            {stageOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Startups list */}
      {isLoading ? (
        <div className="card p-12 text-center">
          <Loader2 className="w-8 h-8 mx-auto text-primary-600 animate-spin" />
          <p className="mt-2 text-gray-600">Loading startups...</p>
        </div>
      ) : startups.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText className="w-12 h-12 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No startups found</h3>
          <p className="text-gray-600 mb-4">
            {searchParams.toString()
              ? 'Try adjusting your filters or search query'
              : 'Add your first startup to get started'}
          </p>
          <button onClick={() => setShowCreateModal(true)} className="btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Startup
          </button>
        </div>
      ) : (
        <div className="card divide-y divide-gray-200">
          {startups.map((startup: Startup) => (
            <Link
              key={startup.id}
              to={`/startups/${startup.id}`}
              className="flex items-center justify-between p-5 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 bg-primary-100 rounded-lg">
                  <span className="text-xl font-bold text-primary-600">
                    {startup.name.charAt(0)}
                  </span>
                </div>
                <div>
                  <p className="font-semibold text-gray-900">{startup.name}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={clsx('badge', statusColors[startup.status])}>
                      {statusOptions.find((s) => s.value === startup.status)?.label}
                    </span>
                    {startup.stage && (
                      <span className="badge bg-gray-100 text-gray-600">
                        {stageOptions.find((s) => s.value === startup.stage)?.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-6">
                {/* Score */}
                <div className="text-right">
                  <div className="flex items-center gap-1">
                    <span className="text-2xl font-bold text-gray-900">
                      {startup.currentScore ?? '-'}
                    </span>
                    {startup.scoreTrend === 'up' && (
                      <TrendingUp className="w-5 h-5 text-success-500" />
                    )}
                    {startup.scoreTrend === 'down' && (
                      <TrendingDown className="w-5 h-5 text-danger-500" />
                    )}
                    {startup.scoreTrend === 'stable' && (
                      <Minus className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                  {startup.scoreTrendDelta != null && startup.scoreTrendDelta !== 0 && (
                    <span
                      className={clsx(
                        'text-xs font-medium',
                        startup.scoreTrendDelta > 0 ? 'text-success-600' : 'text-danger-600'
                      )}
                    >
                      {startup.scoreTrendDelta > 0 ? '+' : ''}
                      {startup.scoreTrendDelta.toFixed(1)} this month
                    </span>
                  )}
                </div>

                {/* Score bar */}
                <div className="w-32">
                  <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={clsx(
                        'h-full rounded-full transition-all',
                        (startup.currentScore ?? 0) >= 70
                          ? 'bg-success-500'
                          : (startup.currentScore ?? 0) >= 50
                          ? 'bg-warning-500'
                          : 'bg-danger-500'
                      )}
                      style={{ width: `${startup.currentScore ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create modal */}
      {showCreateModal && (
        <CreateStartupModal onClose={() => setShowCreateModal(false)} />
      )}
    </div>
  );
}

function CreateStartupModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<'form' | 'upload'>('form');
  const [formData, setFormData] = useState({
    name: '',
    website: '',
    description: '',
    stage: '' as FundingStage | '',
  });
  const [createdStartupId, setCreatedStartupId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const createMutation = useMutation({
    mutationFn: startupsApi.create,
    onSuccess: (data) => {
      setCreatedStartupId(data.id);
      setStep('upload');
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      queryClient.invalidateQueries({ queryKey: ['startup-counts'] });
      toast.success('Startup created!');
    },
    onError: () => {
      toast.error('Failed to create startup');
    },
  });

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'application/pdf': ['.pdf'],
    },
    maxFiles: 1,
    onDrop: async (files) => {
      if (!createdStartupId || files.length === 0) return;

      setIsUploading(true);
      try {
        await decksApi.upload(createdStartupId, files[0]!);
        toast.success('Deck uploaded! AI analysis in progress...');
        queryClient.invalidateQueries({ queryKey: ['startups'] });
        onClose();
      } catch {
        toast.error('Failed to upload deck');
      } finally {
        setIsUploading(false);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: formData.name,
      website: formData.website || undefined,
      description: formData.description || undefined,
      stage: formData.stage || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {step === 'form' ? 'Add New Startup' : 'Upload Pitch Deck'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {step === 'form' ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="label">
                  Startup name *
                </label>
                <input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                  className="input"
                  placeholder="e.g., TechStartup Inc"
                  required
                />
              </div>

              <div>
                <label htmlFor="website" className="label">
                  Website
                </label>
                <input
                  id="website"
                  type="url"
                  value={formData.website}
                  onChange={(e) => setFormData((p) => ({ ...p, website: e.target.value }))}
                  className="input"
                  placeholder="https://example.com"
                />
              </div>

              <div>
                <label htmlFor="stage" className="label">
                  Funding stage
                </label>
                <select
                  id="stage"
                  value={formData.stage}
                  onChange={(e) => setFormData((p) => ({ ...p, stage: e.target.value as FundingStage }))}
                  className="input"
                >
                  <option value="">Select stage</option>
                  {stageOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="description" className="label">
                  Description
                </label>
                <textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                  className="input min-h-[80px]"
                  placeholder="Brief description of the startup"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={onClose} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="btn-primary flex-1"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create & Upload Deck'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-gray-600">
                Upload a pitch deck to automatically analyze the startup with AI.
              </p>

              <div
                {...getRootProps()}
                className={clsx(
                  'border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors',
                  isDragActive
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-300 hover:border-primary-400 hover:bg-gray-50'
                )}
              >
                <input {...getInputProps()} />
                {isUploading ? (
                  <>
                    <Loader2 className="w-12 h-12 mx-auto text-primary-600 animate-spin mb-4" />
                    <p className="text-gray-900 font-medium">Uploading and analyzing...</p>
                  </>
                ) : (
                  <>
                    <Upload className="w-12 h-12 mx-auto text-gray-400 mb-4" />
                    <p className="text-gray-900 font-medium">
                      {isDragActive ? 'Drop the PDF here' : 'Drag & drop a pitch deck PDF'}
                    </p>
                    <p className="text-sm text-gray-500 mt-1">or click to browse</p>
                  </>
                )}
              </div>

              <div className="flex gap-3">
                <button onClick={onClose} className="btn-secondary flex-1">
                  Skip for now
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
