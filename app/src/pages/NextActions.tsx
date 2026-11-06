import { useState } from 'react'
import { Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material'
import { Link } from 'react-router-dom'
import type { Task } from '../../../shared/contracts'
import { recommendNext } from '../recommendNext'
import { localDate } from '../localDate'

const timeOptions = [15, 30, 60, 120]

export default function NextActions({ tasks }: { tasks: Task[] }) {
  const [minutes, setMinutes] = useState(30)
  const recommendations = recommendNext(tasks, minutes, localDate())

  return (
    <section className='showcase-panel'>
      <p className='workspace-eyebrow'>Task recommendations</p>
      <h1>What should I do next?</h1>
      <p>Pick how much time you have. Eris shows up to three tasks that fit, ordered by deadline and priority.</p>
      <TextField
        select
        id='next-action-time'
        label='Time available'
        value={minutes}
        onChange={(event) => setMinutes(Number(event.target.value))}
        sx={{ minWidth: 170, mt: 1, mb: 3 }}
      >
        {timeOptions.map((option) => <MenuItem key={option} value={option}>{option} minutes</MenuItem>)}
      </TextField>

      <div aria-live='polite'>
        {recommendations.length ? (
          <Stack component='ol' spacing={1.5} sx={{ listStyle: 'none', padding: 0, margin: 0, maxWidth: 720 }}>
            {recommendations.map(({ task, deadline }, index) => (
              <Paper component='li' key={task.id} variant='outlined' sx={{ p: 2.5 }}>
                <Stack direction='row' spacing={1.5} alignItems='baseline'>
                  <Typography color='primary' aria-hidden='true'>{index + 1}.</Typography>
                  <Typography component='h2' variant='h6'>{task.title}</Typography>
                </Stack>
                {task.description && <Typography color='text.secondary' sx={{ mt: 0.5 }}>{task.description}</Typography>}
                <Stack direction='row' spacing={1} useFlexGap flexWrap='wrap' sx={{ mt: 1.5 }}>
                  {deadline && <Chip size='small' color='primary' label={deadline} />}
                  <Chip size='small' variant='outlined' label={task.priority + ' priority'} />
                  <Chip size='small' variant='outlined' label={task.estimated_duration + ' min'} />
                  {task.status === 'in_progress' && <Chip size='small' variant='outlined' label='In progress' />}
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : (
          <p>No open tasks with a time estimate fit. Pick a longer window or <Link to='/tasks'>add a smaller task</Link>.</p>
        )}
      </div>
      <p><Link to='/view-tasks'>View the demo task list</Link></p>
    </section>
  )
}
