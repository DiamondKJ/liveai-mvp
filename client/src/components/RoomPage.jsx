import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

function RoomPage({ socket }) {
    const { roomId } = useParams();
    const navigate = useNavigate();
    
    const [input, setInput] = useState('');
    const [isRoomClosed, setIsRoomClosed] = useState(false);
    
    const [gameState, setGameState] = useState({
        users: [],
        currentUserIndex: -1,
        promptInProgress: "",
        messages: [],
        isLoading: false,
    });
    
    const messagesEndRef = useRef(null);
    
    const { users, currentUserIndex, promptInProgress, messages, isLoading } = gameState;
    const activeUser = users[currentUserIndex];
    const isMyTurn = activeUser && activeUser.id === socket.id;

    useEffect(() => {
        if (isMyTurn) setInput(promptInProgress);
    }, [isMyTurn, promptInProgress]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isLoading]);

    useEffect(() => {
        const handleStateUpdate = (newState) => setGameState(newState);
        const handleRoomClosed = (data) => {
            alert(data.message);
            setIsRoomClosed(true);
        };
        const handleStreamStart = ({ sender, messageId }) => {
            setGameState(prev => ({ ...prev, isLoading: true }));
            setGameState(prev => ({
                ...prev,
                messages: [...prev.messages, { sender, text: "", id: messageId }]
            }));
        };
        const handleStreamChunk = ({ text, messageId }) => {
            setGameState(prev => ({
                ...prev,
                messages: prev.messages.map(msg => 
                    msg.id === messageId ? { ...msg, text: msg.text + text } : msg
                )
            }));
        };
        const handleStreamEnd = () => {
            setGameState(prev => ({ ...prev, isLoading: false }));
        };

        socket.on('update_game_state', handleStateUpdate);
        socket.on('room_closed', handleRoomClosed);
        socket.on('ai_stream_start', handleStreamStart);
        socket.on('ai_stream_chunk', handleStreamChunk);
        socket.on('ai_stream_end', handleStreamEnd);

        socket.emit('join_room', { roomId }, (response) => {
            if (response.status !== 'ok') {
                alert(response.message);
                navigate('/');
            }
        });

        return () => {
            socket.off('update_game_state', handleStateUpdate);
            socket.off('room_closed', handleRoomClosed);
            socket.off('ai_stream_start', handleStreamStart);
            socket.off('ai_stream_chunk', handleStreamChunk);
            socket.off('ai_stream_end', handleStreamEnd);
        };
    }, [roomId, socket, navigate]);

    const submitForm = () => {
        if (isMyTurn && !isLoading) {
            socket.emit('submit_contribution', { roomId, updatedPrompt: input });
            setInput('');
        }
    };
    
    const handleSubmit = (e) => {
        e.preventDefault();
        submitForm();
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            submitForm();
        }
    };
    
    if (isRoomClosed) {
        return (
            <div className="bg-gray-900 text-white min-h-screen flex flex-col items-center justify-center p-4 font-mono">
                <h1 className="text-4xl font-bold text-red-500">Session Ended</h1>
                <p className="mt-4 text-lg text-gray-400">The host has left the room.</p>
                <button onClick={() => navigate('/')} className="mt-8 bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded">
                    Return to Homepage
                </button>
            </div>
        );
    }
    
    return (
        // Main container: MUST fill screen height (h-screen) to allow flex children to calculate heights
        <div className="bg-gray-900 text-white h-screen flex flex-col md:flex-row p-4 gap-4 font-mono">
            {/* Left sidebar: fixed width, occupies full height of its parent, can scroll its own content */}
            <aside className="w-full md:w-1/4 bg-gray-800 p-4 rounded-lg flex-shrink-0 h-full overflow-y-auto">
                <h2 className="text-xl font-bold mb-4">Participants</h2>
                <ul className="space-y-2">
                    {users.map((user, index) => (
                        <li key={user.id} className={`p-2 rounded transition-all duration-300 ${index === currentUserIndex ? 'bg-purple-600 ring-2 ring-purple-400' : 'bg-gray-700'}`}>
                           {user.name} {user.id === socket.id && '(You)'}
                        </li>
                    ))}
                </ul>
                <div className="mt-6 text-center">
                    <h3 className="text-lg text-gray-400">Turn</h3>
                    <p className="text-2xl font-bold text-purple-400">{activeUser ? `${activeUser.name}'s Turn` : '...'}</p>
                </div>
            </aside>

            {/* Right main content area: flexible width, flex column, takes remaining height */}
            <div className="flex-1 flex flex-col gap-4 h-full"> 
                {/* Header: fixed at top of this flex column, does not shrink */}
                <header className="flex justify-between items-center bg-gray-800 p-4 rounded-lg flex-shrink-0">
                    <h1 className="text-xl md:text-2xl font-bold">Room: <span className="text-purple-400">{roomId}</span></h1>
                    <button 
                        onClick={() => { navigator.clipboard.writeText(window.location.href); alert('Link copied!'); }}
                        className="bg-gray-700 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded transition-colors duration-200"
                    >
                        Copy Invite Link
                    </button>
                </header>

                {/* Main chat display area: takes all *remaining* vertical space, and IS SCROLLABLE */}
                <main className="flex-1 bg-gray-800 p-4 rounded-lg overflow-y-auto space-y-4 min-h-0"> {/* min-h-0 is crucial for flex-1 children */}
                     {messages.map((msg, index) => (
                        <div key={msg.id || index}>
                            <p className={`font-bold ${msg.sender === 'claude' ? 'text-blue-400' : 'text-purple-400'}`}>{msg.sender === 'prompt' ? 'Final Prompt to Claude' : 'Claude:'}</p>
                            <pre className="whitespace-pre-wrap ml-2 font-mono">{msg.text}</pre>
                        </div>
                     ))}
                     {isLoading && messages.every(m => m.sender !== 'claude') && (
                        <div>
                            <p className="font-bold text-blue-400">Claude:</p>
                            <p className="whitespace-pre-wrap ml-2 italic text-gray-400">is thinking...</p>
                        </div>
                     )}
                     <div ref={messagesEndRef} />
                </main>

                {/* Footer/Input area: fixed at bottom of this flex column, does not shrink */}
                <footer className="mt-auto flex-shrink-0">
                    <form onSubmit={handleSubmit} className="flex flex-col">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={isMyTurn ? "Edit the prompt or add your part..." : "Waiting for your turn..."}
                            className="flex-1 bg-gray-700 border-none rounded-t-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-600 h-40 resize-none"
                            disabled={!isMyTurn || isLoading}
                        />
                         <div className="flex justify-between items-center bg-gray-700 p-2 rounded-b-lg">
                            <p className="text-xs text-gray-400">
                                Press <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-md">Cmd/Ctrl</kbd> + <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-md">Enter</kbd> to submit.
                            </p>
                            <button 
                                type="submit" 
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 disabled:bg-gray-500 disabled:cursor-not-allowed"
                                disabled={!isMyTurn || isLoading}
                            >
                                {isLoading ? 'Processing...' : ((currentUserIndex + 1) >= users.length ? 'Send to Claude' : 'Pass Turn & Save')}
                            </button>
                        </div>
                    </form>
                </footer>
            </div>
        </div>
    );
}

export default RoomPage;