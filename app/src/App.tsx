import './App.css'
import { useEffect, useState } from 'react'
import { Routes, Route, useNavigate, useLocation } from 'react-router-dom'
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
import type { Task } from './services/taskService'
import { authService } from './services/apiClient'

const SESSION_MARKER = 'eris-owner-session'

function PublicPreview({ checking }: { checking: boolean }) {
  return (
    <main className='preview-shell'>
      <nav className='preview-nav'>
        <div className='preview-brand'><span className='brand-mark'>E</span>Eris</div>
        <a className='owner-link' href={authService.loginUrl}>{checking ? 'Checking access…' : 'Owner sign in'}</a>
      </nav>
      <section className='preview-hero'>
        <div className='preview-copy'>
          <p className='eyebrow'>PRIVATE AI PRODUCTIVITY SYSTEM</p>
          <h1>Turn scattered intentions into a day you can actually finish.</h1>
          <p className='preview-lede'>Eris combines natural-language task capture, AI-assisted prioritization, and conflict-aware daily planning in one focused workspace.</p>
          <div className='preview-actions'>
            <a className='primary-cta' href={authService.loginUrl}>Owner sign in</a>
            <a className='secondary-cta' href='https://github.com/raghavtk/cf_ai_eris' target='_blank' rel='noreferrer'>View source</a>
          </div>
          <p className='privacy-note'>The live workspace is private. Everything shown here is representative sample content.</p>
        </div>
        <div className='product-preview' aria-label='Sample Eris daily plan'>
          <div className='preview-window-bar'><span /><span /><span /><strong>Today · August 28</strong></div>
          <div className='preview-dashboard'>
            <div className='sample-command'>Plan my afternoon around the research review <kbd>↵</kbd></div>
            <div className='sample-grid'>
              <article><span className='sample-time'>1:00 PM</span><h3>Research review</h3><p>High priority · 90 min</p></article>
              <article><span className='sample-time'>2:30 PM</span><h3>Project deep work</h3><p>Focus block · 120 min</p></article>
              <article><span className='sample-time'>4:30 PM</span><h3>Weekly planning</h3><p>Medium priority · 30 min</p></article>
            </div>
          </div>
        </div>
      </section>
      <section className='feature-strip'>
        <article><span>01</span><h2>Capture naturally</h2><p>Describe work in plain language and turn it into structured tasks.</p></article>
        <article><span>02</span><h2>Prioritize thoughtfully</h2><p>Use AI assistance without sending sensitive context unless explicitly allowed.</p></article>
        <article><span>03</span><h2>Plan realistically</h2><p>Build conflict-aware schedules that preserve locked calendar commitments.</p></article>
      </section>
    </main>
  )
}

const mapTaskToRow = (task: Task): TaskRow => ({
  id: task.id,
  title: task.title,
  description: task.description,
  priority: task.priority,
  status: task.status,
  category: task.category,
  subcategory: task.subcategory,
  dueDate: task.due_date,
  estimatedDuration: task.estimated_duration,
  note: task.note,
})

function Home() {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const [parsedPreview, setParsedPreview] = useState<ParsedTask | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    taskService
      .getAll()
      .then((data) => {
        const mapped = data.map(mapTaskToRow)
        setTasks(mapped)
      })
      .catch((err) => {
        console.error(err)
        setTasks([
          {
            id: 'demo-1',
            title: 'Demo Task',
            description: 'Fallback task',
            priority: 'medium',
            status: 'pending',
            category: 'work',
            subcategory: 'Projects',
            dueDate: '',
            estimatedDuration: 60,
            note: 'Demo',
          },
        ])
      })
      .finally(() => setLoading(false))
  }, [])

  const handlePreview = (parsed: ParsedTask) => {
    setParsedPreview(parsed)
  }

  const handleTaskCreated = (task: Task) => {
    const mapped = mapTaskToRow(task)
    setTasks((prev) => {
      const withoutDemo = prev.filter((t) => t.id !== 'demo-1')
      const withoutDup = withoutDemo.filter((t) => t.id !== mapped.id)
      return [mapped, ...withoutDup]
    })
    setParsedPreview(null)
    setLoading(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.3 }}
      className='max-w-6xl mx-auto px-4 pt-24 pb-12 flex flex-col items-center text-center gap-12'
    >
      <div className='flex flex-col gap-4'>
        <h1 className='font-bold text-gray-100' style={{ fontSize: '40px', fontFamily: 'Helvetica, Arial, sans-serif' }}>
          Welcome to your Personal Productivity Assistant, Eris.
        </h1>
        <p className='text-gray-300' style={{ fontSize: '22px', fontFamily: 'Helvetica, Arial, sans-serif' }}>
          Manage your tasks intelligently with AI-powered insights and natural language processing.
        </p>
      </div>

      <div style={{ width: '100%', display: 'flex', justifyContent: 'center', marginBottom: '40px' }}>
        <div style={{ width: '100%', maxWidth: '900px' }}>
          <NaturalLanguageInput onSavePreview={handlePreview} onTaskCreated={handleTaskCreated} />
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

      <div style={{ width: '100%', maxWidth: '1300px', margin: '0 auto' }}>
        {loading ? (
          <p className='text-gray-300' style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>Loading tasks...</p>
        ) : (
          <TaskTable tasks={tasks} />
        )}
      </div>
    </motion.div>
  )
}

function AppContent() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path='/' element={<Home />} />
        <Route path='/tasks' element={<Tasks />} />
        <Route path='/view-tasks' element={<ViewTasks />} />
        <Route path='/schedule' element={<Schedule />} />
      </Routes>
    </AnimatePresence>
  )
}

function App() {
  const returnedFromAccess = new URLSearchParams(window.location.search).get('access') === 'granted'
  const shouldVerify = (import.meta.env.DEV && import.meta.env.MODE !== 'test') || returnedFromAccess || localStorage.getItem(SESSION_MARKER) === 'active'
  const [session, setSession] = useState<'public' | 'checking' | 'authenticated'>(shouldVerify ? 'checking' : 'public')

  useEffect(() => {
    const requireAuthentication = () => {
      localStorage.removeItem(SESSION_MARKER)
      setSession('public')
    }
    window.addEventListener('eris:authentication-required', requireAuthentication)
    return () => window.removeEventListener('eris:authentication-required', requireAuthentication)
  }, [])

  useEffect(() => {
    if (!shouldVerify) return
    authService.session()
      .then(() => {
        localStorage.setItem(SESSION_MARKER, 'active')
        setSession('authenticated')
        if (returnedFromAccess) window.history.replaceState({}, '', window.location.pathname)
      })
      .catch(() => {
        localStorage.removeItem(SESSION_MARKER)
        setSession('public')
      })
  }, [returnedFromAccess, shouldVerify])

  if (session !== 'authenticated') return <PublicPreview checking={session === 'checking'} />

  return (
    <div className='min-h-screen bg-[#0f172a] flex flex-col'>
      <Navbar />
      <main className='px-4 flex-1 flex justify-center items-start overflow-auto' style={{ paddingTop: '96px' }}>
        <div className='mx-auto max-w-6xl w-full py-10'>
          <AppContent />
        </div>
      </main>
    </div>
  )
}

export default App
