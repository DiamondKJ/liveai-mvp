import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';

// Import university logos
import cambridgeLogo from '../assets/university-logos/cambridge.png';
import oxfordLogo from '../assets/university-logos/university-of-oxford-logo-png_seeklogo-146008.png';
import harvardLogo from '../assets/university-logos/harvard.png';
import warwickLogo from '../assets/university-logos/University_of_Warwick_logo.jpeg';
import imperialLogo from '../assets/university-logos/Imperial_College_London_new_logo.png';
import kingsLogo from '../assets/university-logos/King\'s_College_London_logo.svg.png';
import lseLogo from '../assets/university-logos/LSE_Logo.png';
import manchesterLogo from '../assets/university-logos/Manchester_University_Logo_(2).png';
import uclLogo from '../assets/university-logos/UCL_logo.png';
import redwoodLogo from '../assets/university-logos/redwoodlogo.png';

const ArrowIcon = () => (
  <svg className="w-6 h-6 text-gray-500 mx-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3"></path>
  </svg>
);

function HomePage({ socket }) {
  const navigate = useNavigate();
  const { roomCode: urlRoomCode } = useParams();

  const [userName, setUserName] = useState('');
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const nameInputRef = useRef(null);

  useEffect(() => {
    if (urlRoomCode) {
      setRoomCodeInput(urlRoomCode);
      nameInputRef.current?.focus(); 
    }
  }, [urlRoomCode]);

  useEffect(() => {
    const savedName = localStorage.getItem('llm_teams_username');
    if (savedName) setUserName(savedName);
  }, []);

  const handleAction = (isHostAction) => {
    if (!userName.trim()) {
        alert("Please enter your name.");
        return;
    }
    const codeToJoin = urlRoomCode || roomCodeInput;
    if (!isHostAction && !codeToJoin.trim()) {
        alert("Please enter a room code to join.");
        return;
    }

    setIsLoading(true);
    localStorage.setItem('llm_teams_username', userName.trim());

    if (isHostAction) {
      socket.emit('create_room', { userName: userName.trim() }, (response) => {
        setIsLoading(false);
        if (response.status === "error") {
          alert(`Failed to create room: ${response.message}`);
        } else {
          navigate(`/room/${response.roomId}`); // Navigate to the room URL.
        }
      });
    } else {
      // For joining, simply navigate. RoomPage will handle the join logic via its Lobby.
      navigate(`/room/${codeToJoin.trim()}`);
    }
  };

  return (
    <div className="bg-chatgpt min-h-screen flex flex-col items-center justify-center p-6 font-inter text-text-primary">
      {/* Background gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-blue-500/5 pointer-events-none"></div>
      
      {/* Main container */}
      <div className="relative z-10 w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="mb-6">
            <h1 className="text-6xl font-semibold text-white mb-4 tracking-tight">
              TeamChat
            </h1>
            <p className="text-xl text-text-secondary font-normal">
              Collaborative AI, Made Simple
            </p>
          </div>
          
          {urlRoomCode ? (
            <div className="bg-bg-secondary/50 backdrop-blur-sm rounded-2xl p-6 border border-chatgpt mb-6">
              <p className="text-text-secondary mb-2">You've been invited to join:</p>
              <p className="text-2xl font-mono text-blue-400 font-bold tracking-wider">{urlRoomCode}</p>
            </div>
          ) : null}
        </div>

        {/* Form */}
        <div className="space-y-6">
          {/* Name input */}
          <div className="relative">
            <input
              ref={nameInputRef}
              type="text"
              placeholder="Enter your name"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              maxLength={50}
              className="w-full px-4 py-3 bg-bg-secondary text-gray-900 rounded-xl border border-chatgpt focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base placeholder-gray-400 transition-all duration-200 focus:bg-white focus:text-gray-900"
            />
            <div className="absolute right-3 bottom-1 text-xs text-gray-400">
              {userName.length}/50
            </div>
          </div>

          {urlRoomCode ? (
            // Invited View
            <button
              onClick={() => handleAction(false)}
              disabled={isLoading}
              className="w-full px-4 py-3 bg-emerald-600 text-white font-medium text-base rounded-xl hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-chatgpt disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
            >
              {isLoading ? (
                <div className="flex items-center justify-center space-x-2">
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Joining...</span>
                </div>
              ) : (
                'Join Session'
              )}
            </button>
          ) : (
            // Default View
            <>
              <button
                onClick={() => handleAction(true)}
                disabled={isLoading}
                className="w-full px-4 py-3 bg-emerald-600 text-white font-medium text-base rounded-xl hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-chatgpt disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isLoading ? (
                  <div className="flex items-center justify-center space-x-2">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Creating...</span>
                  </div>
                ) : (
                  'Host a New Session'
                )}
              </button>
              
              {/* Divider */}
              <div className="relative flex items-center my-8">
                <div className="flex-grow border-t border-chatgpt"></div>
                <span className="px-4 text-text-secondary text-sm font-medium">or</span>
                <div className="flex-grow border-t border-chatgpt"></div>
              </div>
              
              {/* Join room section */}
              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Enter room code"
                    value={roomCodeInput}
                    onChange={(e) => setRoomCodeInput(e.target.value)}
                    maxLength={10}
                    className="w-full px-4 py-3 bg-bg-secondary text-gray-900 rounded-xl border border-chatgpt focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-base placeholder-gray-400 transition-all duration-200 focus:bg-white focus:text-gray-900"
                  />
                  <div className="absolute right-3 bottom-1 text-xs text-gray-400">
                    {roomCodeInput.length}/10
                  </div>
                </div>
                <button
                  onClick={() => handleAction(false)}
                  disabled={isLoading}
                  className="w-full px-4 py-3 bg-emerald-600 text-white font-medium text-base rounded-xl hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-chatgpt disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  Join Session
                </button>
              </div>
            </>
          )}
        </div>

        {/* University Logos Section */}
        <div className="mt-16 pt-8 border-t border-gray-700">
          <div className="text-center mb-8">
            <p className="text-text-secondary text-sm font-medium tracking-wide uppercase">
              Trusted by students at
            </p>
          </div>
        </div>
      </div>
      
      {/* Logos stretch full width beyond central UI */}
      <div className="w-full overflow-hidden bg-chatgpt mt-16">
        <div className="relative overflow-hidden py-4">
          <div className="flex animate-scroll">
                {/* First set of logos */}
                <div className="flex items-center space-x-12 min-w-max">
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={manchesterLogo} alt="University of Manchester" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={redwoodLogo} alt="Redwood Founders" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={harvardLogo} alt="Harvard University" className="max-h-32 max-w-full object-contain brightness-125 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={cambridgeLogo} alt="University of Cambridge" className="max-h-32 max-w-full object-contain brightness-125 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={oxfordLogo} alt="University of Oxford" className="max-h-36 max-w-full object-contain brightness-125 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={imperialLogo} alt="Imperial College London" className="max-h-24 max-w-full object-contain brightness-120 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={uclLogo} alt="University College London" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={lseLogo} alt="London School of Economics" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={kingsLogo} alt="King's College London" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={warwickLogo} alt="University of Warwick" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                </div>
                
                {/* Duplicate set for seamless loop - positioned to flow immediately after first set */}
                <div className="flex items-center space-x-12 min-w-max ml-12">
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={manchesterLogo} alt="University of Manchester" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={redwoodLogo} alt="Redwood Founders" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={harvardLogo} alt="Harvard University" className="max-h-32 max-w-full object-contain brightness-125 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={cambridgeLogo} alt="University of Cambridge" className="max-h-32 max-w-full object-contain brightness-125 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={oxfordLogo} alt="University of Oxford" className="max-h-36 max-w-full object-contain brightness-125 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={imperialLogo} alt="Imperial College London" className="max-h-24 max-w-full object-contain brightness-120 drop-shadow-lg" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={uclLogo} alt="University College London" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={lseLogo} alt="London School of Economics" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={kingsLogo} alt="King's College London" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                  <div className="flex items-center justify-center h-40 w-52 hover:scale-110 transition-all duration-300">
                    <img src={warwickLogo} alt="University of Warwick" className="max-h-20 max-w-full object-contain brightness-110" />
                  </div>
                </div>
            </div>
          </div>
        </div>
    </div>
  );
}

export default HomePage;

