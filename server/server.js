const dotenv = require('dotenv');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@vercel/kv'); // Import Vercel KV

// Only call .config() in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

// --- Setup KV Database Client ---
const kv = createClient({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: process.env.CLIENT_URL } });
const rooms = new Map();

// Log DB stats periodically
setInterval(async () => {
    try {
        const roomsCreated = await kv.get('analytics:roomsCreated') || 0;
        const promptsSent = await kv.get('analytics:messagesSent') || 0;
        console.log(`[DB_ANALYTICS] Rooms Created: ${roomsCreated} | Prompts Sent: ${promptsSent}`);
    } catch (error) { console.error("KV Analytics Error:", error); }
}, 60000 * 5); // Log every 5 minutes

const broadcastGameState = (roomId, room) => {
    io.to(roomId).emit('update_game_state', {
        users: room.users,
        currentUserIndex: room.currentUserIndex,
        promptInProgress: room.promptInProgress,
        messages: room.messages,
        isLoading: room.isLoading,
    });
};

io.on('connection', (socket) => {
    console.log(`[CONNECTION] User connected: ${socket.id}`);

    socket.on('create_room', (callback) => {
        kv.incr('analytics:roomsCreated'); // Use KV Database
        console.log('[ANALYTICS] Room created.');
        const roomId = nanoid(8);
        rooms.set(roomId, {
            hostId: socket.id,
            users: [{ id: socket.id, name: 'Host' }],
            currentUserIndex: 0,
            promptInProgress: "",
            messages: [],
            isLoading: false,
            createdAt: new Date(),
            messageCount: 0,
        });
        socket.join(roomId);
        callback({ roomId });
    });

    socket.on('join_room', ({ roomId }, callback) => {
        const room = rooms.get(roomId);
        if (room) {
            socket.join(roomId);
            if (!room.users.some(u => u.id === socket.id)) {
                room.users.push({ id: socket.id, name: `Guest-${room.users.length}` });
            }
            broadcastGameState(roomId, room); // This line fixes the frozen screen
            callback({ status: "ok" });
        } else {
            callback({ status: "error", message: 'Room not found' });
        }
    });

    socket.on('submit_contribution', async ({ roomId, updatedPrompt }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        const currentUser = room.users[room.currentUserIndex];
        if (currentUser.id !== socket.id) return;
        
        room.promptInProgress = updatedPrompt;
        const isFinalTurn = (room.currentUserIndex + 1) >= room.users.length;
        
        if (isFinalTurn) {
            kv.incr('analytics:messagesSent'); // Use KV Database
            room.messageCount++;
            console.log(`[ANALYTICS] Final prompt sent in room ${roomId}.`);
            // ... (The rest of the logic remains the same)
            room.isLoading = true;
            room.messages.push({ sender: 'prompt', text: room.promptInProgress });
            broadcastGameState(roomId, room);
            
            let fullResponseText = "";
            const messageId = nanoid();

            try {
                const stream = anthropic.messages.stream({
                    model: "claude-3-haiku-20240307",
                    max_tokens: 1024,
                    messages: room.messages.slice(-5).map(m => ({ role: m.sender === 'claude' ? 'assistant' : 'user', content: m.text })),
                });
                io.to(roomId).emit('ai_stream_start', { sender: 'claude', messageId });
                for await (const chunk of stream) {
                    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                        const textChunk = chunk.delta.text;
                        fullResponseText += textChunk;
                        io.to(roomId).emit('ai_stream_chunk', { text: textChunk, messageId });
                    }
                }
            } catch (error) { console.error("AI Error:", error); }
            
            io.to(roomId).emit('ai_stream_end');
            if (fullResponseText) {
                room.messages.push({ sender: 'claude', text: fullResponseText, id: messageId });
            }
            
            room.promptInProgress = "";
            room.isLoading = false;
            room.currentUserIndex = 0;
            broadcastGameState(roomId, room);
        } else {
            room.currentUserIndex++;
            broadcastGameState(roomId, room);
        }
    });

    socket.on('disconnect', () => {
        console.log(`[CONNECTION] User disconnected: ${socket.id}`);
        for (const [roomId, room] of rooms.entries()) {
            if (room.hostId === socket.id) {
                const duration = ((new Date() - room.createdAt) / 1000 / 60).toFixed(2);
                console.log(`[ANALYTICS] Host left. Room ${roomId} closed. Duration: ${duration}m. Messages: ${room.messageCount}.`);
                io.to(roomId).emit('room_closed', { message: 'The host has left the session. This room is now closed.' });
                rooms.delete(roomId);
                return;
            }
            // ... (rest of disconnect logic) ...
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is live and listening on port ${PORT}`);
});