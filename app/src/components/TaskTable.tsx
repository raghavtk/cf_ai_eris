import { useEffect, useId, useMemo, useState } from 'react'
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, TextField } from '@mui/material'
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined'
import ChevronRight from '@mui/icons-material/ChevronRight'
import './TaskTable.css'
import { aiService } from '../services/aiService'
import { taskService } from '../services/taskService'
import { mapTaskToRow } from '../demo'
import { localDate } from '../localDate'
import type { AiResult, UpdateTaskInput } from '../../../shared/contracts'

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
  readOnly?: boolean
  onDeleted?: (id: string) => void
}

const TaskTable = ({ tasks, onDeleted, readOnly = false }: Props) => {
  const [rows, setRows] = useState<TaskRow[]>(tasks)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [aiMessage, setAiMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const detailTitleId = useId()
  const [openId, setOpenId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [view, setView] = useState<'table' | 'queue'>('table')
  const [columns, setColumns] = useState({ priority: true, dueDate: true, note: false })
  const [editDraft, setEditDraft] = useState<TaskRow | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    setRows(tasks)
    setSelected(new Set())
  }, [tasks])

  const selectedTasks = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected])

  const openTask = rows.find((row) => row.id === openId)
  const today = localDate()
  const groups = view === 'table' ? [{ label: '', tasks: rows }] : [
    { label: 'Overdue', tasks: rows.filter((row) => isOpen(row) && row.dueDate && row.dueDate < today) },
    { label: 'Due today', tasks: rows.filter((row) => isOpen(row) && row.dueDate === today) },
    { label: 'Later', tasks: rows.filter((row) => isOpen(row) && (!row.dueDate || row.dueDate > today)) },
    { label: 'Closed', tasks: rows.filter((row) => !isOpen(row)) },
  ].filter((group) => group.tasks.length)
  const columnCount = 3 + Number(!readOnly) + Object.values(columns).filter(Boolean).length

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
    setRows(all.map(mapTaskToRow))
    setSelected(new Set())
  }

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const closeTask = () => {
    setOpenId(null)
    setEditDraft(null)
    setError('')
  }

  const saveEdit = async () => {
    if (readOnly || savingEdit || !openTask || !editDraft) return
    setError('')
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

      const updated = await taskService.update(openTask.id, payload)
      setRows((prev) => prev.map((row) => row.id === updated.id ? mapTaskToRow(updated) : row))
      setEditDraft(null)
    } catch (err) {
      console.error(err)
      setError('Could not save the task. Your edits are still here. Try again.')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (readOnly || savingEdit) return
    setSavingEdit(true)
    setError('')
    try {
      await taskService.delete(id)
      setRows((prev) => prev.filter((r) => r.id !== id))
      setSelected((current) => new Set([...current].filter((selectedId) => selectedId !== id)))
      closeTask()
      onDeleted?.(id)
    } catch (err) {
      console.error(err)
      setError('Could not delete the task. Try again.')
    } finally {
      setSavingEdit(false)
    }
  }

  const runEstimate = async () => {
    if (readOnly || busy || !selectedTasks.length) return
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

  const updateDraft = <Key extends keyof TaskRow>(key: Key, value: TaskRow[Key]) => {
    setEditDraft((draft) => draft && { ...draft, [key]: value })
  }

  return (
    <section className='task-database' aria-label='Tasks'>
      <header className='task-database-header'>
        <div className='task-database-title'>
          <h2>Tasks</h2>
          <span>{rows.length} {rows.length === 1 ? 'task' : 'tasks'}</span>
        </div>
        <div className='task-database-tools' role='group' aria-label='Task controls'>
          <div className='task-view-switch' role='group' aria-label='Task view'>
            <button type='button' aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
            <button type='button' aria-pressed={view === 'queue'} onClick={() => setView('queue')}>Work queue</button>
          </div>
          {!readOnly && selectedTasks.length > 0 && <span>{selectedTasks.length} selected</span>}
          <Button size='small' disabled={readOnly || busy || !selectedTasks.length} onClick={runEstimate}>Estimate time</Button>
          <Button size='small' disabled={readOnly || busy || !selectedTasks.length} onClick={runPriority}>Assign priority</Button>
          <Button size='small' disabled={readOnly || busy || !selectedTasks.length} onClick={runCategorize}>Categorize tasks</Button>
          <details className='task-columns'>
            <summary>Columns</summary>
            <fieldset>
              <legend>Additional properties</legend>
              {([
                ['priority', 'Priority'],
                ['dueDate', 'Due date'],
                ['note', 'Notes'],
              ] as const).map(([key, label]) => (
                <label key={key}>
                  <input type='checkbox' checked={columns[key]} onChange={(event) => {
                    const checked = event.target.checked
                    setColumns((current) => ({ ...current, [key]: checked }))
                  }} />
                  {label}
                </label>
              ))}
            </fieldset>
          </details>
        </div>
      </header>
      {readOnly && <p className='task-database-caption'>Open a task to see its details. Editing and AI tools require owner access.</p>}
      <div role='status' className='task-database-status'>{busy ? 'Updating selected tasks…' : aiMessage}</div>

      {rows.length ? (
        <div className='task-database-scroll'>
          <table aria-label='Task database' className={columns.note ? 'task-table-with-notes' : undefined}>
            <thead>
              <tr>
                {!readOnly && <th scope='col' className='task-select'>
                  <Checkbox
                    size='small'
                    inputProps={{ 'aria-label': 'Select all tasks' }}
                    checked={selectedTasks.length === rows.length}
                    indeterminate={selectedTasks.length > 0 && selectedTasks.length < rows.length}
                    onChange={(event) => setSelected(event.target.checked ? new Set(rows.map(({ id }) => id)) : new Set())}
                  />
                </th>}
                <th scope='col' className='task-name-column'>Task</th>
                <th scope='col' className='task-status-column'>Status</th>
                {columns.priority && <th scope='col' className='task-secondary task-priority-column'>Priority</th>}
                {columns.dueDate && <th scope='col' className='task-secondary task-date-column'>Due date</th>}
                <th scope='col' className='task-estimate'>Estimate</th>
                {columns.note && <th scope='col' className='task-secondary task-note-column'>Notes</th>}
              </tr>
            </thead>
            {groups.map(({ label, tasks }) => (
              <tbody key={label} aria-label={label || undefined}>
                {label && <tr className='task-group-heading'><th scope='rowgroup' colSpan={columnCount}>{label} <span>{tasks.length}</span></th></tr>}
                {tasks.map((row) => (
                <tr key={row.id} data-selected={selected.has(row.id)}>
                  {!readOnly && <td className='task-select'>
                    <Checkbox
                      size='small'
                      inputProps={{ 'aria-label': 'Select ' + row.title }}
                      checked={selected.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                    />
                  </td>}
                  <td className='task-name-cell'>
                    <button type='button' className='task-name' aria-haspopup='dialog' onClick={() => setOpenId(row.id)}>
                      <DescriptionOutlined aria-hidden='true' fontSize='inherit' />
                      <span>{row.title}</span>
                      <ChevronRight className='task-open-icon' aria-hidden='true' fontSize='inherit' />
                    </button>
                    <span className='task-category'>{[categoryLabels[row.category], row.subcategory].filter(Boolean).join(' / ')}</span>
                    {row.description && <span className='task-description'>{row.description}</span>}
                    {((columns.dueDate && row.dueDate) || (columns.priority && row.priority === 'high') || (columns.note && row.note)) && (
                      <span className='task-mobile-properties'>
                        {columns.priority && row.priority === 'high' && <span data-priority='high'>High priority</span>}
                        {columns.dueDate && row.dueDate && <time dateTime={row.dueDate}>Due {formatDueDate(row.dueDate, today)}</time>}
                        {columns.note && row.note && <span className='task-note'>Note: {row.note}</span>}
                      </span>
                    )}
                  </td>
                  <td><span className='task-status' data-status={row.status}>{statusLabels[row.status]}</span></td>
                  {columns.priority && <td className='task-secondary' data-priority={row.priority}>{priorityLabels[row.priority]}</td>}
                  {columns.dueDate && <td className='task-secondary'>{row.dueDate
                    ? <time dateTime={row.dueDate}>{formatDueDate(row.dueDate, today)}</time>
                    : <span className='task-unset'>—</span>}</td>}
                  <td className='task-estimate'>{row.estimatedDuration > 0 ? row.estimatedDuration + ' min' : <span className='task-unset'>—</span>}</td>
                  {columns.note && <td className='task-secondary'><span className='task-note'>{row.note || '—'}</span></td>}
                </tr>
              ))}
              </tbody>
            ))}
          </table>
        </div>
      ) : <p className='task-database-empty'>No tasks yet. Create a task to add it to this table.</p>}

      <Dialog aria-labelledby={detailTitleId} open={Boolean(openTask)} onClose={savingEdit ? undefined : closeTask} fullWidth maxWidth='sm'>
        {openTask && (
          <>
            <DialogTitle id={detailTitleId} className='task-detail-title'>{editDraft ? 'Edit task' : openTask.title}</DialogTitle>
            <DialogContent dividers>
              {editDraft ? (
                <fieldset className='task-detail-form' disabled={savingEdit} aria-label='Task properties'>
                  <TextField label='Title' value={editDraft.title} onChange={(event) => updateDraft('title', event.target.value)} autoFocus fullWidth />
                  <TextField label='Description' value={editDraft.description} onChange={(event) => updateDraft('description', event.target.value)} multiline fullWidth />
                  <div className='task-detail-grid'>
                    <TextField select disabled={savingEdit} label='Status' value={editDraft.status} onChange={(event) => updateDraft('status', event.target.value as TaskRow['status'])}>
                      {Object.entries(statusLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </TextField>
                    <TextField select disabled={savingEdit} label='Priority' value={editDraft.priority} onChange={(event) => updateDraft('priority', event.target.value as TaskRow['priority'])}>
                      {Object.entries(priorityLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </TextField>
                    <TextField select disabled={savingEdit} label='Category' value={editDraft.category} onChange={(event) => updateDraft('category', event.target.value as TaskRow['category'])}>
                      {Object.entries(categoryLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
                    </TextField>
                    <TextField label='Subcategory' value={editDraft.subcategory} onChange={(event) => updateDraft('subcategory', event.target.value)} />
                    <TextField label='Due date' type='date' slotProps={{ inputLabel: { shrink: true } }} value={editDraft.dueDate} onChange={(event) => updateDraft('dueDate', event.target.value)} />
                    <TextField label='Estimate (minutes)' type='number' value={editDraft.estimatedDuration} onChange={(event) => updateDraft('estimatedDuration', Number(event.target.value))} />
                  </div>
                  <TextField label='Note' value={editDraft.note} onChange={(event) => updateDraft('note', event.target.value)} multiline fullWidth />
                </fieldset>
              ) : (
                <dl className='task-properties'>
                  <dt>Status</dt><dd>{statusLabels[openTask.status]}</dd>
                  <dt>Priority</dt><dd>{priorityLabels[openTask.priority]}</dd>
                  <dt>Category</dt><dd>{categoryLabels[openTask.category]}</dd>
                  <dt>Subcategory</dt><dd>{openTask.subcategory || '—'}</dd>
                  <dt>Due date</dt><dd>{openTask.dueDate
                    ? <time dateTime={openTask.dueDate}>{formatDueDate(openTask.dueDate)}</time>
                    : '—'}</dd>
                  <dt>Estimate</dt><dd>{openTask.estimatedDuration > 0 ? openTask.estimatedDuration + ' min' : '—'}</dd>
                  <dt>Description</dt><dd>{openTask.description || '—'}</dd>
                  <dt>Note</dt><dd>{openTask.note || '—'}</dd>
                </dl>
              )}
              {error && <p role='alert'>{error}</p>}
            </DialogContent>
            <DialogActions>
              {editDraft ? (
                <>
                  <Button disabled={savingEdit} onClick={() => { setEditDraft(null); setError('') }}>Cancel</Button>
                  <Button variant='contained' disabled={savingEdit} onClick={saveEdit}>{savingEdit ? 'Saving…' : 'Save'}</Button>
                </>
              ) : (
                <>
                  {!readOnly && <Button color='error' disabled={busy || savingEdit} onClick={() => handleDelete(openTask.id)}>Delete</Button>}
                  <Button disabled={savingEdit} onClick={closeTask}>Close</Button>
                  {!readOnly && <Button variant='contained' disabled={busy || savingEdit} onClick={() => { setError(''); setEditDraft({ ...openTask }) }}>Edit</Button>}
                </>
              )}
            </DialogActions>
          </>
        )}
      </Dialog>
    </section>
  )
}

const isOpen = (task: TaskRow) => task.status === 'pending' || task.status === 'in_progress'

const statusLabels = { pending: 'Pending', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' }
const priorityLabels = { high: 'High', medium: 'Medium', low: 'Low' }
const categoryLabels = { work: 'Work', personal: 'Personal', other: 'Other' }

function formatDueDate(value: string, today?: string) {
  if (value === today) return 'Today'
  const date = new Date(value + 'T00:00:00Z')
  if (Number.isNaN(date.getTime())) return value
  const showYear = !today || value.slice(0, 4) !== today.slice(0, 4)
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', year: showYear ? 'numeric' : undefined, timeZone: 'UTC',
  }).format(date)
}

export default TaskTable
