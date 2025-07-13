import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import io from 'socket.io-client';
import HomePage from './components/HomePage';
import RoomPage from './components/RoomPage';

const socket = io('http://localhost:3001');

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<HomePage socket={socket} />} />
        <Route path="/room/:roomId" element={<RoomPage socket={socket} />} />
      </Routes>
    </Router>
  );
}

export default App;