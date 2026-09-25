import { apiFetch, readApiResponse } from './apiClient'

export type GitHubContext = 'personal' | 'work'
export type GitHubConnection = {
  id: string; context: GitHubContext; installation_id: number; account_login: string; account_type: string;
  github_login: string; status: 'ready' | 'approval_required' | 'revoked' | 'error'; error_code: string | null;
  projects_error_code: string | null; projects_authorized: number;
  sync_pending: number; last_synced_at: string | null; next_retry_at: string | null
}
export type GitHubRepository = { repo_id: number; full_name: string; html_url: string; description: string | null; private: number; selected: number }
export type GitHubItem = { kind: 'issue' | 'pull_request'; number: number; title: string; html_url: string; state: string;
  draft: number; author_login: string | null; assignees_json: string; requested_reviewers_json: string;
  labels_json: string; milestone_title: string | null; review_state: string | null; github_updated_at: string;
  sensitive: number; repository: string; connection_id: string; context: GitHubContext; github_login: string }
export type GitHubMilestone = { title: string; state: string; due_on: string | null; open_issues: number; closed_issues: number;
  html_url: string; repository: string; context: GitHubContext; connection_id: string }
export type GitHubProject = { node_id: string; title: string; html_url: string; fields_json: string; items_json: string;
  sensitive: number; context: GitHubContext; connection_id: string }
export type GitHubLabel = { name: string; color: string; repository: string; context: GitHubContext }
export type GitHubDashboard = { items: GitHubItem[]; milestones: GitHubMilestone[]; projects: GitHubProject[]; labels: GitHubLabel[] }
export type PendingGitHub = { context: GitHubContext; github_login: string; installations: {
  id: number; account: { id: number; login: string; type: string }; suspended: boolean; repository_selection: string
}[] }

const request = <T>(path: string, fallback: string, init?: RequestInit) => apiFetch(path, init).then((response) => readApiResponse<T>(response, fallback))
const jsonBody = (value: unknown) => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })

export const githubService = {
  config: () => request<{ install_url: string; personal_projects_available: boolean }>('/api/github/config', 'Unable to load GitHub configuration'),
  connections: () => request<{ connections: GitHubConnection[] }>('/api/github/connections', 'Unable to load GitHub connections'),
  dashboard: (context: GitHubContext | 'all') => request<GitHubDashboard>(`/api/github/dashboard?context=${context}`, 'Unable to load GitHub dashboard'),
  pending: (id: string) => request<PendingGitHub>(`/api/github/pending?id=${encodeURIComponent(id)}`, 'Unable to load installations'),
  start: (context: GitHubContext) => request<{ authorization_url: string }>('/api/github/oauth/start', 'Unable to start GitHub authorization', { method: 'POST', ...jsonBody({ context }) }),
  startProjects: (connectionId: string) => request<{ authorization_url: string }>('/api/github/projects/start', 'Unable to authorize personal Projects', { method: 'POST', ...jsonBody({ connection_id: connectionId }) }),
  connect: (pendingId: string, installationId: number) => request<{ id: string }>('/api/github/connections', 'Unable to connect installation', { method: 'POST', ...jsonBody({ pending_id: pendingId, installation_id: installationId }) }),
  repositories: (id: string) => request<{ repositories: GitHubRepository[] }>(`/api/github/connections/${id}/repos`, 'Unable to load repositories'),
  setRepositories: (id: string, repoIds: number[]) => request<{ selected: number }>(`/api/github/connections/${id}/repos`, 'Unable to save repositories', { method: 'PUT', ...jsonBody({ repo_ids: repoIds }) }),
  refresh: (id: string) => request<{ status: string }>(`/api/github/connections/${id}/refresh`, 'Unable to refresh GitHub data', { method: 'POST' }),
  disconnect: (id: string) => request<{ disconnected: boolean }>(`/api/github/connections/${id}`, 'Unable to disconnect GitHub', { method: 'DELETE' }),
}
