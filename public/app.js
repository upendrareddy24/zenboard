// ZenBoard Canvas Engine
const socket = io(); // Connect to local/heroku server

// State Management
let currentTool = 'select'; // Matches index.html default
let isDrawing = false;
let lastLine;
let lastShape;
let transformer;
let currentColor = '#6366f1';
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

    // Add Transformer for selection
    transformer = new Konva.Transformer({
        rotateEnabled: true,
        anchorFill: '#6366f1',
        anchorStroke: '#fff',
        borderStroke: '#6366f1',
        padding: 5
    });
    layer.add(transformer);

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
                const activeBtn = document.querySelector('.tool-btn.active');
                if (activeBtn) activeBtn.classList.remove('active');
                btn.classList.add('active');
                currentTool = tool;

                // Update cursor
                stage.container().style.cursor = (tool === 'select') ? 'default' : 'crosshair';
                // Clear selection when switching tools
                if (tool !== 'select') transformer.nodes([]);
            }
        });
    });

    // Color Swatch Selection
    document.querySelectorAll('.color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelector('.color-swatch.active').classList.remove('active');
            swatch.classList.add('active');
            currentColor = swatch.getAttribute('data-color');

            // If an object is selected, re-color it!
            const nodes = transformer.nodes();
            if (nodes.length > 0) {
                nodes.forEach(node => {
                    const id = node.id();
                    if (node instanceof Konva.Line) {
                        node.stroke(currentColor);
                    } else if (node instanceof Konva.Rect || node instanceof Konva.Circle) {
                        node.stroke(currentColor);
                        const fillBase = node.fill() || 'rgba(0,0,0,0)';
                        if (fillBase !== 'rgba(0,0,0,0)') {
                            node.fill(hexToRGBA(currentColor, 0.2));
                        }
                    }
                    socket.emit('update_style', { id, color: currentColor });
                });
                layer.batchDraw();
            }
        });
    });

    // Save Design Event
    document.getElementById('save-btn').addEventListener('click', () => {
        const name = document.getElementById('design-name').value;
        socket.emit('create_board', { name });
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
        // Miro-style: Delete key to remove selected items
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const nodes = transformer.nodes();
            nodes.forEach(node => {
                const id = node.id();
                if (id) {
                    socket.emit('delete_object', { id });
                    deleteObject(id);
                }
            });
        }
    });

    // Clear Board Action
    document.getElementById('clear-canvas').addEventListener('click', () => {
        if (confirm('Clear the entire board? This cannot be undone.')) {
            socket.emit('clear_board');
        }
    });

    // Draw Event Listeners
    stage.on('mousedown touchstart', (e) => {
        // Handle selection and erasing
        if (e.target !== stage) {
            if (currentTool === 'eraser') {
                const id = e.target.id() || e.target.parent().id();
                if (id) {
                    socket.emit('delete_object', { id });
                    deleteObject(id);
                }
                return;
            }
            if (currentTool === 'select' || currentTool === 'text') {
                const node = e.target.parent() instanceof Konva.Group ? e.target.parent() : e.target;
                if (currentTool === 'select') {
                    transformer.nodes([node]);
                }
                // If clicking an object, don't fall through to create a new one!
                return;
            }
        } else {
            transformer.nodes([]); // Clear selection if clicking stage
        }

        if (stage.draggable() || currentTool === 'select' || currentTool === 'eraser') return;

        isDrawing = true;
        const pos = stage.getRelativePointerPosition();

        if (currentTool === 'pen') {
            lastLine = new Konva.Line({
                stroke: currentColor,
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
                fill: hexToRGBA(currentColor, 0.2),
                stroke: currentColor,
                strokeWidth: 2,
                cornerRadius: 8
            });
            layer.add(lastShape);
        } else if (currentTool === 'circle') {
            lastShape = new Konva.Circle({
                x: pos.x,
                y: pos.y,
                radius: 0,
                fill: hexToRGBA(currentColor, 0.2),
                stroke: currentColor,
                strokeWidth: 2
            });
            layer.add(lastShape);
        } else if (currentTool === 'text') {
            createSticky(pos.x, pos.y);
            isDrawing = false;
        }
    });

    stage.on('mousemove touchmove', () => {
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
            const objId = Math.random().toString(36).substring(7);

            if (currentTool === 'pen') {
                lastLine.id(objId);
                socket.emit('draw_line', {
                    id: objId,
                    points: lastLine.points(),
                    stroke: lastLine.stroke(),
                    userId
                });
            } else if (lastShape) {
                lastShape.id(objId);
                socket.emit('new_shape', {
                    id: objId,
                    type: lastShape.className,
                    x: lastShape.x(),
                    y: lastShape.y(),
                    width: lastShape.width(),
                    height: lastShape.height(),
                    radius: lastShape.radius ? lastShape.radius() : 0,
                    fill: lastShape.fill(),
                    stroke: lastShape.stroke()
                });
                lastShape = null;
            }
        }
    });

    // Double click to add/edit text on ANY shape
    stage.on('dblclick dbltap', (e) => {
        if (e.target === stage) return;
        const node = e.target.parent() instanceof Konva.Group ? e.target.parent() : e.target;

        if (node instanceof Konva.Rect || node instanceof Konva.Circle) {
            let textNode = layer.findOne('#text-' + node.id());
            if (!textNode) {
                textNode = new Konva.Text({
                    id: 'text-' + node.id(),
                    text: 'Type...',
                    fontSize: 14,
                    fontFamily: 'Inter',
                    fill: '#fff',
                    align: 'center',
                    verticalAlign: 'middle'
                });
                layer.add(textNode);
                updateTextPosition(node, textNode);
            }
            makeTextEditable(textNode, node);
        } else if (node instanceof Konva.Group) {
            const txt = node.findOne('Text');
            if (txt) makeTextEditable(txt, node);
        }
    });

    // Sync scaling for Sticky Notes and Shapes
    transformer.on('transform', (e) => {
        const node = transformer.nodes()[0];
        if (node instanceof Konva.Group) {
            const rect = node.findOne('Rect');
            const txt = node.findOne('Text');
            const scaleX = node.scaleX();
            const scaleY = node.scaleY();

            rect.width(rect.width() * scaleX);
            rect.height(rect.height() * scaleY);
            txt.width(txt.width() * scaleX);
            txt.height(txt.height() * scaleY);

            node.scaleX(1);
            node.scaleY(1);
        }

        const id = node.id();
        socket.emit('update_transform', {
            id: id,
            x: node.x(),
            y: node.y(),
            scaleX: node.scaleX(),
            scaleY: node.scaleY(),
            width: node.width ? node.width() : 0,
            height: node.height ? node.height() : 0,
            rotation: node.rotation()
        });
    });

    stage.on('mouseup touchend', () => {
        if (isDrawing) {
            isDrawing = false;
            const objId = Math.random().toString(36).substring(7);

            if (currentTool === 'pen') {
                lastLine.id(objId);
                socket.emit('draw_line', {
                    id: objId,
                    points: lastLine.points(),
                    stroke: lastLine.stroke(),
                    userId
                });
            } else if (lastShape) {
                lastShape.id(objId);
                socket.emit('new_shape', {
                    id: objId,
                    type: lastShape.className,
                    x: lastShape.x(),
                    y: lastShape.y(),
                    width: lastShape.width(),
                    height: lastShape.height(),
                    radius: lastShape.radius ? lastShape.radius() : 0,
                    fill: lastShape.fill(),
                    stroke: lastShape.stroke()
                });
                lastShape = null;
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
    socket.on('init_state', (elements) => {
        layer.destroyChildren(); // Clear current view
        layer.add(transformer); // Always keep transformer
        elements.forEach(el => {
            if (el.type === 'line') {
                layer.add(new Konva.Line(el));
            } else if (el.type === 'shape') {
                if (el.className === 'Rect') layer.add(new Konva.Rect(el));
                else if (el.className === 'Circle') layer.add(new Konva.Circle(el));
            } else if (el.type === 'sticky') {
                createSticky(el.x, el.y, el.text, true);
            }
        });
        layer.batchDraw();
    });

    socket.on('board_list', (boards) => {
        const list = document.getElementById('design-library');
        list.innerHTML = '';
        boards.forEach(board => {
            const btn = document.createElement('div');
            btn.className = 'board-item';
            btn.innerHTML = `<span style="font-size: 14px;">📄 ${board.name}</span>`;
            btn.style.cssText = 'padding: 8px; background: rgba(255,255,255,0.05); border-radius: 6px; cursor: pointer; transition: all 0.2s;';
            btn.onclick = () => socket.emit('join_board', board.id);
            btn.onmouseover = () => btn.style.background = 'rgba(255,255,255,0.1)';
            btn.onmouseout = () => btn.style.background = 'rgba(255,255,255,0.05)';
            list.appendChild(btn);
        });
    });

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

    socket.on('new_shape', (data) => {
        let shape;
        if (data.type === 'Rect') {
            shape = new Konva.Rect(data);
        } else if (data.type === 'Circle') {
            shape = new Konva.Circle(data);
        }
        if (shape) {
            layer.add(shape);
            layer.batchDraw();
        }
    });

    socket.on('delete_object', (data) => {
        deleteObject(data.id);
    });

    socket.on('new_object', (data) => {
        if (data.type === 'sticky') {
            createSticky(data.x, data.y, data.text, true, data.id); // Pass the server-side ID
        }
    });

    socket.on('update_style', (data) => {
        const node = stage.findOne('#' + data.id);
        if (node) {
            if (node instanceof Konva.Line) {
                node.stroke(data.color);
            } else {
                node.stroke(data.color);
                const currentFill = node.fill();
                if (currentFill && currentFill !== 'rgba(0,0,0,0)') {
                    node.fill(hexToRGBA(data.color, 0.2));
                }
            }
            layer.batchDraw();
        }
    });

    socket.on('update_text', (data) => {
        let node = stage.findOne('#' + data.id);
        if (!node) node = stage.findOne('#text-' + data.id); // Check for shape labels

        if (node) {
            const txt = (node instanceof Konva.Text) ? node : node.findOne('Text');
            if (txt) {
                txt.text(data.text);
                layer.batchDraw();
            }
        }
    });

    socket.on('update_transform', (data) => {
        const node = stage.findOne('#' + data.id);
        if (node) {
            node.setAttrs(data);
            // If it's a shape with a text label, update label position
            const textLabel = layer.findOne('#text-' + data.id);
            if (textLabel) updateTextPosition(node, textLabel);
            layer.batchDraw();
        }
    });

    socket.on('mouse_move', (data) => {
        if (data.userId === userId) return;
        updateRemoteCursor(data);
    });
}

function createSticky(x, y, text = 'Type requirements...', skipEmit = false, existingId = null) {
    const id = existingId || Math.random().toString(36).substring(7);
    const group = new Konva.Group({ x, y, draggable: true, id: id });

    const rect = new Konva.Rect({
        width: 150,
        height: 150,
        fill: '#facc15',
        shadowBlur: 10,
        shadowOpacity: 0.2,
        cornerRadius: 4,
        id: 'rect-' + id
    });

    const txt = new Konva.Text({
        text: text,
        fontSize: 16,
        padding: 15,
        width: 150,
        height: 150,
        align: 'left',
        verticalAlign: 'top',
        fontFamily: 'Inter',
        id: 'text-' + id
    });

    group.add(rect, txt);
    layer.add(group);
    layer.batchDraw();

    // Double click to edit text
    txt.on('dblclick dbltap', () => {
        makeTextEditable(txt, group);
    });

    if (!skipEmit) {
        socket.emit('new_object', {
            type: 'sticky',
            id: id,
            x, y, text,
            userId
        });
    }
}

function updateTextPosition(shape, textNode) {
    if (shape instanceof Konva.Rect) {
        textNode.position({
            x: shape.x(),
            y: shape.y()
        });
        textNode.width(shape.width());
        textNode.height(shape.height());
    } else if (shape instanceof Konva.Circle) {
        const radius = shape.radius();
        textNode.position({
            x: shape.x() - radius,
            y: shape.y() - radius
        });
        textNode.width(radius * 2);
        textNode.height(radius * 2);
    }
}

function makeTextEditable(textNode, anchorNode) {
    // Hide text node while editing
    textNode.hide();
    transformer.nodes([]); // Clear transformer
    layer.draw();

    // Create textarea over the canvas
    const stageBox = stage.container().getBoundingClientRect();
    const areaPosition = {
        x: stageBox.left + (anchorNode.x() + (anchorNode.offsetX ? anchorNode.offsetX() : 0)) * stage.scaleX() + stage.x(),
        y: stageBox.top + (anchorNode.y() + (anchorNode.offsetY ? anchorNode.offsetY() : 0)) * stage.scaleY() + stage.y()
    };

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    textarea.value = textNode.text();
    textarea.style.position = 'absolute';
    textarea.style.top = areaPosition.y + 'px';
    textarea.style.left = areaPosition.x + 'px';
    textarea.style.width = textNode.width() * stage.scaleX() + 'px';
    textarea.style.height = textNode.height() * stage.scaleY() + 'px';
    textarea.style.fontSize = textNode.fontSize() * stage.scaleX() + 'px';
    textarea.style.textAlign = textNode.align();
    textarea.style.border = 'none';
    textarea.style.padding = '10px';
    textarea.style.margin = '0px';
    textarea.style.overflow = 'hidden';
    textarea.style.background = 'transparent';
    textarea.style.outline = 'none';
    textarea.style.resize = 'none';
    textarea.style.lineHeight = textNode.lineHeight();
    textarea.style.fontFamily = textNode.fontFamily();
    textarea.style.transformOrigin = 'left top';
    textarea.style.color = '#000';

    textarea.focus();

    function removeTextarea() {
        textNode.text(textarea.value);
        textNode.show();
        document.body.removeChild(textarea);
        layer.draw();

        // Sync the text change
        socket.emit('update_text', {
            id: group.id(),
            text: textarea.value
        });
    }

    textarea.addEventListener('keydown', (e) => {
        if (e.keyCode === 13 && !e.shiftKey) {
            removeTextarea();
        }
        if (e.keyCode === 27) {
            removeTextarea();
        }
    });

    textarea.addEventListener('blur', () => {
        removeTextarea();
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

function hexToRGBA(hex, alpha) {
    let r = parseInt(hex.slice(1, 3), 16),
        g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function deleteObject(id) {
    const node = stage.findOne('#' + id);
    if (node) {
        node.destroy();
        transformer.nodes([]);
        layer.batchDraw();
    }
}
window.addEventListener('resize', () => {
    stage.width(window.innerWidth);
    stage.height(window.innerHeight);
});

init();
