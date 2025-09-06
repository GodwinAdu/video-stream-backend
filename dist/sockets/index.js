"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSocket = void 0;
const socket_io_1 = require("socket.io");
/**
 * Initializes a Socket.IO server with enhanced stability for Render deployment.
 * @param {HttpServer} server - The HTTP server to attach the Socket.IO server to.
 * @returns {Server} The initialized Socket.IO server.
 */
const initSocket = (server) => {
    const io = new socket_io_1.Server(server, {
        cors: {
            origin: "*", // Allow all origins for testing
            methods: ["GET", "POST"],
            credentials: true,
        },
        // Enhanced transport settings for Render stability
        transports: ["websocket", "polling"],
        allowEIO3: true,
        // Optimized connection settings for cloud deployment
        pingTimeout: 180000, // 3 minutes - increased for Render
        pingInterval: 25000, // 25 seconds
        upgradeTimeout: 45000, // 45 seconds for slower connections
        maxHttpBufferSize: 1e6, // 1MB
        // Enhanced compression for better performance
        perMessageDeflate: {
            threshold: 1024,
            concurrencyLimit: 10,
            memLevel: 7,
            serverMaxWindowBits: 15,
            clientMaxWindowBits: 15,
        },
        // Connection management optimizations
        allowUpgrades: true,
        cookie: false,
        // Additional stability settings
        serveClient: false,
        path: "/socket.io/",
        connectTimeout: 45000,
        // Engine.IO specific settings for Render
        allowRequest: (req, callback) => {
            // Add custom validation if needed
            callback(null, true);
        },
    });
    // Enhanced data storage with cleanup mechanisms
    const connectedUsers = new Map(); // socket.id -> User
    const rooms = new Map(); // roomId -> Set<socket.id>
    const typingUsers = new Map(); // For future typing indicators if re-added
    const connectionHealth = new Map();
    const messageBuffer = new Map(); // Buffer messages for reconnection
    // Utility functions
    const generateUserId = () => Math.random().toString(36).substr(2, 9);
    const getCurrentTimestamp = () => new Date().toISOString();
    // Enhanced connection health monitoring
    const monitorConnection = (socket) => {
        const connectionId = socket.id;
        const healthData = {
            connectedAt: Date.now(),
            lastPing: Date.now(),
            pingCount: 0,
            reconnectCount: 0,
            isHealthy: true,
        };
        connectionHealth.set(connectionId, healthData);
        // Adaptive ping monitoring based on connection quality
        let pingIntervalTime = 30000; // Start with 30 seconds
        const pingInterval = setInterval(() => {
            if (socket.connected) {
                const startTime = Date.now();
                socket.emit("ping", {
                    timestamp: startTime,
                    serverLoad: process.cpuUsage(),
                    memoryUsage: process.memoryUsage().heapUsed,
                });
                const timeout = setTimeout(() => {
                    const health = connectionHealth.get(connectionId);
                    if (health) {
                        health.isHealthy = false;
                        health.reconnectCount++;
                        connectionHealth.set(connectionId, health);
                        // Increase ping frequency for unhealthy connections
                        pingIntervalTime = Math.max(15000, pingIntervalTime - 5000);
                        console.warn(`⚠️ Unhealthy connection detected: ${connectionId}`);
                    }
                }, 15000); // 15 second timeout
                socket.once("pong", (data) => {
                    clearTimeout(timeout);
                    const health = connectionHealth.get(connectionId);
                    if (health) {
                        const latency = Date.now() - startTime;
                        health.lastPing = Date.now();
                        health.pingCount++;
                        health.isHealthy = true;
                        health.latency = latency;
                        connectionHealth.set(connectionId, health);
                        // Adjust ping frequency based on latency
                        if (latency < 100) {
                            pingIntervalTime = Math.min(60000, pingIntervalTime + 5000); // Decrease frequency for good connections
                        }
                        else if (latency > 1000) {
                            pingIntervalTime = Math.max(15000, pingIntervalTime - 2000); // Increase frequency for slow connections
                        }
                    }
                });
            }
        }, pingIntervalTime);
        // Cleanup on disconnect
        socket.on("disconnect", () => {
            clearInterval(pingInterval);
            connectionHealth.delete(connectionId);
        });
    };
    // Enhanced graceful shutdown with connection preservation
    const gracefulShutdown = () => {
        console.log("🔄 Graceful shutdown initiated...");
        // Save current state for quick recovery
        const serverState = {
            users: Array.from(connectedUsers.entries()),
            sessions: Array.from(rooms.entries()),
            timestamp: getCurrentTimestamp(),
        };
        // Notify all clients about server shutdown with recovery info
        io.emit("server-shutdown", {
            message: "Server is restarting, please reconnect in a moment",
            timestamp: getCurrentTimestamp(),
            recoveryData: serverState,
            expectedDowntime: 30000, // 30 seconds
        });
        // Gracefully close connections
        const closeTimeout = setTimeout(() => {
            console.log("⚠️ Force closing connections...");
            io.close();
        }, 5000);
        io.close(() => {
            clearTimeout(closeTimeout);
            console.log("✅ All connections closed gracefully");
            server.close(() => {
                console.log("✅ Server closed");
                process.exit(0);
            });
        });
        // Ultimate force exit
        setTimeout(() => {
            console.log("⚠️ Forcing exit...");
            process.exit(1);
        }, 15000);
    };
    // Enhanced process signal handling
    const signals = ["SIGTERM", "SIGINT", "SIGUSR2", "SIGHUP"];
    signals.forEach((signal) => {
        process.on(signal, () => {
            console.log(`📡 Received ${signal}, initiating graceful shutdown...`);
            gracefulShutdown();
        });
    });
    // Enhanced error handling
    process.on("uncaughtException", (error) => {
        console.error("❌ Uncaught Exception:", error);
        // Don't immediately shutdown, try to recover
        setTimeout(() => {
            if (process.listenerCount("uncaughtException") <= 1) {
                gracefulShutdown();
            }
        }, 1000);
    });
    process.on("unhandledRejection", (reason, promise) => {
        console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
        // Log but don't shutdown for unhandled rejections
    });
    // Memory management and cleanup
    const performCleanup = () => {
        const now = Date.now();
        const staleThreshold = 10 * 60 * 1000; // 10 minutes
        let cleanedCount = 0;
        // Clean up stale connections
        connectionHealth.forEach((health, socketId) => {
            if (now - health.lastPing > staleThreshold) {
                connectionHealth.delete(socketId);
                connectedUsers.delete(socketId);
                typingUsers.delete(socketId);
                cleanedCount++;
            }
        });
        // Clean up empty sessions
        rooms.forEach((users, roomId) => {
            if (users.size === 0) {
                rooms.delete(roomId);
            }
        });
        // Clean up message buffers
        messageBuffer.forEach((messages, userId) => {
            if (messages.length > 100) {
                messageBuffer.set(userId, messages.slice(-50));
            }
        });
        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} stale connections`);
        }
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
        }
    };
    // Run cleanup every 2 minutes
    setInterval(performCleanup, 120000);
    // Enhanced connection handling
    io.on("connection", (socket) => {
        console.log(`✅ Client connected: ${socket.id} from ${socket.handshake.address}`);
        // Start enhanced connection monitoring
        monitorConnection(socket);
        // Send enhanced connection confirmation
        socket.emit("connection-confirmed", {
            socketId: socket.id,
            timestamp: getCurrentTimestamp(),
            serverTime: Date.now(),
            serverVersion: "2.0.0",
            features: ["typing-indicators", "reactions", "presence", "reconnection"],
        });
        // WebRTC: Join Room
        socket.on("join-room", ({ roomId, userName }) => {
            socket.join(roomId);
            const newUser = {
                id: socket.id,
                name: userName,
                roomId: roomId,
                joinedAt: getCurrentTimestamp(),
                lastSeen: getCurrentTimestamp(),
                status: "online",
                isMuted: false,
                isVideoOff: false,
                isHost: false, // Host logic can be added here
                isRaiseHand: false,
            };
            connectedUsers.set(socket.id, newUser);
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set());
            }
            const roomSockets = rooms.get(roomId);
            roomSockets.add(socket.id);
            // 1. Notify existing users about the new user
            socket.to(roomId).emit("user-joined", {
                id: socket.id,
                name: userName,
                isMuted: newUser.isMuted,
                isVideoOff: newUser.isVideoOff,
                isHost: newUser.isHost,
                isRaiseHand: newUser.isRaiseHand,
            });
            // 2. Send current participants to the new user
            const currentParticipants = Array.from(roomSockets)
                .filter((id) => id !== socket.id)
                .map((id) => {
                const user = connectedUsers.get(id);
                return {
                    id: id,
                    name: user?.name || `User ${id}`,
                    isMuted: user?.isMuted || false,
                    isVideoOff: user?.isVideoOff || false,
                    isHost: user?.isHost || false,
                    isRaiseHand: user?.isRaiseHand || false,
                };
            });
            socket.emit("current-participants", currentParticipants);
            console.log(`${userName} (${socket.id}) joined room: ${roomId}`);
        });
        // WebRTC: Offer
        socket.on("offer", ({ offer, targetId, senderId }) => {
            socket.to(targetId).emit("offer", { offer, senderId });
            // console.log(`Offer from ${senderId} to ${targetId}`)
        });
        // WebRTC: Answer
        socket.on("answer", ({ answer, targetId, senderId }) => {
            socket.to(targetId).emit("answer", { answer, senderId });
            // console.log(`Answer from ${senderId} to ${targetId}`)
        });
        // WebRTC: ICE Candidate
        socket.on("ice-candidate", ({ candidate, targetId, senderId }) => {
            socket.to(targetId).emit("ice-candidate", { candidate, senderId });
            // console.log(`ICE candidate from ${senderId} to ${targetId}`)
        });
        // WebRTC: Mute Toggle
        socket.on("user-muted", ({ participantId, isMuted }) => {
            const user = connectedUsers.get(participantId);
            if (user) {
                user.isMuted = isMuted; // Update server state
                socket.to(user.roomId).emit("user-muted", { participantId, isMuted });
                console.log(`User ${user.name} muted: ${isMuted}`);
            }
        });
        // WebRTC: Video Toggle
        socket.on("user-video-toggled", ({ participantId, isVideoOff }) => {
            const user = connectedUsers.get(participantId);
            if (user) {
                user.isVideoOff = isVideoOff; // Update server state
                socket.to(user.roomId).emit("user-video-toggled", { participantId, isVideoOff });
                console.log(`User ${user.name} video off: ${isVideoOff}`);
            }
        });
        // WebRTC: Raise Hand Toggle
        socket.on("raise-hand-toggled", ({ participantId, isRaiseHand }) => {
            const user = connectedUsers.get(participantId);
            if (user) {
                user.isRaiseHand = isRaiseHand; // Update server state
                socket.to(user.roomId).emit("raise-hand-toggled", { participantId, isRaiseHand });
                console.log(`User ${user.name} raise hand: ${isRaiseHand}`);
            }
        });
        // WebRTC: Reaction
        socket.on("reaction", ({ emoji, senderId, timestamp }) => {
            const user = connectedUsers.get(senderId);
            if (user) {
                // Broadcast reaction to everyone in the room
                io.to(user.roomId).emit("reaction-received", { emoji, senderId, userName: user.name, timestamp });
                console.log(`Reaction from ${user.name}: ${emoji}`);
            }
        });
        // WebRTC: Chat Message
        socket.on("chat-message", ({ message, senderId, timestamp }) => {
            const user = connectedUsers.get(senderId);
            if (user) {
                // Broadcast chat message to everyone in the room
                io.to(user.roomId).emit("chat-message", { message, senderId, userName: user.name, timestamp });
                console.log(`Chat message from ${user.name}: ${message}`);
            }
        });
        // Enhanced ping/pong handling (client-initiated)
        socket.on("ping", (data) => {
            try {
                const health = connectionHealth.get(socket.id);
                socket.emit("pong", {
                    timestamp: getCurrentTimestamp(),
                    serverTime: Date.now(),
                    clientTime: data?.timestamp,
                    connectionHealth: health
                        ? {
                            latency: health.latency,
                            pingCount: health.pingCount,
                            isHealthy: health.isHealthy,
                        }
                        : null,
                });
            }
            catch (error) {
                console.error("❌ Error in ping:", error);
            }
        });
        // Enhanced reconnection handling
        socket.on("reconnect-request", (data) => {
            try {
                console.log(`🔄 Reconnection request from ${socket.id}`);
                const user = connectedUsers.get(socket.id);
                const health = connectionHealth.get(socket.id);
                socket.emit("reconnect-response", {
                    success: true,
                    timestamp: getCurrentTimestamp(),
                    serverTime: Date.now(),
                    userData: user,
                    connectionHealth: health,
                    bufferedMessages: messageBuffer.get(socket.id) || [],
                });
            }
            catch (error) {
                console.error("❌ Error in reconnect-request:", error);
            }
        });
        // Enhanced disconnection handling
        socket.on("disconnect", (reason) => {
            try {
                console.log(`❌ Client disconnected: ${socket.id}, reason: ${reason}`);
                const user = connectedUsers.get(socket.id);
                if (user) {
                    // Clear typing timeout (if implemented)
                    if (typingUsers.has(socket.id)) {
                        clearTimeout(typingUsers.get(socket.id));
                        typingUsers.delete(socket.id);
                    }
                    // Remove from room tracking
                    const roomSockets = rooms.get(user.roomId);
                    if (roomSockets) {
                        roomSockets.delete(socket.id);
                        if (roomSockets.size === 0) {
                            rooms.delete(user.roomId);
                        }
                    }
                    // Notify others in the room
                    socket.to(user.roomId).emit("user-left", {
                        participantId: socket.id,
                        userName: user.name,
                        timestamp: getCurrentTimestamp(),
                        reason: reason,
                    });
                    // Update user count
                    const remainingUsers = Array.from(connectedUsers.values()).filter((u) => u.roomId === user.roomId && u.id !== socket.id);
                    io.to(user.roomId).emit("user-count", remainingUsers.length);
                    console.log(`👋 ${user.name} left room: ${user.roomId}`);
                    // Keep user data for potential reconnection (for 5 minutes)
                    setTimeout(() => {
                        connectedUsers.delete(socket.id);
                        messageBuffer.delete(socket.id);
                    }, 5 * 60 * 1000);
                }
                connectionHealth.delete(socket.id);
            }
            catch (error) {
                console.error("❌ Error in disconnect:", error);
            }
        });
        // Enhanced error handling
        socket.on("error", (error) => {
            console.error(`❌ Socket error for ${socket.id}:`, error);
            // Try to recover from certain errors
            if (error.message.includes("transport")) {
                socket.emit("connection-recovery", {
                    message: "Transport error detected, attempting recovery",
                    timestamp: getCurrentTimestamp(),
                });
            }
        });
    });
    // Server health monitoring
    const logServerHealth = () => {
        const memUsage = process.memoryUsage();
        const cpuUsage = process.cpuUsage();
        console.log(`💓 Server Health - Users: ${connectedUsers.size}, Rooms: ${rooms.size}, Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
        // Alert if memory usage is high
        if (memUsage.heapUsed > 500 * 1024 * 1024) {
            // 500MB
            console.warn(`⚠️ High memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
            performCleanup();
        }
    };
    // Log server health every 30 seconds
    setInterval(logServerHealth, 30000);
    console.log("🚀 Enhanced Socket.IO Server initialized with stability improvements");
    return io;
};
exports.initSocket = initSocket;
