import './App.css'
import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Navbar from './components/Navbar'
import Tasks from './pages/Tasks'
import ViewTasks from './pages/ViewTasks'
import TaskTable from './components/TaskTable'
import type { TaskRow } from './components/TaskTable'
import NaturalLanguageInput from './components/NaturalLanguageInput'
import type { ParsedTask } from './components/NaturalLanguageInput'
import Schedule from './pages/Schedule'
import { taskService } from './services/taskService'
import type { CreateTaskInput, Task } from './services/taskService'
import { validateCreateTask } from '../../shared/contracts'
import { authService } from './services/apiClient'
import { mapTaskToRow, sampleTasks } from './demo'
import type { DemoWorkspace } from './demo'
import { About, LockedGitHub } from './pages/Showcase'
import { ThemeProvider } from '@mui/material/styles'
import { workspaceTheme } from './theme'

const GitHub = lazy(() => import('./pages/GitHub'))

const SESSION_MARKER = 'eris-owner-session'

function Home({ demo }: { demo?: DemoWorkspace }) {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [parsedPreview, setParsedPreview] = useState<ParsedTask | null>(null)
  const navigate = useNavigate()
  const isDemo = Boolean(demo)

  useEffect(() => {
    if (isDemo) return
    taskService
      .getAll()
      .then((data) => {
        const mapped = data.map(mapTaskToRow)
        setTasks(mapped)
      })
      .catch(() => setLoadError(true))
      .finally(() => setLoading(false))
  }, [isDemo])

  const handlePreview = (parsed: ParsedTask) => {
    setParsedPreview(parsed)
  }

  const handleTaskCreated = (task: Task) => {
    if (!demo) {
      const mapped = mapTaskToRow(task)
      setTasks((prev) => [mapped, ...prev.filter((row) => row.id !== mapped.id)])
    }
    setParsedPreview(null)
    setLoading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className='workspace-home'
    >
      <header className='workspace-hero'>
        <p className='workspace-eyebrow'>Eris workspace</p>
        <h1>Plan your day</h1>
        <p>Add a task in plain language, then use your list to build a schedule.</p>
      </header>

      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
        <div style={{ width: '100%', maxWidth: '900px' }}>
          <NaturalLanguageInput onSavePreview={handlePreview} onTaskCreated={handleTaskCreated} demoCreate={demo?.createTask} />
          {parsedPreview && (
            <div
              style={{
                marginTop: '12px',
                background: 'rgba(30, 41, 59, 0.55)',
                border: '1px solid rgba(148, 163, 184, 0.25)',
                borderRadius: '12px',
                padding: '10px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px',
              }}
            >
              <p className='text-gray-200' style={{ margin: 0, fontFamily: 'Helvetica, Arial, sans-serif' }}>
                Parsed: {parsedPreview.title || 'Untitled task'}
              </p>
              <button
                onClick={() => navigate('/tasks', { state: { parsed: parsedPreview } })}
                style={{
                  border: '1px solid rgba(56, 189, 248, 0.55)',
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: '#e0f2fe',
                  borderRadius: '8px',
                  padding: '6px 10px',
                  cursor: 'pointer',
                  fontFamily: 'Helvetica, Arial, sans-serif',
                  fontWeight: 600,
                }}
              >
                Open Task Form
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {loadError && <p role='alert'>Could not load your tasks.</p>}
        {!demo && loading ? (
          <p className='text-gray-300' style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>Loading tasks...</p>
        ) : (
          <TaskTable tasks={demo ? demo.tasks.map(mapTaskToRow) : tasks} readOnly={isDemo} />
        )}
      </div>
    </motion.div>
  )
}

function AppContent({ demo }: { demo?: DemoWorkspace }) {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path='/' element={<Home demo={demo} />} />
        <Route path='/tasks' element={<Tasks demoCreate={demo?.createTask} />} />
        <Route path='/view-tasks' element={<ViewTasks demoTasks={demo?.tasks} />} />
        <Route path='/schedule' element={<Schedule demoTasks={demo?.tasks} />} />
        <Route path='/github' element={demo ? <LockedGitHub /> : <Suspense fallback={<p role='status'>Loading GitHub…</p>}><GitHub /></Suspense>} />
        <Route path='/about' element={<About />} />
        <Route path='*' element={<Home demo={demo} />} />
      </Routes>
    </AnimatePresence>
  )
}

function Workspace({ owner, status }: { owner: boolean; status: string }) {
  const [demoTasks, setDemoTasks] = useState(sampleTasks)
  const createTask = async (input: CreateTaskInput): Promise<Task> => {
    const result = validateCreateTask(input)
    if (!result.success) throw new Error(Object.values(result.error.details ?? {})[0] ?? result.error.error)
    const now = new Date().toISOString()
    const task = { ...result.data, id: crypto.randomUUID(), created_at: now, updated_at: now }
    setDemoTasks((current) => [task, ...current])
    return task
  }

  return (
    <div className='workspace'>
      <Navbar owner={owner} />
      <main className='workspace-main'>
        {!owner && (
          <aside className='demo-banner' aria-label='Demo workspace'>
            <strong>Interactive demo</strong>
            <span>Sample data. Tasks reset on reload. Live AI is available within a shared daily budget.</span>
          </aside>
        )}
        {status && <p className='session-status' role='status'>{status}</p>}
        <AppContent demo={owner ? undefined : { tasks: demoTasks, createTask }} />
      </main>
    </div>
  )
}

function App() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [shouldVerify] = useState(() => searchParams.get('access') === 'granted' ||
    (import.meta.env.DEV && import.meta.env.MODE !== 'test') ||
    localStorage.getItem(SESSION_MARKER) === 'active')
  const [session, setSession] = useState<'public' | 'checking' | 'owner' | 'failed'>(shouldVerify ? 'checking' : 'public')

  useEffect(() => {
    const requireAuthentication = () => {
      localStorage.removeItem(SESSION_MARKER)
      setSession('failed')
    }
    window.addEventListener('eris:authentication-required', requireAuthentication)
    return () => window.removeEventListener('eris:authentication-required', requireAuthentication)
  }, [])

  useEffect(() => {
    if (!shouldVerify) return
    let active = true
    authService.session()
      .then(() => {
        if (!active) return
        localStorage.setItem(SESSION_MARKER, 'active')
        setSession('owner')
      })
      .catch(() => {
        if (!active) return
        localStorage.removeItem(SESSION_MARKER)
        setSession('failed')
      })
    return () => { active = false }
  }, [shouldVerify])

  useEffect(() => {
    if (session === 'checking' || searchParams.get('access') !== 'granted') return
    const next = new URLSearchParams(searchParams)
    next.delete('access')
    setSearchParams(next, { replace: true, state: null })
  }, [session, searchParams, setSearchParams])

  const owner = session === 'owner'
  const status = session === 'checking' ? 'Checking owner access…' :
    session === 'failed' ? 'Owner access could not be verified. You can keep exploring the demo or try signing in again.' : ''

  return (
    <ThemeProvider theme={workspaceTheme}>
      <Workspace key={owner ? 'owner' : 'demo'} owner={owner} status={status} />
    </ThemeProvider>
  )
}

export default App
