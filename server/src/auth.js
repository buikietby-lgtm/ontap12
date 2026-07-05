const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { getDB, saveDB } = require('./db');
const crypto = require('crypto');

function setupAuth() {
    const callbackURL = (process.env.CLIENT_URL || 'http://localhost:3000') + '/auth/google/callback';
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: callbackURL
    }, (accessToken, refreshToken, profile, done) => {
        const db = getDB();
        const googleId = profile.id;
        const email = profile.emails?.[0]?.value || '';
        const displayName = profile.displayName || 'Unknown';
        const avatarUrl = profile.photos?.[0]?.value || '';

        const existing = db.exec('SELECT * FROM users WHERE google_id = ?', [googleId]);

        let user;
        if (existing.length > 0) {
            user = existing[0].values[0];
            db.run('UPDATE users SET email = ?, avatar_url = ?, last_login = datetime(\'now\') WHERE google_id = ?', [email, avatarUrl, googleId]);
        } else {
            const id = crypto.randomUUID();
            db.run('INSERT INTO users (id, google_id, email, display_name, avatar_url, last_login) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))', [id, googleId, email, displayName, avatarUrl]);
            user = [id, googleId, email, displayName, avatarUrl, 0, 0, null, 0, null, null];
        }
        saveDB();
        return done(null, { id: user[0], displayName: user[3], avatarUrl: user[4], xp: user[5], vipLevel: user[8], email: user[2] });
    }));

    passport.serializeUser((user, done) => done(null, user.id));
    passport.deserializeUser((id, done) => {
        const db = getDB();
        const result = db.exec('SELECT id, display_name, avatar_url, xp, vip_level, email FROM users WHERE id = ?', [id]);
        if (result.length > 0) {
            const r = result[0].values[0];
            done(null, { id: r[0], displayName: r[1], avatarUrl: r[2], xp: r[3], vipLevel: r[4], email: r[5] });
        } else {
            done(null, null);
        }
    });
}

function ensureAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { setupAuth, ensureAuth };
