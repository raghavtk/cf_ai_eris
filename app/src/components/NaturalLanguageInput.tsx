import { useState } from 'react'
import { Paper, Stack, TextField, Button, Typography } from '@mui/material'
import { aiService } from '../services/aiService'

type ParsedTask = {
  title?: string
  description?: string
  priority?: string
  due_date?: string
  category?: string
  subcategory?: string
  estimated_duration?: number
  note?: string | null
}

type Props = {
  onSavePreview?: (task: ParsedTask) => void
}

const NaturalLanguageInput = ({ onSavePreview }: Props) => {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const handleParse = async () => {
    if (!input.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await aiService.parseTask(input)
      const parsed = typeof res === 'string' ? JSON.parse(res) : res.parsed || res
      setSuccess('Parsed task — opening form')
      onSavePreview?.(parsed)
    } catch (e: any) {
      setError(e?.message || 'Parse failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Paper sx={{ p: 3, bgcolor: '#111827', color: '#e5e7eb', borderRadius: 3, width: '100%' }} elevation={3}>
      <Stack spacing={2} alignItems='center'>
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder='Add a task quickly, e.g., Finish the report by Friday, high priority'
          fullWidth
          InputProps={{
            sx: {
              borderRadius: '999px',
              bgcolor: '#0f172a',
              color: '#e5e7eb',
              '& .MuiOutlinedInput-notchedOutline': { borderColor: '#475569' },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#93c5fd' },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: '#38bdf8' },
              px: 2,
            },
          }}
          variant='outlined'
        />
        <Stack direction='row' spacing={2}>
          <Button
            variant='contained'
            onClick={handleParse}
            disabled={loading}
            sx={{ textTransform: 'none', color: '#e5e7eb' }}
          >
            {loading ? 'Parsing...' : 'Parse'}
          </Button>
          <Button
            variant='outlined'
            onClick={() => setInput('')}
            disabled={loading}
            sx={{ textTransform: 'none', color: '#e5e7eb', borderColor: '#e5e7eb' }}
          >
            Clear
          </Button>
        </Stack>

        {error && <Typography color='error'>{error}</Typography>}
        {success && <Typography color='success.main'>{success}</Typography>}
      </Stack>
    </Paper>
  )
}

export default NaturalLanguageInput
