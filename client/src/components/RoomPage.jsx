import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

function RoomPage({ socket }) {
    const { roomId } = useParams();
    const navigate = useNavigate();
    const [input, setInput] = useState('');
    const [isRoomClosed, setIsRoomClosed] = useState(false);
    
    // Server-driven state
    const [users, setUsers] = useState([]);
    const [currentUserIndex, setCurrentUserIndex] = useState(0);
    const [promptInProgress, setPromptInProgress] = useState("");
    const [messages, setMessages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);

    const messagesEndRef = useRef(null);
    const activeUser = users[currentUserIndex];
    const isMyTurn = activeUser && activeUser.id === socket.id;

    useEffect(() => {
        if (isMyTurn) setInput(promptInProgress);
    }, [isMyTurn, promptInProgress]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, isLoading]); // Scroll on loading too

    useEffect(() => {
        socket.emit('join_room', { roomId }, (response) => {
            if (response.status !== 'ok') {
                alert(response.message);
                navigate('/');
            }
        });

        const handleStateUpdate = (gameState) => {
            setUsers(gameState.users);
            setCurrentUserIndex(gameState.currentUserIndex);
            setPromptInProgress(gameState.promptInProgress);
            setMessages(gameState.messages);
            setIsLoading(gameState.isLoading);
        };
        socket.on('update_game_state', handleStateUpdate);
        
        const handleRoomClosed = (data) => {
            alert(data.message);
            setIsRoomClosed(true);
        };
        socket.on('room_closed', handleRoomClosed);

        // --- NEW STREAMING LISTENERS ---
        socket.on('ai_stream_start', ({ sender, messageId }) => {
            setIsLoading(true); // Visually, the AI is now "thinking"
            // Add a new message placeholder to the array
            setMessages(prev => [...prev, { sender, text: "", id: messageId }]);
        });

        socket.on('ai_stream_chunk', ({ text, messageId }) => {
            // Find the message placeholder and append the new text
            setMessages(prev => prev.map(msg => 
                msg.id === messageId 
                ? { ...msg, text: msg.text + text } 
                : msg
            ));
        });

        socket.on('ai_stream_end', () => {
            setIsLoading(false); // AI is done thinking
        });
        // --- END OF STREAMING LISTENERS ---

        return () => {
            socket.off('update_game_state', handleStateUpdate);
            socket.off('room_closed', handleRoomClosed);
            socket.off('ai_stream_start');
            socket.off('ai_stream_chunk');
            socket.off('ai_stream_end');
        };
    }, [roomId, socket, navigate]);

    const submitForm = () => {
        if (isMyTurn && !isLoading) {
            socket.emit('submit_contribution', { roomId, updatedPrompt: input });
            setInput('');
        }
    };
    
    // ... (handleSubmit and handleKeyDown are the same) ...
     const handleSubmit = (e) => { e.preventDefault(); submitForm(); };
     const handleKeyDown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submitForm(); } };

    // ... (isRoomClosed UI is the same) ...
    if (isRoomClosed) { /* ... */ }
    
    return (
        // The main UI structure is the same, we just need to render messages differently
        <div className="bg-gray-900 text-white min-h-screen flex flex-col md:flex-row p-4 gap-4 font-mono">
            {/* ... (aside with participants is the same) ... */}
            <div className="flex-1 flex flex-col gap-4">
                <main className="flex-1 bg-gray-800 p-4 rounded-lg overflow-y-auto space-y-4">
                     {messages.map((msg, index) => (
                        <div key={msg.id || index}> {/* Use messageId for streaming message */}
                            <p className={`font-bold ${msg.sender === 'claude' ? 'text-blue-400' : 'text-purple-400'}`}>{msg.sender === 'prompt' ? 'Final Prompt to Claude' : 'Claude:'}</p>
                            <pre className="whitespace-pre-wrap ml-2 font-mono">{msg.text}</pre>
                        </div>
                     ))}
                     {isLoading && messages.every(m => m.sender !== 'claude') && ( // Only show if a claude message isn't already streaming
                        <div>
                            <p className="font-bold text-blue-400">Claude:</p>
                            <p className="whitespace-pre-wrap ml-2 italic text-gray-400">is thinking...</p>
                        </div>
                     )}
                     <div ref={messagesEndRef} />
                </main>
                {/* ... (footer with form is the same) ... */}
            </div>
        </div>
    );
}

export default RoomPage;