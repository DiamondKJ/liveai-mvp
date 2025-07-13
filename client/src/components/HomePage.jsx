import React from 'react';
import { useNavigate } from 'react-router-dom';

// A simple SVG arrow component for our diagram
const ArrowIcon = () => (
  <svg className="w-6 h-6 text-gray-500 mx-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>
  </svg>
);

function HomePage({ socket }) {
  const navigate = useNavigate();

  const handleCreateRoom = () => {
    socket.emit('create_room', ({ roomId }) => {
      navigate(`/room/${roomId}`);
    });
  };

  return (
    <div className="bg-gray-900 min-h-screen flex flex-col items-center justify-center p-4 font-mono text-white">
      <div className="text-center">
        {/* The Hero Section */}
        <h1 className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-500">
          Build Better Prompts, Together.
        </h1>
        <p className="mt-4 text-lg md:text-xl text-gray-300 max-w-3xl mx-auto">
          Chain-react ideas with friends or teammates in a real-time, turn-based prompt editor powered by Claude. Edit, amend, and build the perfect prompt as a team.
        </p>
        <button
          onClick={handleCreateRoom}
          className="mt-10 px-10 py-5 bg-purple-600 text-white font-bold text-xl rounded-lg shadow-lg shadow-purple-500/20 hover:bg-purple-700 transition-all duration-300 transform hover:scale-105"
        >
          Launch a Collaborative Session
        </button>
      </div>

      {/* The "How It Works" Visual Section */}
      <div className="mt-20 text-center">
        <h2 className="text-2xl font-bold text-gray-400">How It Works</h2>
        <div className="flex items-center justify-center mt-6 space-x-2">
          <div className="bg-gray-800 p-4 rounded-lg">User 1</div>
          <ArrowIcon />
          <div className="bg-gray-800 p-4 rounded-lg">User 2</div>
          <ArrowIcon />
          <div className="bg-gray-800 p-4 rounded-lg">...</div>
          <ArrowIcon />
          <div className="bg-blue-500/30 text-blue-300 p-4 rounded-lg ring-2 ring-blue-400 animate-pulse">AI</div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;