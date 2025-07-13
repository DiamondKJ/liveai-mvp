// Require all packages at the top level
const dotenv = require('dotenv');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Anthropic = require('@anthropic-ai/sdk');

// Only *call* .config() in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config();
}

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: process.env.CLIENT_URL }
});

const rooms = new Map();

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
    console.log(`A user connected: ${socket.id}`);

    // The create_room listener that was likely missing
    socket.on('create_room', (callback) => {
        const roomId = nanoid(8);
        rooms.set(roomId, {
            hostId: socket.id,
            users: [{ id: socket.id, name: `Host` }],
            currentUserIndex: 0,
            promptInProgress: "",
            messages: [],
            isLoading: false,
        });
        socket.join(roomId);
        callback({ roomId });
    });

    socket.on('join_room', ({ roomId }, callback) => {
        const room = rooms.get(roomId);
        if (room) {
            socket.join(roomId);
            if (!room.users.some(u => u.id === socket.id)) {
                const guestName = `Guest-${room.users.length}`;
                room.users.push({ id: socket.id, name: guestName });
            }
            broadcastGameState(roomId, room);
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
            room.isLoading = true;
            room.messages.push({ sender: 'prompt', text: room.promptInProgress });
            broadcastGameState(roomId, room);
            
            let fullResponseText = "";
            const messageId = nanoid();

            try {
                const stream = anthropic.messages.stream({
                    model: "claude-3-haiku-20240307",
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: room.promptInProgress }],
                });
                io.to(roomId).emit('ai_stream_start', { sender: 'claude', messageId });
                for await (const chunk of stream) {
                    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                        const textChunk = chunk.delta.text;
                        fullResponseText += textChunk;
                        io.to(roomId).emit('ai_stream_chunk', { text: textChunk, messageId });
                    }
                }
            } catch (error) {
                console.error("AI Error:", error);
                room.messages.push({ sender: 'system', text: 'Error connecting to AI.' });
            }
            
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
        console.log(`User ${socket.id} disconnected`);
        for (const [roomId, room] of rooms.entries()) {
            if (room.hostId === socket.id) {
                io.to(roomId).emit('room_closed', { message: 'The host has left the session. This room is now closed.' });
                rooms.delete(roomId);
                console.log(`Host left. Room ${roomId} deleted.`);
                return;
            }
            const userIndex = room.users.findIndex(u => u.id === socket.id);
            if (userIndex !== -1) {
                const wasMyTurn = room.currentUserIndex === userIndex;
                room.users.splice(userIndex, 1);
                if (room.users.length > 0 && wasMyTurn) {
                    room.currentUserIndex = room.currentUserIndex % room.users.length;
                } else if (room.users.length > 0 && room.currentUserIndex > userIndex) {
                    room.currentUserIndex--;
                }
                broadcastGameState(roomId, room);
                return;
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is live and listening on port ${PORT}`);
});