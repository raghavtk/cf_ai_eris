import { useCallback, useEffect, useMemo, useState } from 'react'
import { githubService } from '../services/githubService'
import type { GitHubConnection, GitHubContext, GitHubDashboard, GitHubItem, GitHubRepository, PendingGitHub } from '../services/githubService'
import './GitHub.css'

type View = 'inbox' | 'projects' | 'milestones' | 'repositories' | 'connections'
const emptyDashboard: GitHubDashboard = { items: [], projects: [], milestones: [], labels: [] }
const parseList = (raw: string): string[] => { try { const value = JSON.parse(raw); return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [] } catch { return [] } }
const dateLabel = (value: string | null) => value ? new Date(value).toLocaleString() : 'Never'

function itemCategory(item: GitHubItem): 'Review requested' | 'Assigned issue' | 'Your pull request' | 'Other' {
  if (item.kind === 'pull_request' && parseList(item.requested_reviewers_json).includes(item.github_login)) return 'Review requested'
  if (item.kind === 'issue' && parseList(item.assignees_json).includes(item.github_login)) return 'Assigned issue'
  if (item.kind === 'pull_request' && item.author_login === item.github_login) return 'Your pull request'
  return 'Other'
}

const categoryOrder = ['Review requested', 'Assigned issue', 'Your pull request', 'Other'] as const

export default function GitHub() {
  const [context, setContext] = useState<GitHubContext | 'all'>('personal')
  const [view, setView] = useState<View>('inbox')
  const [connections, setConnections] = useState<GitHubConnection[]>([])
  const [dashboard, setDashboard] = useState<GitHubDashboard>(emptyDashboard)
  const [repositories, setRepositories] = useState<Record<string, GitHubRepository[]>>({})
  const [installUrl, setInstallUrl] = useState('')
  const [personalProjectsAvailable, setPersonalProjectsAvailable] = useState(false)
  const [pending, setPending] = useState<PendingGitHub | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(new URLSearchParams(window.location.search).get('github_pending'))
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null)

  const reload = useCallback(async (scope: GitHubContext | 'all') => {
    const [connectionData, dashboardData] = await Promise.all([githubService.connections(), githubService.dashboard(scope)])
    setConnections(connectionData.connections)
    setDashboard(dashboardData)
  }, [])

  useEffect(() => {
    let alive = true
    Promise.all([githubService.config(), githubService.connections(), githubService.dashboard(context)])
      .then(([config, connectionData, dashboardData]) => {
        if (!alive) return
        setInstallUrl(config.install_url)
        setPersonalProjectsAvailable(config.personal_projects_available)
        setConnections(connectionData.connections)
        setDashboard(dashboardData)
      }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'GitHub could not be loaded') })
    return () => { alive = false }
  }, [context])

  useEffect(() => {
    if (!pendingId) return
    githubService.pending(pendingId).then(setPending).catch((cause) => setError(cause instanceof Error ? cause.message : 'Authorization expired'))
  }, [pendingId])

  useEffect(() => {
    const errorCode = new URLSearchParams(window.location.search).get('github_error')
    if (errorCode) setError(`GitHub authorization failed (${errorCode}). Please try again.`)
    if (new URLSearchParams(window.location.search).get('github_projects') === 'connected') {
      setNotice('Personal Projects authorized. Refresh the connection to load Projects.')
      window.history.replaceState({}, '', '/github')
    }
  }, [])

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key); setError(null); setNotice(null)
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : 'GitHub request failed') }
    finally { setBusy(null) }
  }

  const start = (kind: GitHubContext) => run(`connect-${kind}`, async () => {
    const { authorization_url } = await githubService.start(kind)
    window.location.assign(authorization_url)
  })

  const authorizeProjects = (id: string) => run(`projects-${id}`, async () => {
    const { authorization_url } = await githubService.startProjects(id)
    window.location.assign(authorization_url)
  })

  const connect = (installationId: number) => run(`install-${installationId}`, async () => {
    if (!pendingId) return
    const result = await githubService.connect(pendingId, installationId)
    setPending(null); setPendingId(null)
    window.history.replaceState({}, '', '/github')
    setNotice('Installation connected. Select repositories, then refresh to populate the inbox.')
    setView('repositories')
    const repoData = await githubService.repositories(result.id)
    setRepositories((previous) => ({ ...previous, [result.id]: repoData.repositories }))
    await reload(context)
  })

  const loadRepos = (id: string) => run(`repos-${id}`, async () => {
    const data = await githubService.repositories(id)
    setRepositories((previous) => ({ ...previous, [id]: data.repositories }))
  })

  const toggleRepo = (connectionId: string, repoId: number) => {
    setRepositories((previous) => ({ ...previous, [connectionId]: (previous[connectionId] || []).map((repo) =>
      repo.repo_id === repoId ? { ...repo, selected: repo.selected ? 0 : 1 } : repo) }))
  }

  const saveRepos = (id: string) => run(`save-${id}`, async () => {
    const selected = (repositories[id] || []).filter((repo) => repo.selected).map((repo) => repo.repo_id)
    await githubService.setRepositories(id, selected)
    setNotice(`Saved ${selected.length} repositories. Refresh to load their data.`)
    await reload(context)
  })

  const refresh = (id: string) => run(`refresh-${id}`, async () => {
    const result = await githubService.refresh(id)
    await reload(context)
    setNotice(result.status === 'ready' ? 'GitHub data is current.' : result.status === 'syncing' ? 'GitHub is syncing in batches. Refresh again or let the daily sync continue.' : `Refresh finished with status: ${result.status}. Check the connection card.`)
  })

  const disconnect = (id: string) => run(`disconnect-${id}`, async () => {
    await githubService.disconnect(id)
    setConfirmDisconnect(null)
    setRepositories((previous) => { const next = { ...previous }; delete next[id]; return next })
    setNotice('Installation disconnected and its cached GitHub data was removed.')
    await reload(context)
  })

  const scopedConnections = connections.filter((connection) => context === 'all' || connection.context === context)
  const filteredItems = useMemo(() => dashboard.items.filter((item) =>
    `${item.title} ${item.repository} ${item.number}`.toLowerCase().includes(search.toLowerCase())), [dashboard.items, search])
  const inboxGroups = categoryOrder.map((category) => ({ category, items: filteredItems.filter((item) => itemCategory(item) === category) }))
  const selectedRepoCount = Object.values(repositories).flat().filter((repo) => repo.selected).length
  const reviewCount = dashboard.items.filter((item) => itemCategory(item) === 'Review requested').length
  const assignedCount = dashboard.items.filter((item) => itemCategory(item) === 'Assigned issue').length
  const activePrCount = dashboard.items.filter((item) => item.kind === 'pull_request' && item.author_login === item.github_login).length

  return <div className='github-page'>
    <header className='github-header'>
      <div><p className='github-eyebrow'>DEVELOPER WORKSPACE</p><h1>GitHub</h1><p className='github-subtitle'>Your engineering inbox and connected repositories, in one place.</p></div>
      <div className='github-header-actions'>
        <span className='github-sync-note'>Daily sync · manual refresh anytime</span>
        <button className='github-primary' onClick={() => { setView('connections'); setContext('personal') }}>Manage connections</button>
      </div>
    </header>

    {error && <div className='github-alert github-alert-error' role='alert'>{error}<button aria-label='Dismiss error' onClick={() => setError(null)}>×</button></div>}
    {notice && <div className='github-alert github-alert-success' role='status'>{notice}<button aria-label='Dismiss notice' onClick={() => setNotice(null)}>×</button></div>}

    {pending && <section className='github-pending'>
      <div><p className='github-eyebrow'>FINISH CONNECTING</p><h2>Select a {pending.context} installation</h2><p>Authorized as @{pending.github_login}. Choose the account you want Eris to read.</p></div>
      <div className='github-pending-list'>
        {pending.installations.filter((item) => pending.context === 'personal' ? item.account.type === 'User' : item.account.type === 'Organization').map((item) =>
          <button key={item.id} disabled={item.suspended || busy !== null} onClick={() => connect(item.id)}>
            <strong>{item.account.login}</strong><span>{item.account.type} · {item.repository_selection} repositories{item.suspended ? ' · suspended' : ''}</span>
          </button>)}
        {!pending.installations.some((item) => pending.context === 'personal' ? item.account.type === 'User' : item.account.type === 'Organization') &&
          <p>No matching installation is available yet. Install the GitHub App on the account, then authorize again.</p>}
      </div>
    </section>}

    <div className='github-context-switch' aria-label='GitHub account context'>
      {(['personal', 'work', 'all'] as const).map((value) => <button key={value} aria-pressed={context === value} onClick={() => setContext(value)}>
        {value === 'all' ? 'All accounts' : value === 'personal' ? 'Personal' : 'Work'}
      </button>)}
    </div>

    <section className='github-summary' aria-label='GitHub summary'>
      <div><span>Review requested</span><strong>{reviewCount}</strong><small>Pull requests awaiting you</small></div>
      <div><span>Assigned issues</span><strong>{assignedCount}</strong><small>Open work on your plate</small></div>
      <div><span>Your pull requests</span><strong>{activePrCount}</strong><small>Open authored PRs</small></div>
      <div><span>Connections</span><strong>{scopedConnections.length}</strong><small>{scopedConnections.filter((item) => item.status === 'ready').length} healthy</small></div>
    </section>

    <div className='github-view-tabs' role='tablist' aria-label='GitHub dashboard views'>
      {(['inbox', 'projects', 'milestones', 'repositories', 'connections'] as const).map((value) =>
        <button key={value} role='tab' aria-selected={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
    </div>

    {view === 'inbox' && <section className='github-content'>
      <div className='github-section-heading'><div><h2>Engineering inbox</h2><p>Open items from selected repositories</p></div>
        <input type='search' value={search} onChange={(event) => setSearch(event.target.value)} placeholder='Search issues and PRs' aria-label='Search GitHub items' /></div>
      {!scopedConnections.length ? <Empty title='Connect your GitHub account' description='Add a personal or work installation to start building your inbox.' action={() => setView('connections')} /> :
        !filteredItems.length ? <Empty title='Inbox is clear' description='Choose repositories and refresh a connection to bring in issues and pull requests.' action={() => setView('repositories')} /> :
          inboxGroups.filter((group) => group.items.length).map((group) => <div className='github-inbox-group' key={group.category}>
            <h3>{group.category} <span>{group.items.length}</span></h3>
            {group.items.map((item) => <a className='github-item' key={`${item.connection_id}-${item.kind}-${item.number}`} href={item.html_url} target='_blank' rel='noreferrer'>
              <span className={`github-kind ${item.kind}`}>{item.kind === 'issue' ? 'Issue' : 'PR'}</span>
              <div><strong>{item.title}</strong><small>{item.repository} #{item.number} · updated {dateLabel(item.github_updated_at)}</small></div>
              <div className='github-item-tags'>{item.review_state && <span>{item.review_state.replaceAll('_', ' ').toLowerCase()}</span>}
                {parseList(item.labels_json).slice(0, 2).map((label) => <span key={label}>{label}</span>)}
                {item.draft ? <span>Draft</span> : null}{item.context === 'work' ? <span className='github-work-tag'>Work</span> : null}</div>
              <span className='github-arrow'>↗</span>
            </a>)}
          </div>)}
    </section>}

    {view === 'projects' && <section className='github-content'><div className='github-section-heading'><div><h2>Projects</h2><p>Fields and items linked to selected repositories</p></div></div>
      {!dashboard.projects.length ? <Empty title='No Projects yet' description='Projects with items from selected repositories appear after a refresh.' action={() => setView('repositories')} /> :
        <div className='github-card-grid'>{dashboard.projects.map((project) => {
          let items: { title: string; url: string; fields: unknown[] }[] = []
          try { const parsed = JSON.parse(project.items_json); items = Array.isArray(parsed) ? parsed : [] } catch { /* safe empty */ }
          return <article className='github-project-card' key={`${project.connection_id}-${project.node_id}`}>
            <span className='github-context-label'>{project.context === 'work' ? 'WORK · SENSITIVE' : 'PERSONAL'}</span>
            <h3><a href={project.html_url} target='_blank' rel='noreferrer'>{project.title} ↗</a></h3>
            <p>{items.length} item{items.length === 1 ? '' : 's'} in selected repositories</p>
            <ul>{items.slice(0, 4).map((item, index) => <li key={`${item.url}-${index}`}><a href={item.url} target='_blank' rel='noreferrer'>{item.title}</a>
              <span className='github-project-fields'>{(Array.isArray(item.fields) ? item.fields : []).slice(0, 2).map((field, fieldIndex) => {
                const value = field as { name?: string; text?: string; date?: string; field?: { name?: string } } | null
                return <small key={fieldIndex}>{value?.field?.name || 'Field'}: {value?.name || value?.text || value?.date || '—'}</small>
              })}</span></li>)}</ul>
          </article>
        })}</div>}
    </section>}

    {view === 'milestones' && <section className='github-content'><div className='github-section-heading'><div><h2>Milestones</h2><p>Open goals across selected repositories</p></div></div>
      {!dashboard.milestones.length ? <Empty title='No open milestones' description='Milestones appear after a selected repository is refreshed.' action={() => setView('repositories')} /> :
        <div className='github-card-grid'>{dashboard.milestones.map((milestone) => <article className='github-project-card' key={`${milestone.connection_id}-${milestone.repository}-${milestone.title}`}>
          <span className='github-context-label'>{milestone.repository}{milestone.context === 'work' ? ' · WORK' : ''}</span>
          <h3><a href={milestone.html_url} target='_blank' rel='noreferrer'>{milestone.title} ↗</a></h3>
          <p>{milestone.closed_issues} closed · {milestone.open_issues} open</p>
          <div className='github-progress'><span style={{ width: `${Math.round(100 * milestone.closed_issues / Math.max(1, milestone.closed_issues + milestone.open_issues))}%` }} /></div>
          <small>{milestone.due_on ? `Due ${new Date(milestone.due_on).toLocaleDateString()}` : 'No due date'}</small>
        </article>)}</div>}
    </section>}

    {view === 'repositories' && <section className='github-content'><div className='github-section-heading'><div><h2>Repository selection</h2><p>Only selected repositories are synced. {selectedRepoCount ? `${selectedRepoCount} selected in this session.` : ''}</p></div></div>
      {!scopedConnections.length ? <Empty title='No connected installations' description='Connect a GitHub App installation first.' action={() => setView('connections')} /> :
        scopedConnections.map((connection) => <article className='github-connection-card' key={connection.id}>
          <div className='github-connection-top'><div><span className='github-context-label'>{connection.context}</span><h3>{connection.account_login}</h3><p>Choose the repositories Eris may display.</p></div>
            <button onClick={() => loadRepos(connection.id)} disabled={busy !== null}>{repositories[connection.id] ? 'Reload list' : 'Load repositories'}</button></div>
          {repositories[connection.id] && <><div className='github-repo-list'>{repositories[connection.id].map((repo) =>
            <label key={repo.repo_id}><input type='checkbox' checked={!!repo.selected} onChange={() => toggleRepo(connection.id, repo.repo_id)} />
              <span><strong>{repo.full_name}</strong><small>{repo.description || (repo.private ? 'Private repository' : 'Public repository')}</small></span><em>{repo.private ? 'Private' : 'Public'}</em></label>)}</div>
            <div className='github-card-actions'><button className='github-primary' onClick={() => saveRepos(connection.id)} disabled={busy !== null}>Save selection</button>
              <button onClick={() => refresh(connection.id)} disabled={busy !== null}>Refresh now</button></div></>}
        </article>)}
    </section>}

    {view === 'connections' && <section className='github-content'><div className='github-section-heading'><div><h2>Connections</h2><p>Install the read-only GitHub App, then authorize this dashboard.</p></div></div>
      <div className='github-connect-grid'>{(['personal', 'work'] as const).map((kind) => <article className='github-connect-card' key={kind}>
        <span className='github-context-label'>{kind === 'personal' ? 'YOUR ACCOUNT' : 'ORGANIZATION ACCOUNT'}</span>
        <h3>{kind === 'personal' ? 'Personal GitHub' : 'Work GitHub'}</h3>
        <p>{kind === 'personal' ? 'Keep personal issues and pull requests close at hand. Authorize Projects separately after connecting.' : 'See approved organization work in a clearly marked, sensitive context.'}</p>
        <div className='github-card-actions'><a href={installUrl} target='_blank' rel='noreferrer' className='github-outline'>1. Install app ↗</a>
          <button className='github-primary' disabled={busy !== null} onClick={() => start(kind)}>2. Authorize</button></div>
      </article>)}</div>
      <h3 className='github-list-heading'>Connected installations</h3>
      {!connections.length ? <p className='github-muted'>No installations connected yet.</p> : scopedConnections.map((connection) => <article className='github-connection-card' key={connection.id}>
        <div className='github-connection-top'><div><span className='github-context-label'>{connection.context} · {connection.account_type}</span><h3>{connection.account_login}</h3>
          <p>Authorized by @{connection.github_login} · last sync {dateLabel(connection.last_synced_at)}</p></div>
          <span className={`github-status ${connection.status}`}>{connection.status.replace('_', ' ')}</span></div>
        {connection.error_code && <p className='github-connection-error'>Sync needs attention: {connection.error_code.replaceAll('_', ' ')}{connection.next_retry_at ? ` · retry after ${dateLabel(connection.next_retry_at)}` : ''}</p>}
        {connection.sync_pending ? <p className='github-muted'>Full repository sync is still in progress. Daily sync or manual refresh will continue it.</p> : null}
        {connection.projects_error_code && <p className='github-connection-error'>Projects need attention: {connection.projects_error_code.replaceAll('_', ' ')}</p>}
        <div className='github-card-actions'><button onClick={() => refresh(connection.id)} disabled={busy !== null}>Refresh now</button>
          <button onClick={() => { setView('repositories'); loadRepos(connection.id) }} disabled={busy !== null}>Repositories</button>
          {connection.context === 'personal' && personalProjectsAvailable && <button onClick={() => authorizeProjects(connection.id)} disabled={busy !== null}>
            {connection.projects_authorized ? 'Reauthorize Projects' : 'Authorize Projects'}</button>}
          {confirmDisconnect === connection.id ? <><span className='github-danger-copy'>Remove this connection and its cached data?</span><button className='github-danger' onClick={() => disconnect(connection.id)} disabled={busy !== null}>Yes, disconnect</button><button onClick={() => setConfirmDisconnect(null)}>Cancel</button></> :
            <button className='github-danger-link' onClick={() => setConfirmDisconnect(connection.id)}>Disconnect</button>}</div>
      </article>)}
      <p className='github-privacy-note'>The GitHub App requests read access to metadata, issues, pull requests, and organization Projects. Personal Projects use a separate read:project authorization. Work records stay marked sensitive and are not sent to OpenAI.</p>
    </section>}
  </div>
}

function Empty({ title, description, action }: { title: string; description: string; action: () => void }) {
  return <div className='github-empty'><div className='github-empty-icon'>⌘</div><h3>{title}</h3><p>{description}</p><button onClick={action}>Get started →</button></div>
}
