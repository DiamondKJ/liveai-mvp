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
    
    // Override console logging to hide debug objects and socket spam
    if (typeof window !== 'undefined') {
      const originalConsoleLog = console.log;
      console.log = (...args) => {
        // Filter out various debug objects and socket.io messages
        const argsStr = args.join(' ');
        
        // Skip if contains debug patterns - updated to match exact console output
        if (argsStr.includes('socket.io') || 
            argsStr.includes('Socket {') ||
            argsStr.includes('DEBUG: users') ||
            argsStr.includes('🔍 GROUP CHAT DEBUG:') ||
            argsStr.includes('🎯 AI RESPONSE DECISION:') ||
            argsStr.includes('🎯 FINAL AI RESPONSE DECISION:') ||
            argsStr.includes('📥 Loading messages for referenced chat:') ||
            argsStr.includes('🔄 Processing referenced chat:') ||
            argsStr.includes('📋 CONTEXTUAL MESSAGE RESULT:') ||
            argsStr.includes('🚀 SENDING AI MESSAGE:') ||
            argsStr.includes('🚀 PARSE CONTEXTUAL MESSAGE START:') ||
            argsStr.includes('SENDING USER-TO-USER MESSAGE') ||
            argsStr.includes('BLOCKING AI RESPONSE') ||
            argsStr.includes('sers[0] Object')) {
          return; // Don't log debug messages
        }
        
        // Skip if any argument is an object with common debug properties
        for (let arg of args) {
          if (typeof arg === 'object' && arg !== null) {
            // Skip socket objects
            if (arg.id && arg.connected !== undefined) return;
            // Skip debug objects with common patterns
            if (arg.hasOwnProperty('socket_id') || 
                arg.hasOwnProperty('room_id') ||
                arg.hasOwnProperty('user_name') ||
                arg.hasOwnProperty('chat_type')) return;
          }
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