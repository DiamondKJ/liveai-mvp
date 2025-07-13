// Only load .env file in development, not in production
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
  
  // --- THE DEFINITIVE FIX IS HERE ---
  const io = new Server(server, {
      cors: {
          origin: process.env.CLIENT_URL, // Use the environment variable, NOT a hardcoded string
          methods: ["GET", "POST"]
      }
  });
  // --- END OF FIX ---
  
  const rooms = new Map();
  
  io.on('connection', (socket) => {
      console.log(`A user connected: ${socket.id}`);
  
      socket.on('create_room', (callback) => {
          const roomId = nanoid(8);
          rooms.set(roomId, {
              users: [{ id: socket.id, name: `User-${socket.id.substring(0,4)}` }],
              currentUserIndex: 0,
              promptInProgress: "",
              messages: [],
          });
          socket.join(roomId);
          console.log(`Room created: ${roomId} by host ${socket.id}`);
          callback({ roomId });
      });
  
      socket.on('join_room', ({ roomId }, callback) => {
          const room = rooms.get(roomId);
          if (room) {
              socket.join(roomId);
              if (!room.users.some(u => u.id === socket.id)) {
                   room.users.push({ id: socket.id, name: `User-${socket.id.substring(0,4)}` });
              }
              
              io.to(roomId).emit('update_game_state', {
                  users: room.users,
                  currentUserIndex: room.currentUserIndex,
                  promptInProgress: room.promptInProgress,
                  messages: room.messages
              });
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
          room.currentUserIndex++;
  
          if (room.currentUserIndex >= room.users.length) {
              console.log(`Final prompt for room ${roomId}: ${room.promptInProgress}`);
              room.messages.push({ sender: 'prompt', text: room.promptInProgress });
              
              try {
                  const claudeResponse = await anthropic.messages.create({
                      model: "claude-3-haiku-20240307",
                      max_tokens: 1024,
                      messages: [{ role: 'user', content: room.promptInProgress }],
                  });
                  const aiText = claudeResponse.content[0].text;
                  room.messages.push({ sender: 'claude', text: aiText });
              } catch (error) {
                  console.error("AI Error:", error);
                  room.messages.push({ sender: 'system', text: 'Error connecting to AI.' });
              }
              room.currentUserIndex = 0;
              room.promptInProgress = "";
          }
          
          io.to(roomId).emit('update_game_state', {
              users: room.users,
              currentUserIndex: room.currentUserIndex,
              promptInProgress: room.promptInProgress,
              messages: room.messages
          });
      });
  
      socket.on('disconnect', () => {
          console.log(`User ${socket.id} disconnected`);
      });
  });
  
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
      console.log(`Server is live and listening on port ${PORT}`);
  });