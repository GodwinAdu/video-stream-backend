import type { Server as HttpServer } from "http"
import { Server, type Socket } from "socket.io"

interface User {
    id: string // Socket ID
    name: string
    roomId: string // Renamed sessionId to roomId for clarity in WebRTC context
    joinedAt: string
    lastSeen: string
    status: "online" | "offline" // Simplified status for video call
    isMuted: boolean
    isVideoOff: boolean
    isHost: boolean
    isRaiseHand: boolean
    // connectionHealth?: ConnectionHealth // Removed from User interface, managed separately
}

interface ConnectionHealth {
    connectedAt: number
    lastPing: number
    pingCount: number
    reconnectCount: number
    isHealthy: boolean
    latency?: number
}

/**
 * Initializes a Socket.IO server with enhanced stability for Render deployment.
 * @param {HttpServer} server - The HTTP server to attach the Socket.IO server to.
 * @returns {Server} The initialized Socket.IO server.
 */
export const initSocket = (server: HttpServer): Server => {
    const io = new Server(server, {
        cors: { origin: "*" },
        transports: ["websocket", "polling"],
        pingTimeout: 30000,
        pingInterval: 15000,
        upgradeTimeout: 10000,
        maxHttpBufferSize: 5e5,
        allowUpgrades: true,
        cookie: false,
        serveClient: false,
        connectTimeout: 20000,
    })

    // Optimized data storage
    const connectedUsers = new Map<string, User>()
    const userSessions = new Map<string, Set<string>>()
    const rooms = new Map<string, Set<string>>()
    const connectionHealth = new Map<string, ConnectionHealth>()
    
    // Room limits for scalability
    const MAX_ROOM_SIZE = 50
    const MAX_TOTAL_USERS = 1000

    // Utility functions
    const generateUserId = (): string => Math.random().toString(36).substr(2, 9)
    const getCurrentTimestamp = (): string => new Date().toISOString()

    // Enhanced connection health monitoring
    const monitorConnection = (socket: Socket): void => {

        const connectionId = socket.id
        const healthData: ConnectionHealth = {

            connectedAt: Date.now(),
            lastPing: Date.now(),
            pingCount: 0,
            reconnectCount: 0,
            isHealthy: true,
        }
        connectionHealth.set(connectionId, healthData)

        // Adaptive ping monitoring based on connection quality
        let pingIntervalTime = 30000 // Start with 30 seconds
        const pingInterval = setInterval(() => {

            if (socket.connected) {

                const startTime = Date.now()
                socket.emit("ping", {

                    timestamp: startTime,
                    serverLoad: process.cpuUsage(),
                    memoryUsage: process.memoryUsage().heapUsed,
                })
                const timeout = setTimeout(() => {

                    const health = connectionHealth.get(connectionId)
                    if (health) {
                        health.isHealthy = false
                        health.reconnectCount++
                        connectionHealth.set(connectionId, health)
                        // Increase ping frequency for unhealthy connections
                        pingIntervalTime = Math.max(15000, pingIntervalTime - 5000)
                        console.warn(`⚠️ Unhealthy connection detected: ${connectionId}`)
                    }
                }, 15000) // 15 second timeout

                socket.once("pong", (data: any) => {
                    clearTimeout(timeout)
                    const health = connectionHealth.get(connectionId)
                    if (health) {

                        const latency = Date.now() - startTime
                        health.lastPing = Date.now()
                        health.pingCount++
                        health.isHealthy = true
                        health.latency = latency
                        connectionHealth.set(connectionId, health)
                        // Adjust ping frequency based on latency
                        if (latency < 100) {

                            pingIntervalTime = Math.min(60000, pingIntervalTime + 5000) // Decrease frequency for good connections
                        } else if (latency > 1000) {
                            pingIntervalTime = Math.max(15000, pingIntervalTime - 2000) // Increase frequency for slow connections
                        }
                    }
                })
            }
        }, pingIntervalTime)

        // Cleanup on disconnect
        socket.on("disconnect", () => {
            clearInterval(pingInterval)
            connectionHealth.delete(connectionId)
        })
    }

    // Enhanced graceful shutdown with connection preservation
    const gracefulShutdown = (): void => {
        console.log("🔄 Graceful shutdown initiated...")

        // Save current state for quick recovery
        const serverState = {

            users: Array.from(connectedUsers.entries()),
            sessions: Array.from(rooms.entries()),
            timestamp: getCurrentTimestamp(),
        }

        // Notify all clients about server shutdown with recovery info
        io.emit("server-shutdown", {
            message: "Server is restarting, please reconnect in a moment",
            timestamp: getCurrentTimestamp(),
            recoveryData: serverState,
            expectedDowntime: 30000, // 30 seconds
        })

        // Gracefully close connections
        const closeTimeout = setTimeout(() => {
            console.log("⚠️ Force closing connections...")
            io.close()
        }, 5000)

        io.close(() => {
            clearTimeout(closeTimeout)
            console.log("✅ All connections closed gracefully")
            server.close(() => {
                console.log("✅ Server closed")
                process.exit(0)
            })
        })

        // Ultimate force exit
        setTimeout(() => {
            console.log("⚠️ Forcing exit...")
            process.exit(1)
        }, 15000)
    }

    // Enhanced process signal handling
    const signals = ["SIGTERM", "SIGINT", "SIGUSR2", "SIGHUP"]
    signals.forEach((signal) => {
        process.on(signal, () => {
            console.log(`📡 Received ${signal}, initiating graceful shutdown...`)
            gracefulShutdown()
        })
    })

    // Enhanced error handling
    process.on("uncaughtException", (error) => {
        console.error("❌ Uncaught Exception:", error)
        // Don't immediately shutdown, try to recover
        setTimeout(() => {

            if (process.listenerCount("uncaughtException") <= 1) {

                gracefulShutdown()
            }
        }, 1000)
    })

    process.on("unhandledRejection", (reason, promise) => {
        console.error("❌ Unhandled Rejection at:", promise, "reason:", reason)
        // Log but don't shutdown for unhandled rejections
    })

    // Optimized cleanup
    const performCleanup = (): void => {
        const now = Date.now()
        const staleThreshold = 5 * 60 * 1000 // 5 minutes
        let cleaned = 0

        // Clean stale connections
        for (const [socketId, health] of connectionHealth) {
            if (now - health.lastPing > staleThreshold) {
                connectionHealth.delete(socketId)
                connectedUsers.delete(socketId)
                cleaned++
            }
        }

        // Clean empty rooms
        for (const [roomId, users] of rooms) {
            if (users.size === 0) rooms.delete(roomId)
        }

        if (cleaned > 0) console.log(`🧹 Cleaned ${cleaned} stale connections`)
        if (global.gc) global.gc()
    }

    // Run cleanup every minute
    setInterval(performCleanup, 60000)

    // Enhanced connection handling
    io.on("connection", (socket: Socket) => {
        console.log(`✅ Client connected: ${socket.id} from ${socket.handshake.address}`)

        // Start enhanced connection monitoring
        monitorConnection(socket)

        // Send enhanced connection confirmation
        socket.emit("connection-confirmed", {
            socketId: socket.id,
            timestamp: getCurrentTimestamp(),
            serverTime: Date.now(),
            serverVersion: "2.0.0",
            features: ["typing-indicators", "reactions", "presence", "reconnection"],
        })

        // Optimized join room with limits
        socket.on("join-room", ({ roomId, userName }) => {
            // Check server capacity
            if (connectedUsers.size >= MAX_TOTAL_USERS) {
                socket.emit("join-error", { message: "Server at capacity" })
                return
            }
            
            // Check room capacity
            const roomSockets = rooms.get(roomId) || new Set()
            if (roomSockets.size >= MAX_ROOM_SIZE) {
                socket.emit("join-error", { message: "Room is full" })
                return
            }
            
            // Handle existing sessions efficiently
            const existingSessions = userSessions.get(userName)
            if (existingSessions?.size) {
                existingSessions.forEach(oldId => {
                    if (oldId !== socket.id) {
                        io.sockets.sockets.get(oldId)?.disconnect(true)
                    }
                })
                existingSessions.clear()
            }
            
            (userSessions.get(userName) || new Set()).add(socket.id)
            userSessions.set(userName, userSessions.get(userName) || new Set())
            
            socket.join(roomId)
            const newUser: User = {
                id: socket.id,
                name: userName,
                roomId: roomId,
                joinedAt: getCurrentTimestamp(),
                lastSeen: getCurrentTimestamp(),
                status: "online",
                isMuted: false,
                isVideoOff: false,
                isHost: false,
                isRaiseHand: false,
            }
            connectedUsers.set(socket.id, newUser)

            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set())
            }
            const roomSockets = rooms.get(roomId)!
            roomSockets.add(socket.id)

            // Check if user should be host (first in room or rejoining as host)
            const isFirstInRoom = roomSockets.size === 1
            if (isFirstInRoom) {
                newUser.isHost = true
                connectedUsers.set(socket.id, newUser)
            }

            // 1. Notify existing users about the new user
            socket.to(roomId).emit("user-joined", {
                id: socket.id,
                name: userName,
                isMuted: newUser.isMuted,
                isVideoOff: newUser.isVideoOff,
                isHost: newUser.isHost,
                isRaiseHand: newUser.isRaiseHand,
            })

            // 2. Send current participants to the new user
            const currentParticipants = Array.from(roomSockets)
                .filter((id) => id !== socket.id)
                .map((id) => {
                    const user = connectedUsers.get(id)
                    return {
                        id: id,
                        name: user?.name || `User ${id}`,
                        isMuted: user?.isMuted || false,
                        isVideoOff: user?.isVideoOff || false,
                        isHost: user?.isHost || false,
                        isRaiseHand: user?.isRaiseHand || false,
                    }
                })
            socket.emit("current-participants", currentParticipants)

            // 3. Send updated participant count to all users in room
            const totalParticipants = roomSockets.size
            io.to(roomId).emit("participant-count", totalParticipants)

            console.log(`✅ ${userName} (${socket.id}) joined room: ${roomId} (${totalParticipants} participants)${isFirstInRoom ? ' [HOST]' : ''}`)
        })

        // Optimized WebRTC signaling
        socket.on("offer", ({ offer, targetId }) => {
            socket.to(targetId).emit("offer", { offer, senderId: socket.id })
        })

        socket.on("answer", ({ answer, targetId }) => {
            socket.to(targetId).emit("answer", { answer, senderId: socket.id })
        })

        socket.on("ice-candidate", ({ candidate, targetId }) => {
            socket.to(targetId).emit("ice-candidate", { candidate, senderId: socket.id })
        })

        // WebRTC: Mute Toggle
        socket.on("user-muted", ({ participantId, isMuted }) => {

            const user = connectedUsers.get(participantId)
            if (user) {
                user.isMuted = isMuted // Update server state
                socket.to(user.roomId).emit("user-muted", { participantId, isMuted })
                console.log(`User ${user.name} muted: ${isMuted}`)
            }
        })

        // WebRTC: Video Toggle
        socket.on("user-video-toggled", ({ participantId, isVideoOff }) => {

            const user = connectedUsers.get(participantId)
            if (user) {
                user.isVideoOff = isVideoOff // Update server state
                socket.to(user.roomId).emit("user-video-toggled", { participantId, isVideoOff })
                console.log(`User ${user.name} video off: ${isVideoOff}`)
            }
        })

        // WebRTC: Raise Hand Toggle
        socket.on("raise-hand-toggled", ({ participantId, isRaiseHand }) => {

            const user = connectedUsers.get(participantId)
            if (user) {
                user.isRaiseHand = isRaiseHand // Update server state
                socket.to(user.roomId).emit("raise-hand-toggled", { participantId, isRaiseHand })
                console.log(`User ${user.name} raise hand: ${isRaiseHand}`)
            }
        })

        // WebRTC: Reaction
        socket.on("reaction", ({ emoji, senderId, timestamp }) => {

            const user = connectedUsers.get(senderId)
            if (user) {
                // Broadcast reaction to everyone in the room
                io.to(user.roomId).emit("reaction-received", { emoji, senderId, userName: user.name, timestamp })
                console.log(`Reaction from ${user.name}: ${emoji}`)
            }
        })

        // WebRTC: Chat Message
        socket.on("chat-message", ({ message, senderId, timestamp }) => {
            const user = connectedUsers.get(senderId)
            if (user) {
                // Broadcast chat message to everyone in the room
                io.to(user.roomId).emit("chat-message", { message, senderId, userName: user.name, timestamp })
                console.log(`Chat message from ${user.name}: ${message}`)
            }
        })

        // Typing indicators
        socket.on("typing", ({ isTyping }) => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                socket.to(user.roomId).emit("user-typing", { 
                    userName: user.name, 
                    isTyping 
                })
            }
        })

        // Host Controls
        socket.on("host-mute-participant", ({ participantId, mute }) => {
            const host = connectedUsers.get(socket.id)
            const participant = connectedUsers.get(participantId)
            if (host?.isHost && participant && host.roomId === participant.roomId) {
                participant.isMuted = mute
                io.to(participant.roomId).emit("participant-force-muted", { participantId, mute })
                console.log(`Host ${host.name} ${mute ? 'muted' : 'unmuted'} ${participant.name}`)
            }
        })

        socket.on("host-toggle-video", ({ participantId, videoOff }) => {
            const host = connectedUsers.get(socket.id)
            const participant = connectedUsers.get(participantId)
            if (host?.isHost && participant && host.roomId === participant.roomId) {
                participant.isVideoOff = videoOff
                io.to(participant.roomId).emit("participant-force-video-toggle", { participantId, videoOff })
                console.log(`Host ${host.name} ${videoOff ? 'disabled' : 'enabled'} video for ${participant.name}`)
            }
        })

        socket.on("host-remove-participant", ({ participantId }) => {
            const host = connectedUsers.get(socket.id)
            const participant = connectedUsers.get(participantId)
            if (host?.isHost && participant && host.roomId === participant.roomId) {
                const targetSocket = io.sockets.sockets.get(participantId)
                if (targetSocket) {
                    targetSocket.emit("force-disconnect", {
                        reason: "removed-by-host",
                        message: `You were removed from the meeting by ${host.name}`
                    })
                    targetSocket.disconnect(true)
                    console.log(`Host ${host.name} removed ${participant.name} from meeting`)
                }
            }
        })

        socket.on("host-transfer", ({ newHostId }) => {
            const currentHost = connectedUsers.get(socket.id)
            const newHost = connectedUsers.get(newHostId)
            if (currentHost?.isHost && newHost && currentHost.roomId === newHost.roomId) {
                currentHost.isHost = false
                newHost.isHost = true
                connectedUsers.set(socket.id, currentHost)
                connectedUsers.set(newHostId, newHost)
                io.to(currentHost.roomId).emit("host-changed", {
                    newHostId,
                    newHostName: newHost.name,
                    previousHostId: socket.id
                })
                console.log(`Host transferred from ${currentHost.name} to ${newHost.name}`)
            }
        })

        socket.on("rename-participant", ({ participantId, newName }) => {
            const requester = connectedUsers.get(socket.id)
            const participant = connectedUsers.get(participantId)
            if (participant && requester && 
                (requester.isHost || participantId === socket.id) && 
                requester.roomId === participant.roomId) {
                const oldName = participant.name
                participant.name = newName
                connectedUsers.set(participantId, participant)
                io.to(participant.roomId).emit("participant-renamed", {
                    participantId,
                    oldName,
                    newName
                })
                console.log(`${oldName} renamed to ${newName}`)
            }
        })

        // Enhanced ping/pong handling (client-initiated)
        socket.on("ping", (data) => {
            try {

                const health = connectionHealth.get(socket.id)
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
                })
            } catch (error) {
                console.error("❌ Error in ping:", error)
            }
        })

        // Enhanced reconnection handling
        socket.on("reconnect-request", (data) => {
            try {

                console.log(`🔄 Reconnection request from ${socket.id}`)
                const user = connectedUsers.get(socket.id)
                const health = connectionHealth.get(socket.id)

                socket.emit("reconnect-response", {
                    success: true,
                    timestamp: getCurrentTimestamp(),
                    serverTime: Date.now(),
                    userData: user,
                    connectionHealth: health,
                    bufferedMessages: messageBuffer.get(socket.id) || [],
                })
            } catch (error) {
                console.error("❌ Error in reconnect-request:", error)
            }
        })

        // Enhanced disconnection handling with session cleanup
        socket.on("disconnect", (reason) => {
            try {
                console.log(`❌ Client disconnected: ${socket.id}, reason: ${reason}`)
                const user = connectedUsers.get(socket.id)
                if (user) {
                    // Clear typing timeout (if implemented)
                    if (typingUsers.has(socket.id)) {
                        clearTimeout(typingUsers.get(socket.id)!)
                        typingUsers.delete(socket.id)
                    }

                    // Remove from user sessions
                    const userSessionSet = userSessions.get(user.name)
                    if (userSessionSet) {
                        userSessionSet.delete(socket.id)
                        if (userSessionSet.size === 0) {
                            userSessions.delete(user.name)
                        }
                    }

                    // Remove from room tracking
                    const roomSockets = rooms.get(user.roomId)
                    if (roomSockets) {
                        roomSockets.delete(socket.id)
                        
                        // If user was host and others remain, transfer host to next user
                        if (user.isHost && roomSockets.size > 0) {
                            const nextHostId = Array.from(roomSockets)[0]
                            const nextHost = connectedUsers.get(nextHostId)
                            if (nextHost) {
                                nextHost.isHost = true
                                connectedUsers.set(nextHostId, nextHost)
                                io.to(user.roomId).emit("host-changed", {
                                    newHostId: nextHostId,
                                    newHostName: nextHost.name
                                })
                                console.log(`👑 Host transferred to ${nextHost.name} (${nextHostId})`)
                            }
                        }
                        
                        if (roomSockets.size === 0) {
                            rooms.delete(user.roomId)
                            console.log(`🏠 Room ${user.roomId} closed (empty)`)
                        }
                    }

                    // Notify others in the room
                    socket.to(user.roomId).emit("user-left", {
                        participantId: socket.id,
                        userName: user.name,
                        timestamp: getCurrentTimestamp(),
                        reason: reason,
                    })

                    // Update participant count
                    const userRoomSockets = rooms.get(user.roomId)
                    const participantCount = userRoomSockets ? userRoomSockets.size : 0
                    io.to(user.roomId).emit("participant-count", participantCount)
                    console.log(`👋 ${user.name} left room: ${user.roomId} (${participantCount} remaining)`)

                    // Keep user data for potential reconnection (for 2 minutes)
                    setTimeout(() => {
                        connectedUsers.delete(socket.id)
                        messageBuffer.delete(socket.id)
                    }, 2 * 60 * 1000)
                }
                connectionHealth.delete(socket.id)
            } catch (error) {
                console.error("❌ Error in disconnect:", error)
            }
        })

        // Enhanced error handling
        socket.on("error", (error) => {
            console.error(`❌ Socket error for ${socket.id}:`, error)
            // Try to recover from certain errors
            if (error.message.includes("transport")) {
                socket.emit("connection-recovery", {
                    message: "Transport error detected, attempting recovery",
                    timestamp: getCurrentTimestamp(),
                })
            }
        })
    })

    // Server health monitoring
    const logServerHealth = () => {
        const memUsage = process.memoryUsage()
        const cpuUsage = process.cpuUsage()
        console.log(
            `💓 Server Health - Users: ${connectedUsers.size}, Rooms: ${rooms.size}, Memory: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
        )
        // Alert if memory usage is high
        if (memUsage.heapUsed > 500 * 1024 * 1024) {
            // 500MB
            console.warn(`⚠️ High memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`)
            performCleanup()
        }
    }

    // Log server health every 30 seconds
    setInterval(logServerHealth, 30000)

    console.log("🚀 Enhanced Socket.IO Server initialized with stability improvements")
    return io
}
