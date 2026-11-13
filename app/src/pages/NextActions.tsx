import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Task } from '../../../shared/contracts'
import { recommendNext } from '../recommendNext'
import { localDate } from '../localDate'
import './NextActions.css'

const timeOptions = [15, 30, 60, 120]

function taskDetails(task: Task, deadline: string | null) {
  return [deadline, task.priority + ' priority', task.status === 'in_progress' && 'In progress']
    .filter(Boolean)
    .join(' · ')
}

export default function NextActions({ tasks }: { tasks: Task[] }) {
  const [minutes, setMinutes] = useState(30)
  const [deferred, setDeferred] = useState<Task[]>([])
  const skipButton = useRef<HTMLButtonElement>(null)
  const available = tasks.filter((task) => !deferred.some(({ id }) => id === task.id))
  const [first, ...alternatives] = recommendNext(available, minutes, localDate())
  const lastDeferred = deferred.at(-1)
  const skippedFits = recommendNext(deferred, minutes, localDate()).length > 0

  return (
    <section className='next-page'>
      <header className='next-header'>
        <h1>What should I do next?</h1>
        <Link to='/view-tasks'>View demo tasks</Link>
      </header>

      <fieldset className='next-time'>
        <legend>How much time do you have?</legend>
        <div className='next-time-options'>
          {timeOptions.map((option) => (
            <label key={option}>
              <input
                type='radio'
                name='next-time'
                checked={minutes === option}
                onChange={() => setMinutes(option)}
              />
              <span>{option} min</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div aria-live='polite' className='next-results'>
        {first ? (
          <article className='next-pick'>
            <div className='next-pick-heading'>
              <div>
                <p className='next-kicker'>Start here</p>
                <h2>{first.task.title}</h2>
              </div>
              <span className='next-duration'>{first.task.estimated_duration} min</span>
            </div>
            {first.task.description && <p>{first.task.description}</p>}
            <p className='next-reason'>{taskDetails(first.task, first.deadline)} · Fits your {minutes}-minute window</p>
          </article>
        ) : (
          <div className='next-pick'>
            <h2>{skippedFits ? 'No more suggestions' : 'No tasks fit'} in {minutes} minutes</h2>
            <p>{skippedFits ? 'Undo a skip, choose a longer window, or ' : 'Choose a longer window or '}
              <Link to='/tasks'>add a task</Link> with a shorter estimate.
            </p>
          </div>
        )}
      </div>
      <div className='next-feedback'>
        <button
          ref={skipButton}
          type='button'
          aria-disabled={!first}
          onClick={() => {
            if (first) setDeferred([...deferred, first.task])
          }}
        >Not now</button>
        {lastDeferred && (
          <>
            <button type='button' onClick={() => {
              skipButton.current?.focus()
              setDeferred(deferred.slice(0, -1))
            }}>Undo</button>
            <span role='status'>Skipped {lastDeferred.title}.</span>
          </>
        )}
      </div>
      {alternatives.length > 0 && (
        <section className='next-alternatives'>
          <h2>Other options</h2>
          <ul>
            {alternatives.map(({ task, deadline }) => (
              <li key={task.id}>
                <div>
                  <h3>{task.title}</h3>
                  <p>{taskDetails(task, deadline)}</p>
                </div>
                <span className='next-duration'>{task.estimated_duration} min</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  )
}
