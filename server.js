'use strict';
require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const Admin          = require('./models/Admin');
const connectDB      = require('./config/db');
const errorHandler   = require('./middleware/errorHandler');
const trackingRoutes = require('./routes/trackingRoutes');
const contactRoutes  = require('./routes/contactRoutes');
const adminRoutes    = require('./routes/adminRoutes');

const app    = express();
const server = http.createServer(app);

const ALWAYS_ALLOWED = [
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

function getAllowedOrigins() {
  const fromEnv = (process.env.FRONTEND_ORIGIN || '')
    .split(',').map(o => o.trim()).filter(Boolean);
  return [...new Set([...ALWAYS_ALLOWED, ...fromEnv])];
}

const corsOptions = {
  origin: (origin, cb) => {
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return cb(null, true);
    }
    const allowed = getAllowedOrigins();
    if (allowed.includes(origin) || allowed.includes('*')) return cb(null, true);
    cb(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
};

const io = new Server(server, {
  cors: {
    origin: (origin, cb) => corsOptions.origin(origin, cb),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

const { initChat } = require('./services/chatService');
initChat(io);

async function ensureAdmin() {
  try {
    const email    = process.env.ADMIN_EMAIL    || 'admin@test.com';
    const password = process.env.ADMIN_PASSWORD || 'AdminRG';
    const exists   = await Admin.findOne({ email });
    if (!exists) {
      const admin = new Admin({ username: 'admin_user', email, password });
      await admin.save();
      console.log(`✅  Admin created: ${email}`);
    } else {
      console.log(`✅  Admin exists: ${email}`);
    }
  } catch (err) {
    console.error('❌  Error ensuring admin:', err.message);
  }
}

connectDB().then(ensureAdmin);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000, max: 100,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
}));
app.use('/api/track', rateLimit({
  windowMs: 5 * 60 * 1000, max: 30,
  message: { success: false, message: 'Too many tracking attempts. Please wait a few minutes.' },
}));

app.use('/admin', express.static(path.join(__dirname, 'admin/public')));

app.use('/api/track',   trackingRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/admin',   adminRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use('/api/*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n🚀  CAC Couriers Backend running');
  console.log(`    API:       http://localhost:${PORT}/api`);
  console.log(`    Admin UI:  http://localhost:${PORT}/admin`);
  console.log(`    Health:    http://localhost:${PORT}/health`);
  console.log(`    Env:       ${process.env.NODE_ENV || 'development'}\n`);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM — shutting down…');
  server.close(() => process.exit(0));
});
