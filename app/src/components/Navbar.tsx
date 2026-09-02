import { useState } from 'react';
import type { MouseEvent } from 'react';
import {
  AppBar,
  Box,
  Toolbar,
  IconButton,
  Typography,
  Container,
  Menu,
  MenuItem,
  Button,
} from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import { useNavigate, useLocation } from 'react-router-dom';

const navItems = [
  { label: 'Create Task', path: '/tasks' },
  { label: 'View Tasks', path: '/view-tasks' },
  { label: 'Schedule', path: '/schedule' },
];

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [anchorElNav, setAnchorElNav] = useState<null | HTMLElement>(null);

  const isActive = (path: string) => location.pathname === path;

  const handleOpenNavMenu = (event: MouseEvent<HTMLElement>) => setAnchorElNav(event.currentTarget);
  const handleCloseNavMenu = () => setAnchorElNav(null);

  const handleNavigate = (path: string) => {
    navigate(path);
    handleCloseNavMenu();
  };
// 1f2937
  return (
    <AppBar position='fixed' sx={{ bgcolor: '#232d3f' }}> 
      <Container maxWidth='lg'>
        <Toolbar disableGutters sx={{ minHeight: 64 }}>
          {/* Brand */}
          <Typography
            variant='h6'
            noWrap
            onClick={() => navigate('/')}
            sx={{
              mr: 2,
              cursor: 'pointer',
              fontWeight: 700,
              letterSpacing: '.2rem',
              color: 'white',
              textDecoration: 'none',
            }}
          >
            Eris
          </Typography>

          {/* Mobile menu */}
          <Box sx={{ flexGrow: 1, display: { xs: 'flex', md: 'none' }, justifyContent: 'flex-end' }}>
            <IconButton size='large' aria-label='menu' aria-controls='menu-appbar' aria-haspopup='true' onClick={handleOpenNavMenu} color='inherit'>
              <MenuIcon />
            </IconButton>
            <Menu
              id='menu-appbar'
              anchorEl={anchorElNav}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              keepMounted
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              open={Boolean(anchorElNav)}
              onClose={handleCloseNavMenu}
            >
              {navItems.map((item) => (
                <MenuItem key={item.path} onClick={() => handleNavigate(item.path)}>
                  <Typography textAlign='center'>{item.label}</Typography>
                </MenuItem>
              ))}
            </Menu>
          </Box>

          {/* Desktop buttons */}
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' }, justifyContent: 'flex-end', gap: 1.5 }}>
            {navItems.map((item) => (
              <Button
                key={item.path}
                onClick={() => handleNavigate(item.path)}
                variant={isActive(item.path) ? 'contained' : 'outlined'}
                color='primary'
                sx={{
                  borderColor: '#6b7280',
                  color: 'white',
                  bgcolor: isActive(item.path) ? 'primary.main' : 'transparent',
                  textTransform: 'none',
                  fontWeight: 600,
                  letterSpacing: '0.01em',
                  fontFamily: 'Inter, "Helvetica Neue", Arial, sans-serif',
                  '&:hover': { bgcolor: isActive(item.path) ? 'primary.dark' : 'rgba(255,255,255,0.08)' },
                }}
              >
                {item.label}
              </Button>
            ))}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
};

export default Navbar;
