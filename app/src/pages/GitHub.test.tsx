import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GitHub from './GitHub'
import { githubService } from '../services/githubService'

vi.mock('../services/githubService', () => ({
  githubService: {
    config: vi.fn(), connections: vi.fn(), dashboard: vi.fn(), pending: vi.fn(),
  },
}))

const service = vi.mocked(githubService)

describe('GitHub dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState({}, '', '/github')
    service.config.mockResolvedValue({ install_url: 'https://github.com/apps/eris/installations/new', personal_projects_available: true })
    service.connections.mockResolvedValue({ connections: [] })
    service.dashboard.mockResolvedValue({ items: [], milestones: [], projects: [], labels: [] })
  })

  it('starts in personal context and switches to work only when selected', async () => {
    render(<GitHub />)
    expect(await screen.findByText('Engineering inbox')).toBeInTheDocument()
    expect(service.dashboard).toHaveBeenCalledWith('personal')
    fireEvent.click(screen.getByRole('button', { name: 'Work' }))
    await waitFor(() => expect(service.dashboard).toHaveBeenCalledWith('work'))
    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps the combined view an explicit choice', async () => {
    render(<GitHub />)
    await screen.findByText('Engineering inbox')
    fireEvent.click(screen.getByRole('button', { name: 'All accounts' }))
    await waitFor(() => expect(service.dashboard).toHaveBeenCalledWith('all'))
  })
})
