import { useState, useEffect } from 'react'
import { Box, Container } from '@mui/material'
import TaskTable from '../components/TaskTable'
import type { TaskRow } from '../components/TaskTable'
import { mapTaskToRow } from '../demo'
import type { Task } from '../../../shared/contracts'
import { taskService } from '../services/taskService'

const ViewTasks = ({ demoTasks }: { demoTasks?: Task[] }) => {
  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(true)

  const isDemo = Boolean(demoTasks)

  useEffect(() => {
    if (isDemo) return
    taskService
      .getAll()
      .then((data) => setTasks(data.map(mapTaskToRow)))
      .catch((err) => console.error(err))
      .finally(() => setLoading(false))
  }, [isDemo])

  const handleDeleted = (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id))
  }

  return (
    <Box sx={{ py: { xs: 0, md: 2 } }}>
      <Container maxWidth='lg'>
        {!isDemo && loading ? (
          <p style={{ color: '#e5e7eb', textAlign: 'center' }}>Loading tasks...</p>
        ) : (
          <TaskTable tasks={demoTasks?.map(mapTaskToRow) ?? tasks} onDeleted={handleDeleted} readOnly={isDemo} />
        )}
      </Container>
    </Box>
  )
}

export default ViewTasks
