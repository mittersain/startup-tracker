import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { invitesApi } from '@/services/api';
import {
  Building2,
  Globe,
  TrendingUp,
  MessageSquare,
  Send,
  Loader2,
  AlertTriangle,
  User,
  Clock,
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';

interface Comment {
  id: string;
  authorName: string;
  content: string;
  parentId: string | null;
  createdAt: string;
}

interface StartupData {
  id: string;
  name: string;
  description?: string;
  website?: string;
  stage?: string;
  sector?: string;
  currentScore?: number;
  status?: string;
  founderName?: string;
}

export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accessLevel, setAccessLevel] = useState<'view' | 'comment'>('view');
  const [startup, setStartup] = useState<StartupData | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commenterName, setCommenterName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (token) {
      validateToken();
    }
  }, [token]);

  const validateToken = async () => {
    try {
      setLoading(true);
      const data = await invitesApi.validateToken(token!);
      setAccessLevel(data.accessLevel);
      setStartup(data.startup);
      setComments(data.comments || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid or expired invite link';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim() || !commenterName.trim()) return;

    try {
      setIsSubmitting(true);
      const result = await invitesApi.addCommentViaToken(token!, {
        content: newComment,
        name: commenterName,
      });
      setComments([...comments, result.comment]);
      setNewComment('');
    } catch {
      alert('Failed to add comment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading deal details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-12 h-12 text-danger-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!startup) {
    return null;
  }

  const stageLabels: Record<string, string> = {
    pre_seed: 'Pre-Seed',
    seed: 'Seed',
    series_a: 'Series A',
    series_b: 'Series B',
    growth: 'Growth',
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-primary-600" />
            <span className="text-lg font-bold text-gray-900">Deal Room</span>
          </div>
          <span className="badge bg-primary-100 text-primary-700">
            {accessLevel === 'comment' ? 'View & Comment' : 'View Only'}
          </span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Startup Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 bg-primary-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <span className="text-2xl font-bold text-primary-600">
                {startup.name.charAt(0)}
              </span>
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-bold text-gray-900">{startup.name}</h1>
                {startup.sector && (
                  <span className="badge bg-primary-100 text-primary-700">{startup.sector}</span>
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
                  className="text-sm text-primary-600 hover:text-primary-700 flex items-center gap-1 mt-1"
                >
                  <Globe className="w-3 h-3" />
                  {startup.website}
                </a>
              )}
              {startup.description && (
                <p className="text-gray-600 mt-3">{startup.description}</p>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-200">
            {startup.currentScore && (
              <div>
                <p className="text-sm text-gray-500">Score</p>
                <div className="flex items-center gap-1">
                  <TrendingUp className="w-4 h-4 text-primary-500" />
                  <span className="text-lg font-bold text-gray-900">{startup.currentScore}/100</span>
                </div>
              </div>
            )}
            {startup.founderName && (
              <div>
                <p className="text-sm text-gray-500">Founder</p>
                <div className="flex items-center gap-1">
                  <User className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-900">{startup.founderName}</span>
                </div>
              </div>
            )}
            {startup.status && (
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <span className={clsx(
                  'badge',
                  startup.status === 'reviewing' && 'bg-blue-100 text-blue-700',
                  startup.status === 'due_diligence' && 'bg-yellow-100 text-yellow-700',
                  startup.status === 'invested' && 'bg-green-100 text-green-700',
                  startup.status === 'passed' && 'bg-gray-100 text-gray-700',
                )}>
                  {startup.status.replace('_', ' ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Discussion Section */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-gray-400" />
            Discussion
          </h2>

          {/* Comment Input (if allowed) */}
          {accessLevel === 'comment' && (
            <div className="mb-6 p-4 bg-gray-50 rounded-xl">
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                <input
                  type="text"
                  value={commenterName}
                  onChange={(e) => setCommenterName(e.target.value)}
                  placeholder="Enter your name"
                  className="input w-full"
                />
              </div>
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 mb-1">Comment</label>
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Share your thoughts on this deal..."
                  className="input w-full min-h-[80px] resize-none"
                  rows={3}
                />
              </div>
              <button
                onClick={handleSubmitComment}
                disabled={!newComment.trim() || !commenterName.trim() || isSubmitting}
                className="btn btn-primary"
              >
                {isSubmitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Post Comment
              </button>
            </div>
          )}

          {/* Comments List */}
          <div className="space-y-4">
            {comments.length > 0 ? (
              comments
                .filter(c => !c.parentId)
                .map((comment) => {
                  const replies = comments.filter(c => c.parentId === comment.id);
                  return (
                    <div key={comment.id} className="border-b border-gray-100 pb-4 last:border-0">
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-medium text-primary-600">
                            {comment.authorName.charAt(0).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">{comment.authorName}</span>
                            <span className="text-xs text-gray-500 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {format(new Date(comment.createdAt), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          <p className="text-gray-700 mt-1 whitespace-pre-wrap">{comment.content}</p>

                          {/* Replies */}
                          {replies.length > 0 && (
                            <div className="mt-3 ml-4 pl-4 border-l-2 border-gray-200 space-y-3">
                              {replies.map((reply) => (
                                <div key={reply.id} className="flex items-start gap-2">
                                  <div className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center flex-shrink-0">
                                    <span className="text-xs font-medium text-gray-600">
                                      {reply.authorName.charAt(0).toUpperCase()}
                                    </span>
                                  </div>
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-medium text-gray-900">{reply.authorName}</span>
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
              <div className="text-center py-8 text-gray-500">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                <p>No comments yet</p>
                {accessLevel === 'comment' && (
                  <p className="text-sm mt-1">Be the first to share your thoughts!</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-sm text-gray-500 mt-8">
          This is a private deal room. Please keep all information confidential.
        </p>
      </main>
    </div>
  );
}
