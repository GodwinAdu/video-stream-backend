import mongoose, { Schema, Document } from 'mongoose'

export interface IMeeting extends Document {
  meetingId: string
  hostId: string
  title: string
  description?: string
  scheduledTime?: Date
  duration: number // minutes
  isRecurring: boolean
  recurrencePattern?: {
    type: 'daily' | 'weekly' | 'monthly'
    interval: number
    endDate?: Date
  }
  settings: {
    waitingRoom: boolean
    muteOnEntry: boolean
    videoOnEntry: boolean
    allowScreenShare: boolean
    recordingEnabled: boolean
    chatEnabled: boolean
    password?: string
    maxParticipants: number
  }
  participants: Array<{
    userId?: string
    name: string
    email?: string
    role: 'host' | 'co-host' | 'participant'
    joinedAt?: Date
    leftAt?: Date
  }>
  status: 'scheduled' | 'active' | 'ended'
  recordings?: Array<{
    id: string
    url: string
    duration: number
    size: number
    createdAt: Date
  }>
  analytics: {
    totalParticipants: number
    peakParticipants: number
    averageDuration: number
    chatMessages: number
  }
  createdAt: Date
  updatedAt: Date
}

const MeetingSchema = new Schema<IMeeting>({
  meetingId: { type: String, required: true, unique: true },
  hostId: { type: String, required: true },
  title: { type: String, required: true },
  description: String,
  scheduledTime: Date,
  duration: { type: Number, default: 60 },
  isRecurring: { type: Boolean, default: false },
  recurrencePattern: {
    type: { type: String, enum: ['daily', 'weekly', 'monthly'] },
    interval: Number,
    endDate: Date
  },
  settings: {
    waitingRoom: { type: Boolean, default: true },
    muteOnEntry: { type: Boolean, default: true },
    videoOnEntry: { type: Boolean, default: false },
    allowScreenShare: { type: Boolean, default: true },
    recordingEnabled: { type: Boolean, default: false },
    chatEnabled: { type: Boolean, default: true },
    password: String,
    maxParticipants: { type: Number, default: 100 }
  },
  participants: [{
    userId: String,
    name: { type: String, required: true },
    email: String,
    role: { type: String, enum: ['host', 'co-host', 'participant'], default: 'participant' },
    joinedAt: Date,
    leftAt: Date
  }],
  status: { type: String, enum: ['scheduled', 'active', 'ended'], default: 'scheduled' },
  recordings: [{
    id: String,
    url: String,
    duration: Number,
    size: Number,
    createdAt: Date
  }],
  analytics: {
    totalParticipants: { type: Number, default: 0 },
    peakParticipants: { type: Number, default: 0 },
    averageDuration: { type: Number, default: 0 },
    chatMessages: { type: Number, default: 0 }
  }
}, {
  timestamps: true
})

export default mongoose.model<IMeeting>('Meeting', MeetingSchema)