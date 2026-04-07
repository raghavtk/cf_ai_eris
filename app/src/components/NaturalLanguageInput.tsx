import { useState, useEffect, useRef } from 'react'
import { Modal, Box, Typography } from '@mui/material'
import { motion, AnimatePresence } from 'framer-motion'
import { aiService } from '../services/aiService'
import { taskService } from '../services/taskService'

type ParsedTask = {
  title?: string
  description?: string
  priority?: string
  due_date?: string
  category?: string
  subcategory?: string
  estimated_duration?: number
  note?: string | null
}

type Props = {
  onSavePreview?: (task: ParsedTask) => void
  onTaskCreated?: (task: any) => void
}

type ThreadItem = {
  input: string
  parsed: ParsedTask
  ts?: string
}

const SESSION_KEY = 'eris-ai-session-id'

const createSessionId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

const getThreadSummary = (parsed: ParsedTask) => {
  const parts: string[] = []
  if (parsed.priority) parts.push(`P:${parsed.priority}`)
  if (parsed.category) parts.push(`C:${parsed.category}`)
  if (parsed.estimated_duration != null) parts.push(`${parsed.estimated_duration}m`)
  return parts.join(' • ')
}

const toCreatePayload = (parsed: ParsedTask) => ({
  title: parsed.title?.trim() || 'Untitled task',
  description: parsed.description?.trim() || '',
  priority: ((parsed.priority || 'medium').toLowerCase() as 'high' | 'medium' | 'low'),
  status: 'pending' as const,
  category: ((parsed.category || 'other').toLowerCase() as 'work' | 'personal' | 'other'),
  subcategory: parsed.subcategory?.trim() || 'Other',
  due_date: parsed.due_date || '',
  estimated_duration: Number(parsed.estimated_duration || 0),
  note: parsed.note || '',
})

const NaturalLanguageInput = ({ onSavePreview, onTaskCreated }: Props) => {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [thread, setThread] = useState<ThreadItem[]>([])
  const [sessionId, setSessionId] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const stored = window.localStorage.getItem(SESSION_KEY)
    if (stored) {
      setSessionId(stored)
      return
    }
    const next = createSessionId()
    window.localStorage.setItem(SESSION_KEY, next)
    setSessionId(next)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setInput('')
      setError(null)
    }
  }, [open])

  const handleParse = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    setSaveMessage(null)
    try {
      const res = await aiService.parseTask(input, sessionId)
      const parsed = typeof res === 'string' ? JSON.parse(res) : (res.parsed || res)
      const history = Array.isArray((res as any)?.history) ? ((res as any).history as ThreadItem[]) : []
      if (history.length) {
        setThread(history.slice(-5))
      } else {
        setThread((prev) => [...prev, { input, parsed }].slice(-5))
      }
      onSavePreview?.(parsed)
      setInput('')
    } catch (e: any) {
      setError(e?.message || 'Parse failed')
    } finally {
      setLoading(false)
    }
  }

  const handleReuse = (text: string) => {
    setInput(text)
    inputRef.current?.focus()
  }

  const handleRefine = (item: ThreadItem) => {
    setInput(`Refine previous task: ${item.parsed.title || item.input}`)
    inputRef.current?.focus()
  }

  const handleNewSession = () => {
    const next = createSessionId()
    window.localStorage.setItem(SESSION_KEY, next)
    setSessionId(next)
    setThread([])
    setInput('')
    setError(null)
    setSaveMessage(null)
  }

  const handleAddToDb = async (item: ThreadItem, key: string) => {
    try {
      setSavingKey(key)
      setError(null)
      setSaveMessage(null)
      const created = await taskService.create(toCreatePayload(item.parsed) as any)
      onTaskCreated?.(created)
      setSaveMessage(`Saved "${created.title}" to tasks.`)
    } catch (e: any) {
      setError(e?.message || 'Failed to save task')
    } finally {
      setSavingKey(null)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleParse()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <>
      <Box 
        onClick={() => setOpen(true)}
        sx={{
          bgcolor: 'rgba(30, 41, 59, 0.5)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '999px',
          px: 3,
          py: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'text',
          transition: 'all 0.2s ease',
          '&:hover': {
            bgcolor: 'rgba(30, 41, 59, 0.8)',
            borderColor: 'rgba(255, 255, 255, 0.2)'
          }
        }}
      >
        <Typography color="#94a3b8" sx={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: '1.1rem' }}>
          Add a task, set a meeting...
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Box sx={{ bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1, px: 1, py: 0.5, fontSize: '0.8rem', color: '#cbd5e1' }}>⌘</Box>
          <Box sx={{ bgcolor: 'rgba(255,255,255,0.1)', borderRadius: 1, px: 1, py: 0.5, fontSize: '0.8rem', color: '#cbd5e1' }}>K</Box>
        </Box>
      </Box>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        closeAfterTransition
        slotProps={{ backdrop: { sx: { backdropFilter: 'blur(4px)', backgroundColor: 'rgba(15, 23, 42, 0.7)' } } }}
        sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', pt: { xs: 10, sm: 20 }, outline: 'none' }}
      >
        <Box sx={{ outline: 'none', width: '100%', display: 'flex', justifyContent: 'center' }}>
          <AnimatePresence>
            {open && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -20 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                style={{ width: '100%', maxWidth: '600px', margin: '0 16px', outline: 'none' }}
              >
                <Box
                  sx={{
                    width: '100%',
                    bgcolor: 'rgba(17, 24, 39, 0.8)',
                    backdropFilter: 'blur(16px)',
                    borderRadius: 3,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    outline: 'none'
                  }}
                >
                  <input
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="E.g., Call with team tomorrow at 10am..."
                    style={{
                      width: '100%',
                      padding: '24px',
                      fontSize: '1.25rem',
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: '#f8fafc',
                      outline: 'none',
                      fontFamily: 'Helvetica, Arial, sans-serif'
                    }}
                    disabled={loading}
                    autoFocus
                  />
                  {thread.length > 0 && (
                    <Box sx={{ px: 2, pb: 1.5, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                      <Typography sx={{ color: '#94a3b8', fontSize: '0.75rem', mb: 1.2, mt: 1.2, letterSpacing: '0.04em' }}>
                        Recent Context
                      </Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 200, overflowY: 'auto', pr: 0.5 }}>
                        {[...thread].reverse().map((item, idx) => (
                          <Box
                            key={`${item.ts || idx}-${item.input}`}
                            sx={{
                              bgcolor: 'rgba(15, 23, 42, 0.65)',
                              border: '1px solid rgba(148, 163, 184, 0.18)',
                              borderRadius: 2,
                              p: 1.2,
                            }}
                          >
                            <Typography sx={{ color: '#cbd5e1', fontSize: '0.82rem' }}>{item.input}</Typography>
                            <Typography sx={{ color: '#94a3b8', fontSize: '0.72rem', mt: 0.4 }}>
                              {(item.parsed.title || 'Untitled task') + (getThreadSummary(item.parsed) ? ` • ${getThreadSummary(item.parsed)}` : '')}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1, mt: 0.8 }}>
                              <Box
                                component='button'
                                onClick={() => handleReuse(item.input)}
                                sx={{
                                  bgcolor: 'rgba(56, 189, 248, 0.16)',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  borderRadius: 1,
                                  px: 1,
                                  py: 0.3,
                                  color: '#bae6fd',
                                  fontSize: '0.72rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Reuse
                              </Box>
                              <Box
                                component='button'
                                onClick={() => handleRefine(item)}
                                sx={{
                                  bgcolor: 'rgba(148, 163, 184, 0.14)',
                                  border: '1px solid rgba(148, 163, 184, 0.3)',
                                  borderRadius: 1,
                                  px: 1,
                                  py: 0.3,
                                  color: '#cbd5e1',
                                  fontSize: '0.72rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Refine
                              </Box>
                              <Box
                                component='button'
                                onClick={() => handleAddToDb(item, `${item.ts || idx}-save`)}
                                disabled={savingKey === `${item.ts || idx}-save`}
                                sx={{
                                  bgcolor: 'rgba(34, 197, 94, 0.16)',
                                  border: '1px solid rgba(34, 197, 94, 0.35)',
                                  borderRadius: 1,
                                  px: 1,
                                  py: 0.3,
                                  color: '#bbf7d0',
                                  fontSize: '0.72rem',
                                  cursor: 'pointer',
                                  opacity: savingKey === `${item.ts || idx}-save` ? 0.7 : 1,
                                }}
                              >
                                {savingKey === `${item.ts || idx}-save` ? 'Saving...' : 'Add to DB'}
                              </Box>
                            </Box>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                  )}
                  {loading && (
                    <Box sx={{ height: '3px', width: '100%', bgcolor: 'rgba(255,255,255,0.1)', position: 'relative', overflow: 'hidden' }}>
                      <motion.div
                        initial={{ x: '-100%' }}
                        animate={{ x: '200%' }}
                        transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                        style={{ height: '100%', width: '50%', backgroundColor: '#38bdf8', position: 'absolute' }}
                      />
                    </Box>
                  )}
                  {error && (
                    <Box sx={{ px: 3, py: 2, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <Typography color="error">{error}</Typography>
                    </Box>
                  )}
                  {saveMessage && (
                    <Box sx={{ px: 3, py: 1.5, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
                      <Typography sx={{ color: '#86efac', fontSize: '0.85rem' }}>{saveMessage}</Typography>
                    </Box>
                  )}
                  <Box sx={{ px: 3, py: 2, bgcolor: 'rgba(0, 0, 0, 0.2)', borderTop: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography sx={{ color: '#64748b', fontSize: '0.85rem' }}>Eris Assistant</Typography>
                    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                      <Box
                        component='button'
                        onClick={handleNewSession}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          fontSize: '0.8rem',
                        }}
                      >
                        new session
                      </Box>
                      <Typography sx={{ color: '#64748b', fontSize: '0.85rem' }}>↵ to parse</Typography>
                      <Typography sx={{ color: '#64748b', fontSize: '0.85rem' }}>esc to close</Typography>
                    </Box>
                  </Box>
                </Box>
              </motion.div>
            )}
          </AnimatePresence>
        </Box>
      </Modal>
    </>
  )
}

export default NaturalLanguageInput
