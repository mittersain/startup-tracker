import axios, { AxiosError } from 'axios';
import { useAuthStore } from '@/stores/auth.store';
import type { AuthTokens } from '@startup-tracker/shared';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use((config) => {
  const { tokens } = useAuthStore.getState();
  if (tokens?.accessToken) {
    config.headers.Authorization = `Bearer ${tokens.accessToken}`;
  }
  return config;
});

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && originalRequest && !('_retry' in originalRequest)) {
      (originalRequest as typeof originalRequest & { _retry: boolean })._retry = true;

      const { tokens, updateTokens, logout } = useAuthStore.getState();

      if (tokens?.refreshToken) {
        try {
          const response = await axios.post<AuthTokens>(`${import.meta.env.VITE_API_URL || '/api'}/auth/refresh`, {
            refreshToken: tokens.refreshToken,
          });

          updateTokens(response.data);

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${response.data.accessToken}`;
          }

          return api(originalRequest);
        } catch {
          logout();
          window.location.href = '/login';
        }
      } else {
        logout();
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;

// Auth API
export const authApi = {
  login: async (email: string, password: string) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },

  register: async (email: string, password: string, name: string, organizationName: string) => {
    const response = await api.post('/auth/register', {
      email,
      password,
      name,
      organizationName,
    });
    return response.data;
  },

  logout: async (refreshToken: string) => {
    await api.post('/auth/logout', { refreshToken });
  },

  me: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },
};

// Startups API
export const startupsApi = {
  list: async (params?: {
    status?: string;
    excludeStatus?: string;
    stage?: string;
    search?: string;
    sortBy?: string;
    sortOrder?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const response = await api.get('/startups', { params });
    return response.data;
  },

  getCounts: async () => {
    const response = await api.get('/startups/counts');
    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get(`/startups/${id}`);
    return response.data;
  },

  create: async (data: { name: string; website?: string; description?: string; stage?: string }) => {
    const response = await api.post('/startups', data);
    return response.data;
  },

  update: async (id: string, data: Partial<{ name: string; website: string; description: string; status: string; stage: string; notes: string; tags: string[]; gpNotes: string }>) => {
    const response = await api.patch(`/startups/${id}`, data);
    return response.data;
  },

  updateStatus: async (id: string, status: string) => {
    const response = await api.patch(`/startups/${id}/status`, { status });
    return response.data;
  },

  delete: async (id: string) => {
    await api.delete(`/startups/${id}`);
  },

  getScoreEvents: async (id: string, params?: { limit?: number; offset?: number; category?: string }) => {
    const response = await api.get(`/startups/${id}/score-events`, { params });
    return response.data;
  },

  getScoreHistory: async (id: string, days = 30) => {
    const response = await api.get(`/startups/${id}/score-history`, { params: { days } });
    return response.data;
  },

  getAnalysisHistory: async (id: string) => {
    const response = await api.get(`/startups/${id}/analysis-history`);
    return response.data;
  },

  addScoreEvent: async (id: string, data: { category: string; signal: string; impact: number; evidence?: string }) => {
    const response = await api.post(`/startups/${id}/score-events`, data);
    return response.data;
  },

  sendDraftReply: async (id: string) => {
    const response = await api.post(`/startups/${id}/send-reply`);
    return response.data;
  },

  updateDraftReply: async (id: string, draftReply: string) => {
    const response = await api.patch(`/startups/${id}/draft-reply`, { draftReply });
    return response.data;
  },

  resetDraftReplyStatus: async (id: string) => {
    const response = await api.patch(`/startups/${id}/draft-reply`, { draftReplyStatus: 'pending' });
    return response.data;
  },

  rescanAttachments: async (id: string) => {
    const response = await api.post(`/startups/${id}/rescan-attachments`);
    return response.data;
  },

  generateScoreEvents: async (id: string) => {
    const response = await api.post(`/startups/${id}/generate-score-events`);
    return response.data;
  },

  snooze: async (id: string, reason: string, followUpMonths?: number) => {
    const response = await api.post(`/startups/${id}/snooze`, { reason, followUpMonths });
    return response.data;
  },

  pass: async (id: string, reason: string) => {
    const response = await api.post(`/startups/${id}/pass`, { reason });
    return response.data;
  },

  sendDecisionEmail: async (id: string, emailBody: string, emailSubject?: string) => {
    const response = await api.post(`/startups/${id}/send-decision-email`, { emailBody, emailSubject });
    return response.data;
  },

  recordFounderUpdate: async (id: string, updateContent: string, source?: string) => {
    const response = await api.post(`/startups/${id}/founder-update`, { updateContent, source });
    return response.data;
  },

  markResponseRead: async (id: string) => {
    const response = await api.post(`/startups/${id}/mark-response-read`);
    return response.data;
  },

  // AI Chat
  getChatHistory: async (id: string) => {
    const response = await api.get(`/startups/${id}/chat`);
    return response.data;
  },

  sendChatMessage: async (id: string, message: string) => {
    const response = await api.post(`/startups/${id}/chat`, { message });
    return response.data;
  },

  clearChatHistory: async (id: string) => {
    const response = await api.delete(`/startups/${id}/chat`);
    return response.data;
  },

  // Enrichment
  triggerEnrichment: async (id: string) => {
    const response = await api.post(`/startups/${id}/enrich`);
    return response.data;
  },

  getEnrichment: async (id: string) => {
    const response = await api.get(`/startups/${id}/enrichment`);
    return response.data;
  },

  // Investment Memo
  generateMemo: async (id: string) => {
    const response = await api.post(`/startups/${id}/generate-memo`);
    return response.data;
  },
};

// Reminders API
export const remindersApi = {
  getPending: async () => {
    const response = await api.get('/reminders');
    return response.data;
  },

  dismiss: async (id: string) => {
    const response = await api.post(`/reminders/${id}/dismiss`);
    return response.data;
  },
};

// Alerts API
export const alertsApi = {
  getUnread: async () => {
    const response = await api.get('/alerts');
    return response.data;
  },

  markAsRead: async (id: string) => {
    const response = await api.post(`/alerts/${id}/read`);
    return response.data;
  },
};

// Decks API
export const decksApi = {
  upload: async (startupId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);

    const response = await api.post(`/decks/startup/${startupId}`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get(`/decks/${id}`);
    return response.data;
  },

  getByStartup: async (startupId: string) => {
    const response = await api.get(`/decks/startup/${startupId}`);
    return response.data;
  },

  reprocess: async (id: string) => {
    const response = await api.post(`/decks/${id}/reprocess`);
    return response.data;
  },

  getDownloadUrl: (id: string) => {
    // Return the download URL that goes through the backend
    const baseUrl = import.meta.env.VITE_API_URL || '/api';
    return `${baseUrl}/decks/${id}/download`;
  },

  delete: async (id: string) => {
    await api.delete(`/decks/${id}`);
  },
};

// Emails API
export const emailsApi = {
  getByStartup: async (startupId: string, params?: { limit?: number; offset?: number }) => {
    const response = await api.get(`/emails/startup/${startupId}`, { params });
    return response.data;
  },

  getUnmatched: async (params?: { limit?: number; offset?: number }) => {
    const response = await api.get('/emails/unmatched', { params });
    return response.data;
  },

  match: async (emailId: string, startupId: string) => {
    const response = await api.post(`/emails/${emailId}/match`, { startupId });
    return response.data;
  },

  compose: async (startupId: string, data: { to?: string; subject: string; body: string; replyToEmailId?: string }) => {
    const response = await api.post(`/emails/startup/${startupId}/compose`, data);
    return response.data;
  },

  getContacts: async (startupId: string) => {
    const response = await api.get(`/emails/contacts/${startupId}`);
    return response.data;
  },

  addContact: async (startupId: string, data: { email: string; name?: string; role?: string }) => {
    const response = await api.post(`/emails/contacts/${startupId}`, data);
    return response.data;
  },

  updateContact: async (contactId: string, data: { name?: string; role?: string; matchType?: string }) => {
    const response = await api.patch(`/emails/contacts/${contactId}`, data);
    return response.data;
  },

  deleteContact: async (contactId: string) => {
    await api.delete(`/emails/contacts/${contactId}`);
  },

  getMetrics: async (startupId: string) => {
    const response = await api.get(`/emails/metrics/${startupId}`);
    return response.data;
  },

  analyze: async (emailId: string) => {
    const response = await api.post(`/emails/${emailId}/analyze`);
    return response.data;
  },

  generateReply: async (emailId: string): Promise<{
    success: boolean;
    recommendation: 'continue' | 'pass' | 'schedule_call';
    recommendationReason: string;
    draftReply: string;
    suggestedQuestions: string[];
    responseQuality: {
      score: number;
      clarity: number;
      responsiveness: number;
      substance: number;
      concerns: string[];
      positives: string[];
    };
  }> => {
    const response = await api.post(`/emails/${emailId}/generate-reply`);
    return response.data;
  },
};

// Inbox API
export const inboxApi = {
  getConfig: async () => {
    const response = await api.get('/inbox/config');
    return response.data;
  },

  saveConfig: async (config: {
    host: string;
    port: number;
    user: string;
    password: string;
    tls?: boolean;
    folder?: string;
    pollingEnabled?: boolean;
    pollingInterval?: number;
  }) => {
    const response = await api.post('/inbox/config', config);
    return response.data;
  },

  testConnection: async (config: {
    host: string;
    port: number;
    user: string;
    password: string;
    tls?: boolean;
    folder?: string;
  }) => {
    const response = await api.post('/inbox/test', config);
    return response.data;
  },

  processInbox: async () => {
    const response = await api.post('/inbox/process');
    return response.data;
  },

  syncInbox: async () => {
    const response = await api.post('/inbox/sync');
    return response.data;
  },

  parseContent: async (content: string, subject?: string, from?: string, createStartup?: boolean) => {
    const response = await api.post('/inbox/parse', { content, subject, from, createStartup });
    return response.data;
  },

  // Proposal Queue
  getQueue: async () => {
    const response = await api.get('/inbox/queue');
    return response.data;
  },

  approveProposal: async (id: string) => {
    const response = await api.post(`/inbox/queue/${id}/approve`);
    return response.data;
  },

  rejectProposal: async (id: string, reason?: string) => {
    const response = await api.post(`/inbox/queue/${id}/reject`, { reason });
    return response.data;
  },

  snoozeProposal: async (id: string) => {
    const response = await api.post(`/inbox/queue/${id}/snooze`);
    return response.data;
  },

  checkSnoozedProposals: async () => {
    const response = await api.post('/inbox/queue/check-snoozed');
    return response.data;
  },
};

// Backup API
export const backupApi = {
  getStatus: async () => {
    const response = await api.get('/backup/status');
    return response.data;
  },

  listBackups: async () => {
    const response = await api.get('/backup/list');
    return response.data;
  },

  createBackup: async () => {
    const response = await api.post('/backup/create');
    return response.data;
  },

  checkIntegrity: async () => {
    const response = await api.get('/backup/integrity');
    return response.data;
  },

  restore: async (backupName: string) => {
    const response = await api.post('/backup/restore', { backupName });
    return response.data;
  },
};

// Evaluation API
export const evaluationApi = {
  get: async (startupId: string) => {
    const response = await api.get(`/evaluation/${startupId}`);
    return response.data;
  },

  initialize: async (startupId: string, isPostRevenue: boolean) => {
    const response = await api.post(`/evaluation/${startupId}/initialize`, { isPostRevenue });
    return response.data;
  },

  generateQuestions: async (startupId: string) => {
    const response = await api.post(`/evaluation/${startupId}/generate-questions`);
    return response.data;
  },

  sendQuestions: async (startupId: string, qaRoundId: string, customEmail?: string) => {
    const response = await api.post(`/evaluation/${startupId}/send-questions`, { qaRoundId, customEmail });
    return response.data;
  },

  recordResponse: async (
    startupId: string,
    qaRoundId: string,
    data: { emailBody?: string; manualResponses?: Array<{ questionId: string; answer: string }> }
  ) => {
    const response = await api.post(`/evaluation/${startupId}/record-response`, { qaRoundId, ...data });
    return response.data;
  },

  score: async (startupId: string) => {
    const response = await api.post(`/evaluation/${startupId}/score`);
    return response.data;
  },

  getScoreBreakdown: async (startupId: string) => {
    const response = await api.get(`/evaluation/${startupId}/score-breakdown`);
    return response.data;
  },
};

// Users API
export const usersApi = {
  list: async () => {
    const response = await api.get('/users');
    return response.data;
  },

  getById: async (id: string) => {
    const response = await api.get(`/users/${id}`);
    return response.data;
  },

  update: async (id: string, data: { name?: string; avatarUrl?: string }) => {
    const response = await api.patch(`/users/${id}`, data);
    return response.data;
  },

  updateRole: async (id: string, role: string) => {
    const response = await api.patch(`/users/${id}/role`, { role });
    return response.data;
  },

  changePassword: async (id: string, currentPassword: string, newPassword: string) => {
    const response = await api.post(`/users/${id}/password`, { currentPassword, newPassword });
    return response.data;
  },

  invite: async (email: string, name: string, role: string) => {
    const response = await api.post('/users/invite', { email, name, role });
    return response.data;
  },

  delete: async (id: string) => {
    await api.delete(`/users/${id}`);
  },

  // Get users for @mentions
  listForMentions: async () => {
    const response = await api.get('/users/list');
    return response.data;
  },
};

// Comments API
export const commentsApi = {
  getByStartup: async (startupId: string) => {
    const response = await api.get(`/startups/${startupId}/comments`);
    return response.data;
  },

  add: async (startupId: string, data: { content: string; parentId?: string; mentions?: string[] }) => {
    const response = await api.post(`/startups/${startupId}/comments`, data);
    return response.data;
  },

  update: async (commentId: string, content: string) => {
    const response = await api.put(`/comments/${commentId}`, { content });
    return response.data;
  },

  delete: async (commentId: string) => {
    await api.delete(`/comments/${commentId}`);
  },
};

// Deal Invites API (for co-investors)
export const invitesApi = {
  getByStartup: async (startupId: string) => {
    const response = await api.get(`/startups/${startupId}/invites`);
    return response.data;
  },

  send: async (startupId: string, data: { email: string; accessLevel: 'view' | 'comment' }) => {
    const response = await api.post(`/startups/${startupId}/invite`, data);
    return response.data;
  },

  revoke: async (startupId: string, inviteId: string) => {
    await api.delete(`/startups/${startupId}/invite/${inviteId}`);
  },

  // Magic link validation (no auth required)
  validateToken: async (token: string) => {
    const response = await api.get(`/invite/${token}`);
    return response.data;
  },

  // Add comment via magic link (no auth required)
  addCommentViaToken: async (token: string, data: { content: string; name?: string }) => {
    const response = await api.post(`/invite/${token}/comment`, data);
    return response.data;
  },
};

// Notifications API
export const notificationsApi = {
  list: async (params?: { limit?: number }) => {
    const response = await api.get('/notifications', { params });
    return response.data;
  },

  getUnreadCount: async () => {
    const response = await api.get('/notifications/unread-count');
    return response.data;
  },

  markAsRead: async (notificationId: string) => {
    const response = await api.put(`/notifications/${notificationId}/read`);
    return response.data;
  },

  markAllAsRead: async () => {
    const response = await api.put('/notifications/read-all');
    return response.data;
  },
};
