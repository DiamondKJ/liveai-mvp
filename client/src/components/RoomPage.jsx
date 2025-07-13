import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';

function RoomPage({ socket }) {
    const { roomId } = useParams();
    const [input, setInput] = useState('');
    
    // Server-driven state
    const [users, setUsers] = useState([]);
    const [currentUserIndex, setCurrentUserIndex] = useState(0);
    const [promptInProgress, setPromptInProgress] = useState("");
    const [messages, setMessages] = useState([]);
    
    // --- NEW: A state to track when the AI is working ---
    const [isLoading, setIsLoading] = useState(false);

    const messagesEndRef = useRef(null);
    const activeUser = users[currentUserIndex];
    const isMyTurn = activeUser && activeUser.id === socket.id;

    useEffect(() => {
        if (isMyTurn) {
            setInput(promptInProgress);
        }
    }, [isMyTurn, promptInProgress]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    useEffect(() => {
        socket.emit('join_room', { roomId }, (response) => {
            if (response.status !== 'ok') alert(response.message);
        });

        const handleStateUpdate = (gameState) => {
            setUsers(gameState.users);
            setCurrentUserIndex(gameState.currentUserIndex);
            setPromptInProgress(gameState.promptInProgress);
            setMessages(gameState.messages);
            // --- NEW: Turn off loading state when an update arrives ---
            setIsLoading(false); 
        };
        socket.on('update_game_state', handleStateUpdate);

        return () => socket.off('update_game_state', handleStateUpdate);
    }, [roomId, socket]);

    const submitForm = () => {
        if (isMyTurn && !isLoading) { // Don't submit if already loading
            const isFinalTurn = users.length === currentUserIndex + 1;
            if (isFinalTurn) {
                // --- NEW: Set loading state to true only on the final turn ---
                setIsLoading(true);
            }
            socket.emit('submit_contribution', { roomId, updatedPrompt: input });
            // --- NEW: Immediately clear the input for instant feedback ---
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
    
    return (
        <div className="bg-gray-900 text-white min-h-screen flex flex-col md:flex-row p-4 gap-4 font-mono">
            
            <aside className="w-full md:w-1/4 bg-gray-800 p-4 rounded-lg flex-shrink-0">
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
                    <p className="text-2xl font-bold text-purple-400">{activeUser ? activeUser.name : '...'}'s Turn</p>
                </div>
            </aside>

            <div className="flex-1 flex flex-col gap-4">
                <main className="flex-1 bg-gray-800 p-4 rounded-lg overflow-y-auto space-y-4">
                     {messages.map((msg, index) => (
                        <div key={index}>
                            <p className={`font-bold ${msg.sender === 'claude' ? 'text-blue-400' : 'text-purple-400'}`}>{msg.sender === 'prompt' ? 'Final Prompt to Claude' : 'Claude:'}</p>
                            <pre className="whitespace-pre-wrap ml-2 font-mono">{msg.text}</pre>
                        </div>
                     ))}
                     {/* --- NEW: The Loading Indicator UI --- */}
                     {isLoading && (
                        <div>
                            <p className="font-bold text-blue-400">Claude:</p>
                            <p className="whitespace-pre-wrap ml-2 italic text-gray-400">is thinking...</p>
                        </div>
                     )}
                     <div ref={messagesEndRef} />
                </main>

                <footer className="mt-auto">
                    <form onSubmit={handleSubmit} className="flex flex-col">
                        <textarea
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder={isMyTurn ? "Edit the prompt or add your part..." : "Waiting for your turn..."}
                            className="flex-1 bg-gray-700 border-none rounded-t-lg p-3 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-600 h-40 resize-none"
                            disabled={!isMyTurn || isLoading} // Disable form while loading
                        />
                         <div className="flex justify-between items-center bg-gray-700 p-2 rounded-b-lg">
                            <p className="text-xs text-gray-400">
                                Press <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-md">Cmd/Ctrl</kbd> + <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-md">Enter</kbd> to submit.
                            </p>
                            <button 
                                type="submit" 
                                className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 disabled:bg-gray-500 disabled:cursor-not-allowed"
                                disabled={!isMyTurn || isLoading} // Disable form while loading
                            >
                                {isLoading ? 'Processing...' : (users.length === currentUserIndex + 1 ? 'Send to Claude' : 'Pass Turn & Save')}
                            </button>
                        </div>
                    </form>
                </footer>
            </div>
        </div>
    );
}

export default RoomPage;