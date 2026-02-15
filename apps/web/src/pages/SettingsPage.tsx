import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi, inboxApi, backupApi } from '@/services/api';
import {
  User,
  Users,
  Mail,
  Shield,
  Key,
  Loader2,
  Inbox,
  CheckCircle,
  XCircle,
  RefreshCw,
  Send,
  Download,
  Database,
  HardDrive,
  AlertTriangle,
} from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { permissions } = useAuthStore();
  const [activeTab, setActiveTab] = useState<'profile' | 'team' | 'integrations'>('profile');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600">Manage your account and organization settings</p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-8">
          {[
            { id: 'profile', label: 'Profile', icon: User },
            ...(permissions?.canManageUsers ? [{ id: 'team', label: 'Collab', icon: Users }] : []),
            { id: 'integrations', label: 'Integrations', icon: Mail },
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

      {activeTab === 'profile' && <ProfileSettings />}
      {activeTab === 'team' && permissions?.canManageUsers && <TeamSettings />}
      {activeTab === 'integrations' && <IntegrationsSettings />}
    </div>
  );
}

function ProfileSettings() {
  const { user } = useAuthStore();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: user?.name ?? '',
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await usersApi.update(user!.id, { name: formData.name });
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    if (passwordData.newPassword.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      await usersApi.changePassword(
        user!.id,
        passwordData.currentPassword,
        passwordData.newPassword
      );
      toast.success('Password changed');
      setPasswordData({ currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch {
      toast.error('Failed to change password');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Profile form */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Profile Information</h3>
        <form onSubmit={handleUpdateProfile} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              value={user?.email ?? ''}
              disabled
              className="input bg-gray-50"
            />
          </div>

          <div>
            <label htmlFor="name" className="label">
              Name
            </label>
            <input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              className="input"
            />
          </div>

          <div>
            <label className="label">Role</label>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-gray-400" />
              <span className="text-gray-900 capitalize">{user?.role}</span>
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Save Changes
          </button>
        </form>
      </div>

      {/* Password form */}
      <div className="card p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Change Password</h3>
        <form onSubmit={handleChangePassword} className="space-y-4">
          <div>
            <label htmlFor="currentPassword" className="label">
              Current Password
            </label>
            <input
              id="currentPassword"
              type="password"
              value={passwordData.currentPassword}
              onChange={(e) =>
                setPasswordData((p) => ({ ...p, currentPassword: e.target.value }))
              }
              className="input"
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="label">
              New Password
            </label>
            <input
              id="newPassword"
              type="password"
              value={passwordData.newPassword}
              onChange={(e) =>
                setPasswordData((p) => ({ ...p, newPassword: e.target.value }))
              }
              className="input"
              minLength={8}
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="label">
              Confirm New Password
            </label>
            <input
              id="confirmPassword"
              type="password"
              value={passwordData.confirmPassword}
              onChange={(e) =>
                setPasswordData((p) => ({ ...p, confirmPassword: e.target.value }))
              }
              className="input"
            />
          </div>

          <button type="submit" disabled={isLoading} className="btn-primary">
            {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Change Password
          </button>
        </form>
      </div>
    </div>
  );
}

function TeamSettings() {
  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  });

  const [showInviteModal, setShowInviteModal] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">Collaborators</h3>
        <button onClick={() => setShowInviteModal(true)} className="btn-primary">
          Invite Collaborator
        </button>
      </div>

      <div className="card">
        {isLoading ? (
          <div className="p-8 text-center">
            <Loader2 className="w-6 h-6 mx-auto text-primary-600 animate-spin" />
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {users?.map((u: { id: string; name: string; email: string; role: string }) => (
              <div key={u.id} className="flex items-center justify-between p-4">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 bg-primary-100 rounded-full">
                    <User className="w-5 h-5 text-primary-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{u.name}</p>
                    <p className="text-sm text-gray-500">{u.email}</p>
                  </div>
                </div>
                <span className="badge bg-gray-100 text-gray-600 capitalize">{u.role}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {showInviteModal && <InviteModal onClose={() => setShowInviteModal(false)} />}
    </div>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    role: 'analyst' as string,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      await usersApi.invite(formData.email, formData.name, formData.role);
      toast.success('Invitation sent');
      onClose();
    } catch {
      toast.error('Failed to send invitation');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Invite Collaborator</h3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="invite-email" className="label">
              Email
            </label>
            <input
              id="invite-email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData((p) => ({ ...p, email: e.target.value }))}
              className="input"
              required
            />
          </div>

          <div>
            <label htmlFor="invite-name" className="label">
              Name
            </label>
            <input
              id="invite-name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
              className="input"
              required
            />
          </div>

          <div>
            <label htmlFor="invite-role" className="label">
              Role
            </label>
            <select
              id="invite-role"
              value={formData.role}
              onChange={(e) => setFormData((p) => ({ ...p, role: e.target.value }))}
              className="input"
            >
              <option value="admin">Admin</option>
              <option value="partner">Partner</option>
              <option value="analyst">Analyst</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">
              Cancel
            </button>
            <button type="submit" disabled={isLoading} className="btn-primary flex-1">
              {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Send Invite
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function IntegrationsSettings() {
  return (
    <div className="space-y-6">
      {/* Email Inbox for Startup Proposals (Gmail via IMAP) */}
      <EmailInboxSettings />

      {/* Database Backup */}
      <DatabaseBackupSettings />

      <div className="card p-6 opacity-50">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-12 h-12 bg-gray-100 rounded-lg">
            <Key className="w-6 h-6 text-gray-400" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">API Keys</h3>
            <p className="text-sm text-gray-600 mt-1">
              Generate API keys for programmatic access to your data.
            </p>
            <p className="text-sm text-gray-500 mt-3">Coming soon</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DatabaseBackupSettings() {
  const queryClient = useQueryClient();
  const [showBackups, setShowBackups] = useState(false);

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['backup-status'],
    queryFn: backupApi.getStatus,
    refetchInterval: 60000, // Refresh every minute
  });

  const { data: backupList } = useQuery({
    queryKey: ['backup-list'],
    queryFn: backupApi.listBackups,
    enabled: showBackups,
  });

  const createBackupMutation = useMutation({
    mutationFn: backupApi.createBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['backup-status'] });
      queryClient.invalidateQueries({ queryKey: ['backup-list'] });
      toast.success('Backup created successfully');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to create backup');
    },
  });

  const integrityMutation = useMutation({
    mutationFn: backupApi.checkIntegrity,
    onSuccess: (data) => {
      if (data.ok) {
        toast.success('Database integrity check passed');
      } else {
        toast.error(`Integrity issues found: ${data.message}`);
      }
      queryClient.invalidateQueries({ queryKey: ['backup-status'] });
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to check integrity');
    },
  });

  if (statusLoading) {
    return (
      <div className="card p-6">
        <Loader2 className="w-6 h-6 mx-auto text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg">
            <Database className="w-6 h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Database & Backups</h3>
            <p className="text-sm text-gray-600 mt-1">
              Automatic backups keep your data safe. Manual backups available anytime.
            </p>

            {status && status.stats && (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1 text-gray-600">
                    <HardDrive className="w-4 h-4" />
                    Database: {status.stats.dbSizeFormatted}
                  </span>
                  <span className="flex items-center gap-1 text-gray-600">
                    <Download className="w-4 h-4" />
                    {status.stats.backupCount} backups
                  </span>
                </div>

                {status.integrity && (
                  <div className={clsx(
                    'flex items-center gap-1 text-sm',
                    status.integrity.ok ? 'text-green-600' : 'text-red-600'
                  )}>
                    {status.integrity.ok ? (
                      <CheckCircle className="w-4 h-4" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                    {status.integrity.message}
                  </div>
                )}

                {status.stats.lastBackup && (
                  <p className="text-xs text-gray-500">
                    Last backup: {new Date(status.stats.lastBackup).toLocaleString()}
                    {status.stats.nextBackup && (
                      <> · Next: {new Date(status.stats.nextBackup).toLocaleString()}</>
                    )}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => integrityMutation.mutate()}
            disabled={integrityMutation.isPending}
            className="btn-secondary"
            title="Check database integrity"
          >
            {integrityMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => createBackupMutation.mutate()}
            disabled={createBackupMutation.isPending}
            className="btn-primary"
          >
            {createBackupMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Backup Now
          </button>
          <button
            onClick={() => setShowBackups(!showBackups)}
            className="btn-secondary"
          >
            {showBackups ? 'Hide' : 'View'} Backups
          </button>
        </div>
      </div>

      {/* Backup list */}
      {showBackups && backupList && (
        <div className="mt-6 pt-6 border-t border-gray-200">
          <h4 className="font-medium text-gray-900 mb-3">Available Backups</h4>
          {backupList.backups.length === 0 ? (
            <p className="text-sm text-gray-500">No backups available</p>
          ) : (
            <div className="space-y-2">
              {backupList.backups.map((backup: {
                name: string;
                sizeFormatted: string;
                created: string;
                reason: string;
              }) => (
                <div
                  key={backup.name}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{backup.name}</p>
                    <p className="text-xs text-gray-500">
                      {backup.sizeFormatted} · {new Date(backup.created).toLocaleString()} · {backup.reason}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-gray-500">
            Backups are stored locally. For production, consider setting up external backup storage.
          </p>
        </div>
      )}
    </div>
  );
}

function EmailInboxSettings() {
  const queryClient = useQueryClient();
  const [showConfig, setShowConfig] = useState(false);
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string; mailboxInfo?: { total: number; unseen: number } } | null>(null);

  const [formData, setFormData] = useState({
    host: 'imap.gmail.com',
    port: 993,
    user: '',
    password: '',
    tls: true,
    folder: 'INBOX',
    pollingEnabled: false,
    pollingInterval: 5,
  });

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['inbox-config'],
    queryFn: inboxApi.getConfig,
  });

  const saveMutation = useMutation({
    mutationFn: inboxApi.saveConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inbox-config'] });
      toast.success('Email inbox configured successfully');
      setShowConfig(false);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save configuration');
    },
  });

  const testMutation = useMutation({
    mutationFn: inboxApi.testConnection,
    onSuccess: (result) => {
      setTestResult(result);
      if (result.success) {
        toast.success(`Connection successful! Found ${result.mailboxInfo?.unseen || 0} unread emails`);
      } else {
        toast.error(`Connection failed: ${result.error}`);
      }
    },
    onError: (error: Error) => {
      setTestResult({ success: false, error: error.message });
      toast.error('Connection test failed');
    },
  });

  const processMutation = useMutation({
    mutationFn: inboxApi.processInbox,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      toast.success(`Processed ${result.processed} emails. Created ${result.created} startups.`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to process inbox');
    },
  });

  const syncMutation = useMutation({
    mutationFn: inboxApi.syncInbox,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['startups'] });
      queryClient.invalidateQueries({ queryKey: ['emails'] });
      const message = [
        `Synced ${result.processed} emails`,
        result.created > 0 ? `${result.created} startups created` : null,
        result.decksProcessed > 0 ? `${result.decksProcessed} decks processed` : null,
        result.emailsLinked > 0 ? `${result.emailsLinked} email threads linked` : null,
      ].filter(Boolean).join(', ');
      toast.success(message || 'Sync complete - no new proposals found');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to sync inbox');
    },
  });

  const handleTest = () => {
    testMutation.mutate({
      host: formData.host,
      port: formData.port,
      user: formData.user,
      password: formData.password,
      tls: formData.tls,
      folder: formData.folder,
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(formData);
  };

  if (configLoading) {
    return (
      <div className="card p-6">
        <Loader2 className="w-6 h-6 mx-auto text-primary-600 animate-spin" />
      </div>
    );
  }

  return (
    <>
      <div className="card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg">
              <Inbox className="w-6 h-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Email Inbox for Proposals</h3>
              <p className="text-sm text-gray-600 mt-1">
                Forward startup pitches from LinkedIn or other sources to a dedicated email.
                AI will automatically extract startup info and add them to your tracker.
              </p>

              {config?.configured ? (
                <div className="flex items-center gap-2 mt-3">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span className="text-sm text-gray-600">
                    Configured: <strong>{config.user}</strong>
                  </span>
                  {config.pollingEnabled && (
                    <span className="badge badge-success ml-2">Auto-polling every {config.pollingInterval}m</span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 mt-3">
                  <XCircle className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-gray-500">Not configured</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => setShowPasteModal(true)} className="btn-secondary">
              <Send className="w-4 h-4 mr-2" />
              Paste Content
            </button>
            {config?.configured && (
              <>
                <button
                  onClick={() => syncMutation.mutate()}
                  disabled={syncMutation.isPending}
                  className="btn-primary"
                  title="Sync emails, extract startups, process attachments, and create email threads"
                >
                  {syncMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4 mr-2" />
                  )}
                  Sync
                </button>
                <button
                  onClick={() => processMutation.mutate()}
                  disabled={processMutation.isPending}
                  className="btn-secondary"
                  title="Quick check for new emails"
                >
                  {processMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Check Now
                </button>
              </>
            )}
            <button onClick={() => setShowConfig(!showConfig)} className="btn-secondary">
              {config?.configured ? 'Edit' : 'Configure'}
            </button>
          </div>
        </div>

        {/* Configuration form */}
        {showConfig && (
          <form onSubmit={handleSave} className="mt-6 pt-6 border-t border-gray-200">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="imap-host" className="label">IMAP Server</label>
                <input
                  id="imap-host"
                  type="text"
                  value={formData.host}
                  onChange={(e) => setFormData((p) => ({ ...p, host: e.target.value }))}
                  className="input"
                  placeholder="imap.gmail.com"
                  required
                />
              </div>

              <div>
                <label htmlFor="imap-port" className="label">Port</label>
                <input
                  id="imap-port"
                  type="number"
                  value={formData.port}
                  onChange={(e) => setFormData((p) => ({ ...p, port: parseInt(e.target.value) }))}
                  className="input"
                  required
                />
              </div>

              <div>
                <label htmlFor="imap-user" className="label">Email Address</label>
                <input
                  id="imap-user"
                  type="email"
                  value={formData.user}
                  onChange={(e) => setFormData((p) => ({ ...p, user: e.target.value }))}
                  className="input"
                  placeholder="proposals@yourdomain.com"
                  required
                />
              </div>

              <div>
                <label htmlFor="imap-password" className="label">Password / App Password</label>
                <input
                  id="imap-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData((p) => ({ ...p, password: e.target.value }))}
                  className="input"
                  placeholder="••••••••••••"
                  required
                />
              </div>

              <div>
                <label htmlFor="imap-folder" className="label">Folder</label>
                <input
                  id="imap-folder"
                  type="text"
                  value={formData.folder}
                  onChange={(e) => setFormData((p) => ({ ...p, folder: e.target.value }))}
                  className="input"
                  placeholder="INBOX"
                />
              </div>

              <div>
                <label htmlFor="polling-interval" className="label">Polling Interval (minutes)</label>
                <input
                  id="polling-interval"
                  type="number"
                  min={1}
                  max={60}
                  value={formData.pollingInterval}
                  onChange={(e) => setFormData((p) => ({ ...p, pollingInterval: parseInt(e.target.value) }))}
                  className="input"
                />
              </div>

              <div className="flex items-center gap-3 md:col-span-2">
                <input
                  id="tls"
                  type="checkbox"
                  checked={formData.tls}
                  onChange={(e) => setFormData((p) => ({ ...p, tls: e.target.checked }))}
                  className="w-4 h-4 text-primary-600 rounded border-gray-300"
                />
                <label htmlFor="tls" className="text-sm text-gray-700">Use TLS/SSL</label>

                <input
                  id="polling-enabled"
                  type="checkbox"
                  checked={formData.pollingEnabled}
                  onChange={(e) => setFormData((p) => ({ ...p, pollingEnabled: e.target.checked }))}
                  className="w-4 h-4 text-primary-600 rounded border-gray-300 ml-6"
                />
                <label htmlFor="polling-enabled" className="text-sm text-gray-700">Enable auto-polling</label>
              </div>
            </div>

            {testResult && (
              <div className={clsx(
                'mt-4 p-3 rounded-lg text-sm',
                testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              )}>
                {testResult.success ? (
                  <>Connection successful! Found {testResult.mailboxInfo?.unseen || 0} unread emails.</>
                ) : (
                  <>Connection failed: {testResult.error}</>
                )}
              </div>
            )}

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={handleTest}
                disabled={testMutation.isPending || !formData.user || !formData.password}
                className="btn-secondary"
              >
                {testMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Test Connection
              </button>
              <button
                type="submit"
                disabled={saveMutation.isPending}
                className="btn-primary"
              >
                {saveMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Configuration
              </button>
              <button type="button" onClick={() => setShowConfig(false)} className="btn-secondary">
                Cancel
              </button>
            </div>

            <p className="text-xs text-gray-500 mt-4">
              For Gmail, use an App Password instead of your regular password.
              Go to Google Account &rarr; Security &rarr; 2-Step Verification &rarr; App passwords.
            </p>
          </form>
        )}
      </div>

      {showPasteModal && <PasteContentModal onClose={() => setShowPasteModal(false)} />}
    </>
  );
}

function PasteContentModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [subject, setSubject] = useState('');
  const [from, setFrom] = useState('');
  const [result, setResult] = useState<{
    proposal?: {
      startupName: string;
      founderName?: string;
      description: string;
      confidence: number;
      sector?: string;
      stage?: string;
    };
    startupId?: string;
  } | null>(null);

  const parseMutation = useMutation({
    mutationFn: ({ createStartup }: { createStartup: boolean }) =>
      inboxApi.parseContent(content, subject || undefined, from || undefined, createStartup),
    onSuccess: (data) => {
      setResult(data);
      if (data.startupId) {
        queryClient.invalidateQueries({ queryKey: ['startups'] });
        toast.success(`Created startup: ${data.proposal?.startupName}`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to parse content');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Paste Startup Proposal</h3>
          <p className="text-sm text-gray-600 mt-1">
            Paste a LinkedIn message, email, or any startup pitch content. AI will extract the startup information.
          </p>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="paste-from" className="label">From (optional)</label>
              <input
                id="paste-from"
                type="text"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="input"
                placeholder="John Doe <john@startup.com>"
              />
            </div>
            <div>
              <label htmlFor="paste-subject" className="label">Subject (optional)</label>
              <input
                id="paste-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="input"
                placeholder="Investment opportunity"
              />
            </div>
          </div>

          <div>
            <label htmlFor="paste-content" className="label">Content</label>
            <textarea
              id="paste-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="input min-h-[200px]"
              placeholder="Paste the full email, LinkedIn message, or pitch content here..."
              required
            />
          </div>

          {result?.proposal && (
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h4 className="font-semibold text-gray-900">Extracted Information</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">Startup:</span>{' '}
                  <strong>{result.proposal.startupName}</strong>
                </div>
                {result.proposal.founderName && (
                  <div>
                    <span className="text-gray-500">Founder:</span>{' '}
                    {result.proposal.founderName}
                  </div>
                )}
                {result.proposal.sector && (
                  <div>
                    <span className="text-gray-500">Sector:</span>{' '}
                    {result.proposal.sector}
                  </div>
                )}
                {result.proposal.stage && (
                  <div>
                    <span className="text-gray-500">Stage:</span>{' '}
                    {result.proposal.stage}
                  </div>
                )}
                <div className="col-span-2">
                  <span className="text-gray-500">Description:</span>{' '}
                  {result.proposal.description}
                </div>
                <div>
                  <span className="text-gray-500">Confidence:</span>{' '}
                  <span className={result.proposal.confidence >= 70 ? 'text-green-600' : 'text-yellow-600'}>
                    {result.proposal.confidence}%
                  </span>
                </div>
              </div>

              {result.startupId && (
                <div className="flex items-center gap-2 mt-3 text-green-600">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm">Startup added to tracker!</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 flex gap-3">
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
          <button
            onClick={() => parseMutation.mutate({ createStartup: false })}
            disabled={parseMutation.isPending || !content.trim()}
            className="btn-secondary"
          >
            {parseMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Preview
          </button>
          <button
            onClick={() => parseMutation.mutate({ createStartup: true })}
            disabled={parseMutation.isPending || !content.trim()}
            className="btn-primary"
          >
            {parseMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Extract & Add Startup
          </button>
        </div>
      </div>
    </div>
  );
}
