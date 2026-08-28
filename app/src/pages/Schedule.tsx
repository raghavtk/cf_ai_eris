import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, CircularProgress, Container, Paper, Stack, TextField, Typography } from '@mui/material'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import LockIcon from '@mui/icons-material/Lock'
import type { ScheduleEntry, Task } from '../../../shared/contracts'
import { scheduleService } from '../services/scheduleService'
import { blockPosition, visibleHourRange } from './scheduleLayout'
import './Schedule.css'

const localDate = () => {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
const hourLabel = (hour: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, hour))
const PIXELS_PER_HOUR = 72

export default function Schedule() {
  const [date, setDate] = useState(localDate)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [entries, setEntries] = useState<ScheduleEntry[]>([])
  const [unscheduled, setUnscheduled] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [planning, setPlanning] = useState(false)
  const [error, setError] = useState('')
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setEntries(await scheduleService.getDay(date)); setUnscheduled([]) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load the schedule') }
    finally { setLoading(false) }
  }, [date])
  useEffect(() => { void load() }, [load])

  const { startHour, endHour } = useMemo(() => visibleHourRange(start, end, entries), [start, end, entries])
  const hours = useMemo(() => Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index), [startHour, endHour])
  const plan = async () => {
    setPlanning(true); setError('')
    try {
      const result = await scheduleService.planDay({ date, timezone, workday_start: start, workday_end: end })
      setEntries(result.entries); setUnscheduled(result.unscheduled)
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not plan the day') }
    finally { setPlanning(false) }
  }
  const remove = async (entry: ScheduleEntry) => {
    try { await scheduleService.delete(entry.id); setEntries((current) => current.filter((item) => item.id !== entry.id)) }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not remove the block') }
  }

  return (
    <Container maxWidth='lg' className='schedule-page'>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent='space-between' gap={3} mb={3}>
        <Box><Typography variant='h3' fontWeight={800} color='#f8fafc'>Daily planner</Typography><Typography color='#94a3b8'>A realistic, hour-by-hour plan in {timezone}.</Typography></Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems='center'>
          <TextField type='date' size='small' value={date} onChange={(event) => setDate(event.target.value)} inputProps={{ 'aria-label': 'Schedule date' }} />
          <TextField type='time' size='small' label='Start' value={start} onChange={(event) => setStart(event.target.value)} InputLabelProps={{ shrink: true }} />
          <TextField type='time' size='small' label='End' value={end} onChange={(event) => setEnd(event.target.value)} InputLabelProps={{ shrink: true }} />
          <Button variant='contained' startIcon={<AutoAwesomeIcon />} onClick={plan} disabled={planning} sx={{ whiteSpace: 'nowrap' }}>{planning ? 'Planning…' : 'Plan my day'}</Button>
        </Stack>
      </Stack>
      {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems='flex-start'>
        <Paper className='day-grid' elevation={0}>
          {loading ? <Box p={8} textAlign='center'><CircularProgress /></Box> : <Box className='timeline' sx={{ height: `${(endHour - startHour) * PIXELS_PER_HOUR}px` }}>
            {hours.map((hour, index) => <Box className='timeline-line' key={hour} sx={{ top: `${index * PIXELS_PER_HOUR}px` }}><Typography className='hour-label'>{hour < 24 ? hourLabel(hour) : ''}</Typography></Box>)}
            <Box className='timeline-events'>
              {entries.map((entry) => {
                const position = blockPosition(entry, startHour, PIXELS_PER_HOUR)
                return <Box key={entry.id} className={`schedule-block ${entry.source === 'google' ? 'google-block' : ''}`} sx={{ top: `${position.top}px`, height: `${position.height}px` }}>
                  <Stack direction='row' justifyContent='space-between' gap={2}><Box className='block-copy'><Typography fontWeight={700} noWrap>{entry.title}</Typography><Typography variant='body2' color='#cbd5e1'>{entry.start_time}–{entry.end_time}</Typography></Box>
                    <Stack direction='row' spacing={.75} alignItems='center'>{entry.locked ? <LockIcon fontSize='small' /> : null}<Chip size='small' label={entry.source === 'google' ? 'Google' : 'Eris'} />{entry.source === 'local' && <Button size='small' color='inherit' onClick={() => void remove(entry)}>Remove</Button>}</Stack>
                  </Stack>
                </Box>
              })}
            </Box>
          </Box>}
        </Paper>
        <Stack spacing={2} className='schedule-sidebar'>
          <Paper className='sidebar-card' elevation={0}><Stack direction='row' spacing={1} alignItems='center' mb={1}><CalendarMonthIcon color='primary' /><Typography fontWeight={700}>Calendar sync</Typography></Stack><Typography variant='body2' color='#94a3b8'>Google events will become locked busy blocks; Eris task blocks can later be pushed back as events.</Typography><Button disabled fullWidth variant='outlined' sx={{ mt: 2 }}>Connect Google Calendar — next</Button></Paper>
          <Paper className='sidebar-card' elevation={0}><Typography fontWeight={700} mb={1}>Couldn’t fit today</Typography>{!unscheduled.length ? <Typography variant='body2' color='#94a3b8'>Plan your day to see capacity conflicts.</Typography> : unscheduled.map((task) => <Box key={task.id} className='unscheduled-task'><Typography fontWeight={600}>{task.title}</Typography><Typography variant='caption' color='#94a3b8'>{task.estimated_duration || 60} min · {task.priority}</Typography></Box>)}</Paper>
        </Stack>
      </Stack>
    </Container>
  )
}
