const dotenv = require('dotenv');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient: createKVClient } = require('@vercel/kv');
const { createClient: createSupabaseClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { validateInput, validateObject, CHARACTER_LIMITS } = require('./utils/security');

if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const kv = createKVClient({ url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN });
const supabase = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Global AI processing state tracker
const aiProcessingState = new Map(); // roomId -> { isProcessing: boolean, chatId: string }

const app = express();
const CUMULATIVE_TOKEN_LIMIT = 50000; // "Extra nice" token limit for the entire chat history
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      process.env.CLIENT_URL
    ].filter(Boolean),
    credentials: true
  }
});

// --- Helper Functions ---
const estimateTokens = (text) => text ? Math.ceil(text.length / 4) : 0;

// Web search function using Google Custom Search JSON API
const performWebSearch = async (query, maxResults = 5) => {
    try {
        const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
        const searchEngineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
        
        if (!apiKey || !searchEngineId) {
            console.error('[WEB_SEARCH_ERROR] Missing Google Search API key or Search Engine ID');
            return {
                success: false,
                error: 'Web search is not configured. Please set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID environment variables.'
            };
        }
        
        const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}&num=${maxResults}`;
        
        console.log(`[WEB_SEARCH] Searching for: "${query}"`);
        
        const response = await fetch(searchUrl);
        const data = await response.json();
        
        if (!response.ok) {
            // Handle quota exhaustion specifically
            if (response.status === 429 || (data.error && data.error.code === 429)) {
                console.error('[WEB_SEARCH_QUOTA_EXHAUSTED] Daily quota of 100 searches reached. Additional queries cost $5 per 1,000 queries.');
                return {
                    success: false,
                    error: 'Daily web search quota exhausted (100 free searches per day). Please try again tomorrow or enable billing for additional searches.'
                };
            }
            
            // Handle other API errors
            if (data.error) {
                console.error('[WEB_SEARCH_API_ERROR]', data.error.message);
                return {
                    success: false,
                    error: `Web search API error: ${data.error.message}`
                };
            }
            
            console.error('[WEB_SEARCH_HTTP_ERROR]', response.status, response.statusText);
            return {
                success: false,
                error: `Web search failed: ${response.status} ${response.statusText}`
            };
        }
        
        if (!data.items || data.items.length === 0) {
            console.log('[WEB_SEARCH_NO_RESULTS] No results found for query:', query);
            return {
                success: true,
                results: [],
                message: 'No search results found for this query.'
            };
        }
        
        const results = data.items.map(item => ({
            title: item.title,
            link: item.link,
            snippet: item.snippet,
            displayLink: item.displayLink
        }));
        
        console.log(`[WEB_SEARCH_SUCCESS] Found ${results.length} results for: "${query}"`);
        
        return {
            success: true,
            results: results,
            query: query,
            totalResults: data.searchInformation?.totalResults || 'Unknown'
        };
        
    } catch (error) {
        console.error('[WEB_SEARCH_ERROR]', error.message);
        return {
            success: false,
            error: `Web search failed: ${error.message}`
        };
    }
};

const getRoomStateFromDB = async (roomDBId) => {
    // Fetch room, users, chats for the given roomDBId
    const { data: room, error: roomError } = await supabase.from('rooms').select('*').eq('id', roomDBId).single();
    if (roomError) throw roomError;
    const { data: users, error: usersError } = await supabase.from('users_in_room').select('*').eq('room_id', roomDBId);
    if (usersError) throw usersError;
    const { data: chats, error: chatsError } = await supabase.from('chats').select('*').eq('room_id', roomDBId);
    if (chatsError) throw chatsError;
    // --- Fetch messages by chat_id, not room_id ---
    const chatIdsInRoom = chats.map(c => c.id);
    let { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .in('chat_id', chatIdsInRoom)
        .order('timestamp', { ascending: true });
    if (messagesError) console.error(`Messages error: ${messagesError.message}`);
    // Token usage (sum of all message tokens)
    const tokens_used = (messages || []).reduce((sum, m) => sum + (m.tokens_used || estimateTokens(m.text)), 0);
    const token_limit = 250000; // Hardcoded for now
    return {
        id: room.id,
        roomCode: room.room_code,
        users,
        chats,
        messages: messages || [],
        isProcessingAI: aiProcessingState.get(roomDBId)?.isProcessing || false, // Check actual AI processing state
        processingChatId: aiProcessingState.get(roomDBId)?.chatId || null, // Which chat is processing AI
        token_limit,
        tokens_used,
    };
};

const broadcastGameState = async (roomDBId) => {
    try {
        const roomState = await getRoomStateFromDB(roomDBId);
        console.log(`[BROADCAST_DEBUG] Room ${roomDBId} AI state:`, {
            isProcessingAI: roomState.isProcessingAI,
            processingChatId: roomState.processingChatId,
            aiProcessingState: aiProcessingState.get(roomDBId)
        });
        io.to(roomDBId).emit('update_game_state', roomState);
        console.log(`[BROADCAST] Sent state to room ${roomDBId}`);
    } catch (error) {
        console.error(`[BROADCAST_ERROR] Failed for room ${roomDBId}:`, error);
    }
};

const triggerAIResponse = async (roomDBId, chatId, userMessageText, mentionChatIds = [], images = []) => {
    try {
        const { data: chat, error: chatError } = await supabase.from('chats').select('summary, message_count').eq('id', chatId).single();
        if (chatError) throw chatError;

        if (chat.message_count === 51 && !chat.summary) {
            console.log(`[SUMMARIZE_TRIGGER] Chat ${chatId} reached 51 messages. Starting summarization.`);
            summarizeChatHistory(chatId); // Fire and forget
        }

        let mentionedHistory = [];
        // Process inline chat references in message text for contextual injection
        let processedMessageText = userMessageText;
        const inlineReferences = [];
        
        // Find inline @chatname references in the message text
        // Updated regex: capture up to and including the "Chat" suffix, then stop (word boundary)
        const inlineReferencePattern = /@([\w\s'"\-_.]+?(?:'s\s+[Cc]hat|\s+[Cc]hat))\b/gi;
        let match;
        
        console.log(`[REGEX_DEBUG] === REGEX DEBUGGING START ===`);
        console.log(`[REGEX_DEBUG] Original message: "${userMessageText}"`);
        console.log(`[REGEX_DEBUG] Regex pattern: ${inlineReferencePattern}`);
        
        while ((match = inlineReferencePattern.exec(userMessageText)) !== null) {
            console.log(`[REGEX_DEBUG] Raw match found:`, match);
            console.log(`[REGEX_DEBUG] match[0]: "${match[0]}"`);
            console.log(`[REGEX_DEBUG] match[1]: "${match[1]}"`);
            const referencedChatName = match[1].trim();
            console.log(`[REGEX_DEBUG] After trim: "${referencedChatName}"`);
            console.log(`[INLINE_REFERENCE] Found inline reference to: "${referencedChatName}"`);
            
            // DEBUG: Show chats only from the current room to avoid cross-room mismatches
            console.log(`[INLINE_REFERENCE] Using roomDBId for lookup: ${roomDBId}`);
            const { data: allChatsDebug, error: queryError } = await supabase
                .from('chats')
                .select('id, chat_name, room_id')
                .eq('room_id', roomDBId);
            console.log(`[INLINE_REFERENCE] Raw query result:`, allChatsDebug);
            console.log(`[INLINE_REFERENCE] Query error:`, queryError);
            
            // Try a simpler query to test database connection
            const { data: allChatsSimple, error: simpleError } = await supabase
                .from('chats')
                .select('chat_name')
                .eq('room_id', roomDBId);
            console.log(`[INLINE_REFERENCE] Simple query result:`, allChatsSimple);
            console.log(`[INLINE_REFERENCE] Simple query error:`, simpleError);
            
            // Try querying all chats to see if any exist
            const { data: allChatsEverywhere, error: everywhereError } = await supabase
                .from('chats')
                .select('chat_name, room_id')
                .limit(10);
            console.log(`[INLINE_REFERENCE] All chats (everywhere):`, allChatsEverywhere);
            console.log(`[INLINE_REFERENCE] All chats error:`, everywhereError);
            
            console.log(`[INLINE_REFERENCE] === CHAT MATCHING DEBUG ===`);
            console.log(`[INLINE_REFERENCE] Looking for chat: "${referencedChatName}"`);
            console.log(`[INLINE_REFERENCE] Available chats:`);
            for (const chat of allChatsDebug || []) {
                console.log(`[INLINE_REFERENCE]   - "${chat.chat_name}" (ID: ${chat.id})`);
            }
            
            // Try exact match first
            let referencedChat = allChatsDebug?.find(chat => 
                chat.chat_name.toLowerCase() === referencedChatName.toLowerCase()
            );
            
            // Try partial match if exact fails
            if (!referencedChat) {
                referencedChat = allChatsDebug?.find(chat => 
                    chat.chat_name.toLowerCase().includes(referencedChatName.toLowerCase()) ||
                    referencedChatName.toLowerCase().includes(chat.chat_name.toLowerCase())
                );
            }
            
            console.log(`[INLINE_REFERENCE] Chat match result:`, referencedChat);
            const error = !referencedChat;
            
            if (error) {
                console.log(`[INLINE_REFERENCE] No chat found matching "${referencedChatName}"`);
                console.log(`[INLINE_REFERENCE] Available chats:`, allChatsDebug?.map(c => c.chat_name) || []);
            }
            
            if (referencedChat) {
                inlineReferences.push({
                    originalText: match[0],
                    chatId: referencedChat.id,
                    chatName: referencedChat.chat_name,
                    position: match.index
                });
            }
        }
        
        // Helper function to analyze inline reference context needs
        const analyzeInlineReferenceContext = async (fullMessage, referencePart, chatName) => {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
                
                const prompt = `
Analyze what context is needed from the referenced chat for this inline reference.

Full user message: "${fullMessage}"
Inline reference: "${referencePart}"
Referenced chat name: "${chatName}"

Determine:
1. What specific information does the user need from this chat?
2. What keywords/topics should we search for?
3. Is this reference specific enough to warrant context injection?

Examples:
- "Based on what we discussed in @johns chat about API" → Search: "API, endpoints, documentation" → Include: YES
- "Like @sarah chat mentioned" → Too vague → Include: NO
- "Following up on @team chat's decision about deployment" → Search: "deployment, decision, infrastructure" → Include: YES

Respond in JSON format:
{
  "shouldInclude": true/false,
  "searchTerms": ["term1", "term2", "term3"],
  "reasoning": "brief explanation"
}`;
                
                const result = await model.generateContent(prompt);
                let responseText = result.response.text().trim();
                
                // Strip markdown code fences if present
                if (responseText.startsWith('```json')) {
                    responseText = responseText.replace(/^```json\n?/, '').replace(/\n?```$/, '');
                } else if (responseText.startsWith('```')) {
                    responseText = responseText.replace(/^```\n?/, '').replace(/\n?```$/, '');
                }
                
                const analysis = JSON.parse(responseText);
                
                console.log(`[INLINE_CONTEXT] Analysis for "${referencePart}": ${JSON.stringify(analysis)}`);
                return analysis;
                
            } catch (error) {
                console.error('[INLINE_CONTEXT] Error:', error.message);
                return { shouldInclude: false, searchTerms: [], reasoning: "Analysis failed" };
            }
        };

        // Helper function to get relevant context from a referenced chat
        const getRelevantChatContext = async (chatId, searchTerms, chatName) => {
            try {
                // Get all messages from the referenced chat
                const { data: allMessages, error } = await supabase
                    .from('messages')
                    .select('text, role')
                    .eq('chat_id', chatId);
                
                if (error || !allMessages?.length) {
                    console.log(`[RELEVANT_CONTEXT] No messages found for chat ${chatName}`);
                    return null;
                }
                
                // Use Gemini to find the most relevant messages based on search terms
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
                
                const messages = allMessages.map((msg, index) => {
                    return `[Message #${index + 1}] ${msg.role}: ${msg.text}`;
                }).join('\n');
                
                const prompt = `
Analyze these chat messages and extract the 3-5 most relevant exchanges based on the search terms.

Search terms: ${searchTerms.join(', ')}

Chat messages:\n${messages}

Extract the most relevant message exchanges that relate to the search terms. Focus on:
1. Direct mentions of the search terms
2. Related discussions or decisions
3. Context that would help answer questions about these topics

Return ONLY the relevant message exchanges, maintaining their original format and chronological order.`;
                
                const result = await model.generateContent(prompt);
                const relevantMessages = result.response.text().trim();
                
                console.log(`[RELEVANT_CONTEXT] Found relevant context for ${chatName} with ${searchTerms.length} search terms`);
                return relevantMessages;
                
            } catch (error) {
                console.error(`[RELEVANT_CONTEXT] Error getting context for ${chatName}:`, error.message);
                return null;
            }
        };

        // Process inline references and inject context
        if (inlineReferences.length > 0) {
            console.log(`[INLINE_REFERENCE] Processing ${inlineReferences.length} inline references`);
            
            // Process references in reverse order to maintain string positions
            for (const ref of inlineReferences.reverse()) {
                try {
                    console.log(`[INLINE_REFERENCE] Processing reference to "${ref.chatName}"`);
                    
                    // Get messages from the referenced chat
                    const { data: refMessages, error: refError } = await supabase
                        .from('messages')
                        .select('text, role')
                        .eq('chat_id', ref.chatId);
                    
                    if (refError) {
                        console.error(`[INLINE_REFERENCE] Error fetching messages for ${ref.chatName}:`, refError);
                        continue;
                    }
                    
                    if (!refMessages || refMessages.length === 0) {
                        console.log(`[INLINE_REFERENCE] No messages found in ${ref.chatName}`);
                        processedMessageText = processedMessageText.replace(ref.originalText, `(no messages in ${ref.chatName})`);
                        continue;
                    }
                    
                    console.log(`[INLINE_REFERENCE] Found ${refMessages.length} messages in ${ref.chatName}`);
                    
                    // Get relevant context using AI - use broad search terms to capture any content
                    const relevantContext = await getRelevantChatContext(ref.chatId, ['all', 'messages', 'conversation', 'discussion', 'topic', 'mentioned', 'talked', 'said'], ref.chatName);
                    
                    // If AI context extraction fails, fall back to including all messages
                    let contextToUse = relevantContext;
                    if (!relevantContext || relevantContext.trim().length < 50) {
                        console.log(`[INLINE_REFERENCE] AI context extraction minimal, including all messages from ${ref.chatName}`);
                        contextToUse = refMessages.map((msg, idx) => `${msg.role}: ${msg.text}`).join('\n');
                    }
                    
                    if (contextToUse && contextToUse.trim()) {
                        const contextBlock = `\n\n**IMPORTANT: You have been provided with conversation history from "${ref.chatName}":**\n\n${contextToUse}\n\n**End of conversation history from "${ref.chatName}". Please reference this context in your response.**\n\n`;
                        processedMessageText = processedMessageText.replace(ref.originalText, contextBlock);
                        console.log(`[INLINE_REFERENCE] Injected context from ${ref.chatName}`);
                    } else {
                        console.log(`[INLINE_REFERENCE] No relevant context found for ${ref.chatName}`);
                        processedMessageText = processedMessageText.replace(ref.originalText, `(no relevant discussion found in ${ref.chatName})`);
                    }
                    
                } catch (error) {
                    console.error(`[INLINE_REFERENCE] Error processing reference to "${ref.chatName}":`, error.message);
                }
            }
        }

        // Smart cross-chat referencing with intent analysis (for pill-based mentions)
        if (mentionChatIds && mentionChatIds.length > 0) {
            await Promise.all(mentionChatIds.map(async (chatId) => {
                try {
                    // Get chat name for proper labeling
                    const { data: chatInfo } = await supabase
                        .from('chats')
                        .select('chat_name')
                        .eq('id', chatId)
                        .single();
                    
                    const chatDisplayName = chatInfo?.chat_name || `Chat ${chatId.slice(0, 8)}`;
                    
                    // Analyze what user wants from this referenced chat
                    const intentAnalysis = await analyzeReferenceIntent(userMessageText, chatDisplayName);
                    
                    if (intentAnalysis.shouldInclude) {
                        // Get relevant context only
                        const relevantContext = await getRelevantChatContext(chatId, intentAnalysis.searchTerms, chatDisplayName);
                        
                        if (relevantContext && relevantContext.length > 0) {
                            mentionedHistory.push({
                                role: 'user',
                                content: `REFERENCE FROM CHAT "${chatDisplayName.toUpperCase()}": Based on your request, here's the relevant context from this chat:\n\n${relevantContext}\n\n[End of reference from "${chatDisplayName}"]"`
                            });
                            console.log(`[SMART_REFERENCE] Added relevant context from chat: ${chatDisplayName}`);
                        }
                    } else {
                        console.log(`[SMART_REFERENCE] No relevant context found for chat: ${chatDisplayName}`);
                    }
                    
                } catch (error) {
                    console.error(`[SMART_REFERENCE] Error processing chat ${chatId}:`, error.message);
                }
            }));
        }

        const historyLimit = 50;
        const { data: recentMessages, error: historyError } = await supabase
            .from('messages')
            .select('text, role')
            .eq('chat_id', chatId)
            .order('timestamp', { ascending: false })
            .limit(historyLimit);
        if (historyError) throw historyError;

        // Build chronologically ordered message history
        const currentChatHistory = recentMessages.map((msg, index) => {
            return {
                role: msg.role,
                content: `[Message #${index + 1}] ${msg.text}`
            };
        }); // Keep original chronological order (oldest to newest)
        
        let contextMessages = [];
        if (chat.summary) {
            contextMessages.push({ 
                role: 'user', 
                content: `Here is a summary of our current conversation. Use it for context, but do not mention it unless asked:\n\n${chat.summary}` 
            });
        }

        // Use the enhanced message text with inline context injection
        let userMessageContent = [{ type: 'text', text: processedMessageText }];
        
        // Add images if provided (only for current message, not with @mentions)
        if (images && images.length > 0 && mentionChatIds.length === 0) {
            images.forEach(imageBase64 => {
                // Extract base64 data (remove data:image/...;base64, prefix)
                const base64Data = imageBase64.split(',')[1];
                const mimeType = imageBase64.split(',')[0].split(':')[1].split(';')[0];
                
                userMessageContent.push({
                    type: 'image',
                    source: {
                        type: 'base64',
                        media_type: mimeType,
                        data: base64Data
                    }
                });
            });
        }
        
        const userMessage = { role: 'user', content: userMessageContent };
        const baseMessages = [...mentionedHistory, ...contextMessages, ...currentChatHistory, userMessage].filter(m => m.content && (typeof m.content === 'string' ? m.content.trim() : true));

        // Check if user explicitly requests links - if so, force web search
        const requestsLinks = /\b(link|links|url|urls|website|websites|source|sources)\b/i.test(userMessageText);
        
        let searchDecision;
        let decisionText;
        
        if (requestsLinks) {
            // Force web search when links are explicitly requested
            console.log('[LINK_REQUEST_DETECTED] User requested links - forcing web search');
            decisionText = `SEARCH_NEEDED: ${userMessageText.replace(/\b(give me|provide|show|find)\b/gi, '').trim()}`;
        } else {
            // Check if message contains inline chat references - if so, skip web search
            const hasInlineChatMentions = /@[\w\s]+/g.test(userMessageText);
            
            if (hasInlineChatMentions) {
                console.log('[WEB_SEARCH_SKIP] Message contains inline chat mentions - skipping web search');
                searchDecision = null; // Skip web search entirely
            } else {
                // First, ask Claude if a web search would be helpful for this query
                const searchDecisionMessages = [
                    {
                        role: 'user',
                        content: `Please analyze this user message and determine if a web search would be helpful to provide a more accurate, up-to-date, or comprehensive response. Consider if the query involves:
- Current events, news, or recent information
- Factual information that might have changed recently
- Specific data, statistics, or references
- Technical information that might benefit from current sources

IMPORTANT: If the user asks for links, sources, or URLs, you MUST respond with SEARCH_NEEDED. NEVER fabricate or guess links.

User message: "${userMessageText}"

Respond with ONLY one of these options:
- SEARCH_NEEDED: [brief search query]
- NO_SEARCH_NEEDED

Example responses:
- SEARCH_NEEDED: latest AI developments 2024
- NO_SEARCH_NEEDED`
                }
                ];

                console.log('[WEB_SEARCH_DECISION] Asking Claude if web search is needed...');
                searchDecision = await anthropic.messages.create({
                    model: 'claude-3-haiku-20240307',
                    max_tokens: 1024,
                    messages: searchDecisionMessages,
                });
                
                decisionText = searchDecision.content[0].text.trim();
            }
        }

        // Handle the decision text
        if (searchDecision) {
            console.log('[WEB_SEARCH_DECISION] Claude response:', decisionText);
        } else {
            console.log('[WEB_SEARCH_DECISION] Skipped due to inline chat mentions');
            decisionText = 'NO_SEARCH_NEEDED';
        }
        
        let finalMessages = baseMessages;
        let searchResults = null;
        
        // Check if Claude wants to perform a web search
        if (decisionText.startsWith('SEARCH_NEEDED:')) {
            const searchQuery = decisionText.replace('SEARCH_NEEDED:', '').trim();
            console.log('[WEB_SEARCH_TRIGGER] Performing web search for:', searchQuery);
            
            searchResults = await performWebSearch(searchQuery, 5);
            
            if (searchResults.success && searchResults.results && searchResults.results.length > 0) {
                // Format search results for Claude
                const searchContext = {
                    role: 'user',
                    content: `Here are current web search results for "${searchQuery}":\n\n${searchResults.results.map((result, index) => 
                        `${index + 1}. **${result.title}**\n   Link: ${result.link}\n   ${result.snippet}\n`
                    ).join('\n')}\n\nPlease use this information to enhance your response. Include relevant links in your answer when appropriate.`
                };
                
                finalMessages = [...baseMessages, searchContext];
                console.log('[WEB_SEARCH_CONTEXT] Added search results to Claude context');
            } else if (!searchResults.success) {
                // If search failed, inform Claude about the error
                const searchErrorContext = {
                    role: 'user',
                    content: `Note: I attempted to search the web for additional information but encountered an error: ${searchResults.error}. Please proceed with the information available in our conversation.`
                };
                
                finalMessages = [...baseMessages, searchErrorContext];
                console.log('[WEB_SEARCH_ERROR] Informed Claude about search failure:', searchResults.error);
            }
        } else {
            console.log('[WEB_SEARCH_SKIP] Claude determined no web search is needed');
        }

        // Function moved above for proper hoisting - duplicate removed

        // Smart cross-chat reference analysis using Gemini
        const analyzeReferenceIntent = async (userMessage, chatName) => {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
                
                const prompt = `
Analyze what information the user wants from the referenced chat.

User's message: "${userMessage}"
Referenced chat name: "${chatName}"

Determine:
1. What topics/keywords should we search for in the referenced chat?
2. Is the reference specific enough to include context?

Examples:
- "@Claude based on what we discussed about dogs" → Search for: "dogs, dog breeds, pets" → Include: YES
- "@Claude tell me about machine learning" → No specific reference → Include: NO
- "@Claude like we said about the python code" → Search for: "python, code, programming" → Include: YES

Respond in JSON format:
{
  "shouldInclude": true/false,
  "searchTerms": ["term1", "term2", "term3"],
  "reasoning": "brief explanation"
}`;
                
                const result = await model.generateContent(prompt);
                const analysis = JSON.parse(result.response.text().trim());
                
                console.log(`[REFERENCE_INTENT] Analysis for "${userMessage}": ${JSON.stringify(analysis)}`);
                return analysis;
                
            } catch (error) {
                console.error('[REFERENCE_INTENT] Error:', error.message);
                return { shouldInclude: false, searchTerms: [], reasoning: "Analysis failed" };
            }
        };
        
        // Function moved above for proper hoisting - duplicate removed

        // Smart intent classification using Gemini 2.5 Pro
        const classifyMessageIntent = async (message) => {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" }); // Using latest Gemini model
                
                const prompt = `Classify this user message intent. Respond with ONLY one word:

ACKNOWLEDGMENT - if user is thanking, saying got it, perfect, etc.
GREETING - if user is saying hi, how are you, what's up, etc.
REQUEST - if user is asking for information, help, or action
OTHER - for anything else

Message: "${message}"

Classification:`;
                
                const result = await model.generateContent(prompt);
                const intent = result.response.text().trim().toUpperCase();
                console.log(`[INTENT_CLASSIFICATION] Message: "${message}" -> Intent: ${intent}`);
                return intent;
            } catch (error) {
                console.error('[INTENT_CLASSIFICATION_ERROR]', error.message);
                return 'OTHER'; // Fallback to OTHER if classification fails
            }
        };

        // Smart topic transition detection using Gemini
        const detectTopicTransition = async (newMessage, recentMessages) => {
            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
                
                // Get last few messages to understand previous topic
                const lastMessages = recentMessages.slice(-6).map(msg => {
                    const role = msg.role === 'assistant' ? 'AI' : 'User';
                    return `${role}: ${msg.content}`;
                }).join('\n');
                
                const prompt = `
Analyze if the user is changing to a completely different topic.

Recent conversation:
${lastMessages}

New user message: "${newMessage}"

EXAMPLES:
- If recent conversation was about "dogs" and new message asks about "machine learning" = TOPIC_CHANGE
- If recent conversation was about "cooking" and new message asks about "programming" = TOPIC_CHANGE  
- If recent conversation was about "dogs" and new message asks "tell me more about breeds" = SAME_TOPIC
- If recent conversation was about "machine learning" and new message asks "what about deep learning" = SAME_TOPIC

RULES:
- Look for clear subject changes (animals → technology, sports → food, etc.)
- "Tell me about [NEW_SUBJECT]" where NEW_SUBJECT is unrelated to recent conversation = TOPIC_CHANGE
- Questions with "now", "instead", "what about" often indicate topic shifts
- Ignore transitional words, focus on the core subject matter

Respond with ONLY: TOPIC_CHANGE or SAME_TOPIC`;
                
                const result = await model.generateContent(prompt);
                const topicAnalysis = result.response.text().trim();
                
                console.log(`[TOPIC_DETECTION] Analysis: ${topicAnalysis} for message: "${newMessage}"`);
                return topicAnalysis === 'TOPIC_CHANGE';
                
            } catch (error) {
                console.error('[TOPIC_DETECTION] Error:', error.message);
                return false; // Default to keeping context if detection fails
            }
        };

        // Smart redundancy prevention - analyze conversation history
        const analyzeForRedundancy = async (messages, currentUserMessage) => {
            // Use Gemini to classify message intent
            const intent = await classifyMessageIntent(currentUserMessage);
            
            if (intent === 'ACKNOWLEDGMENT') {
                console.log('[REDUNDANCY_CHECK] Gemini detected acknowledgment - preventing detailed response');
                return { 
                    shouldSkipAI: true, 
                    simpleResponse: "You're welcome! Happy to help!" 
                };
            }
            
            if (intent === 'GREETING') {
                console.log('[REDUNDANCY_CHECK] Gemini detected greeting - preventing topic repetition');
                return { 
                    shouldSkipAI: true, 
                    simpleResponse: "I'm doing well, thanks for asking! How can I help you today?" 
                };
            }
            
            // Smart semantic redundancy analysis using Gemini
            const recentAIMessages = messages
                .filter(msg => msg.role === 'assistant')
                .slice(-2) // Check last 2 AI responses
                .map(msg => msg.content || '');
            
            // Skip redundancy check for cross-chat references (inline mentions)
            const hasInlineChatMentions = /@[\w\s'"\-_.]+/g.test(userMessageText);
            
            // Only check for redundancy if there are recent AI responses AND no inline chat mentions
            if (recentAIMessages.length > 0 && !hasInlineChatMentions) {
                try {
                    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });
                    
                    const redundancyPrompt = `
Analyze if the user is asking for the same information they already received.

Recent AI responses:
${recentAIMessages.map((msg, i) => `Response ${i+1}: ${msg.substring(0, 500)}...`).join('\n\n')}

User's new request: "${currentUserMessage}"

Rules:
- If user is asking for the SAME thing they already got (e.g., "give me ML courses" after already receiving ML courses), respond with "REDUNDANT"
- If user is asking for something DIFFERENT even if topic is similar (e.g., "link dogs and ML" vs "give me ML courses"), respond with "NOT_REDUNDANT"  
- If user is asking for MORE, ADDITIONAL, or DIFFERENT examples/info on same topic, respond with "NOT_REDUNDANT"
- Focus on the INTENT and PURPOSE of the request, not just keywords

Respond with only: REDUNDANT or NOT_REDUNDANT`;
                    
                    const result = await model.generateContent(redundancyPrompt);
                    const redundancyAnalysis = result.response.text().trim();
                    
                    console.log(`[SMART_REDUNDANCY] Analysis: ${redundancyAnalysis} for message: "${currentUserMessage}"`);
                    
                    if (redundancyAnalysis === 'REDUNDANT') {
                        console.log('[SMART_REDUNDANCY] Gemini detected actual redundancy - preventing repetition');
                        return { 
                            shouldSkipAI: true, 
                            simpleResponse: "I recently provided that information above. Would you like me to suggest something different, or are you looking for something more specific?"
                        };
                    }
                    
                } catch (error) {
                    console.error('[SMART_REDUNDANCY] Error:', error.message);
                    // Fall through to not block if analysis fails
                }
            }
            
            return { shouldSkipAI: false };
        };
        
        // Add memory-awareness system prompt at the beginning
        const memoryAwarenessPrompt = {
            role: 'user',
            content: `SYSTEM CONTEXT: You are a conversation assistant that may be provided with conversation history/memories from other chats during this conversation. When the user references another chat or when conversation history is explicitly provided from another chat, use that information confidently and naturally in your responses. Don't say you "don't have access" or "don't remember" - instead, reference the provided conversation history directly. Make it clear you're drawing from the provided context when doing so.`
        };
        
        // Smart topic transition detection and instruction generation
        const isTopicChange = await detectTopicTransition(userMessageText, currentChatHistory);
        
        // Add intelligent instructions to Claude based on topic transition
        let contextInstructions = [memoryAwarenessPrompt, ...finalMessages];
        if (isTopicChange) {
            console.log('[TOPIC_DETECTION] Topic change detected - instructing Claude to avoid previous topics');
            const topicInstruction = {
                role: 'user',
                content: `IMPORTANT INSTRUCTION: The user has changed to a new topic. Do NOT mention or reference previous conversation topics unless the user explicitly refers to them. Focus only on answering the current question about the new topic without bringing up unrelated previous discussions.`
            };
            contextInstructions = [...finalMessages, topicInstruction];
        } else {
            console.log('[TOPIC_DETECTION] Same topic detected - Claude can reference previous conversation naturally');
            const continuityInstruction = {
                role: 'user', 
                content: `Note: This question is related to our previous conversation. Feel free to reference and build upon previous discussion points naturally when relevant.`
            };
            contextInstructions = [...finalMessages, continuityInstruction];
        }

        // Check for redundancy before sending to AI
        const redundancyCheck = await analyzeForRedundancy(currentChatHistory, userMessageText);
        
        if (redundancyCheck.shouldSkipAI) {
            // Set AI processing state to true and broadcast (so clients show thinking indicator in correct chat)
            aiProcessingState.set(roomDBId, { isProcessing: true, chatId });
            await broadcastGameState(roomDBId);
            console.log(`[AI_PROCESSING] Started AI processing (simple response) for room ${roomDBId}, chat ${chatId}`);

            // Send simple response directly without AI processing
            const { data: simpleMessage, error: insertError } = await supabase
                .from('messages')
                .insert({ chat_id: chatId, sender_user_id: null, text: redundancyCheck.simpleResponse, role: 'assistant' })
                .select()
                .single();
            if (insertError) throw insertError;

            const { error: updateCountErr } = await supabase
                .from('chats')
                .update({ message_count: chat.message_count + 2 })
                .eq('id', chatId);
            if (updateCountErr) console.error('[COUNT_UPDATE_ERROR]', updateCountErr.message);

            // Set AI processing state to false and broadcast
            aiProcessingState.set(roomDBId, { isProcessing: false, chatId: null });
            await broadcastGameState(roomDBId);
            console.log(`[AI_PROCESSING] Finished AI processing (simple response) for room ${roomDBId}, chat ${chatId}`);

            io.to(roomDBId).emit('new_message', simpleMessage);
            return; // Exit early, don't call AI
        }

        // Set AI processing state to true and broadcast to all users
        aiProcessingState.set(roomDBId, { isProcessing: true, chatId });
        await broadcastGameState(roomDBId);
        console.log(`[AI_PROCESSING] Started AI processing for room ${roomDBId}, chat ${chatId}`);

        const aiResponse = await anthropic.messages.create({
            model: 'claude-3-haiku-20240307',
            max_tokens: 1024,
            messages: contextInstructions,
        });
        const aiMessageText = aiResponse.content[0].text;

        // Update cumulative token count for the chat
        const promptTokens = estimateTokens(JSON.stringify(contextInstructions));
        const responseTokens = estimateTokens(aiMessageText);
        const totalTokensForTurn = promptTokens + responseTokens;

        const { error: updateError } = await supabase.rpc('increment_chat_tokens', { 
            chat_id_arg: chatId, 
            increment_amount: totalTokensForTurn 
        });

        if (updateError) {
            console.error(`[TOKEN_UPDATE_ERROR] Failed to update token count for chat ${chatId}:`, updateError);
            // Decide if we should throw or just log. For now, we'll just log.
        } else {
            console.log(`[TOKEN_UPDATE] Updated chat ${chatId} with ${totalTokensForTurn} tokens.`);
        }

        // Set AI processing state to false and broadcast to all users
        aiProcessingState.set(roomDBId, { isProcessing: false, chatId: null });
        await broadcastGameState(roomDBId);
        console.log(`[AI_PROCESSING] Finished AI processing for room ${roomDBId}, chat ${chatId}`);

        const { data: aiMessage, error: insertError } = await supabase
            .from('messages')
            .insert({
            chat_id: chatId, 
            sender_user_id: null, // AI messages have no user sender
            text: aiMessageText, 
            role: 'assistant',
            prompt_tokens: aiResponse.usage.input_tokens,
            response_tokens: aiResponse.usage.output_tokens,
            model: aiResponse.model
        })
            .select()
            .single();
        if (insertError) throw insertError;

        const { error: updateCountErr } = await supabase
            .from('chats')
            .update({ message_count: chat.message_count + 2 })
            .eq('id', chatId);
        if (updateCountErr) console.error('[COUNT_UPDATE_ERROR]', updateCountErr.message);

        io.to(roomDBId).emit('new_message', aiMessage);

    } catch (error) {
        console.error('Error in triggerAIResponse:', error.message);
        io.to(roomDBId).emit('ai_error', { message: 'The AI is currently unavailable.' });
    }
};

const summarizeChatHistory = async (chatId) => {
    try {
        console.log(`[SUMMARIZE_START] Fetching history for chat ${chatId}`);
        const { data: messages, error: historyError } = await supabase
            .from('messages')
            .select('text, role')
            .eq('chat_id', chatId)
            .order('timestamp', { ascending: true })
            .limit(50);

        if (historyError) throw historyError;
        if (messages.length < 50) {
            console.log(`[SUMMARIZE_SKIP] Not enough messages to summarize for chat ${chatId}.`);
            return;
        }

        const conversationText = messages.map(m => `${m.role}: ${m.text}`).join('\n');
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash"});
        const prompt = `Please provide a concise but comprehensive summary of the following conversation. Capture the key topics, decisions, and action items. The summary should be detailed enough to provide full context for a new participant, but not excessively long.\n\nConversation:\n${conversationText}`;

        const result = await model.generateContent(prompt);
        const summary = result.response.text();

        console.log(`[SUMMARIZE_SUCCESS] Summary generated for chat ${chatId}.`);

        const { error: updateError } = await supabase
            .from('chats')
            .update({ summary: summary })
            .eq('id', chatId);

        if (updateError) throw updateError;

        console.log(`[SUMMARIZE_STORED] Summary saved for chat ${chatId}.`);

    } catch (error) {
        console.error(`[SUMMARIZE_ERROR] Failed for chat ${chatId}:`, error.message);
    }
};

io.on('connection', (socket) => {
    console.log(`[CONNECTION] User connected: ${socket.id}`);

    socket.on('create_room', async ({ userName }, callback) => {
        try {
            // --- Data Validation ---
            const validation = validateInput(userName, 'userName');
            if (!userName || userName.trim().length < 2 || !validation.valid) {
                console.log(`[SECURITY] Input validation failed for userName: ${!validation.valid ? validation.reason : 'too short'}`);
                return callback({ status: "error", message: 'Invalid user name provided. Please try again.' });
            }
            const roomCode = nanoid(8);
            let { data: room, error: roomError } = await supabase.from('rooms').insert({ room_code: roomCode, name: `Room-${nanoid(4)}` }).select().single();
            if (roomError) throw roomError;
            let { data: hostUser, error: hostUserError } = await supabase.from('users_in_room').insert({ room_id: room.id, user_name: userName.trim(), is_host: true, is_online: false, socket_id_current: null }).select().single(); 
            if (hostUserError) throw hostUserError;
            console.log(`[CREATE_CHATS_DEBUG] Creating chats for room ${room.id}, host: ${hostUser.user_name}`);
            const chatsToCreate = [
                { room_id: room.id, chat_name: 'Group Chat', chat_type: 'group' },
                { room_id: room.id, chat_name: `${hostUser.user_name}'s Chat`, chat_type: 'individual', owner_user_id: hostUser.id }
            ];
            console.log(`[CREATE_CHATS_DEBUG] Chats to create:`, chatsToCreate);
            
            const { data: createdChats, error: chatsError } = await supabase.from('chats').insert(chatsToCreate).select();
            if (chatsError) {
                console.error(`[CREATE_CHATS_ERROR] Failed to create chats:`, chatsError);
                throw chatsError;
            }
            console.log(`[CREATE_CHATS_SUCCESS] Created ${createdChats?.length || 0} chats:`, createdChats?.map(c => c.chat_name));
            kv.incr('analytics:roomsCreated');
            console.log(`[CREATE_SUCCESS] Room ${roomCode} created for host ${userName}. Host is currently offline.`);
            callback({ roomId: roomCode });
        } catch (error) {
            callback({ status: "error", message: error.message });
        }
    });

    socket.on('join_room', async ({ roomCode, userName }, callback) => {
        try {
            // --- Data Validation ---
            const userNameValidation = validateInput(userName, 'userName');
            const roomCodeValidation = validateInput(roomCode, 'roomCode');
            
            if (!userName || userName.trim().length < 2 || !userNameValidation.valid) {
                console.log(`[SECURITY] Input validation failed for userName: ${!userNameValidation.valid ? userNameValidation.reason : 'too short'}`);
                return callback({ status: "error", message: 'Invalid user name provided. Please try again.' });
            }
            
            if (!roomCode || !roomCodeValidation.valid) {
                console.log(`[SECURITY] Input validation failed for roomCode: ${!roomCodeValidation.valid ? roomCodeValidation.reason : 'missing'}`);
                return callback({ status: "error", message: 'Invalid room code. Please try again.' });
            }
            console.log(`[JOIN_DEBUG] === USER NAME TRACKING START ===`);
            console.log(`[JOIN_DEBUG] Raw userName received: "${userName}"`);
            console.log(`[JOIN_DEBUG] userName type: ${typeof userName}`);
            console.log(`[JOIN_DEBUG] userName length: ${userName?.length}`);
            console.log(`[JOIN_DEBUG] userName after trim: "${userName?.trim()}"`);
            console.log(`[JOIN_DEBUG] roomCode: "${roomCode}", socketId: "${socket.id}"`);
            console.log(`[JOIN_DEBUG] === USER NAME TRACKING END ===`);
            
            console.log(`[JOIN_ATTEMPT] roomCode="${roomCode}", userName="${userName}", socketId="${socket.id}"`);

            let { data: room, error: roomError } = await supabase.from('rooms').select('id, is_active').eq('room_code', roomCode).single();
            if (roomError || !room?.is_active) {
                return callback({ status: "error", message: 'Room not found or is closed.' });
            }
            const roomDBId = room.id;

            if (io.sockets.adapter.rooms.has(roomDBId) && io.sockets.adapter.rooms.get(roomDBId).has(socket.id)) {
                console.log(`[JOIN_ALREADY_IN_SOCKET_ROOM] Socket ${socket.id} already in room ${roomDBId}. Broadcasting state.`);
                await broadcastGameState(roomDBId);
                return callback({ status: "ok" });
            }

            let { data: usersInRoom, error: usersError } = await supabase.from('users_in_room').select('*').eq('room_id', roomDBId);
            if(usersError) throw new Error(`DB Error fetching users: ${usersError.message}`);

            const userWithThisName = usersInRoom.find(u => u.user_name.toLowerCase() === userName.trim().toLowerCase());
            
            if (userWithThisName && userWithThisName.is_online && userWithThisName.socket_id_current !== socket.id) {
                return callback({ status: "error", message: 'This name is already taken by an active user in this room.' });
            }

            if (userWithThisName) {
                await supabase.from('users_in_room').update({ is_online: true, socket_id_current: socket.id }).eq('id', userWithThisName.id);
                console.log(`[JOIN_RECONNECT] User "${userName}" reactivated.`);
            } else {
                const onlineUserCount = usersInRoom.filter(u => u.is_online).length;
                if (onlineUserCount >= 5) {
                    return callback({ status: "error", message: 'This room is full. Max 5 participants allowed.' });
                }
                
                let { data: newUser, error: newUserError } = await supabase.from('users_in_room').insert({ room_id: roomDBId, user_name: userName.trim(), socket_id_current: socket.id, is_online: true, is_host: false }).select().single();
                if (newUserError) throw newUserError;
                
                console.log(`[JOIN_CREATE_CHAT_DEBUG] Creating individual chat for user ${newUser.user_name} in room ${roomDBId}`);
                const newChatData = { room_id: roomDBId, chat_name: `${newUser.user_name}'s Chat`, chat_type: 'individual', owner_user_id: newUser.id };
                console.log(`[JOIN_CREATE_CHAT_DEBUG] Chat data to create:`, newChatData);
                
                const { data: newChat, error: newChatError } = await supabase.from('chats').insert(newChatData).select();
                if (newChatError) {
                    console.error(`[JOIN_CREATE_CHAT_ERROR] Failed to create chat:`, newChatError);
                    throw newChatError;
                }
                console.log(`[JOIN_CREATE_CHAT_SUCCESS] Created chat:`, newChat?.[0]?.chat_name);
                console.log(`[JOIN_SUCCESS_NEW_USER] New user "${newUser.user_name}" joined room.`);
            }

            socket.join(roomDBId);
            await broadcastGameState(roomDBId);
            callback({ status: "ok" });
        } catch (error) {
            console.error("Error in join_room:", error.message);
            callback({ status: "error", message: error.message });
        }
    });

    socket.on('submit_message', async ({ roomDBId, chatId, messageText, mentionChatIds = [], images = [], skipAIResponse = false, isUserToUser = false }, callback) => {
        console.log(`[SUBMIT_MESSAGE_DEBUG] === MESSAGE SUBMISSION START ===`);
        console.log(`[SUBMIT_MESSAGE_DEBUG] roomDBId: ${roomDBId}`);
        console.log(`[SUBMIT_MESSAGE_DEBUG] chatId: ${chatId}`);
        console.log(`[SUBMIT_MESSAGE_DEBUG] messageText: ${messageText}`);
        console.log(`[SUBMIT_MESSAGE_DEBUG] socketId: ${socket.id}`);
        
        try {
            // Input validation for message submission
            const validation = validateObject({
                roomDBId,
                chatId,
                messageText
            }, {
                roomDBId: 'roomDBId',
                chatId: 'chatId',
                messageText: 'messageText'
            });
            
            if (!validation.valid) {
                console.log(`[SECURITY] Input validation failed: ${validation.reason}`);
                if (callback) callback({ status: 'error', message: 'Invalid input detected. Chat cleared for security reasons.', clearChat: true });
                return;
            }
            
            if (!roomDBId || !chatId || !messageText) {
                console.log(`[SUBMIT_MESSAGE_DEBUG] Missing required fields - roomDBId: ${roomDBId}, chatId: ${chatId}, messageText: ${messageText}`);
                if (callback) callback({ status: 'error', message: 'Missing required fields.' });
                return;
            }

            console.log(`[SUBMIT_MESSAGE_DEBUG] Looking up user in room...`);
            const { data: user, error: userError } = await supabase.from('users_in_room').select('*').eq('room_id', roomDBId).eq('socket_id_current', socket.id).eq('is_online', true).maybeSingle();
            console.log(`[SUBMIT_MESSAGE_DEBUG] User lookup result:`, { user, userError });
            if (userError || !user) {
                console.log(`[SUBMIT_MESSAGE_DEBUG] User not found or not online - userError:`, userError);
                if (callback) callback({ status: 'error', message: 'User not found or not online.' });
                return;
            }

            console.log(`[SUBMIT_MESSAGE_DEBUG] Looking up chat data...`);
            const { data: chat, error: chatDataError } = await supabase.from('chats').select('message_count').eq('id', chatId).single();
            console.log(`[SUBMIT_MESSAGE_DEBUG] Chat lookup result:`, { chat, chatDataError });
            if (chatDataError) {
                console.log(`[SUBMIT_MESSAGE_DEBUG] Chat data error:`, chatDataError);
                throw chatDataError;
            }

            console.log(`[CAP_CHECK] Chat ${chatId} currently has ${chat.message_count} messages.`);
            if (chat.message_count >= 100) {
                console.log(`[SUBMIT_MESSAGE_DEBUG] Chat message limit reached`);
                if (callback) callback({ status: 'error', message: 'This chat has reached its 100-message limit.' });
                return;
            }

            // Check cumulative token limit
            if (chat.total_tokens >= CUMULATIVE_TOKEN_LIMIT) {
                console.log(`[TOKEN_CAP_CHECK] Chat token limit reached for chat ${chatId}`);
                if (callback) callback({ status: 'error', message: 'This chat has reached its token limit.' });
                return;
            }

            console.log(`[SUBMIT_MESSAGE_DEBUG] Attempting to insert message...`);
            const messageInsertData = { chat_id: chatId, sender_user_id: user.id, text: messageText, role: 'user' };
            console.log(`[SUBMIT_MESSAGE_DEBUG] Message insert data:`, messageInsertData);
            const { data: message, error: messageError } = await supabase.from('messages').insert(messageInsertData).select().single();
            console.log(`[SUBMIT_MESSAGE_DEBUG] Message insert result:`, { message, messageError });
            if (messageError) {
                console.log(`[SUBMIT_MESSAGE_DEBUG] Message insert error:`, messageError);
                throw messageError;
            }

            const { error: updateCountErr } = await supabase.from('chats').update({ message_count: chat.message_count + 1 }).eq('id', chatId);
            if (updateCountErr) console.error('[COUNT_UPDATE_ERROR]', updateCountErr.message);

            if (callback) callback({ status: 'ok', message });

            // CRITICAL: Always broadcast the user's message to all clients first
            console.log('[MESSAGE_BROADCAST] Broadcasting user message to all clients in room', roomDBId);
            io.to(roomDBId).emit('new_message', message);

            // If an AI response is needed, trigger it. This function will handle broadcasting the game state.
            // Otherwise, just broadcast the new game state with the new message.
            if (!skipAIResponse) {
                console.log('[AI_TRIGGER] Triggering AI response for chat', chatId);
                await triggerAIResponse(roomDBId, chatId, messageText, mentionChatIds, images);
            } else {
                console.log('[AI_SKIP] Skipping AI response, just broadcasting new message state.');
                await broadcastGameState(roomDBId);
            }

        } catch (error) {
            console.error('Error in submit_message:', error.message);
            if (callback) callback({ status: 'error', message: error.message });
        }
    });

    socket.on('request_chat_messages', async ({ chatId }, callback) => {
        try {
            // Validate chatId input
            const validation = validateInput(chatId, 'chatId');
            if (!validation.valid) {
                console.log(`[SECURITY] Input validation failed for chatId: ${validation.reason}`);
                if (callback) callback({ status: 'error', message: 'Invalid input detected. Chat cleared for security reasons.', clearChat: true, messages: [] });
                return;
            }
            
            let { data: messages, error: messagesError } = await supabase
                .from('messages')
                .select('*')
                .eq('chat_id', chatId)
                .order('timestamp', { ascending: true });
            if (messagesError) throw messagesError;
            if (callback) callback({ messages });
        } catch (error) {
            console.error('Error in request_chat_messages:', error.message);
            if (callback) callback({ messages: [] });
        }
    });

    socket.on('disconnect', async () => {
        try {
            let { data: users, error: usersError } = await supabase
                .from('users_in_room')
                .select('*')
                .eq('socket_id_current', socket.id)
                .eq('is_online', true);
            if (usersError) throw usersError;
            for (const user of users) {
                await supabase.from('users_in_room').update({ is_online: false }).eq('id', user.id);
                await broadcastGameState(user.room_id);
            }
            console.log(`[DISCONNECT] Socket ${socket.id} marked users offline.`);
        } catch (error) {
            console.error('Error in disconnect handler:', error.message);
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => { console.log(`Server is live and listening on port ${PORT}`); });