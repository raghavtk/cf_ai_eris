import { motion, AnimatePresence } from "framer-motion"
import { useEffect, useMemo, useState } from 'react'
import {
  Button,
  Checkbox,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { aiService } from '../services/aiService'
import { taskService } from '../services/taskService'
import type { AiResult, Task, UpdateTaskInput } from '../../../shared/contracts'

export type TaskRow = {
  id: string
  title: string
  description: string
  priority: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  category: 'work' | 'personal' | 'other'
  subcategory: string
  dueDate: string
  estimatedDuration: number
  note: string
}

type Props = {
  tasks: TaskRow[]
  onDeleted?: (id: string) => void
}

const TaskTable = ({ tasks, onDeleted }: Props) => {
  const [rows, setRows] = useState<TaskRow[]>(tasks)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [aiMessage, setAiMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<TaskRow | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    setRows(tasks)
    setSelected(new Set())
  }, [tasks])

  const selectedTasks = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected])

  const mapApiTask = (t: Task): TaskRow => ({
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
  })

  const pickMatch = (values: Array<unknown>, pattern: RegExp) => {
    for (const value of values) {
      if (typeof value === 'string') {
        const match = value.match(pattern)
        if (match?.[0]) return match[0].toLowerCase()
      }
    }
    return null
  }

  const normalizePriority = (res: AiResult, fallback: TaskRow['priority']) =>
    (pickMatch([res?.priority, res?.priority_label, res?.suggestion, res?.raw], /high|medium|low/i) as TaskRow['priority']) ||
    fallback

  const normalizeCategory = (res: AiResult, fallback: TaskRow['category']) =>
    (pickMatch([res?.category, res?.category_label, res?.raw], /work|personal|other/i) as TaskRow['category']) || fallback

  const normalizeSubcategory = (res: AiResult, fallback: string) => {
    const direct = res?.subcategory ?? res?.sub_category
    if (typeof direct === 'string' && direct.trim()) return direct.trim()

    const knownSubcategories = [
      'Courses',
      'Internship',
      'Projects',
      'Health',
      'Social',
      'Finance',
      'Chores',
    ]

    const match = pickMatch([res?.raw], new RegExp(knownSubcategories.join('|'), 'i'))
    if (match) {
      const canonical = knownSubcategories.find((s) => s.toLowerCase() === match.toLowerCase())
      return canonical ?? match
    }

    return fallback
  }

  const normalizeEstimate = (res: AiResult) => {
    const candidate = res?.estimated_minutes ?? res?.estimated_duration ?? res?.estimatedMinutes ?? res?.minutes ?? res?.raw
    if (typeof candidate === 'number' && !Number.isNaN(candidate)) return candidate
    if (typeof candidate === 'string') {
      const match = candidate.match(/\d+(?:\.\d+)?/)
      if (match) return Number(match[0])
    }
    return 0
  }

  const refreshRows = async () => {
    const all = await taskService.getAll()
    setRows(all.map(mapApiTask))
    setSelected(new Set())
    setEditingId(null)
    setEditDraft(null)
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const startEdit = (row: TaskRow) => {
    setSelected(new Set([row.id]))
    setEditingId(row.id)
    setEditDraft({ ...row })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditDraft(null)
  }

  const saveEdit = async () => {
    if (!editingId || !editDraft) return
    setSavingEdit(true)
    try {
      const payload: UpdateTaskInput = {
        title: editDraft.title,
        description: editDraft.description,
        priority: editDraft.priority,
        status: editDraft.status,
        category: editDraft.category,
        subcategory: editDraft.subcategory,
        due_date: editDraft.dueDate,
        estimated_duration: Number(editDraft.estimatedDuration) || 0,
        note: editDraft.note,
      }

      const updated = await taskService.update(editingId, payload)
      setRows((prev) =>
        prev.map((r) =>
          r.id === editingId
            ? {
                id: updated.id,
                title: updated.title,
                description: updated.description,
                priority: updated.priority,
                status: updated.status,
                category: updated.category,
                subcategory: updated.subcategory,
                dueDate: updated.due_date,
                estimatedDuration: updated.estimated_duration,
                note: updated.note,
              }
            : r,
        ),
      )
      cancelEdit()
    } catch (err) {
      console.error(err)
      alert('Failed to update task')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await taskService.delete(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      onDeleted?.(id)
    } catch (err) {
      console.error(err)
      alert('Failed to delete task')
    }
  }

  const runEstimate = async () => {
    if (!selectedTasks.length) return
    setBusy(true)
    try {
      await Promise.all(
        selectedTasks.map(async (t) => {
          const res = await aiService.estimateDuration({ title: t.title, description: t.description })
          const est = normalizeEstimate(res)
          await taskService.update(t.id, { estimated_duration: est })
        }),
      )
      await refreshRows()
      setAiMessage('Time estimation updated for selected tasks.')
    } catch (err) {
      console.error(err)
      alert('Failed to estimate time')
    } finally {
      setBusy(false)
    }
  }

  const runCategorize = async () => {
    if (!selectedTasks.length) return
    setBusy(true)
    try {
      await Promise.all(
        selectedTasks.map(async (t) => {
          const res = await aiService.categorizeTask({ title: t.title, description: t.description })
          const category = normalizeCategory(res, t.category ?? 'work')
          const subcategory = normalizeSubcategory(res, t.subcategory ?? '')
          await taskService.update(t.id, { category, subcategory })
        }),
      )
      await refreshRows()
      setAiMessage('Categorization updated for selected tasks.')
    } catch (err) {
      console.error(err)
      alert('Failed to categorize tasks')
    } finally {
      setBusy(false)
    }
  }

  const runPriority = async () => {
    if (!selectedTasks.length) return
    setBusy(true)
    try {
      await Promise.all(
        selectedTasks.map(async (t) => {
          const res = await aiService.suggestPriority({ title: t.title, description: t.description, due_date: t.dueDate })
          const priority = normalizePriority(res, t.priority ?? 'medium')
          await taskService.update(t.id, { priority })
        }),
      )
      await refreshRows()
      setAiMessage('Priority updated for selected tasks.')
    } catch (err) {
      console.error(err)
      alert('Failed to assign priority')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Paper elevation={2} sx={{ p: 2, borderRadius: 2, bgcolor: '#1f2937', color: '#e5e7eb' }}>
      <Stack direction='row' alignItems='center' justifyContent='space-between' mb={2}>
        <Typography variant='h6' fontWeight={700}>
          Tasks
        </Typography>
        <Stack direction='row' spacing={1}>
          <Button
            variant='contained'
            size='small'
            onClick={runEstimate}
            disabled={!selectedTasks.length || busy}
            sx={{
              color: '#f8fafc',
              borderColor: '#f8fafc',
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { borderColor: '#f1f5f9', bgcolor: 'rgba(248,250,252,0.08)' },
            }}
          >
            Estimate time
          </Button>
          <Button
            variant='contained'
            size='small'
            onClick={runPriority}
            disabled={!selectedTasks.length || busy}
            sx={{
              color: '#f8fafc',
              borderColor: '#f8fafc',
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { borderColor: '#f1f5f9', bgcolor: 'rgba(94, 95, 92, 0.08)' },
            }}
          >
            Assign priority
          </Button>
          <Button
            variant='contained'
            size='small'
            onClick={runCategorize}
            disabled={!selectedTasks.length || busy}
            sx={{
              color: '#f8fafc',
              borderColor: '#f8fafc',
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': { borderColor: '#f1f5f9', bgcolor: 'rgba(248,250,252,0.08)' },
            }}
          >
            Categorize tasks
          </Button>
        </Stack>
      </Stack>
      {aiMessage && (
        <Typography variant='body2' sx={{ mb: 1, color: '#cbd5e1', fontFamily: 'Helvetica, Arial, sans-serif' }}>
          {aiMessage}
        </Typography>
      )}
      <TableContainer sx={{ maxHeight: 480 }}>
        <Table stickyHeader size='small'>
          <TableHead>
            <TableRow>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }} padding='checkbox'>
                <Checkbox
                  inputProps={{ 'aria-label': 'Select all tasks' }}
                  size='small'
                  sx={{ color: '#e5e7eb' }}
                  indeterminate={selected.size > 0 && selected.size < rows.length}
                  checked={selected.size === rows.length && rows.length > 0}
                  onChange={(e) => {
                    if (e.target.checked) setSelected(new Set(rows.map((r) => r.id)))
                    else setSelected(new Set())
                  }}
                />
              </TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Title</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Description</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Priority</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Status</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Category</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Subcategory</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Due Date</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Est. (min)</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }}>Note</TableCell>
              <TableCell sx={{ bgcolor: 'rgba(255,255,255,0.06)', color: '#e5e7eb' }} align='right'>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
<AnimatePresence>
            {rows.map((row) => {
              const isSelected = selected.has(row.id)
              const isEditing = editingId === row.id
              return (
                <TableRow component={motion.tr} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.2 }} key={row.id} hover selected={isSelected}>
                  <TableCell padding='checkbox' sx={{ color: '#e5e7eb' }}>
                    <Checkbox
                      inputProps={{ 'aria-label': `Select ${row.title}` }}
                      size='small'
                      sx={{ color: '#e5e7eb' }}
                      checked={isSelected}
                      onChange={() => toggleSelect(row.id)}
                    />
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <TextField
                        size='small'
                        value={editDraft?.title ?? ''}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, title: e.target.value } : d))}
                        sx={{ input: { color: '#e5e7eb' } }}
                      />
                    ) : (
                      row.title
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <TextField
                        size='small'
                        value={editDraft?.description ?? ''}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, description: e.target.value } : d))}
                        sx={{ input: { color: '#e5e7eb' } }}
                      />
                    ) : (
                      row.description
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <Select
                        size='small'
                        value={editDraft?.priority ?? row.priority}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, priority: e.target.value as TaskRow['priority'] } : d))}
                        sx={{ color: '#e5e7eb' }}
                      >
                        <MenuItem value='high'>high</MenuItem>
                        <MenuItem value='medium'>medium</MenuItem>
                        <MenuItem value='low'>low</MenuItem>
                      </Select>
                    ) : (
                      row.priority
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <Select
                        size='small'
                        value={editDraft?.status ?? row.status}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, status: e.target.value as TaskRow['status'] } : d))}
                        sx={{ color: '#e5e7eb' }}
                      >
                        <MenuItem value='pending'>pending</MenuItem>
                        <MenuItem value='in_progress'>in_progress</MenuItem>
                        <MenuItem value='completed'>completed</MenuItem>
                        <MenuItem value='cancelled'>cancelled</MenuItem>
                      </Select>
                    ) : (
                      row.status
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <Select
                        size='small'
                        value={editDraft?.category ?? row.category}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, category: e.target.value as TaskRow['category'] } : d))}
                        sx={{ color: '#e5e7eb' }}
                      >
                        <MenuItem value='work'>work</MenuItem>
                        <MenuItem value='personal'>personal</MenuItem>
                        <MenuItem value='other'>other</MenuItem>
                      </Select>
                    ) : (
                      row.category
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <TextField
                        size='small'
                        value={editDraft?.subcategory ?? ''}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, subcategory: e.target.value } : d))}
                        sx={{ input: { color: '#e5e7eb' } }}
                      />
                    ) : (
                      row.subcategory
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <TextField
                        size='small'
                        type='date'
                        value={editDraft?.dueDate ?? ''}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, dueDate: e.target.value } : d))}
                        InputLabelProps={{ shrink: true }}
                        sx={{ input: { color: '#e5e7eb' } }}
                      />
                    ) : (
                      row.dueDate || '—'
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <TextField
                        size='small'
                        type='number'
                        value={editDraft?.estimatedDuration ?? ''}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, estimatedDuration: Number(e.target.value) } : d))}
                        sx={{ input: { color: '#e5e7eb' } }}
                      />
                    ) : (
                      row.estimatedDuration ?? '—'
                    )}
                  </TableCell>
                  <TableCell sx={{ color: '#e5e7eb', maxWidth: 180 }}>
                    {isEditing ? (
                      <TextField
                        size='small'
                        value={editDraft?.note ?? ''}
                        onChange={(e) => setEditDraft((d) => (d ? { ...d, note: e.target.value } : d))}
                        sx={{ input: { color: '#e5e7eb' } }}
                      />
                    ) : (
                      row.note
                    )}
                  </TableCell>
                  <TableCell align='right' sx={{ color: '#e5e7eb' }}>
                    {isEditing ? (
                      <Stack direction='row' spacing={1} justifyContent='flex-end'>
                        <Button
                          size='small'
                          variant='outlined'
                          color='inherit'
                          onClick={cancelEdit}
                          disabled={savingEdit}
                          sx={{ textTransform: 'none', color: '#e5e7eb', borderColor: '#9ca3af' }}
                        >
                          Cancel
                        </Button>
                        <Button
                          size='small'
                          variant='contained'
                          color='primary'
                          onClick={saveEdit}
                          disabled={savingEdit}
                          sx={{ textTransform: 'none', fontWeight: 600 }}
                        >
                          {savingEdit ? 'Saving...' : 'Save'}
                        </Button>
                      </Stack>
                    ) : (
                      <Stack direction='row' spacing={1} justifyContent='flex-end'>
                        <Button
                          size='small'
                          variant='contained'
                          onClick={() => startEdit(row)}
                          disabled={!isSelected || busy}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 600,
                            bgcolor: '#2563eb',
                            color: '#f8fafc',
                            '&:hover': { bgcolor: '#1d4ed8' },
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size='small'
                          variant='contained'
                          color='error'
                          onClick={() => handleDelete(row.id)}
                          disabled={busy}
                          sx={{
                            textTransform: 'none',
                            bgcolor: '#b91c1c',
                            color: '#f8fafc',
                            fontWeight: 600,
                            fontFamily: 'Helvetica, Arial, sans-serif',
                            '&:hover': { bgcolor: '#dc2626' },
                          }}
                        >
                          Delete
                        </Button>
                      </Stack>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </AnimatePresence>
</TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}

export default TaskTable
