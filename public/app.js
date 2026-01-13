// ZenBoard Canvas Engine
const socket = io(); // Connect to local/heroku server

// State Management
let currentTool = 'pen';
let isDrawing = false;
let lastLine;
let lastShape;
let stage, layer;
let userId = Math.random().toString(36).substring(7);
let userColor = `hsl(${Math.random() * 360}, 70%, 60%)`;

// Initialize Canvas
function init() {
    stage = new Konva.Stage({
        container: 'canvas-container',
        width: window.innerWidth,
        height: window.innerHeight,
        draggable: false // We will handle custom panning
    });

    layer = new Konva.Layer();
    stage.add(layer);

    setupEventListeners();
    setupSocketListeners();
    handleZoom();
}

function setupEventListeners() {
    // Tool Selection
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const tool = btn.getAttribute('data-tool');
            if (tool) {
                document.querySelector('.tool-btn.active').classList.remove('active');
                btn.classList.add('active');
                currentTool = tool;
            }
        });
    });

    // Panning (Spacebar logic)
    let isPanning = false;
    window.addEventListener('keydown', (e) => {
        if (e.code === 'Space') {
            stage.container().style.cursor = 'grab';
            stage.draggable(true);
        }
    });
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            stage.container().style.cursor = 'default';
            stage.draggable(false);
        }
    });

    // Draw Event Listeners
    stage.on('mousedown touchstart', (e) => {
        if (stage.draggable() || currentTool === 'select') return;

        isDrawing = true;
        const pos = stage.getRelativePointerPosition();

        if (currentTool === 'pen') {
            lastLine = new Konva.Line({
                stroke: '#6366f1',
                strokeWidth: 3,
                globalCompositeOperation: 'source-over',
                lineCap: 'round',
                lineJoin: 'round',
                points: [pos.x, pos.y],
                tension: 0.5
            });
            layer.add(lastLine);
        } else if (currentTool === 'rect') {
            lastShape = new Konva.Rect({
                x: pos.x,
                y: pos.y,
                width: 0,
                height: 0,
                fill: 'rgba(99, 102, 241, 0.2)',
                stroke: '#6366f1',
                strokeWidth: 2,
                cornerRadius: 8
            });
            layer.add(lastShape);
        } else if (currentTool === 'circle') {
            lastShape = new Konva.Circle({
                x: pos.x,
                y: pos.y,
                radius: 0,
                fill: 'rgba(236, 72, 153, 0.2)',
                stroke: '#ec4899',
                strokeWidth: 2
            });
            layer.add(lastShape);
        } else if (currentTool === 'text') {
            createSticky(pos.x, pos.y);
            isDrawing = false;
        }
    });

    stage.on('mousemove touchmove', () => {
        // Broadcast cursor position
        const pos = stage.getPointerPosition();
        socket.emit('mouse_move', {
            x: pos.x,
            y: pos.y,
            userId,
            color: userColor
        });

        if (!isDrawing) return;

        const posRel = stage.getRelativePointerPosition();

        if (currentTool === 'pen') {
            let newPoints = lastLine.points().concat([posRel.x, posRel.y]);
            lastLine.points(newPoints);
        } else if (currentTool === 'rect') {
            lastShape.width(posRel.x - lastShape.x());
            lastShape.height(posRel.y - lastShape.y());
        } else if (currentTool === 'circle') {
            const dist = Math.sqrt(Math.pow(posRel.x - lastShape.x(), 2) + Math.pow(posRel.y - lastShape.y(), 2));
            lastShape.radius(dist);
        }
        layer.batchDraw();
    });

    stage.on('mouseup touchend', () => {
        if (isDrawing) {
            isDrawing = false;
            // Sync new object to others
            if (currentTool === 'pen') {
                socket.emit('draw_line', {
                    points: lastLine.points(),
                    stroke: lastLine.stroke(),
                    userId
                });
            }
        }
    });
}

function handleZoom() {
    const scaleBy = 1.1;
    stage.on('wheel', (e) => {
        e.evt.preventDefault();
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();

        const mousePointTo = {
            x: (pointer.x - stage.x()) / oldScale,
            y: (pointer.y - stage.y()) / oldScale,
        };

        const newScale = e.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy;
        stage.scale({ x: newScale, y: newScale });

        const newPos = {
            x: pointer.x - mousePointTo.x * newScale,
            y: pointer.y - mousePointTo.y * newScale,
        };
        stage.position(newPos);

        // Update UI
        document.getElementById('zoom-level').innerText = Math.round(newScale * 100) + '%';
    });
}

function setupSocketListeners() {
    socket.on('draw_line', (data) => {
        if (data.userId === userId) return;
        const line = new Konva.Line({
            ...data,
            lineCap: 'round',
            lineJoin: 'round',
            tension: 0.5
        });
        layer.add(line);
        layer.batchDraw();
    });

    socket.on('mouse_move', (data) => {
        if (data.userId === userId) return;
        updateRemoteCursor(data);
    });
}

function createSticky(x, y, text = 'Idea...') {
    const group = new Konva.Group({ x, y, draggable: true });
    const rect = new Konva.Rect({
        width: 120,
        height: 120,
        fill: '#facc15',
        shadowBlur: 10,
        shadowOpacity: 0.2,
        cornerRadius: 4
    });
    const txt = new Konva.Text({
        text: text,
        fontSize: 14,
        padding: 10,
        width: 120,
        height: 120,
        align: 'center',
        verticalAlign: 'middle',
        fontFamily: 'Inter'
    });
    group.add(rect, txt);
    layer.add(group);
    layer.batchDraw();

    socket.emit('new_object', {
        type: 'sticky',
        x, y, text,
        userId
    });
}

function updateRemoteCursor(data) {
    let cursor = document.getElementById(`cursor-${data.userId}`);
    if (!cursor) {
        cursor = document.createElement('div');
        cursor.id = `cursor-${data.userId}`;
        cursor.className = 'remote-cursor';
        cursor.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="${data.color}">
                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
            </svg>
            <div class="cursor-label" style="background: ${data.color}">${data.userId}</div>
        `;
        document.body.appendChild(cursor);
    }
    cursor.style.transform = `translate(${data.x}px, ${data.y}px)`;
}

// Window Resize Handling
window.addEventListener('resize', () => {
    stage.width(window.innerWidth);
    stage.height(window.innerHeight);
});

init();
