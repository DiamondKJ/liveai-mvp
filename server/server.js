// Only load .env file in development
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: process.env.CLIENT_URL }
});

const rooms = new Map();

// Helper function to broadcast the current state of a room
const broadcastGameState = (roomId, room) => {
    io.to(roomId).emit('update_game_state', {
        users: room.users,
        currentUserIndex: room.currentUserIndex,
        promptInProgress: room.promptInProgress,
        messages: room.messages
    });
};

io.on('connection', (socket) => {
    console.log(`A user connected: ${socket.id}`);

    socket.on('create_room', (callback) => {
        const roomId = nanoid(8);
        rooms.set(roomId, {
            hostId: socket.id, // Explicitly track the host
            users: [{ id: socket.id, name: `Host` }], // The host is always the first user
            currentUserIndex: 0, // Turn starts with the host
            promptInProgress: "",
            messages: [],
        });
        socket.join(roomId);
        callback({ roomId });
    });

    socket.on('join_room', ({ roomId }, callback) => {
        const room = rooms.get(roomId);
        if (room) {
            socket.join(roomId);
            // Don't add a user if they are already in the list (e.g., on a page refresh)
            if (!room.users.some(u => u.id === socket.id)) {
                // Guests are added to the end of the list
                const guestName = `Guest-${room.users.length}`;
                room.users.push({ id: socket.id, name: guestName });
            }
            broadcastGameState(roomId, room);
            callback({ status: "ok" });
        } else {
            callback({ status: "error", message: 'Room not found' });
        }
    });

// in server.js

    socket.on('submit_contribution', async ({ roomId, updatedPrompt }) => {
        const room = rooms.get(roomId);
        if (!room) return;
        
        const currentUser = room.users[room.currentUserIndex];
        if (currentUser.id !== socket.id) return;

        room.promptInProgress = updatedPrompt;
        room.currentUserIndex = (room.currentUserIndex + 1) % room.users.length;

        const isFinalTurn = room.currentUserIndex === 0;

        if (isFinalTurn) {
            room.isLoading = true;
            room.messages.push({ sender: 'prompt', text: room.promptInProgress });
            broadcastGameState(roomId, room); // Show prompt and loading state

            try {
                const stream = anthropic.messages.stream({
                    model: "claude-3-haiku-20240307",
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: room.promptInProgress }],
                });

                // Tell clients to add a new, empty message for Claude
                const messageId = nanoid(); // Give this message a temporary ID
                io.to(roomId).emit('ai_stream_start', { sender: 'claude', messageId });

                for await (const chunk of stream) {
                    if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
                        // Send just the new text chunk to all clients
                        io.to(roomId).emit('ai_stream_chunk', { text: chunk.delta.text, messageId });
                    }
                }
                // Once the stream is done, we need to save the final message to history
                // For simplicity in this MVP, we won't re-assemble the full text here,
                // we'll let the client handle it. In a bigger app, you'd save it here.

            } catch (error) {
                console.error("AI Error:", error);
                io.to(roomId).emit('ai_stream_end'); // End the stream even on error
                room.messages.push({ sender: 'system', text: 'Error connecting to AI.' });
            }
            
            io.to(roomId).emit('ai_stream_end'); // Tell clients the stream is finished
            room.promptInProgress = "";
            room.isLoading = false;
            
            // Don't broadcast game state here, let the stream events handle UI updates
            // We only need to broadcast the final state *if* we were saving the full message text.
            // For now, we let clients manage their own final message state.

        } else {
            // If it's not the final turn, just broadcast the state normally
            broadcastGameState(roomId, room);
        }
    });
    // --- NEW ROBUST DISCONNECT LOGIC ---
    socket.on('disconnect', () => {
        console.log(`User ${socket.id} disconnected`);
        // Find which room the user was in
        for (const [roomId, room] of rooms.entries()) {
            // Check if the disconnected user is the host
            if (room.hostId === socket.id) {
                // If host leaves, notify everyone and destroy the room
                io.to(roomId).emit('room_closed', { message: 'The host has left the session. This room is now closed.' });
                rooms.delete(roomId);
                console.log(`Host left. Room ${roomId} deleted.`);
                return; // Exit, we're done with this user
            }

            // If not the host, check if they were a guest in the list
            const userIndex = room.users.findIndex(u => u.id === socket.id);
            if (userIndex !== -1) {
                room.users.splice(userIndex, 1); // Remove the guest

                // If it was the disconnected guest's turn, pass the turn to the next person
                if (room.users.length > 0 && room.currentUserIndex === userIndex) {
                    room.currentUserIndex = room.currentUserIndex % room.users.length;
                } else if (room.currentUserIndex > userIndex) {
                    // If someone ahead in the list leaves, decrement the index to keep the turn correct
                    room.currentUserIndex--;
                }
                
                broadcastGameState(roomId, room);
                return; // Exit, we're done with this user
            }
        }
    });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
    console.log(`Server is live and listening on port ${PORT}`);
});