import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import UserModel from '../models/User'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production'
const JWT_EXPIRES_IN = '7d'

export interface User {
  id: string
  email: string
  name: string
  personalRoomId: string
  personalRoomPassword?: string
  profile: {
    avatar?: string
    title?: string
    company?: string
    timezone: string
  }
  meetingSettings: {
    waitingRoom: boolean
    muteOnEntry: boolean
    videoOnEntry: boolean
    allowScreenShare: boolean
    recordingEnabled: boolean
    chatEnabled: boolean
    maxParticipants: number
  }
  subscription: {
    plan: 'free' | 'pro' | 'business'
    meetingDuration: number
    cloudStorage: number
  }
  createdAt: string
}

export interface AuthToken {
  token: string
  user: User
}

export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, 10)
}

export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}

export const generateToken = (user: User): string => {
  return jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN })
}

export const verifyToken = async (token: string): Promise<User | null> => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; email: string }
    const user = await UserModel.findById(decoded.id)
    if (!user) return null
    return { 
      id: user._id.toString(), 
      email: user.email, 
      name: user.name, 
      personalRoomId: user.personalRoomId,
      personalRoomPassword: user.personalRoomPassword,
      profile: user.profile,
      meetingSettings: user.meetingSettings,
      subscription: user.subscription,
      createdAt: user.createdAt.toISOString() 
    }
  } catch {
    return null
  }
}

export const registerUser = async (email: string, password: string, name: string): Promise<AuthToken | null> => {
  const existing = await UserModel.findOne({ email })
  if (existing) return null

  const hashedPassword = await hashPassword(password)
  // Generate unique personal room ID
  const personalRoomId = `${name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}`
  
  // Default user settings
  const defaultProfile = { timezone: 'UTC' }
  const defaultMeetingSettings = {
    waitingRoom: true,
    muteOnEntry: true,
    videoOnEntry: false,
    allowScreenShare: true,
    recordingEnabled: false,
    chatEnabled: true,
    maxParticipants: 100
  }
  const defaultSubscription = {
    plan: 'free' as const,
    meetingDuration: 40,
    cloudStorage: 1
  }
  
  const user = await UserModel.create({ 
    email, 
    name, 
    password: hashedPassword, 
    personalRoomId,
    profile: defaultProfile,
    meetingSettings: defaultMeetingSettings,
    subscription: defaultSubscription
  })

  const userResponse: User = { 
    id: user._id.toString(), 
    email: user.email, 
    name: user.name, 
    personalRoomId: user.personalRoomId,
    personalRoomPassword: user.personalRoomPassword,
    profile: user.profile,
    meetingSettings: user.meetingSettings,
    subscription: user.subscription,
    createdAt: user.createdAt.toISOString() 
  }
  const token = generateToken(userResponse)

  return { token, user: userResponse }
}

export const loginUser = async (email: string, password: string): Promise<AuthToken | null> => {
  const user = await UserModel.findOne({ email })
  if (!user) return null

  const isValid = await comparePassword(password, user.password)
  if (!isValid) return null

  const userResponse: User = { 
    id: user._id.toString(), 
    email: user.email, 
    name: user.name, 
    personalRoomId: user.personalRoomId,
    personalRoomPassword: user.personalRoomPassword,
    profile: user.profile,
    meetingSettings: user.meetingSettings,
    subscription: user.subscription,
    createdAt: user.createdAt.toISOString() 
  }
  const token = generateToken(userResponse)

  return { token, user: userResponse }
}

export const getUserById = async (id: string): Promise<User | null> => {
  const user = await UserModel.findById(id)
  if (!user) return null
  return { 
    id: user._id.toString(), 
    email: user.email, 
    name: user.name, 
    personalRoomId: user.personalRoomId,
    personalRoomPassword: user.personalRoomPassword,
    profile: user.profile,
    meetingSettings: user.meetingSettings,
    subscription: user.subscription,
    createdAt: user.createdAt.toISOString() 
  }
}
