ALTER TABLE github_connections ADD COLUMN encrypted_project_refresh_token TEXT;
ALTER TABLE github_connections ADD COLUMN project_refresh_expires_at TEXT;
ALTER TABLE github_connections ADD COLUMN selection_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE github_connections ADD COLUMN full_sync_started_at TEXT;
ALTER TABLE github_connections ADD COLUMN sync_lease_id TEXT;
ALTER TABLE github_connections ADD COLUMN sync_lease_until TEXT;

CREATE TABLE github_sync_progress (
  connection_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('issue', 'pull_request')),
  next_url TEXT NOT NULL,
  generation TEXT NOT NULL,
  started_at TEXT NOT NULL,
  selection_revision INTEGER NOT NULL,
  PRIMARY KEY (connection_id, repo_id, kind),
  FOREIGN KEY (connection_id, repo_id) REFERENCES github_repositories(connection_id, repo_id) ON DELETE CASCADE
);
