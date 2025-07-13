// Require all packages at the top level
const dotenv = require('dotenv');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { nanoid } = require('nanoid');
const Anthropic = require('@anthropic-ai/sdk');

// ... (requires are the same) ...

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
  
  // --- ANALYTICS: Our simple in-memory analytics object ---
  const analytics = {
      roomsCreatedToday: 0,
      messagesSent: 0,
      totalUsers: new Set(), // Using a Set to count unique users
      startTime: new Date(),
  };
  
  // --- ANALYTICS: Log stats periodically ---
  setInterval(() => {
      const uptime = (new Date() - analytics.startTime) / 1000 / 60; // Uptime in minutes
      console.log(`[ANALYTICS] Uptime: ${uptime.toFixed(2)}m | Rooms Created: ${analytics.roomsCreatedToday} | Messages Sent: ${analytics.messagesSent} | Unique Users: ${analytics.totalUsers.size}`);
  }, 60000 * 5); // Log every 5 minutes
  
  
  const broadcastGameState = (roomId, room) => {
      // ... (this function is the same) ...
  };
  
  io.on('connection', (socket) => {
      // ANALYTICS: Track unique users
      analytics.totalUsers.add(socket.id);
      console.log(`[CONNECTION] User connected: ${socket.id}. Total unique users so far: ${analytics.totalUsers.size}`);
  
      socket.on('create_room', (callback) => {
          // ANALYTICS: Increment rooms created
          analytics.roomsCreatedToday++;
          console.log(`[ANALYTICS] Room created. Total for today: ${analytics.roomsCreatedToday}`);
  
          const roomId = nanoid(8);
          rooms.set(roomId, {
              hostId: socket.id,
              users: [{ id: socket.id, name: `Host` }],
              currentUserIndex: 0,
              promptInProgress: "",
              messages: [],
              isLoading: false,
              // ANALYTICS: Track session start time
              createdAt: new Date(),
              messageCount: 0,
          });
          socket.join(roomId);
          callback({ roomId });
      });
  
      socket.on('join_room', ({ roomId }, callback) => {
          // ... (this function is the same) ...
      });
  
      socket.on('submit_contribution', async ({ roomId, updatedPrompt }) => {
          // ... (most of this function is the same) ...
          const room = rooms.get(roomId);
          // ...
          
          const isFinalTurn = (room.currentUserIndex + 1) >= room.users.length;
          
          if (isFinalTurn) {
              // ANALYTICS: Increment messages sent per room and globally
              room.messageCount++;
              analytics.messagesSent++;
              console.log(`[ANALYTICS] Final prompt sent in room ${roomId}. Room msg count: ${room.messageCount}. Global msg count: ${analytics.messagesSent}`);
  
              // ... (the rest of the logic for calling the AI) ...
          } else {
              // ... (passing the turn) ...
          }
      });
  
      socket.on('disconnect', () => {
          console.log(`[CONNECTION] User ${socket.id} disconnected`);
          for (const [roomId, room] of rooms.entries()) {
              if (room.hostId === socket.id) {
                  // ANALYTICS: Log session duration when host leaves
                  const sessionDuration = (new Date() - room.createdAt) / 1000 / 60; // Duration in minutes
                  console.log(`[ANALYTICS] Host left. Room ${roomId} closed. Duration: ${sessionDuration.toFixed(2)} minutes. Messages: ${room.messageCount}.`);
                  // ... (the rest of the disconnect logic) ...
              }
              // ...
          }
      });
  });
  
  const PORT = process.env.PORT || 3001;
  server.listen(PORT, () => {
      console.log(`Server is live and listening on port ${PORT}`);
  });