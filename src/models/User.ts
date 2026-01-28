import mongoose, { Schema, Document } from 'mongoose'

export interface IUser extends Document {
  email: string
  name: string
  password: string
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
    meetingDuration: number // minutes
    cloudStorage: number // GB
  }
  createdAt: Date
}

const UserSchema = new Schema<IUser>({
  email: { type: String, required: true, unique: true, lowercase: true },
  name: { type: String, required: true },
  password: { type: String, required: true },
  personalRoomId: { type: String, required: true, unique: true },
  personalRoomPassword: { type: String },
  profile: {
    avatar: String,
    title: String,
    company: String,
    timezone: { type: String, default: 'UTC' }
  },
  meetingSettings: {
    waitingRoom: { type: Boolean, default: true },
    muteOnEntry: { type: Boolean, default: true },
    videoOnEntry: { type: Boolean, default: false },
    allowScreenShare: { type: Boolean, default: true },
    recordingEnabled: { type: Boolean, default: false },
    chatEnabled: { type: Boolean, default: true },
    maxParticipants: { type: Number, default: 100 }
  },
  subscription: {
    plan: { type: String, enum: ['free', 'pro', 'business'], default: 'free' },
    meetingDuration: { type: Number, default: 40 }, // 40 minutes for free
    cloudStorage: { type: Number, default: 1 } // 1GB for free
  },
  createdAt: { type: Date, default: Date.now }
})

export default mongoose.model<IUser>('User', UserSchema)
