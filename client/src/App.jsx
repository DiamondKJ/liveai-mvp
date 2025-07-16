import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import HomePage from './components/HomePage';
import RoomPage from './components/RoomPage';

const socket = io(import.meta.env.VITE_SERVER_URL || 'http://localhost:4000');

function App() {
  useEffect(() => {
    socket.on('connect', () => console.log('CLIENT: Socket connected successfully! ID:', socket.id));
    socket.on('disconnect', (reason) => console.warn('CLIENT: Socket disconnected:', reason));
    socket.on('connect_error', (error) => console.error('CLIENT: Socket connection error:', error.message));
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
    </Router>
  );
}

export default App;