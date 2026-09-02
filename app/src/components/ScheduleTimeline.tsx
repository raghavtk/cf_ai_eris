import { useMemo } from 'react'
import { Box, Button, Chip, CircularProgress, Paper, Stack, Typography } from '@mui/material'
import { Lock as LockIcon } from '@mui/icons-material'
import type { ScheduleEntry } from '../../../shared/contracts'
import { blockPosition, visibleHourRange } from '../pages/scheduleLayout'

const PIXELS_PER_HOUR = 72
const hourLabel = (hour: number) => new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(2020, 0, 1, hour))

type Props = {
  entries: ScheduleEntry[]
  loading: boolean
  workdayStart: string
  workdayEnd: string
  onRemove: (entry: ScheduleEntry) => void
}

export default function ScheduleTimeline({ entries, loading, workdayStart, workdayEnd, onRemove }: Props) {
  const { startHour, endHour } = useMemo(
    () => visibleHourRange(workdayStart, workdayEnd, entries),
    [workdayStart, workdayEnd, entries],
  )
  const hours = useMemo(
    () => Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index),
    [startHour, endHour],
  )

  return (
    <Paper className='day-grid' elevation={0}>
      {loading ? <Box p={8} textAlign='center'><CircularProgress /></Box> : (
        <Box className='timeline' sx={{ height: `${(endHour - startHour) * PIXELS_PER_HOUR}px` }}>
          {hours.map((hour, index) => (
            <Box className='timeline-line' key={hour} sx={{ top: `${index * PIXELS_PER_HOUR}px` }}>
              <Typography className='hour-label'>{hour < 24 ? hourLabel(hour) : ''}</Typography>
            </Box>
          ))}
          <Box className='timeline-events'>
            {entries.map((entry) => {
              const position = blockPosition(entry, startHour, PIXELS_PER_HOUR)
              return (
                <Box key={entry.id} className={`schedule-block ${entry.source === 'google' ? 'google-block' : ''}`} sx={{ top: `${position.top}px`, height: `${position.height}px` }}>
                  <Stack direction='row' justifyContent='space-between' gap={2}>
                    <Box className='block-copy'>
                      <Typography fontWeight={700} noWrap>{entry.title}</Typography>
                      <Typography variant='body2' color='#cbd5e1'>{entry.start_time}–{entry.end_time}</Typography>
                    </Box>
                    <Stack direction='row' spacing={0.75} alignItems='center'>
                      {entry.locked ? <LockIcon fontSize='small' /> : null}
                      <Chip size='small' label={entry.source === 'google' ? 'Google' : 'Eris'} />
                      {entry.source === 'local' && <Button size='small' color='inherit' onClick={() => onRemove(entry)}>Remove</Button>}
                    </Stack>
                  </Stack>
                </Box>
              )
            })}
          </Box>
        </Box>
      )}
    </Paper>
  )
}
