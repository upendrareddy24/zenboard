const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

// In-memory state (Store objects so late-comers see the current board)
let boardState = [];

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);

    // Send current board state to the new user
    socket.emit('init_state', boardState);

    // Sync freehand drawing
    socket.on('draw_line', (data) => {
        boardState.push(data);
        socket.broadcast.emit('draw_line', data);
    });

    // Sync mouse movement for cursors
    socket.on('mouse_move', (data) => {
        socket.broadcast.emit('mouse_move', data);
    });

    // Clear board
    socket.on('clear_board', () => {
        boardState = [];
        io.emit('clear_board');
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`ZenBoard Server running on port ${PORT}`);
});
