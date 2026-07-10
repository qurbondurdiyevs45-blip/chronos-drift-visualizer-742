const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const ZIG_PARSER_PATH = path.join(__dirname, '../bin/drift_parser');

/**
 * The server acts as a high-speed gateway.
 * It consumes binary drift logs produced by the various language instrumentations,
 * pipes them through the Zig-optimized parser for normalization,
 * and emits the resulting 3D heatmap coordinates to the WebGL frontend.
 */

function streamDriftData(socket) {
    // In a production environment, this would tail a live log file or subscribe to a bus
    // Here we invoke our Zig binary parser to process raw execution jitter logs
    const parser = spawn(ZIG_PARSER_PATH, ['--stream', '--format=json']);

    parser.stdout.on('data', (data) => {
        try {
            const lines = data.toString().split('\n');
            lines.forEach(line => {
                if (line.trim()) {
                    const payload = JSON.parse(line);
                    socket.emit('drift_update', payload);
                }
            });
        } catch (err) {
            console.error('Parser output parse error:', err);
        }
    });

    parser.stderr.on('data', (data) => {
        console.error(`Zig Parser Error: ${data}`);
    });

    socket.on('disconnect', () => {
        parser.kill();
    });
}

// REST endpoint for snapshot history
app.get('/api/v1/drift/history', (req, res) => {
    const duration = req.query.duration || '1h';
    const historyProcess = spawn(ZIG_PARSER_PATH, ['--history', duration]);
    
    let responseData = '';
    historyProcess.stdout.on('data', (data) => {
        responseData += data;
    });

    historyProcess.on('close', () => {
        try {
            res.json(JSON.parse(responseData));
        } catch (e) {
            res.status(500).json({ error: "Failed to parse historical drift data" });
        }
    });
});

// Health check
app.get('/health', (req, res) => {
    res.status(200).send({ status: 'CHRONOS_DRIFT_ONLINE' });
});

// WebSocket connection for real-time 3D visualization
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    socket.on('subscribe_drift', (config) => {
        console.log(`Client ${socket.id} subscribed to drift telemetry:`, config);
        streamDriftData(socket);
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

server.listen(PORT, () => {
    console.log(`Chronos Drift Visualizer API Gateway running on port ${PORT}`);
    console.log(`Binary Parser integration: ${ZIG_PARSER_PATH}`);
});

process.on('SIGTERM', () => {
    server.close(() => {
        console.log('Gateway process terminated');
    });
});