import { Router } from 'express'
import { registerUser, loginUser, verifyToken } from '../auth/auth'

const router = Router()

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body
    console.log('📝 Register attempt:', { email, name })

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' })
    }

    const result = await registerUser(email, password, name)
    if (!result) {
      return res.status(400).json({ error: 'User already exists' })
    }

    res.cookie('auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    })

    console.log('✅ User registered:', result.user.email)
    res.json({ user: result.user })
  } catch (error) {
    console.error('❌ Register error:', error)
    res.status(500).json({ error: 'Registration failed' })
  }
})

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body
    console.log('🔑 Login attempt:', email)

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const result = await loginUser(email, password)
    if (!result) {
      return res.status(401).json({ error: 'Invalid credentials' })
    }

    res.cookie('auth_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    })

    console.log('✅ User logged in:', result.user.email)
    res.json({ user: result.user })
  } catch (error) {
    console.error('❌ Login error:', error)
    res.status(500).json({ error: 'Login failed' })
  }
})

router.get('/me', async (req, res) => {
  const token = req.cookies.auth_token
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  const user = await verifyToken(token)
  if (!user) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  res.json({ user })
})

router.post('/logout', (req, res) => {
  res.clearCookie('auth_token')
  res.json({ message: 'Logged out successfully' })
})

export default router
