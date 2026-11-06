import { NavLink } from 'react-router-dom'
import { authService } from '../services/apiClient'

const navItems = [
  { label: 'Overview', path: '/' },
  { label: 'Create Task', path: '/tasks' },
  { label: 'View Tasks', path: '/view-tasks' },
  { label: 'Schedule', path: '/schedule' },
  { label: 'GitHub', path: '/github' },
  { label: 'About', path: '/about' },
]

export default function Navbar({ owner }: { owner: boolean }) {
  return (
    <header className='workspace-header'>
      <div className='workspace-nav'>
        <NavLink to='/' className='workspace-brand' aria-label='Eris home'>
          <img src={`${import.meta.env.BASE_URL}eris.svg`} alt='' width={32} height={32} /> Eris
        </NavLink>
        <nav className='workspace-links' aria-label='Workspace'>
          {navItems.map(({ label, path }) => <NavLink key={path} to={path} end>{label}</NavLink>)}
        </nav>
        {owner
          ? <span className='workspace-owner'>Owner workspace</span>
          : <a className='workspace-owner' href={authService.loginUrl}>Owner sign in</a>}
      </div>
    </header>
  )
}
