import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import { authService } from '../services/apiClient'

export function LockedGitHub() {
  return (
    <section className='showcase-panel'>
      <p className='workspace-eyebrow'>Integrations</p>
      <h1>GitHub</h1>
      <p>Bring assigned issues, pull requests, and project milestones into your planning workflow.</p>
      <div className='locked-panel'>
        <div className='locked-skeleton' aria-hidden='true'>
          <span /><span /><span />
        </div>
        <div className='locked-copy'>
          <LockOutlinedIcon aria-hidden='true' />
          <h2>Connected accounts are private</h2>
          <p>Owner access is required to view repositories or manage connections.</p>
          <a href={authService.loginUrl}>Sign in to manage GitHub</a>
        </div>
      </div>
    </section>
  )
}

export function About() {
  return (
    <section className='showcase-panel'>
      <p className='workspace-eyebrow'>About this project</p>
      <h1>Inside Eris</h1>
      <p>Eris is a personal productivity workspace for capturing tasks in plain language and turning them into a daily plan.</p>
      <div className='showcase-cards'>
        <article>
          <h2>Task capture</h2>
          <p>The owner assistant turns natural-language prompts into editable tasks. Workers AI handles parsing, and a Durable Object keeps recent context.</p>
        </article>
        <article>
          <h2>Daily planning</h2>
          <p>The planner fits prioritized tasks around fixed commitments and shows which work could not fit into the day.</p>
        </article>
        <article>
          <h2>Demo and privacy</h2>
          <p>The demo uses sample tasks and the same scheduler as the owner workspace. Task parsing uses Workers AI within a shared daily budget, with a basic local fallback. Cloudflare Access protects the owner API and its D1 data.</p>
        </article>
      </div>
      <a href='https://github.com/raghavtk/cf_ai_eris'>View the source on GitHub</a>
    </section>
  )
}
