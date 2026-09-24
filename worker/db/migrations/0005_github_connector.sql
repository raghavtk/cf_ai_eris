CREATE TABLE github_oauth_flows (
  state TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('personal', 'work')),
  expires_at TEXT NOT NULL
);

CREATE TABLE github_pending_links (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('personal', 'work')),
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  access_expires_at TEXT NOT NULL,
  refresh_expires_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE github_project_oauth_flows (
  state TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE github_connections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  context TEXT NOT NULL CHECK (context IN ('personal', 'work')),
  installation_id INTEGER NOT NULL UNIQUE,
  account_id INTEGER NOT NULL,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  github_user_id INTEGER NOT NULL,
  github_login TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  encrypted_project_token TEXT,
  refresh_expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'approval_required', 'revoked', 'error')),
  error_code TEXT,
  projects_error_code TEXT,
  last_synced_at TEXT,
  last_full_sync_at TEXT,
  next_retry_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_github_connections_owner ON github_connections(owner_id, context);

CREATE TABLE github_repositories (
  connection_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  full_name TEXT NOT NULL,
  html_url TEXT NOT NULL,
  description TEXT,
  private INTEGER NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0,
  access_available INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (connection_id, repo_id),
  FOREIGN KEY (connection_id) REFERENCES github_connections(id) ON DELETE CASCADE
);
CREATE INDEX idx_github_repositories_selected ON github_repositories(connection_id, selected);

CREATE TABLE github_items (
  connection_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'pull_request')),
  github_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  html_url TEXT NOT NULL,
  state TEXT NOT NULL,
  draft INTEGER NOT NULL DEFAULT 0,
  author_login TEXT,
  assignees_json TEXT NOT NULL DEFAULT '[]',
  requested_reviewers_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  milestone_title TEXT,
  review_state TEXT,
  github_updated_at TEXT NOT NULL,
  sensitive INTEGER NOT NULL,
  sync_generation TEXT,
  PRIMARY KEY (connection_id, kind, github_id),
  FOREIGN KEY (connection_id, repo_id) REFERENCES github_repositories(connection_id, repo_id) ON DELETE CASCADE
);
CREATE INDEX idx_github_items_inbox ON github_items(connection_id, kind, state, github_updated_at DESC);

CREATE TABLE github_milestones (
  connection_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  github_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  state TEXT NOT NULL,
  due_on TEXT,
  open_issues INTEGER NOT NULL DEFAULT 0,
  closed_issues INTEGER NOT NULL DEFAULT 0,
  html_url TEXT NOT NULL,
  PRIMARY KEY (connection_id, repo_id, github_id),
  FOREIGN KEY (connection_id, repo_id) REFERENCES github_repositories(connection_id, repo_id) ON DELETE CASCADE
);

CREATE TABLE github_labels (
  connection_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  github_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  PRIMARY KEY (connection_id, repo_id, github_id),
  FOREIGN KEY (connection_id, repo_id) REFERENCES github_repositories(connection_id, repo_id) ON DELETE CASCADE
);

CREATE TABLE github_projects (
  connection_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  html_url TEXT NOT NULL,
  fields_json TEXT NOT NULL DEFAULT '[]',
  items_json TEXT NOT NULL DEFAULT '[]',
  sensitive INTEGER NOT NULL,
  PRIMARY KEY (connection_id, node_id),
  FOREIGN KEY (connection_id) REFERENCES github_connections(id) ON DELETE CASCADE
);
