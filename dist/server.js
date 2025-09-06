"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = exports.server = exports.app = void 0;
const express_1 = __importDefault(require("express"));
const http_1 = require("http");
const cors_1 = __importDefault(require("cors"));
const sockets_1 = require("./sockets");
const app = (0, express_1.default)();
exports.app = app;
const server = (0, http_1.createServer)(app);
exports.server = server;
// Enhanced CORS configuration
app.use((0, cors_1.default)({
    origin: [
        "http://localhost:3000",
        "https://carpentary2025.vercel.app",
        /\.vercel\.app$/,
        /\.netlify\.app$/,
        /\.render\.com$/,
    ],
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));
app.use(express_1.default.json({ limit: "10mb" }));
app.use(express_1.default.urlencoded({ extended: true, limit: "10mb" }));
// Initialize Socket.IO with enhanced stability
const io = (0, sockets_1.initSocket)(server);
exports.io = io;
// Enhanced health check endpoint
app.get("/health", (req, res) => {
    const memUsage = process.memoryUsage();
    const uptime = process.uptime();
    res.status(200).json({
        status: "ok",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime),
        memory: {
            used: Math.round(memUsage.heapUsed / 1024 / 1024),
            total: Math.round(memUsage.heapTotal / 1024 / 1024),
            external: Math.round(memUsage.external / 1024 / 1024),
        },
        connections: io.engine.clientsCount,
        version: "2.0.0",
        environment: process.env.NODE_ENV || "development",
    });
});
// Keep-alive endpoint for monitoring services
app.get("/ping", (req, res) => {
    res.status(200).json({
        message: "pong",
        timestamp: new Date().toISOString(),
        serverTime: Date.now(),
    });
});
// Server statistics endpoint
app.get("/api/stats", (req, res) => {
    const stats = {
        connections: io.engine.clientsCount,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date().toISOString(),
        version: "2.0.0",
        transport: {
            websocket: 0,
            polling: 0,
        },
    };
    // Count transport types
    Object.values(io.sockets.sockets).forEach((socket) => {
        const transportName = socket.conn.transport.name;
        if (transportName === "websocket") {
            stats.transport.websocket++;
        }
        else if (transportName === "polling") {
            stats.transport.polling++;
        }
    });
    res.json(stats);
});
// Root endpoint
app.get("/", (req, res) => {
    res.json({
        message: "Real-time Video Streaming Server v2.0",
        status: "running",
        timestamp: new Date().toISOString(),
        uptime: Math.floor(process.uptime()),
        connections: io.engine.clientsCount,
        features: [
            "Enhanced stability for Render",
            "Connection health monitoring",
            "Automatic reconnection",
            "Message buffering",
            "Rate limiting",
            "Memory optimization",
        ],
    });
});
// Error handling middleware
app.use((err, req, res, next) => {
    console.error("❌ Express error:", err);
    res.status(500).json({
        error: "Internal server error",
        timestamp: new Date().toISOString(),
    });
});
// 404 handler
app.use((req, res) => {
    res.status(404).json({
        error: "Not found",
        path: req.path,
        timestamp: new Date().toISOString(),
    });
});
const PORT = process.env.PORT || 4000;
// Enhanced server startup
server.listen(PORT, () => {
    console.log(`🚀 Enhanced Server running on port ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
    console.log(`📊 Process ID: ${process.pid}`);
    console.log(`💾 Node version: ${process.version}`);
    // Log initial memory usage
    const memUsage = process.memoryUsage();
    console.log(`💾 Initial memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
});
// Handle server errors
server.on("error", (error) => {
    console.error("❌ Server error:", error);
    if (error.code === "EADDRINUSE") {
        console.error(`❌ Port ${PORT} is already in use`);
        process.exit(1);
    }
});
