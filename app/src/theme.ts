import { createTheme } from '@mui/material/styles'

export const workspaceTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: { main: '#9ce3c5', contrastText: '#10251e' },
    background: { default: '#10171a', paper: '#192528' },
    text: { primary: '#edf5f1', secondary: '#a8bdb4' },
  },
  typography: { fontFamily: 'Inter, system-ui, sans-serif' },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 650 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
})
