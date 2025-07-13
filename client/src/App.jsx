import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react'; // <-- Import
import io from 'socket.io-client';
import HomePage from './components/HomePage';
import RoomPage from './components/RoomPage';

const socket = io(import.meta.env.VITE_SERVER_URL);

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage socket={socket} />} />
        <Route path="/room/:roomId" element={<RoomPage socket={socket} />} />
      </Routes>
      <Analytics /> {/* <-- Add the component here */}
    </Router>
  );
}

export default App;