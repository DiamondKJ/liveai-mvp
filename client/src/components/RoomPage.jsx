import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { nanoid } from 'nanoid';
import HelpModal from './HelpModal';

// Safe Rich Text Editor - React-friendly approach
const RichTextEditor = forwardRef(({
    value,
    onChange,
    onKeyDown,
    placeholder,
    className,
    disabled,
    mentionedChats,
    onMentionedChatsChange,
    showMentionPopup,
    mentionSuggestions,
    onMentionSelect,
    style,
    maxLength = 2000 // Default max length if not provided
}, ref) => {
    const textareaRef = useRef(null);
    const [displayValue, setDisplayValue] = useState(value || '');

    // Sync with parent value
    useEffect(() => {
        setDisplayValue(value || '');
    }, [value]);

    // Expose focus method to parent component
    useImperativeHandle(ref, () => ({
        focus: () => {
            if (textareaRef.current) {
                textareaRef.current.focus();
            }
        },
        current: textareaRef.current
    }));

    // Handle input changes
    const handleInputChange = (e) => {
        const value = e.target.value;
        // Enforce max character limit
        if (value.length <= maxLength) {
            setDisplayValue(value);
            onChange(e);
        }
    };

    // Render preview with inline pills (visual only, not editable)
    const renderPreview = () => {
        if (!displayValue.trim()) return null;
        
        const parts = [];
        let lastIndex = 0;
        
        // Find @mentions and render as pills
        const mentionPattern = /@([\w\s]+)/g;
        let match;
        
        while ((match = mentionPattern.exec(displayValue)) !== null) {
            // Add text before mention
            if (match.index > lastIndex) {
                parts.push(
                    <span key={`text-${lastIndex}`} className="text-gray-300">
                        {displayValue.substring(lastIndex, match.index)}
                    </span>
                );
            }
            
            // Find corresponding chat
            const mentionName = match[1].trim();
            const mentionedChat = mentionedChats.find(chat => 
                chat.chat_name?.toLowerCase().includes(mentionName.toLowerCase()) ||
                chat.name?.toLowerCase().includes(mentionName.toLowerCase())
            );
            
            if (mentionedChat) {
                // Render as pill preview
                parts.push(
                    <span
                        key={`pill-${match.index}`}
                        className="inline-flex items-center px-2 py-1 mx-1 text-xs font-medium bg-blue-600/80 text-white rounded-full"
                    >
                        @{mentionedChat.chat_name || mentionedChat.name}
                    </span>
                );
            } else {
                // Keep as text if no matching chat
                parts.push(
                    <span key={`mention-${match.index}`} className="text-blue-400">
                        {match[0]}
                    </span>
                );
            }
            
            lastIndex = match.index + match[0].length;
        }
        
        // Add remaining text
        if (lastIndex < displayValue.length) {
            parts.push(
                <span key={`text-${lastIndex}`} className="text-gray-300">
                    {displayValue.substring(lastIndex)}
                </span>
            );
        }
        
        return (
            <div className="absolute inset-0 pointer-events-none p-4 text-base" style={style}>
                {parts}
            </div>
        );
    };

    return (
        <div className="relative">
            {/* Background preview with pills */}
            {renderPreview()}
            
            {/* Actual editable textarea (transparent text) */}
            <textarea
                ref={textareaRef}
                value={displayValue}
                onChange={handleInputChange}
                onKeyDown={onKeyDown}
                placeholder={placeholder}
                className={`${className} relative z-10 text-transparent caret-white bg-transparent`}
                disabled={disabled}
                style={style}
            />
        </div>
    );
});

// --- Lobby Component (No changes needed) ---
const Lobby = ({ roomCode, onJoin, isJoining }) => {
    const [userName, setUserName] = useState('');
    const nameInputRef = useRef(null);

    useEffect(() => {
        const savedName = localStorage.getItem('llm_teams_username');
        if (savedName) setUserName(savedName);
        nameInputRef.current?.focus(); 
    }, []);

    const handleJoin = () => {
        if (!userName.trim()) return alert('Please enter your name.');
        localStorage.setItem('llm_teams_username', userName.trim());
        onJoin(userName.trim());
    };

    return (
        <div className="bg-neutral-900 h-screen flex flex-col items-center justify-center font-inter text-white p-4">
            <h1 className="text-4xl font-bold mb-2">Joining Session</h1>
            <p className="text-2xl font-mono text-blue-400 mb-8">{roomCode}</p>
            <div className="w-full max-w-sm flex flex-col space-y-3">
                <input
                    ref={nameInputRef}
                    type="text"
                    placeholder="Enter your name"
                    value={userName}
                    onChange={(e) => setUserName(e.target.value)}
                    className="px-5 py-3 input-bg rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-lg"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
                />
                <button
                    onClick={handleJoin}
                    disabled={isJoining}
                    className="px-10 py-3 button-chatgpt font-bold text-lg rounded-lg disabled:bg-gray-600"
                >
                    {isJoining ? 'Joining...' : 'Join Session'}
                </button>
            </div>
        </div>
    );
};


// --- Main RoomPage Component ---
function RoomPage({ socket }) {
    const { roomCode: urlRoomCode } = useParams();
    const navigate = useNavigate();
    
    // --- Raw State Management ---
    const [gameState, setGameState] = useState(null); 
    const [activeChatId, setActiveChatId] = useState(null); 
    const [input, setInput] = useState('');
    const [awaitingAI, setAwaitingAI] = useState(false);
    const [chatMessages, setChatMessages] = useState({}); 
    const [isRoomClosed, setIsRoomClosed] = useState(false);
    const [isJoiningLobby, setIsJoiningLobby] = useState(false); 
    const [mentionQuery, setMentionQuery] = useState('');
    const [showMentionPopup, setShowMentionPopup] = useState(false);
    const [mentionedChats, setMentionedChats] = useState([]); // Stores selected chat objects
    const [mentionSuggestions, setMentionSuggestions] = useState([]);
    const [highlightedMentionIndex, setHighlightedMentionIndex] = useState(0);
    const [selectedImages, setSelectedImages] = useState([]);
    const [showHelpModal, setShowHelpModal] = useState(false);
    
    // --- Refs ---
    const textareaRef = useRef(null); 
    const messagesEndRef = useRef(null);
    
    // --- Action Handlers ---
    const beginStream = (fullMsg) => {
        const streamId = fullMsg.id; // Use original message ID instead of creating new one
        
        console.log('🟢 [BEGIN_STREAM] Starting stream for message:', {
            id: streamId,
            chat_id: fullMsg.chat_id,
            role: fullMsg.role,
            text: fullMsg.text?.substring(0, 50) + '...',
            timestamp: new Date().toISOString()
        });
        
        // Add placeholder message with empty text
        setChatMessages(prev => {
            const existingMessages = prev[fullMsg.chat_id] || [];
            const alreadyExists = existingMessages.some(m => m.id === streamId);
            
            console.log('🟢 [BEGIN_STREAM] Adding placeholder message:', {
                chat_id: fullMsg.chat_id,
                existing_count: existingMessages.length,
                already_exists: alreadyExists,
                streamId
            });
            
            if (alreadyExists) {
                console.log('🟠 [BEGIN_STREAM] WARNING: Message already exists, not adding duplicate');
                return prev;
            }
            
            return {
                ...prev,
                [fullMsg.chat_id]: [...existingMessages, { ...fullMsg, id: streamId, text: '' }]
            };
        });

        let index = 0;
        const interval = setInterval(() => {
            index += 2; // reveal 2 characters per tick
            setChatMessages(prev => {
                const msgs = (prev[fullMsg.chat_id] || []).map(m => {
                    if (m.id === streamId) {
                        return { ...m, text: fullMsg.text.slice(0, index) };
                    }
                    return m;
                });
                return { ...prev, [fullMsg.chat_id]: msgs };
            });
            if (index >= fullMsg.text.length) {
                console.log('🟢 [BEGIN_STREAM] Streaming complete for message:', streamId);
                clearInterval(interval);
            }
        }, 5);
    };

    // --- Socket Event Listeners ---
    useEffect(() => {
        const handleStateUpdate = (newState) => {
            console.log('🟣 [HANDLE_STATE_UPDATE] Received state update:', {
                message_count: newState.messages?.length || 0,
                isProcessingAI: newState.isProcessingAI,
                processingChatId: newState.processingChatId,
                timestamp: new Date().toISOString()
            });
            
            setGameState(newState);
            const newMessagesCache = {};
            newState.messages.forEach(msg => {
                if (!newMessagesCache[msg.chat_id]) newMessagesCache[msg.chat_id] = [];
                newMessagesCache[msg.chat_id].push(msg);
            });
            
            console.log('🟣 [HANDLE_STATE_UPDATE] Organized messages by chat:', 
                Object.keys(newMessagesCache).map(chatId => ({
                    chat_id: chatId,
                    message_count: newMessagesCache[chatId].length,
                    assistant_messages: newMessagesCache[chatId].filter(m => m.role === 'assistant').length
                }))
            );
            
            // Merge with existing messages instead of replacing to avoid duplicating streamed AI responses
            setChatMessages(prevMessages => {
                console.log('🟣 [HANDLE_STATE_UPDATE] Current messages before merge:', 
                    Object.keys(prevMessages).map(chatId => ({
                        chat_id: chatId,
                        existing_count: prevMessages[chatId]?.length || 0,
                        assistant_count: prevMessages[chatId]?.filter(m => m.role === 'assistant').length || 0
                    }))
                );
                
                const mergedMessages = { ...prevMessages };
                Object.keys(newMessagesCache).forEach(chatId => {
                    // For each chat, only add messages that don't already exist (to prevent duplication)
                    const existingMessages = mergedMessages[chatId] || [];
                    const existingMessageIds = new Set(existingMessages.map(m => m.id));
                    
                    const newMessages = newMessagesCache[chatId].filter(msg => !existingMessageIds.has(msg.id));
                    
                    console.log('🟣 [HANDLE_STATE_UPDATE] Merge details for chat:', {
                        chat_id: chatId,
                        existing_count: existingMessages.length,
                        server_messages: newMessagesCache[chatId].length,
                        filtered_new: newMessages.length,
                        filtered_assistant: newMessages.filter(m => m.role === 'assistant').length,
                        existing_ids: Array.from(existingMessageIds),
                        new_message_ids: newMessages.map(m => m.id)
                    });
                    
                    mergedMessages[chatId] = [...existingMessages, ...newMessages];
                });
                
                console.log('🟣 [HANDLE_STATE_UPDATE] Final merged messages:', 
                    Object.keys(mergedMessages).map(chatId => ({
                        chat_id: chatId,
                        final_count: mergedMessages[chatId]?.length || 0,
                        assistant_count: mergedMessages[chatId]?.filter(m => m.role === 'assistant').length || 0
                    }))
                );
                
                return mergedMessages;
            });
            
            setIsJoiningLobby(false);
        };
        
        const handleRoomClosed = (data) => { alert(data.message); setIsRoomClosed(true); };
        
        const handleNewMessage = (msg) => {
            console.log('🔵 [HANDLE_NEW_MESSAGE] Received message:', {
                id: msg.id,
                chat_id: msg.chat_id,
                role: msg.role,
                text: msg.text?.substring(0, 50) + '...',
                timestamp: new Date().toISOString()
            });
            
            // Non-assistant messages are added directly
            if (msg.role !== 'assistant') {
                console.log('🔵 [HANDLE_NEW_MESSAGE] Adding user message directly');
                setChatMessages(prev => ({
                    ...prev,
                    [msg.chat_id]: [...(prev[msg.chat_id] || []), msg]
                }));
            } else {
                console.log('🔵 [HANDLE_NEW_MESSAGE] Processing assistant message - calling beginStream');
                // Assistant messages trigger the thinking/streaming flow
                setAwaitingAI(false);
                beginStream(msg);
            }
        };

        socket.on('update_game_state', handleStateUpdate);
        socket.on('room_closed', handleRoomClosed);
        socket.on('new_message', handleNewMessage);

        return () => {
            // Cleanup: remove all listeners
            socket.off('update_game_state', handleStateUpdate);
            socket.off('room_closed', handleRoomClosed);
            socket.off('new_message', handleNewMessage);
        };
    }, [socket, navigate, urlRoomCode]);

    // --- Defensive: Ensure activeChatId is always set when gameState.chats is available ---
    useEffect(() => {
        if (gameState && !activeChatId && Array.isArray(gameState.chats) && gameState.chats.length > 0) {
            const groupChat = gameState.chats.find(c => c.chat_type === 'group');
            if (groupChat) setActiveChatId(groupChat.id);
            else setActiveChatId(gameState.chats[0].id); // fallback to first chat
        }
    }, [gameState, activeChatId]);

    // Show help modal when user first joins a room - only after everything is fully loaded
    useEffect(() => {
        if (gameState && gameState.id && activeChatId && !showHelpModal) {
            const hasSeenHelp = localStorage.getItem(`help_seen_${gameState.id}`);
            if (!hasSeenHelp) {
                // Add a small delay to ensure everything is rendered
                setTimeout(() => {
                    setShowHelpModal(true);
                }, 500);
            }
        }
    }, [gameState?.id, activeChatId]); // Remove showHelpModal from dependencies to prevent loops

    // --- Effects for UI behaviors ---
    useEffect(() => {
        if (gameState) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [chatMessages, gameState?.isProcessingAI, gameState]);

    useEffect(() => {
        if (activeChatId && !chatMessages[activeChatId] && gameState) { 
            socket.emit('request_chat_messages', { chatId: activeChatId }, (response) => {
                setChatMessages(prev => ({ ...prev, [activeChatId]: response.messages || [] }));
            });
        }
    }, [activeChatId, chatMessages, socket, gameState]);

    // Separate useEffect for clearing input only when chat actually changes
    useEffect(() => {
        // Clear mention pills, images, and input when switching chats
        setMentionedChats([]);
        setShowMentionPopup(false);
        setSelectedImages([]);
        setInput(''); // Clear unsent message input
    }, [activeChatId]); // Only run when activeChatId changes, not when gameState changes


    const handleJoinRoom = (userName) => {
        setIsJoiningLobby(true); 
        socket.emit('join_room', { roomCode: urlRoomCode, userName: userName }, (response) => {
            if (response.status === "error") {
                alert(response.message);
                setIsJoiningLobby(false); 
                navigate('/'); 
            }
        });
    };

    // Enhanced context parsing for reference-based research
    const parseContextualMessage = async (messageText, activeChatId, mentionedChats) => {
        // Phase 1: Context Parsing - Create structured context blocks
        const messageContext = {
            primary_context: {
                chat_id: activeChatId,
                message: messageText,
                user_id: myUser?.id,
                timestamp: Date.now(),
                chat_type: activeChat?.chat_type
            },
            referenced_contexts: [],
            // Default to false for group chats, true for individual chats
            requires_ai_response: activeChat?.chat_type === 'individual'
        };

        console.log('🚀 PARSE CONTEXTUAL MESSAGE START:', {
            messageText,
            activeChatId,
            activeChat_type: activeChat?.chat_type,
            mentionedChats_count: mentionedChats.length,
            mentionedChats: mentionedChats.map(c => ({ id: c.id, isAI: c.isAI, name: c.chat_name })),
            initial_requires_ai_response: messageContext.requires_ai_response
        });

        // Check if this is a group chat message requiring Claude pill selection
        if (activeChat?.chat_type === 'group') {
            const hasClaudeSelected = mentionedChats.some(chat => chat.isAI || chat.id === 'claude-ai');
            
            console.log('🔍 GROUP CHAT DEBUG:', {
                activeChat_type: activeChat?.chat_type,
                mentionedChats: mentionedChats.map(c => ({ id: c.id, isAI: c.isAI, name: c.chat_name })),
                hasClaudeSelected,
                messageText
            });
            
            // In group chat, ONLY respond when Claude is selected from dropdown (blue pill)
            messageContext.requires_ai_response = hasClaudeSelected;
            
            console.log('🎯 AI RESPONSE DECISION:', {
                requires_ai_response: messageContext.requires_ai_response,
                reason: hasClaudeSelected ? 'Claude selected from dropdown' : 'No Claude selection'
            });
            
            if (!messageContext.requires_ai_response) {
                // This is user-to-user communication, still send message but don't trigger AI
                console.log('✋ BLOCKING AI RESPONSE - User-to-user message');
                return {
                    ...messageContext,
                    requires_ai_response: false,
                    is_user_to_user: true
                };
            }
        }

        console.log('🎯 FINAL AI RESPONSE DECISION:', {
            requires_ai_response: messageContext.requires_ai_response,
            chat_type: activeChat?.chat_type,
            should_proceed: messageContext.requires_ai_response
        });

        // Phase 2: Smart Referencing - Load messages for referenced chats if needed
        const loadReferencedMessages = async (chat) => {
            if (!chatMessages[chat.id] || chatMessages[chat.id].length === 0) {
                console.log('📥 Loading messages for referenced chat:', chat.id, chat.chat_name);
                return new Promise((resolve) => {
                    socket.emit('request_chat_messages', { chatId: chat.id }, (response) => {
                        const messages = response.messages || [];
                        setChatMessages(prev => ({ ...prev, [chat.id]: messages }));
                        resolve(messages);
                    });
                });
            }
            return chatMessages[chat.id] || [];
        };

        // Load messages for all referenced chats
        for (const chat of mentionedChats) {
            const chatMsgs = await loadReferencedMessages(chat);
            const recentMessages = chatMsgs.slice(-10); // Analyze more messages for better context
            
            console.log('🔄 Processing referenced chat:', {
                chat_id: chat.id,
                chat_name: chat.chat_name,
                messages_count: chatMsgs.length,
                recent_messages_count: recentMessages.length
            });
            
            // Phase 2: Generate intelligent context summary
            const intelligentSummary = generateIntelligentSummary(recentMessages, messageText, chat);
            
            const contextSummary = {
                chat_id: chat.id,
                chat_name: chat.chat_name,
                chat_type: chat.chat_type,
                owner_user_id: chat.owner_user_id,
                
                // Phase 2: Enhanced summarization
                key_findings: intelligentSummary.key_findings,
                research_status: intelligentSummary.research_status,
                main_topic: intelligentSummary.main_topic,
                actionable_insights: intelligentSummary.actionable_insights,
                relevance_to_query: intelligentSummary.relevance_to_query,
                
                // Legacy support
                recent_messages: recentMessages.slice(-3).map(msg => ({
                    role: msg.role,
                    content: msg.text.length > 150 ? msg.text.substring(0, 150) + '...' : msg.text,
                    timestamp: msg.timestamp,
                    relevance_score: calculateRelevanceScore(msg.text, messageText)
                })),
                reference_type: detectReferenceType(messageText, chat)
            };
            
            messageContext.referenced_contexts.push(contextSummary);
        }

        // Phase 1: Implement recency weighting
        messageContext.referenced_contexts.sort((a, b) => {
            const aScore = a.recent_messages.reduce((sum, msg) => sum + msg.relevance_score, 0);
            const bScore = b.recent_messages.reduce((sum, msg) => sum + msg.relevance_score, 0);
            return bScore - aScore; // Higher relevance first
        });

        return messageContext;
    };

    // Helper function to calculate relevance between messages
    const calculateRelevanceScore = (contextText, queryText) => {
        const contextWords = contextText.toLowerCase().split(/\s+/);
        const queryWords = queryText.toLowerCase().split(/\s+/);
        
        let score = 0;
        queryWords.forEach(word => {
            if (contextWords.includes(word)) score += 1;
        });
        
        return score / Math.max(queryWords.length, 1);
    };

    // Helper function to detect reference type
    const detectReferenceType = (messageText, chat) => {
        if (/find|found|data|result|information/i.test(messageText)) return 'data';
        if (/question|ask|help|explain/i.test(messageText)) return 'question';
        if (/conclude|summary|findings/i.test(messageText)) return 'conclusion';
        return 'general';
    };

    // Phase 2: Generate intelligent context summary from chat messages
    const generateIntelligentSummary = (messages, currentQuery, chat) => {
        if (!messages || messages.length === 0) {
            return {
                key_findings: [],
                research_status: 'no_data',
                main_topic: 'unknown',
                actionable_insights: [],
                relevance_to_query: 0
            };
        }

        // Extract key findings using pattern matching
        const keyFindings = extractKeyFindings(messages);
        const researchStatus = determineResearchStatus(messages);
        const mainTopic = extractMainTopic(messages);
        const actionableInsights = extractActionableInsights(messages);
        const relevanceToQuery = calculateQueryRelevance(messages, currentQuery);

        return {
            key_findings: keyFindings,
            research_status: researchStatus,
            main_topic: mainTopic,
            actionable_insights: actionableInsights,
            relevance_to_query: relevanceToQuery
        };
    };

    // Extract key findings from conversation
    const extractKeyFindings = (messages) => {
        const findings = [];
        const findingPatterns = [
            /(?:found|discovered|identified|determined|concluded)\s+(?:that\s+)?(.{10,100})/gi,
            /(?:result|outcome|finding)\s*:?\s*(.{10,100})/gi,
            /(?:data shows|analysis reveals|research indicates)\s+(.{10,100})/gi,
            /(?:key point|important|significant)\s*:?\s*(.{10,100})/gi
        ];

        messages.forEach(msg => {
            if (msg.role === 'assistant' || msg.role === 'user') {
                findingPatterns.forEach(pattern => {
                    const matches = [...msg.text.matchAll(pattern)];
                    matches.forEach(match => {
                        const finding = match[1]?.trim();
                        if (finding && finding.length > 10) {
                            findings.push({
                                content: finding,
                                confidence: determineConfidence(finding, msg.text),
                                timestamp: msg.timestamp
                            });
                        }
                    });
                });
            }
        });

        return findings.slice(0, 3); // Top 3 findings
    };

    // Determine research status from conversation flow
    const determineResearchStatus = (messages) => {
        const lastMessages = messages.slice(-3);
        const hasQuestions = lastMessages.some(msg => msg.text.includes('?'));
        const hasConclusions = lastMessages.some(msg => 
            /(?:conclude|summary|final|result|outcome)/i.test(msg.text)
        );
        const hasOngoingWork = lastMessages.some(msg => 
            /(?:looking into|investigating|researching|analyzing)/i.test(msg.text)
        );

        if (hasConclusions) return 'concluded';
        if (hasOngoingWork) return 'in_progress';
        if (hasQuestions) return 'exploring';
        return 'active';
    };

    // Extract main topic from conversation
    const extractMainTopic = (messages) => {
        const allText = messages.map(msg => msg.text).join(' ');
        const topicPatterns = [
            /(?:about|regarding|concerning|studying|researching)\s+([\w\s]{5,30})/gi,
            /(?:topic|subject|focus)\s*:?\s*([\w\s]{5,30})/gi
        ];

        for (const pattern of topicPatterns) {
            const match = pattern.exec(allText);
            if (match && match[1]) {
                return match[1].trim();
            }
        }

        // Fallback: most common meaningful words
        const words = allText.toLowerCase().split(/\s+/);
        const meaningfulWords = words.filter(word => 
            word.length > 4 && 
            !['that', 'this', 'with', 'from', 'they', 'have', 'been', 'will', 'would', 'could', 'should'].includes(word)
        );
        
        if (meaningfulWords.length > 0) {
            return meaningfulWords[0];
        }

        return 'general research';
    };

    // Extract actionable insights
    const extractActionableInsights = (messages) => {
        const insights = [];
        const insightPatterns = [
            /(?:should|recommend|suggest|next step|action)\s*:?\s*(.{10,80})/gi,
            /(?:need to|must|important to)\s+(.{10,80})/gi,
            /(?:solution|approach|method)\s*:?\s*(.{10,80})/gi
        ];

        messages.forEach(msg => {
            insightPatterns.forEach(pattern => {
                const matches = [...msg.text.matchAll(pattern)];
                matches.forEach(match => {
                    const insight = match[1]?.trim();
                    if (insight && insight.length > 10) {
                        insights.push({
                            content: insight,
                            priority: determinePriority(insight, msg.text),
                            timestamp: msg.timestamp
                        });
                    }
                });
            });
        });

        return insights.slice(0, 2); // Top 2 insights
    };

    // Calculate relevance between messages and current query
    const calculateQueryRelevance = (messages, query) => {
        if (!query || messages.length === 0) return 0;

        const queryWords = query.toLowerCase().split(/\s+/);
        const messageText = messages.map(msg => msg.text).join(' ').toLowerCase();
        
        let relevanceScore = 0;
        queryWords.forEach(word => {
            if (word.length > 3 && messageText.includes(word)) {
                relevanceScore += 1;
            }
        });

        return Math.min(relevanceScore / queryWords.length, 1); // Normalize to 0-1
    };

    // Helper functions for confidence and priority scoring
    const determineConfidence = (finding, fullText) => {
        const highConfidenceWords = ['confirmed', 'proven', 'definitely', 'clearly', 'certainly'];
        const lowConfidenceWords = ['maybe', 'possibly', 'might', 'unclear', 'uncertain'];
        
        if (highConfidenceWords.some(word => fullText.toLowerCase().includes(word))) return 'high';
        if (lowConfidenceWords.some(word => fullText.toLowerCase().includes(word))) return 'low';
        return 'medium';
    };

    const determinePriority = (insight, fullText) => {
        const urgentWords = ['urgent', 'critical', 'important', 'must', 'immediately'];
        const lowPriorityWords = ['later', 'eventually', 'consider', 'maybe'];
        
        if (urgentWords.some(word => fullText.toLowerCase().includes(word))) return 'high';
        if (lowPriorityWords.some(word => fullText.toLowerCase().includes(word))) return 'low';
        return 'medium';
    };

    const submitForm = async () => {
        // --- Derived states for submitForm scope ---
        const myUserInsideHandler = users.find(u => u.socket_id_current === socket.id); 
        const isUserOnlineInsideHandler = users.some(u => u.socket_id_current === socket.id);
        const activeChatInsideHandler = chats.find(c => c.id === activeChatId);
        const isChatEditableInsideHandler = activeChatInsideHandler?.chat_type === 'group' || (activeChatInsideHandler?.owner_user_id === myUserInsideHandler?.id);
        const isChatCappedInsideHandler = currentChatMessages.length >= 100;

        if (!activeChatInsideHandler || !myUserInsideHandler || !input.trim() || isProcessingAI || awaitingAI || !isChatEditableInsideHandler || isChatCappedInsideHandler) return;

        const messageText = input.trim();
        // Filter out AI mentions - they're not real chats with history
        const mentionChatIds = mentionedChats.filter(c => !c.isAI && c.id !== 'claude-ai').map(c => c.id);

        // Phase 1: Parse contextual message with enhanced structure (now async)
        const contextualMessage = await parseContextualMessage(messageText, activeChatId, mentionedChats);
        
        console.log('📋 CONTEXTUAL MESSAGE RESULT:', {
            contextualMessage,
            should_trigger_ai: contextualMessage?.requires_ai_response,
            is_user_to_user: contextualMessage?.is_user_to_user
        });
        
        // If message doesn't require AI response (user-to-user in group chat), still send as regular message
        if (!contextualMessage || contextualMessage.is_user_to_user) {
            console.log('🚫 SENDING USER-TO-USER MESSAGE (NO AI):', {
                messageText,
                mentionChatIds,
                isUserToUser: true,
                skipAIResponse: true
            });
            
            // Still send message to chat for user-to-user communication, but don't trigger AI
            socket.emit('submit_message', {
                roomDBId: gameState.id,
                chatId: activeChatId,
                messageText,
                mentionChatIds,
                isUserToUser: true,
                skipAIResponse: true,
                images: selectedImages.map(img => img.base64)
            });
            
            setInput('');
            setMentionedChats([]);
            setSelectedImages([]);
            
            // Keep focus in text input after sending message
            setTimeout(() => {
                if (textareaRef.current) {
                    textareaRef.current.focus();
                }
            }, 50);
            return;
        }

        // Note: Removed optimistic message creation to prevent duplicate messages for sender
        // The server will broadcast the message to all users (including sender) after insertion

        // Reset UI state
        setInput('');
        setAwaitingAI(true);
        setMentionedChats([]); // Clear mentions after sending
        setSelectedImages([]); // Clear images after sending
        
        // Keep focus in text input after sending message
        setTimeout(() => {
            if (textareaRef.current) {
                textareaRef.current.focus();
            }
        }, 50);

        console.log('🚀 SENDING AI MESSAGE:', {
            messageText,
            mentionChatIds,
            contextualMessage,
            activeChat_type: activeChat?.chat_type,
            will_trigger_ai: true
        });

        // Send enhanced contextual message to backend
        socket.emit('submit_message', { 
            roomDBId: gameState.id, 
            chatId: activeChatId, 
            messageText, 
            mentionChatIds,
            contextualMessage, // Enhanced context structure
            images: selectedImages.map(img => img.base64) // Only send base64 data
        }); 
    };
    
    // Help modal close handler
    const handleCloseHelpModal = () => {
        setShowHelpModal(false);
        if (gameState && gameState.id) {
            localStorage.setItem(`help_seen_${gameState.id}`, 'true');
        }
    };
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (isChatCapped) {
            alert('This chat has reached its limit for testing.');
            return;
        }
        e.preventDefault(); 
        submitForm(); 
    };
    
    const handleKeyDown = (e) => {
        if (showMentionPopup) {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedMentionIndex(prev => (prev + 1) % mentionSuggestions.length);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedMentionIndex(prev => (prev - 1 + mentionSuggestions.length) % mentionSuggestions.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                if (mentionSuggestions[highlightedMentionIndex]) {
                    handleMentionSelect(mentionSuggestions[highlightedMentionIndex]);
                }
            }
        } else if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitForm();
        }
    };

    const handleInputChange = (e) => {
        const value = e.target.value;
        // Enforce 2000 character limit
        if (value.length <= 2000) {
            setInput(value);
        } else {
            // If exceeding limit, keep the first 2000 characters
            setInput(value.substring(0, 2000));
            return;
        }

        const mentionMatch = value.match(/@(\w*)$/);

        if (mentionMatch && gameState?.chats) {
            const query = mentionMatch[1].toLowerCase();
            setMentionQuery(query);
            
            // Add Claude as a special AI mention option ONLY in group chats
            const aiSuggestions = [];
            if (activeChat?.chat_type === 'group' && ('claude'.includes(query) || 'ai'.includes(query) || 'assistant'.includes(query) || query === '')) {
                aiSuggestions.push({
                    id: 'claude-ai',
                    chat_name: 'Claude',
                    chat_type: 'ai',
                    isAI: true,
                });
            }
            
            const chatSuggestions = gameState.chats.filter(chat =>
                chat.id !== activeChatId &&
                (
                    (chat.chat_type === 'group' && 'group chat'.includes(query)) ||
                    (chat.owner_user_id === myUser?.id && 'your chat'.includes(query)) ||
                    (chat.chat_name.toLowerCase().includes(query))
                )
            );
            
            const allSuggestions = [...aiSuggestions, ...chatSuggestions];
            setMentionSuggestions(allSuggestions);
            setShowMentionPopup(allSuggestions.length > 0);
            setHighlightedMentionIndex(0); // Reset highlight on new suggestions
        } else {
            setShowMentionPopup(false);
        }
    };
    
    const handleMentionSelect = (chat) => {
        if (chat.isAI || chat.id === 'claude-ai') {
            // Claude mentions go to top pills only
            if (!mentionedChats.find(c => c.id === chat.id)) {
                setMentionedChats([...mentionedChats, chat]);
            }
            // Remove @mention from text
            setInput(input.replace(/@\w*$|@$/, ''));
        } else {
            // Chat mentions go ONLY inline in text (not top pills)
            const mentionText = `@${chat.chat_name || chat.name}`;
            const newInput = input.replace(/@\w*$|@$/, mentionText + ' ');
            setInput(newInput);
            
            // DO NOT add to mentionedChats - chat mentions stay inline only
            // Backend will parse inline mentions from the text itself
        }
        
        setShowMentionPopup(false);
    }
};
    
const handleMentionSelect = (chat) => {
    if (chat.isAI || chat.id === 'claude-ai') {
        // Claude mentions go to top pills only
        if (!mentionedChats.find(c => c.id === chat.id)) {
            setMentionedChats([...mentionedChats, chat]);
        }
        // Remove @mention from text
        setInput(input.replace(/@\w*$|@$/, ''));
    } else {
        // Chat mentions go ONLY inline in text (not top pills)
        const mentionText = `@${chat.chat_name || chat.name}`;
        const newInput = input.replace(/@\w*$|@$/, mentionText + ' ');
        setInput(newInput);
        
        // DO NOT add to mentionedChats - chat mentions stay inline only
        // Backend will parse inline mentions from the text itself
    }
    
    setShowMentionPopup(false);
    setMentionQuery('');
    textareaRef.current.focus();
};

const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    
    // Constants for image validation
    const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB limit
    const MAX_IMAGES = 5; // Maximum 5 images per message
    
    // Check if adding these images would exceed the limit
    if (selectedImages.length + imageFiles.length > MAX_IMAGES) {
        alert(`Maximum ${MAX_IMAGES} images allowed per message. You currently have ${selectedImages.length} images.`);
        e.target.value = '';
        return;
    }
    
    imageFiles.forEach(file => {
        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            console.error('🔴 [IMAGE_UPLOAD] File too large:', {
                fileName: file.name,
                fileSize: file.size,
                maxSize: MAX_FILE_SIZE,
                fileSizeMB: (file.size / (1024 * 1024)).toFixed(2)
            });
            alert(`Image "${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(2)}MB). Maximum size is 5MB.`);
            return;
        }
        
        console.log('🟡 [IMAGE_UPLOAD] Processing image:', {
            fileName: file.name,
            fileSize: file.size,
            fileSizeMB: (file.size / (1024 * 1024)).toFixed(2),
            fileType: file.type
        });
        
        const reader = new FileReader();
        
        reader.onload = (event) => {
            try {
                const base64 = event.target.result;
                
                // Additional validation for base64 size
                const base64Size = base64.length * 0.75; // Approximate decoded size
                if (base64Size > MAX_FILE_SIZE) {
                    console.error('🔴 [IMAGE_UPLOAD] Base64 too large:', {
                        fileName: file.name,
                        base64Size: base64Size,
                        base64SizeMB: (base64Size / (1024 * 1024)).toFixed(2)
                    });
                    alert(`Image "${file.name}" is too large after processing. Please use a smaller image.`);
                    return;
                }
                
                console.log('🟢 [IMAGE_UPLOAD] Image processed successfully:', {
                    fileName: file.name,
                    base64Length: base64.length,
                    estimatedSizeMB: (base64Size / (1024 * 1024)).toFixed(2)
                });
                
                setSelectedImages(prev => [...prev, {
                    id: Date.now() + Math.random(),
                    name: file.name,
                    base64,
                    size: file.size
                }]);
            } catch (error) {
                console.error('🔴 [IMAGE_UPLOAD] Error processing image:', {
                    fileName: file.name,
                    error: error.message,
                    stack: error.stack
                });
                alert(`Error processing image "${file.name}": ${error.message}`);
            }
        };
        
        reader.onerror = (error) => {
            console.error('🔴 [IMAGE_UPLOAD] FileReader error:', {
                fileName: file.name,
                error: error,
                readyState: reader.readyState
            });
            alert(`Error reading image "${file.name}". Please try again.`);
        };
        
        reader.readAsDataURL(file);
    });
    
    // Clear the input so the same file can be selected again
    e.target.value = '';
};

const removeImage = (imageId) => {
    setSelectedImages(prev => prev.filter(img => img.id !== imageId));
};

    // --- RENDER LOGIC ---
    // If gameState is null, we always show the "Lobby" screen.
    if (!gameState) {
        return <Lobby roomCode={urlRoomCode} onJoin={handleJoinRoom} isJoining={isJoiningLobby} />;
    }

    // Defensive: If we reach here, gameState IS populated, but derived state may not be ready due to async state updates.
    if (isRoomClosed) { /* ... (isRoomClosed JSX) ... */ }

    // --- DERIVED STATE (Calculated ONLY after gameState is guaranteed non-null) ---
    // These variables are now guaranteed to be based on a valid gameState object.
    const {
        id: roomDBId,
        users = [],
        chats = [],
        messages: allMessages = [],
        isProcessingAI = false,
        roomCode = '',
        token_limit = 250000,
        tokens_used = 0
    } = gameState;

    // Defensive: All derived state is guarded with null checks
    // FIX: Match using socket_id_current, not socket_id
    const myUser = users.find(u => u.socket_id_current === socket.id) || null;
    const isUserOnline = users.some(u => u.socket_id_current === socket.id);
    const activeChat = chats.find(c => c.id === activeChatId) || null;
    const currentChatMessages = (activeChatId && chatMessages[activeChatId]) ? chatMessages[activeChatId] : [];
    const isChatEditable = activeChat && (activeChat.chat_type === 'group' || (activeChat.owner_user_id === myUser?.id));
    const isChatCapped = currentChatMessages.length >= 100;

    // DEBUG LOGGING
    console.log('DEBUG: users', users, 'socket.id', socket.id, 'myUser', myUser, 'users[0]', users[0]);

    // Function to validate and convert URLs to clickable hyperlinks
    const renderTextWithLinks = (text) => {
        if (!text || typeof text !== 'string') return text;
        
        // Regex to match URLs (http/https) - excluding trailing punctuation
        const urlRegex = /(https?:\/\/[^\s<>"]+)/gi;
        const parts = [];
        let lastIndex = 0;
        let match;
        
        while ((match = urlRegex.exec(text)) !== null) {
            // Add text before the URL
            if (match.index > lastIndex) {
                parts.push(text.slice(lastIndex, match.index));
            }
            
            let url = match[0];
            // Remove trailing punctuation (brackets, parentheses, etc.)
            url = url.replace(/[.,!?;:()\[\]{}]+$/, '');
            
            // Validate URL format more strictly
            try {
                const urlObj = new URL(url);
                // Only allow http and https protocols
                if (urlObj.protocol === 'http:' || urlObj.protocol === 'https:') {
                    // Create a smart link component that validates on click
                    parts.push(
                        <SmartLink 
                            key={match.index}
                            url={url}
                        />
                    );
                } else {
                    // Invalid protocol, render as plain text
                    parts.push(url);
                }
            } catch (error) {
                // Invalid URL, render as plain text
                parts.push(url);
            }
            
            lastIndex = match.index + match[0].length;
        }
        
        // Add remaining text after the last URL
        if (lastIndex < text.length) {
            parts.push(text.slice(lastIndex));
        }
        
        // If no URLs found, return original text
        if (parts.length === 0) {
            return text;
        }
        
        return parts;
    };

    // Smart link component that validates URLs before navigation
    const SmartLink = ({ url }) => {
        const [linkStatus, setLinkStatus] = useState('unknown'); // 'unknown', 'valid', 'invalid', 'checking'
        
        const validateUrl = async (urlToCheck) => {
            try {
                setLinkStatus('checking');
                // Use a CORS proxy or try different validation approaches
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
                
                // Try to fetch with HEAD request
                const response = await fetch(`https://api.allorigins.win/head?url=${encodeURIComponent(urlToCheck)}`, {
                    signal: controller.signal,
                    method: 'GET'
                });
                
                clearTimeout(timeoutId);
                
                if (response.ok) {
                    const data = await response.json();
                    setLinkStatus(data.status >= 200 && data.status < 400 ? 'valid' : 'invalid');
                } else {
                    setLinkStatus('invalid');
                }
            } catch (error) {
                console.log(`[URL_VALIDATION] Could not validate ${urlToCheck}:`, error.message);
                // If validation fails, assume it might work (don't block user)
                setLinkStatus('unknown');
            }
        };
        
        const handleClick = async (e) => {
            e.preventDefault();
            
            // If we haven't checked this URL yet, validate it first
            if (linkStatus === 'unknown') {
                await validateUrl(url);
            }
            
            let warningMessage = `You are about to visit: ${url}\n\nThis link was provided by Claude AI.`;
            
            if (linkStatus === 'invalid') {
                warningMessage += '\n\n⚠️ WARNING: This link appears to be broken or inaccessible. It may not work.';
            } else if (linkStatus === 'checking') {
                warningMessage += '\n\n🔍 Validating link... Please verify it\'s safe before proceeding.';
            } else if (linkStatus === 'valid') {
                warningMessage += '\n\n✅ Link appears to be working.';
            }
            
            warningMessage += '\n\nDo you want to continue?';
            
            const confirmNavigation = window.confirm(warningMessage);
            if (confirmNavigation) {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        };
        
        const getLinkClassName = () => {
            const baseClass = 'underline break-all cursor-pointer';
            switch (linkStatus) {
                case 'valid':
                    return `${baseClass} text-green-600 hover:text-green-800`;
                case 'invalid':
                    return `${baseClass} text-red-600 hover:text-red-800`;
                case 'checking':
                    return `${baseClass} text-yellow-600 hover:text-yellow-800`;
                default:
                    return `${baseClass} text-blue-600 hover:text-blue-800`;
            }
        };
        
        const getLinkTitle = () => {
            switch (linkStatus) {
                case 'valid':
                    return 'Link validated ✅';
                case 'invalid':
                    return 'Link appears broken ⚠️';
                case 'checking':
                    return 'Validating link... 🔍';
                default:
                    return 'Click to validate and visit';
            }
        };
        
        return (
            <span
                className={getLinkClassName()}
                onClick={handleClick}
                title={getLinkTitle()}
            >
                {url}
                {linkStatus === 'checking' && ' 🔍'}
                {linkStatus === 'invalid' && ' ⚠️'}
                {linkStatus === 'valid' && ' ✅'}
            </span>
        );
    };

    // If any critical derived state is missing, render a fallback/loading UI
    if (!activeChat || !myUser) {
        return (
            <div className="bg-black h-screen flex items-center text-white">
                <div className="text-center">
                    <div className="loader mb-4" />
                    <p></p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-screen w-full bg-neutral-900 flex relative">
            {/* Left Sidebar (Chats List) */}
            <aside className="w-[260px] bg-chatgpt-sidebar p-4 flex flex-col">
                {/* Top Section: Stays at the top */}
                <div className="flex-shrink-0">
                    {/* Brand Header */}
                    <div className="px-2 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="16" cy="16" r="15" fill="#4a4a4a"/>
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="#ffffff" stroke-width="2" transform="translate(8,8) scale(0.7)"/>
                            </svg>
                            <h2 className="text-lg font-bold text-chatgpt-main">TeamChat</h2>
                            <span className="text-xs text-chatgpt-secondary bg-chatgpt-hover px-2 py-1 rounded-full">v1</span>
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Info Button */}
                            <button
                                onClick={() => setShowHelpModal(true)}
                                className="text-chatgpt-secondary hover:text-chatgpt-main transition-colors duration-200 p-1 rounded hover:bg-chatgpt-hover"
                                title="Help & Info"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10"></circle>
                                    <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                                </svg>
                            </button>
                            {/* Exit Button */}
                            <button
                                onClick={() => navigate('/')}
                                className="text-chatgpt-secondary hover:text-red-400 transition-colors duration-200 p-1 rounded hover:bg-chatgpt-hover"
                                title="Leave Room"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                                    <polyline points="16,17 21,12 16,7"></polyline>
                                    <line x1="21" y1="12" x2="9" y2="12"></line>
                                </svg>
                            </button>
                        </div>
                    </div>

        {/* Room code + copy link */}
        <div className="px-2 py-2 flex items-center justify-between text-sm text-chatgpt-secondary">
            <span>Room: {urlRoomCode}</span>
            <button
                onClick={() => navigator.clipboard.writeText(window.location.href)}
                className="text-chatgpt-accent hover:underline focus:outline-none"
            >
                Copy
            </button>
        </div>

        <div className="border-t border-chatgpt my-3" />

        {/* Chat list */}
        <ul className="space-y-1">
            {/* Group Chat Tab */}
            {chats.filter(c => c.chat_type === 'group').map(chat => (
                <li key={chat.id}
                    className={`p-3 rounded-md cursor-pointer transition-colors text-sm ${activeChatId === chat.id ? 'bg-chatgpt-active-tab' : 'hover:bg-hover-bg'}`}
                    onClick={() => setActiveChatId(chat.id)}>
                    <span className="text-white">Group Chat</span>
                </li>
            ))}
        </ul>

        <div className="border-t border-chatgpt my-3" />
        
        {/* Individual Chats Section */}
        <div className="mt-4">
            <h3 className="text-xs font-semibold text-text-secondary px-3 mb-2">Individual Chats</h3>
            <ul className="space-y-1">
                {chats.filter(c => c.chat_type === 'individual').map(chat => (
                    <li key={chat.id}
                        className={`p-3 rounded-md cursor-pointer transition-colors text-sm ${activeChatId === chat.id ? 'bg-chatgpt-active-tab' : 'hover:bg-hover-bg'}`}
                        onClick={() => setActiveChatId(chat.id)}>
                        <span className="text-white">{chat.owner_user_id === myUser?.id ? `Your Chat (${myUser?.user_name || myUser?.name || localStorage.getItem('llm_teams_username') || 'You'})` : `${chat.chat_name}`}</span>
                    </li>
                ))}
            </ul>
        </div>
    </div>

    {/* Spacer: Pushes everything below it to the bottom */}
    <div className="flex-grow" />

    {/* Bottom Section: Stays at the bottom */}
    <div className="flex-shrink-0">
    

        {/* Current User Profile */}
        <div className="border-t border-chatgpt my-3" />
        <div className="px-3 mb-4">
            <div className="flex items-center space-x-2">
                <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center">
                    <svg className="w-4 h-4 text-gray-300" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                    </svg>
                </div>
                <span className="text-sm font-medium text-text-primary">
                    {myUser?.user_name || myUser?.name || localStorage.getItem('llm_teams_username') || 'Anonymous'}
                </span>
            </div>
        </div>
        
        {/* Users List */}
        <h3 className="text-xs font-semibold text-text-secondary px-3 mb-2">Users</h3>
        <div className="px-3 space-y-2 max-h-40 overflow-y-auto">
            {users.length > 0 ? (
                users.map(user => (
                    <div key={user.id} className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                            user.is_online ? 'bg-green-400' : 'bg-gray-500'
                        }`}></div>
                        <span className={`text-sm truncate ${
                            user.is_online ? 'text-text-primary' : 'text-text-secondary'
                        }`}>
                            {user.user_name || user.name || 'Unknown'}
                            {!user.is_online && (
                                <span className="ml-1 text-xs text-gray-500">(disconnected)</span>
                            )}
                        </span>
                    </div>
                ))
            ) : (
                <div className="text-xs text-text-secondary">No users yet</div>
            )}
        </div>
    </div>
</aside>
    
            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-chatgpt-chat-area overflow-hidden">
                <main className="flex-1 overflow-y-auto px-4 pt-4 space-y-4 bg-chatgpt-chat-area" style={{borderRadius: '16px 0 0 0', boxShadow: '0 0 10px rgba(0,0,0,0.2)'}}>
                    {currentChatMessages.length === 0 && !(gameState?.isProcessingAI && gameState?.processingChatId === activeChatId) && gameState && activeChatId && (
                        <div className="text-center text-gray-300 mt-40 text-2xl font-semibold">
                            {activeChatId ? <span className="text-2xl text-gray-300 font-semibold">No messages yet. Start the conversation!</span> : <span className="text-2xl text-gray-300 font-semibold">Please select a chat from the left sidebar.</span>}
                        </div>
                    )}
{currentChatMessages.map((msg, index) => (
  <div key={msg.id || index} className={`flex ${msg.sender_user_id === myUser?.id ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-xl p-4 rounded-lg text-base shadow-sm border border-chatgpt ${msg.role === 'assistant' ? 'ai-message' : 'user-message'}`} style={{marginBottom: 8}}>
      {(activeChat?.chat_type !== 'individual' || msg.role === 'assistant') && (
        <p className="font-semibold mb-1 text-sm text-chatgpt-secondary">
          {msg.role === 'assistant' ? 'Claude' : ((() => { const u = users.find(u => u.id === msg.sender_user_id); if(!u) return 'Unknown'; return u.id === myUser?.id ? 'You' : (u.user_name || u.name); })())}
          {msg.role === 'prompt' && ' (Final Prompt)'}
        </p>
      )}
      <div className="whitespace-pre-wrap font-inter break-words overflow-wrap break-word" style={{background: 'none', fontSize: 16, maxWidth: '100%', wordBreak: 'break-word'}}>{renderTextWithLinks(msg.text)}</div>
    </div>
  </div>
))}
                    <div ref={messagesEndRef} />
                    {(gameState?.isProcessingAI && gameState?.processingChatId === activeChatId) && (
                        <div className="flex justify-start animate-pulse">
                            <div className="max-w-xl p-4 rounded-lg text-base shadow-sm border border-chatgpt ai-message opacity-80">
                                <p className="font-semibold mb-1 text-sm text-chatgpt-secondary">Claude is thinking…</p>
                            </div>
                        </div>
                    )}
                </main>
    
                <footer className="px-4 pb-4 bg-chatgpt-chat-area">
    <div className="w-full max-w-3xl mx-auto pointer-events-auto relative"> 
                    {showMentionPopup && (
                        <div className="absolute bottom-full mb-2 w-auto bg-chatgpt-sidebar border border-chatgpt rounded-lg shadow-lg z-10">
                            <ul className="p-1 max-h-48 overflow-y-auto">
                                {mentionSuggestions.map((chat, index) => {
                                    const isHighlighted = index === highlightedMentionIndex;
                                    
                                    // Special styling for Claude AI
                                    if (chat.isAI) {
                                        return (
                                            <li
                                                key={chat.id}
                                                onClick={() => handleMentionSelect(chat)}
                                                className={`p-3 rounded-md cursor-pointer text-sm whitespace-nowrap flex items-center gap-2 ${
                                                    isHighlighted 
                                                        ? 'bg-orange-500 text-white' 
                                                        : 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                                                } border border-orange-300`}
                                            >
                                                <span className="text-orange-600">🤖</span>
                                                <span className="font-medium">{chat.chat_name}</span>
                                                <span className="text-xs opacity-75">AI Assistant</span>
                                            </li>
                                        );
                                    }
                                    
                                    // Regular chat styling
                                    const chatName = chat.chat_type === 'group'
                                        ? 'Group Chat'
                                        : (chat.owner_user_id === myUser?.id ? 'Your Chat' : chat.chat_name);
                                    
                                    return (
                                        <li
                                            key={chat.id}
                                            onClick={() => handleMentionSelect(chat)}
                                            className={`p-3 rounded-md cursor-pointer text-white text-sm whitespace-nowrap ${isHighlighted ? 'bg-chatgpt-active-tab' : 'hover:bg-hover-bg'}`}
                                        >
                                            {chatName}
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    )}
        <form onSubmit={handleSubmit} className="flex flex-col rounded-xl border border-chatgpt bg-input-bg overflow-hidden">
            {selectedImages.length > 0 && (
                <div className="px-4 pt-2 flex flex-wrap gap-2">
                    {selectedImages.map(image => (
                        <div key={image.id} className="relative inline-block">
                            <img 
                                src={image.base64} 
                                alt={image.name}
                                className="w-16 h-16 object-cover rounded-lg border border-gray-600"
                            />
                            <button 
                                type="button"
                                onClick={() => removeImage(image.id)}
                                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {mentionedChats.length > 0 && (
                <div className="px-4 pt-2 flex flex-wrap gap-2">
                    {mentionedChats.map(chat => (
                        <span key={chat.id} className="inline-flex items-center px-2 py-1 bg-blue-600 text-white text-xs font-medium rounded-full">
                            @{chat.chat_type === 'group' ? 'Group' : chat.chat_name}
                            <button 
                                type="button"
                                onClick={() => setMentionedChats(mentionedChats.filter(c => c.id !== chat.id))}
                                className="ml-1.5 text-white hover:text-gray-200"
                            >
                                &times;
                            </button>
                        </span>
                    ))}
                </div>
            )}
            
            {/* View-only indicator */}
            {!isChatEditable && activeChat && activeChat.chat_type === 'individual' && (
                <div className="bg-yellow-900/20 border border-yellow-600/30 rounded-lg p-3 mb-3 mx-4">
                    <div className="flex items-center space-x-2">
                        <svg className="w-4 h-4 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                        </svg>
                        <span className="text-sm text-yellow-400 font-medium">View Only</span>
                    </div>
                    <p className="text-xs text-yellow-300/80 mt-1">You can view this chat but cannot send messages</p>
                </div>
            )}
            
            {/* Rich Text Editor with Inline Pills */}
            <div className="relative">
                <RichTextEditor
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder={(gameState?.isProcessingAI && gameState?.processingChatId === activeChatId) ? "AI is processing your request..." : "Ask anything..."}
                    className={`w-full border-none p-4 text-chatgpt-main focus:outline-none focus:ring-0 resize-none h-24 text-base ${
                        !isChatEditable && activeChat?.chat_type === 'individual' ? 
                        'bg-gray-800/50 cursor-not-allowed opacity-60' : 
                        'bg-transparent'
                    }`}
                    disabled={(gameState?.isProcessingAI && gameState?.processingChatId === activeChatId) || awaitingAI || !isUserOnline || !isChatEditable || isChatCapped}
                    mentionedChats={mentionedChats}
                    onMentionedChatsChange={setMentionedChats}
                    showMentionPopup={showMentionPopup}
                    mentionSuggestions={mentionSuggestions}
                    onMentionSelect={handleMentionSelect}
                    style={{lineHeight: '1.5em'}}
                />
                <div className={`absolute right-3 bottom-1 text-xs ${input.length >= 1800 ? (input.length >= 1950 ? 'text-red-500 font-semibold' : 'text-yellow-400') : 'text-gray-400'}`}>
                    {input.length}/2000
                </div>
            </div>
            <div className="flex justify-between items-center px-3 py-2 border-t border-chatgpt">
                <p className="text-xs text-gray-400">
                    {activeChat?.chat_type === 'group' ? 
                        "Use @ to ask the AI and to reference other chats" : 
                        "Enter @ to refer to different chat."
                    }
                </p>
                <div className="flex items-center gap-2">
                    <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleImageUpload}
                        className="hidden"
                        id="image-upload"
                    />
                    <label
                        htmlFor="image-upload"
                        className="bg-white w-10 h-10 flex items-center justify-center rounded-full cursor-pointer transition-colors duration-200 hover:bg-gray-100"
                        title="Upload images"
                    >
                        <span className="text-black text-xl font-bold">+</span>
                    </label>
                    <button 
                    type="submit" 
                    className={`bg-white w-10 h-10 flex items-center justify-center rounded-full font-bold transition-colors duration-200 ${
                        isChatCapped 
                        ? 'bg-gray-700 cursor-not-allowed text-red-500' 
                        : 'text-black'
                    }`}
                    disabled={(gameState?.isProcessingAI && gameState?.processingChatId === activeChatId) || awaitingAI || !input.trim() || !isUserOnline || !isChatEditable || isChatCapped}
                >
                    {(gameState?.isProcessingAI && gameState?.processingChatId === activeChatId) ? '...' : '↑'}
                </button>
                </div>
            </div>
        </form>
    </div>
</footer>
            </div>
            
            {/* Help Modal - renders on top of everything */}
            <HelpModal 
                isOpen={showHelpModal} 
                onClose={handleCloseHelpModal} 
            />
        </div>
    );
}

export default RoomPage;