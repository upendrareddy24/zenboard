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

// Multi-board storage
let allBoards = {
    "default": {
        name: "Main Playground",
        elements: []
    }
};

io.on('connection', (socket) => {
    let currentBoardId = "default";
    console.log('User connected:', socket.id);

    // Send the list of all board names to the user
    socket.emit('board_list', Object.keys(allBoards).map(id => ({ id, name: allBoards[id].name })));

    // Send initial state of the default board
    socket.emit('init_state', allBoards[currentBoardId].elements);

    socket.on('join_board', (boardId) => {
        if (!allBoards[boardId]) return;

        socket.leave(currentBoardId);
        currentBoardId = boardId;
        socket.join(currentBoardId);

        socket.emit('init_state', allBoards[currentBoardId].elements);
    });

    socket.on('create_board', (data) => {
        const id = Math.random().toString(36).substring(7);
        allBoards[id] = {
            name: data.name || "Untitled Board",
            elements: []
        };
        io.emit('board_list', Object.keys(allBoards).map(id => ({ id, name: allBoards[id].name })));
        socket.emit('board_created', { id });
    });

    socket.on('request_board_list', () => {
        socket.emit('board_list', Object.keys(allBoards).map(id => ({ id, name: allBoards[id].name })));
    });

    socket.on('draw_line', (data) => {
        allBoards[currentBoardId].elements.push({ type: 'line', ...data });
        socket.to(currentBoardId).emit('draw_line', data);
    });

    socket.on('new_shape', (data) => {
        allBoards[currentBoardId].elements.push({ type: 'shape', ...data });
        socket.to(currentBoardId).emit('new_shape', data);
    });

    socket.on('new_object', (data) => {
        allBoards[currentBoardId].elements.push(data);
        socket.to(currentBoardId).emit('new_object', data);
    });

    socket.on('update_text', (data) => {
        const obj = allBoards[currentBoardId].elements.find(o => o.id === data.id);
        if (obj) obj.text = data.text;
        socket.to(currentBoardId).emit('update_text', data);
    });

    socket.on('delete_object', (data) => {
        allBoards[currentBoardId].elements = allBoards[currentBoardId].elements.filter(obj => obj.id !== data.id);
        socket.to(currentBoardId).emit('delete_object', data);
    });

    socket.on('update_style', (data) => {
        const obj = allBoards[currentBoardId].elements.find(o => o.id === data.id);
        if (obj) obj.color = data.color;
        socket.to(currentBoardId).emit('update_style', data);
    });

    socket.on('mouse_move', (data) => {
        socket.to(currentBoardId).emit('mouse_move', data);
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
