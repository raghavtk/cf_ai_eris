import './App.css'
import { useEffect, useState } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import Navbar from './components/Navbar'
import Tasks from './pages/Tasks'
import ViewTasks from './pages/ViewTasks'
import TaskTable from './components/TaskTable'
import type { TaskRow } from './components/TaskTable'
import NaturalLanguageInput from './components/NaturalLanguageInput'
import { taskService } from './services/taskService'

function Home() {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    taskService
      .getAll()
      .then((data) => {
        const mapped: TaskRow[] = data.map((t: any) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          priority: t.priority,
          status: t.status,
          category: t.category,
          subcategory: t.subcategory,
          dueDate: t.due_date,
          estimatedDuration: t.estimated_duration,
          note: t.note,
        }))
        setTasks(mapped)
      })
      .catch((err) => {
        console.error(err)
        // fallback demo data so UI renders
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

  const handlePreview = (parsed: any) => {
    navigate('/tasks', { state: { parsed } })
  }

  return (
    <div className='max-w-6xl mx-auto px-4 pt-24 pb-12 flex flex-col items-center text-center gap-12'>
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
          <NaturalLanguageInput onSavePreview={handlePreview} />
        </div>
      </div>

      <div style={{ width: '100%', maxWidth: '1300px', margin: '0 auto' }}>
        {loading ? (
          <p className='text-gray-300' style={{ fontFamily: 'Helvetica, Arial, sans-serif' }}>Loading tasks...</p>
        ) : (
          <TaskTable tasks={tasks} />
        )}
      </div>
    </div>
  )
}

function App() {
  return (
    <div className='min-h-screen bg-[#0f172a] flex flex-col'>
      <Navbar />
      <main className='px-4 flex-1 flex justify-center items-start overflow-auto' style={{ paddingTop: '96px' }}>
        <div className='mx-auto max-w-6xl w-full py-10'>
          <Routes>
            <Route path='/' element={<Home />} />
            <Route path='/tasks' element={<Tasks />} />
            <Route path='/view-tasks' element={<ViewTasks />} />
            <Route path='/schedule' element={<div className='text-center text-gray-600'>Schedule Planner - Coming Soon</div>} />
          </Routes>
        </div>
      </main>
    </div>
  )
}

export default App