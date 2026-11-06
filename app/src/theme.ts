import { createTheme } from '@mui/material/styles'

export const workspaceTheme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: { main: '#91bcff', contrastText: '#0c1a31' },
    background: { default: '#0d1525', paper: '#162238' },
    text: { primary: '#eaf0fa', secondary: '#a9b9d2' },
  },
  typography: { fontFamily: 'Inter, system-ui, sans-serif' },
  shape: { borderRadius: 12 },
  components: {
    MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 650 } } },
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none' } } },
  },
})
