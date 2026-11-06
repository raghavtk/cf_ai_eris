import { fireEvent, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

function openWorkspace(path = '/') {
  window.history.replaceState({}, '', path)
  return render(<BrowserRouter><App /></BrowserRouter>)
}

describe('Eris workspace', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('lets a signed-out visitor parse, save, and plan with demo tasks without contacting the API', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected request'))
    const workspace = openWorkspace()

    expect(screen.getByLabelText('Demo workspace')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Estimate time' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Owner sign in' })).toHaveAttribute('href', expect.stringContaining('/api/auth/login'))
    fireEvent.click(screen.getByRole('button', { name: /Add a task/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use example' }))
    expect(screen.getByRole('textbox', { name: 'Task prompt' })).toHaveValue('Draft the portfolio case study in 90 minutes')
    fireEvent.click(screen.getByRole('button', { name: 'Parse task' }))
    expect(await screen.findByText(/Draft the portfolio case study.*90m/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add to demo tasks' }))
    expect(await screen.findByText('Saved "Draft the portfolio case study" to tasks.')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Task prompt' }), { key: 'Escape' })

    fireEvent.click(await screen.findByRole('link', { name: 'View Tasks' }))
    expect(await screen.findByRole('cell', { name: 'Draft the portfolio case study' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'Schedule' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Plan my day' }))
    expect(await screen.findByText('Draft the portfolio case study')).toBeInTheDocument()

    workspace.unmount()
    openWorkspace('/view-tasks')
    expect(screen.getByRole('cell', { name: 'Review research notes' })).toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'Draft the portfolio case study' })).toBeNull()
    expect(request).not.toHaveBeenCalled()
  })

  it('serves connector and About routes publicly without private data requests', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected request'))
    openWorkspace('/github?github_pending=example')
    expect(screen.getByRole('heading', { name: 'Connected accounts are private' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in to manage GitHub' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('link', { name: 'About' }))
    expect(await screen.findByRole('heading', { name: 'Inside Eris' })).toBeInTheDocument()
    expect(request).not.toHaveBeenCalled()
  })

  it('loads owner tasks after a verified Access return', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      switch (new URL(String(input)).pathname) {
        case '/api/auth/session': return Response.json({ authenticated: true, owner: 'owner@example.com' })
        case '/api/tasks': return Response.json([{ id: 'private', title: 'Owner-only task', priority: 'high', estimated_duration: 60 }])
        default: throw new Error('Unexpected request to ' + input)
      }
    })
    openWorkspace('/?access=granted')
    expect(screen.getByLabelText('Demo workspace')).toBeInTheDocument()
    expect(await screen.findByRole('cell', { name: 'Owner-only task' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Demo workspace')).toBeNull()
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/auth/session'), expect.objectContaining({ credentials: 'include' }))
    expect(window.location.search).toBe('')
  })

  it('keeps the demo usable when the Access return cannot be verified', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ authenticated: false }))
    openWorkspace('/view-tasks?access=granted')
    expect(await screen.findByText(/Owner access could not be verified/)).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Review research notes' })).toBeInTheDocument()
    expect(request).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/auth/session'), expect.anything())
  })

  it('returns to the demo when an owner API request receives a 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      new URL(String(input)).pathname === '/api/auth/session'
        ? Response.json({ authenticated: true, owner: 'owner@example.com' })
        : Response.json({ code: 'authentication_required' }, { status: 401 }),
    )
    openWorkspace('/?access=granted')
    expect(await screen.findByText(/Owner access could not be verified/)).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Review research notes' })).toBeInTheDocument()
  })
})
