const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(express.json());

// Initialize SQLite Database
const db = new sqlite3.Database(path.join(__dirname, 'chat.db'));

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      status TEXT DEFAULT 'offline',
      lastSeen DATETIME DEFAULT CURRENT_TIMESTAMP,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_user INTEGER NOT NULL,
      to_user INTEGER NOT NULL,
      message TEXT NOT NULL,
      read BOOLEAN DEFAULT 0,
      readAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(from_user) REFERENCES users(id),
      FOREIGN KEY(to_user) REFERENCES users(id)
    )
  `);

  console.log('✅ Database initialized');
});

// User Helper Functions
const User = {
  create: (username, email, password) => {
    return new Promise((resolve, reject) => {
      const hashedPassword = bcrypt.hashSync(password, 10);
      db.run(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  },
  
  findByUsername: (username) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE username = ?', [username], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  
  findByEmail: (email) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT * FROM users WHERE email = ?', [email], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  
  findById: (id) => {
    return new Promise((resolve, reject) => {
      db.get('SELECT id, username, email, status, lastSeen FROM users WHERE id = ?', [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  },
  
  findAllExcept: (userId) => {
    return new Promise((resolve, reject) => {
      db.all('SELECT id, username, email, status, lastSeen FROM users WHERE id != ?', [userId], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  },
  
  updateStatus: (userId, status) => {
    return new Promise((resolve, reject) => {
      db.run('UPDATE users SET status = ?, lastSeen = CURRENT_TIMESTAMP WHERE id = ?', [status, userId], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  },
  
  comparePassword: (plainPassword, hashedPassword) => {
    return bcrypt.compareSync(plainPassword, hashedPassword);
  }
};

const Message = {
  create: (from, to, message) => {
    return new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO messages (from_user, to_user, message) VALUES (?, ?, ?)',
        [from, to, message],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  },
  
  getConversation: (user1, user2) => {
    return new Promise((resolve, reject) => {
      db.all(
        `SELECT m.*, u.username as from_username 
         FROM messages m 
         JOIN users u ON m.from_user = u.id 
         WHERE (from_user = ? AND to_user = ?) OR (from_user = ? AND to_user = ?) 
         ORDER BY createdAt ASC LIMIT 100`,
        [user1, user2, user2, user1],
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows || []);
        }
      );
    });
  },
  
  markAsRead: (fromUser, toUser) => {
    return new Promise((resolve, reject) => {
      db.run(
        'UPDATE messages SET read = 1, readAt = CURRENT_TIMESTAMP WHERE from_user = ? AND to_user = ? AND read = 0',
        [fromUser, toUser],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }
};

// Store online users
const onlineUsers = new Map();

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    next();
  } catch (err) {
    next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.userId);
  
  socket.on('user-online', async (userId) => {
    onlineUsers.set(userId, socket.id);
    await User.updateStatus(userId, 'online');
    io.emit('user-status-change', { userId, status: 'online' });
    const onlineUserIds = Array.from(onlineUsers.keys());
    socket.emit('online-users-list', onlineUserIds);
  });
  
  socket.on('get-online-users', () => {
    const onlineUserIds = Array.from(onlineUsers.keys());
    socket.emit('online-users-list', onlineUserIds);
  });
  
  socket.on('private-message', async (data) => {
    const { to, message, from, username } = data;
    try {
      const messageId = await Message.create(from, to, message);
      const messageData = {
        _id: messageId,
        from: from,
        to: to,
        message: message,
        username: username,
        createdAt: new Date(),
        read: false
      };
      const recipientSocketId = onlineUsers.get(to);
      if (recipientSocketId) {
        io.to(recipientSocketId).emit('private-message', messageData);
      }
      socket.emit('message-sent', messageData);
    } catch (error) {
      socket.emit('message-error', { error: 'Failed to send message' });
    }
  });
  
  socket.on('typing-start', (data) => {
    const { to, from, username } = data;
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user-typing', { from, username, isTyping: true });
    }
  });
  
  socket.on('typing-stop', (data) => {
    const { to, from } = data;
    const recipientSocketId = onlineUsers.get(to);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('user-typing', { from, isTyping: false });
    }
  });
  
  socket.on('disconnect', async () => {
    if (socket.userId) {
      onlineUsers.delete(socket.userId);
      await User.updateStatus(socket.userId, 'offline');
      io.emit('user-status-change', { userId: socket.userId, status: 'offline' });
    }
  });
});

// API Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    const userId = await User.create(username, email, password);
    const user = await User.findById(userId);
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({ token, user });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findByUsername(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const isValid = User.comparePassword(password, user.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/users', authMiddleware, async (req, res) => {
  try {
    const users = await User.findAllExcept(req.userId);
    const usersWithStatus = users.map(user => ({
      ...user,
      isOnline: onlineUsers.has(user.id.toString())
    }));
    res.json(usersWithStatus);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/messages/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    const messages = await Message.getConversation(req.userId, userId);
    res.json(messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/messages/read/:userId', authMiddleware, async (req, res) => {
  try {
    const { userId } = req.params;
    await Message.markAsRead(userId, req.userId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`✅ SQLite database ready`);
  console.log(`✨ Chat server ready!\n`);
});