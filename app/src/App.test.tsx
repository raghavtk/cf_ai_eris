import { act, render, screen } from '@testing-library/react'
import { BrowserRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'

describe('public portfolio preview', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState({}, '', '/')
    vi.restoreAllMocks()
  })

  it('shows representative content without requesting private data', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    render(<BrowserRouter><App /></BrowserRouter>)

    expect(screen.getByText('Turn scattered intentions into a day you can actually finish.')).toBeInTheDocument()
    expect(screen.getAllByText('Owner sign in').length).toBeGreaterThan(0)
    expect(screen.getByText(/representative sample content/i)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('verifies an Access return before revealing the private application', async () => {
    window.history.replaceState({}, '', '/?access=granted')
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ authenticated: true, owner: 'owner@example.com' }))
      .mockResolvedValueOnce(Response.json([]))

    render(<BrowserRouter><App /></BrowserRouter>)

    expect(await screen.findByText(/Welcome to your Personal Productivity Assistant/i)).toBeInTheDocument()
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:8787/api/auth/session')
    expect(localStorage.getItem('eris-owner-session')).toBe('active')
    expect(window.location.search).toBe('')
  })

  it('returns to the preview when the authenticated session expires', async () => {
    localStorage.setItem('eris-owner-session', 'active')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ authenticated: true, owner: 'owner@example.com' }))
      .mockResolvedValueOnce(Response.json([]))
    render(<BrowserRouter><App /></BrowserRouter>)
    expect(await screen.findByText(/Welcome to your Personal Productivity Assistant/i)).toBeInTheDocument()

    act(() => window.dispatchEvent(new Event('eris:authentication-required')))
    expect(screen.getByText('Turn scattered intentions into a day you can actually finish.')).toBeInTheDocument()
    expect(localStorage.getItem('eris-owner-session')).toBeNull()
  })
})
