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
        cors: { 
            origin: process.env.NODE_ENV === 'production' ? '*' : "*",
            credentials: true,
            methods: ["GET", "POST"]
        },
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
    const roomHosts = new Map<string, string>() // roomId -> hostSocketId
    const roomCreators = new Map<string, string>() // roomId -> creator userId (from auth)
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
        socket.on("join-room", ({ roomId, userName, userId }) => {
            // Validate inputs
            if (!roomId || !userName || typeof roomId !== 'string' || typeof userName !== 'string') {
                socket.emit("join-error", { message: "Invalid room ID or username" })
                return
            }

            // Ensure username is not a room ID format
            if (userName.includes('-') && userName.length > 10) {
                socket.emit("join-error", { message: "Invalid username format" })
                return
            }

            // Check server capacity
            if (connectedUsers.size >= MAX_TOTAL_USERS) {
                socket.emit("join-error", { message: "Server at capacity" })
                return
            }

            // Get or create room
            if (!rooms.has(roomId)) {
                rooms.set(roomId, new Set())
                // If this is a new room and userId is provided, mark them as creator
                if (userId) {
                    roomCreators.set(roomId, userId)
                    console.log(`🎬 Room ${roomId} created by user ${userId}`)
                }
            }
            const roomSockets = rooms.get(roomId)!
            
            // Check room capacity
            if (roomSockets.size >= MAX_ROOM_SIZE) {
                socket.emit("join-error", { message: "Room is full" })
                return
            }

            // Handle existing sessions - force disconnect old sessions SYNCHRONOUSLY
            const existingSessions = userSessions.get(userName)
            if (existingSessions?.size) {
                console.log(`🔄 Force disconnecting ${existingSessions.size} existing sessions for ${userName}`)
                const oldSessionIds = Array.from(existingSessions)
                oldSessionIds.forEach(oldId => {
                    if (oldId !== socket.id) {
                        // Clean up old session IMMEDIATELY before disconnect
                        const oldUser = connectedUsers.get(oldId)
                        if (oldUser) {
                            // Remove from room FIRST
                            const oldRoomSockets = rooms.get(oldUser.roomId)
                            if (oldRoomSockets) {
                                oldRoomSockets.delete(oldId)
                                console.log(`🗑️ Removed ${oldId} from room ${oldUser.roomId}, remaining: ${oldRoomSockets.size}`)
                            }
                            // Remove from connectedUsers
                            connectedUsers.delete(oldId)
                            console.log(`🗑️ Removed ${oldId} from connectedUsers`)
                            // Remove from connectionHealth
                            connectionHealth.delete(oldId)
                            
                            // Notify room BEFORE disconnect
                            io.to(oldUser.roomId).emit("user-left", {
                                participantId: oldId,
                                userName: userName,
                                timestamp: getCurrentTimestamp(),
                                reason: "duplicate-session",
                            })
                            console.log(`📢 Emitted user-left for ${oldId} to room ${oldUser.roomId}`)
                        }
                        
                        // Now disconnect the socket
                        const oldSocket = io.sockets.sockets.get(oldId)
                        if (oldSocket) {
                            oldSocket.disconnect(true)
                            console.log(`🔌 Disconnected old socket ${oldId}`)
                        }
                    }
                })
                // Clear the session set
                existingSessions.clear()
                console.log(`✅ Cleared all sessions for ${userName}`)
            }

            // Add new session
            if (!userSessions.has(userName)) {
                userSessions.set(userName, new Set())
            }
            userSessions.get(userName)!.add(socket.id)

            socket.join(roomId)
            
            // CRITICAL: Clean up ANY disconnected or duplicate sockets in the room
            // This handles network disconnections where socket.disconnect wasn't called
            const socketsToRemove: string[] = []
            roomSockets.forEach(socketId => {
                // Check if socket is actually connected
                const existingSocket = io.sockets.sockets.get(socketId)
                const existingUser = connectedUsers.get(socketId)
                
                // Remove if: socket doesn't exist, socket is disconnected, or it's an old session of same user
                if (!existingSocket || !existingSocket.connected || 
                    (existingUser && existingUser.name === userName && socketId !== socket.id)) {
                    console.warn(`⚠️ Removing stale/disconnected socket ${socketId} (${existingUser?.name || 'unknown'}) from room ${roomId}`)
                    socketsToRemove.push(socketId)
                }
            })
            
            // Remove all stale sockets
            socketsToRemove.forEach(socketId => {
                roomSockets.delete(socketId)
                connectedUsers.delete(socketId)
                connectionHealth.delete(socketId)
                
                // Notify others that this user left
                const user = connectedUsers.get(socketId)
                socket.to(roomId).emit("user-left", {
                    participantId: socketId,
                    userName: user?.name || 'Unknown',
                    timestamp: getCurrentTimestamp(),
                    reason: "stale-connection",
                })
            })
            
            if (socketsToRemove.length > 0) {
                console.log(`🧹 Cleaned up ${socketsToRemove.length} stale connections from room ${roomId}`)
            }
            
            // Determine host status:
            // 1. If user is the room creator (userId matches), they become host
            // 2. If room is empty (first user), they become host
            // 3. If no current host exists, first user becomes host
            const isRoomCreator = roomSockets.size === 0
            const isCreator = userId && roomCreators.get(roomId) === userId
            const currentHostId = roomHosts.get(roomId)
            const currentHostExists = currentHostId && connectedUsers.has(currentHostId)
            const shouldBeHost = isCreator || isRoomCreator || !currentHostExists
            
            const newUser: User = {
                id: socket.id,
                name: userName,
                roomId: roomId,
                joinedAt: getCurrentTimestamp(),
                lastSeen: getCurrentTimestamp(),
                status: "online",
                isMuted: false,
                isVideoOff: false,
                isHost: shouldBeHost,
                isRaiseHand: false,
            }
            
            // Add to room and set host
            roomSockets.add(socket.id)
            connectedUsers.set(socket.id, newUser)
            
            if (shouldBeHost) {
                // If user is creator and there's an existing host, transfer host role
                if (isCreator && currentHostExists && currentHostId !== socket.id) {
                    const oldHost = connectedUsers.get(currentHostId)
                    if (oldHost) {
                        oldHost.isHost = false
                        connectedUsers.set(currentHostId, oldHost)
                        console.log(`👑 Host role transferred from ${oldHost.name} to creator ${userName}`)
                    }
                }
                roomHosts.set(roomId, socket.id)
                console.log(`👑 ${userName} (${socket.id}) is now the host of room ${roomId}${isCreator ? ' [CREATOR]' : ''}`)
            }

            // 1. Notify existing users about the new user with explicit host status
            socket.to(roomId).emit("user-joined", {
                id: socket.id,
                name: userName,
                isMuted: newUser.isMuted,
                isVideoOff: newUser.isVideoOff,
                isHost: newUser.isHost,
                isRaiseHand: newUser.isRaiseHand,
            })
            
            // If new user is host, notify all participants about host status
            if (newUser.isHost) {
                io.to(roomId).emit("host-status-update", {
                    hostId: socket.id,
                    hostName: userName,
                })
            }

            // 2. Send current participants to the new user (exclude self)
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

            console.log(`✅ ${userName} (${socket.id}) joined room: ${roomId} (${totalParticipants} participants)${isRoomCreator ? ' [HOST]' : ''}`)
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
                roomHosts.set(currentHost.roomId, newHostId)
                connectedUsers.set(socket.id, currentHost)
                connectedUsers.set(newHostId, newHost)
                
                // Broadcast to all including the new host
                io.to(currentHost.roomId).emit("host-changed", {
                    newHostId,
                    newHostName: newHost.name,
                    previousHostId: socket.id,
                    participants: Array.from(rooms.get(currentHost.roomId) || []).map(id => ({
                        id,
                        isHost: id === newHostId
                    }))
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
                    // Clear any typing timeouts if needed

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
                                roomHosts.set(user.roomId, nextHostId)
                                connectedUsers.set(nextHostId, nextHost)
                                io.to(user.roomId).emit("host-changed", {
                                    newHostId: nextHostId,
                                    newHostName: nextHost.name,
                                    previousHostId: socket.id,
                                    participants: Array.from(roomSockets).map(id => ({
                                        id,
                                        isHost: id === nextHostId
                                    }))
                                })
                                console.log(`👑 Host transferred to ${nextHost.name} (${nextHostId})`)
                            }
                        }

                        if (roomSockets.size === 0) {
                            rooms.delete(user.roomId)
                            roomHosts.delete(user.roomId)
                            roomCreators.delete(user.roomId) // Clean up creator mapping
                            console.log(`🏠 Room ${user.roomId} closed (empty) - all data cleared`)
                        }
                    }

                    // Remove user immediately BEFORE emitting to prevent race conditions
                    connectedUsers.delete(socket.id)

                    // Notify others in the room AFTER cleanup
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
                }
                connectionHealth.delete(socket.id)
            } catch (error) {
                console.error("❌ Error in disconnect:", error)
            }
        })

        // Breakout Rooms
        socket.on("start-breakout-rooms", ({ rooms, duration }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("breakout-rooms-created", { rooms })
                io.to(user.roomId).emit("breakout-rooms-started", { duration })
                
                // Assign participants to breakout rooms
                rooms.forEach((room: any) => {
                    room.participants.forEach((participantId: string) => {
                        io.to(participantId).emit("assigned-to-breakout-room", { roomId: room.id })
                    })
                })
                console.log(`🏠 Breakout rooms started by ${user.name}`)
            }
        })

        socket.on("end-breakout-rooms", () => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("breakout-rooms-ended")
                console.log(`🏠 Breakout rooms ended by ${user.name}`)
            }
        })

        // Polls
        socket.on("create-poll", ({ poll }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("poll-created", { poll })
                console.log(`📊 Poll created by ${user.name}: ${poll.question}`)
            }
        })

        socket.on("vote-poll", ({ pollId, participantId, optionIndex }) => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                io.to(user.roomId).emit("poll-vote", { pollId, participantId, optionIndex })
                console.log(`📊 Vote received for poll ${pollId}`)
            }
        })

        socket.on("end-poll", ({ pollId }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("poll-ended", { pollId })
                console.log(`📊 Poll ${pollId} ended by ${user.name}`)
            }
        })

        // Whiteboard
        socket.on("whiteboard-draw", ({ action }) => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                socket.to(user.roomId).emit("whiteboard-draw", { action })
            }
        })

        socket.on("whiteboard-clear", () => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                socket.to(user.roomId).emit("whiteboard-clear")
                console.log(`🎨 Whiteboard cleared by ${user.name}`)
            }
        })

        // File Sharing
        socket.on("share-file", ({ file }) => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                socket.to(user.roomId).emit("file-shared", { file })
                console.log(`📎 File shared by ${user.name}: ${file.name}`)
            }
        })

        socket.on("delete-file", ({ fileId }) => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                io.to(user.roomId).emit("file-deleted", { fileId })
                console.log(`📎 File deleted: ${fileId}`)
            }
        })

        // Q&A
        socket.on("ask-question", ({ question }) => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                socket.to(user.roomId).emit("question-asked", { question })
                console.log(`❓ Question asked by ${user.name}`)
            }
        })

        socket.on("upvote-question", ({ questionId, participantId }) => {
            const user = connectedUsers.get(socket.id)
            if (user) {
                io.to(user.roomId).emit("question-upvoted", { questionId, participantId })
            }
        })

        socket.on("answer-question", ({ questionId, answer, answeredBy }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("question-answered", { questionId, answer, answeredBy })
                console.log(`✅ Question answered by ${user.name}`)
            }
        })

        // Security
        socket.on("toggle-meeting-lock", ({ locked }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("meeting-locked", { locked })
                console.log(`🔒 Meeting ${locked ? 'locked' : 'unlocked'} by ${user.name}`)
            }
        })

        socket.on("toggle-waiting-room", ({ enabled }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("waiting-room-toggled", { enabled })
                console.log(`🚪 Waiting room ${enabled ? 'enabled' : 'disabled'} by ${user.name}`)
            }
        })

        socket.on("toggle-screen-share-restriction", ({ restricted }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("screen-share-restricted", { restricted })
                console.log(`🖥️ Screen share ${restricted ? 'restricted' : 'unrestricted'} by ${user.name}`)
            }
        })

        socket.on("toggle-chat-restriction", ({ restricted }) => {
            const user = connectedUsers.get(socket.id)
            if (user?.isHost) {
                io.to(user.roomId).emit("chat-restricted", { restricted })
                console.log(`💬 Chat ${restricted ? 'restricted' : 'unrestricted'} by ${user.name}`)
            }
        })

        // Screen sharing events
        socket.on("screen-share-started", ({ participantId }) => {
            const user = connectedUsers.get(participantId)
            if (user) {
                socket.to(user.roomId).emit("screen-share-started", { participantId })
                // Automatically spotlight the screen sharer
                io.to(user.roomId).emit("participant-spotlighted", { participantId, participantName: user.name })
                console.log(`🖥️ ${user.name} started screen sharing (auto-spotlighted)`)
            }
        })

        socket.on("screen-share-stopped", ({ participantId }) => {
            const user = connectedUsers.get(participantId)
            if (user) {
                socket.to(user.roomId).emit("screen-share-stopped", { participantId })
                // Automatically remove spotlight when screen sharing stops
                io.to(user.roomId).emit("spotlight-removed")
                console.log(`🖥️ ${user.name} stopped screen sharing (spotlight removed)`)
            }
        })

        // Host spotlight control
        socket.on("host-spotlight-participant", ({ participantId }) => {
            const host = connectedUsers.get(socket.id)
            const participant = connectedUsers.get(participantId)
            if (host?.isHost && participant && host.roomId === participant.roomId) {
                io.to(host.roomId).emit("participant-spotlighted", { participantId, participantName: participant.name })
                console.log(`🌟 Host ${host.name} spotlighted ${participant.name}`)
            }
        })

        socket.on("host-remove-spotlight", () => {
            const host = connectedUsers.get(socket.id)
            if (host?.isHost) {
                io.to(host.roomId).emit("spotlight-removed")
                console.log(`🌟 Host ${host.name} removed spotlight`)
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
