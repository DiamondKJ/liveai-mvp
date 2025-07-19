import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import io from 'socket.io-client';
import HomePage from './components/HomePage';
import RoomPage from './components/RoomPage';

const socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:4000');

// Force redeploy
function App() {
  useEffect(() => {
    // Hide socket object from console by using minimal logging
    socket.on('connect', () => {
      // Only log connection status, not the full socket object
      console.log('🟢 TeamChat connected');
    });
    socket.on('disconnect', (reason) => {
      console.warn('🟡 TeamChat disconnected:', reason);
    });
    socket.on('connect_error', (error) => {
      console.error('🔴 TeamChat connection error:', error.message);
    });
    
    // Override socket.io's default console logging
    if (typeof window !== 'undefined') {
      const originalConsoleLog = console.log;
      console.log = (...args) => {
        // Filter out socket.io debug messages and socket objects
        const argsStr = args.join(' ');
        if (argsStr.includes('socket.io') || 
            argsStr.includes('Socket {') ||
            (args.length === 1 && typeof args[0] === 'object' && args[0]?.id && args[0]?.connected !== undefined)) {
          return; // Don't log socket objects or socket.io debug messages
        }
        originalConsoleLog.apply(console, args);
      };
    }
    
    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('connect_error');
    };
  }, []);

  return (
    <Router>
      <Routes>
        {/* NEW: Homepage is now ONLY at the root path */}
        <Route path="/" element={<HomePage socket={socket} />} />
        {/* The RoomPage is where the actual chat happens */}
        <Route path="/room/:roomCode" element={<RoomPage socket={socket} />} />
      </Routes>
      <Analytics />
    </Router>
  );
}

export default App;