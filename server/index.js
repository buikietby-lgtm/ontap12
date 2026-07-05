require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');
const path = require('path');
const { initDB, getDB, saveDB } = require('./src/db');
const { setupAuth } = require('./src/auth');
const apiRoutes = require('./src/routes/api');
const paymentRoutes = require('./src/routes/payment');

// Check required env vars
const REQUIRED_ENV = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
const missing = REQUIRED_ENV.filter(k => !process.env[k] || process.env[k].startsWith('thay-'));
if (missing.length > 0) {
    console.error('❌ Thiếu biến môi trường:', missing.join(', '));
    console.error('   Sửa file .env và chạy lại.');
    process.exit(1);
}

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';

// Trust proxy (Render, Railway, Nginx...)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CORS — chỉ cho phép domain của mình
app.use(cors({
    origin: isProduction ? CLIENT_URL : true,
    credentials: true
}));

// Rate limit — chống spam API
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { error: 'Quá nhiều request, thử lại sau 15 phút' }
});
app.use('/api/', apiLimiter);

app.use(express.json({ limit: '10kb' }));

// Session — dùng SQLite store thay MemoryStore (tránh mất session khi restart)
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const sessionStore = new (require('express-session').Store)();
sessionStore.sessions = {};
sessionStore.get = function(sid, fn) { fn(null, sessionStore.sessions[sid] || null); };
sessionStore.set = function(sid, sess, fn) {
    sessionStore.sessions[sid] = sess;
    try {
        const db = getDB();
        db.run('CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, data TEXT, expires TEXT)');
        db.run('INSERT OR REPLACE INTO sessions (sid, data, expires) VALUES (?, ?, ?)', [sid, JSON.stringify(sess), sess.cookie?.expires ? new Date(sess.cookie.expires).toISOString() : '']);
        saveDB();
    } catch(e) {}
    if (fn) fn();
};
sessionStore.destroy = function(sid, fn) {
    delete sessionStore.sessions[sid];
    try {
        const db = getDB();
        db.run('DELETE FROM sessions WHERE sid = ?', [sid]);
        saveDB();
    } catch(e) {}
    if (fn) fn();
};
app.use(session({
    store: sessionStore,
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(passport.initialize());
app.use(passport.session());

setupAuth();

// CSRF protection cho API POST/PUT/DELETE
app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
        const origin = req.get('Origin') || '';
        const referer = req.get('Referer') || '';
        const valid = origin === CLIENT_URL || referer.startsWith(CLIENT_URL + '/') || (!isProduction && !origin && !referer);
        if (!valid) {
            return res.status(403).json({ error: 'Forbidden' });
        }
    }
    next();
});

app.use((req, res, next) => {
    if (req.path === '/' || req.path === '/index.html') {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
    next();
});
app.use(express.static(path.join(__dirname, '..'), {
    maxAge: isProduction ? '1d' : 0
}));

app.get('/auth/google',
    passport.authenticate('google', { scope: ['profile', 'email'], prompt: 'select_account' })
);

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/?login=failed' }),
    (req, res) => {
        res.redirect('/?login=success');
    }
);

app.get('/auth/logout', (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        res.redirect('/');
    });
});

app.use('/api', apiRoutes);
app.use('/api', paymentRoutes.router);

async function start() {
    await initDB();
    app.listen(PORT, () => {
        console.log(`✅ Server chạy tại http://localhost:${PORT}`);
        if (isProduction) console.log(`   Production mode · HTTPS: on`);
        else console.log(`   Development mode · HTTPS: off`);
    });
}

start();
