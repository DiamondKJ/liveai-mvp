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
    
    // AGGRESSIVE console filtering - block ALL debug output
    if (typeof window !== 'undefined') {
      const originalConsoleLog = console.log;
      console.log = (...args) => {
        // Convert all args to string for pattern matching
        const fullString = args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ');
        
        // Block ALL emoji debug patterns and common debug strings
        const debugPatterns = [
          'socket.io', 'Socket {', 'DEBUG:', 'users [', 'socket.id',
          '🔍', '🎯', '📥', '🔄', '📋', '🚀', // All debug emojis
          'GROUP CHAT DEBUG', 'AI RESPONSE DECISION', 'FINAL AI RESPONSE DECISION',
          'Loading messages for referenced chat', 'Processing referenced chat',
          'CONTEXTUAL MESSAGE RESULT', 'SENDING AI MESSAGE', 'PARSE CONTEXTUAL MESSAGE START',
          'SENDING USER-TO-USER MESSAGE', 'BLOCKING AI RESPONSE',
          'myUser {', 'users[0] {', 'sers[0] Object',
          'room_id', 'socket_id', 'user_name', 'chat_type', 'activeChat_type',
          'mentionedChats', 'messageText', 'will_trigger_ai'
        ];
        
        // Check if any debug pattern exists in the full string
        for (const pattern of debugPatterns) {
          if (fullString.includes(pattern)) {
            return; // Block this log completely
          }
        }
        
        // Only allow logs that don't match any debug patterns
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