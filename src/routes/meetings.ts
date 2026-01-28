import { Router } from 'express'
import Meeting from '../models/Meeting'
import { v4 as uuidv4 } from 'uuid'

const router = Router()

// Middleware to get user from cookie
const authMiddleware = async (req: any, res: any, next: any) => {
  const token = req.cookies.auth_token
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  
  try {
    const { verifyToken } = await import('../auth/auth')
    const user = await verifyToken(token)
    if (!user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    req.user = user
    next()
  } catch (error) {
    res.status(401).json({ error: 'Unauthorized' })
  }
}

// Get meeting by ID (public route for guests)
router.get('/check/:meetingId', async (req: any, res) => {
  try {
    const meeting = await Meeting.findOne({ meetingId: req.params.meetingId })
    
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }
    
    const now = new Date()
    const meetingTime = meeting.scheduledTime ? new Date(meeting.scheduledTime) : new Date()
    const endTime = new Date(meetingTime.getTime() + (meeting.duration || 60) * 60000)
    
    let status = 'upcoming'
    if (now >= meetingTime && now <= endTime) {
      status = 'active'
    } else if (now > endTime) {
      status = 'ended'
    }
    
    res.json({ 
      meeting: {
        title: meeting.title,
        scheduledTime: meeting.scheduledTime,
        duration: meeting.duration,
        status,
        settings: meeting.settings
      }
    })
  } catch (error) {
    console.error('Error checking meeting:', error)
    res.status(500).json({ error: 'Failed to check meeting' })
  }
})

// Get user's meetings
router.get('/', authMiddleware, async (req: any, res) => {
  try {
    const meetings = await Meeting.find({ 
      hostId: req.user.id,
      status: { $in: ['scheduled', 'active'] }
    }).sort({ scheduledTime: 1 })
    
    res.json({ meetings })
  } catch (error) {
    console.error('Error fetching meetings:', error)
    res.status(500).json({ error: 'Failed to fetch meetings' })
  }
})

// Create meeting
router.post('/', authMiddleware, async (req: any, res) => {
  try {
    const { roomId, participants, ...meetingData } = req.body
    
    const meeting = new Meeting({
      ...meetingData,
      meetingId: roomId || `meeting-${Date.now()}`,
      hostId: req.user.id,
      participants: [],
      settings: {
        waitingRoom: meetingData.waitingRoom || true,
        muteOnEntry: true,
        videoOnEntry: false,
        allowScreenShare: true,
        recordingEnabled: meetingData.allowRecording || false,
        chatEnabled: true,
        password: meetingData.password,
        maxParticipants: meetingData.maxParticipants || 100
      },
      analytics: {
        totalParticipants: 0,
        peakParticipants: 0,
        averageDuration: 0,
        chatMessages: 0
      }
    })
    
    await meeting.save()
    res.status(201).json({ meeting })
  } catch (error) {
    console.error('Error creating meeting:', error)
    res.status(500).json({ error: 'Failed to create meeting' })
  }
})

// Update meeting
router.put('/:id', authMiddleware, async (req: any, res) => {
  try {
    const { roomId, participants, ...updateData } = req.body
    
    const meeting = await Meeting.findOneAndUpdate(
      { _id: req.params.id, hostId: req.user.id },
      {
        ...updateData,
        ...(roomId && { meetingId: roomId }),
        settings: {
          ...updateData.settings,
          waitingRoom: updateData.waitingRoom,
          recordingEnabled: updateData.allowRecording
        }
      },
      { new: true }
    )
    
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }
    
    res.json({ meeting })
  } catch (error) {
    console.error('Error updating meeting:', error)
    res.status(500).json({ error: 'Failed to update meeting' })
  }
})

// Delete meeting
router.delete('/:id', authMiddleware, async (req: any, res) => {
  try {
    const meeting = await Meeting.findOneAndDelete({
      _id: req.params.id,
      hostId: req.user.id
    })
    
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' })
    }
    
    res.json({ message: 'Meeting deleted' })
  } catch (error) {
    console.error('Error deleting meeting:', error)
    res.status(500).json({ error: 'Failed to delete meeting' })
  }
})

export default router
