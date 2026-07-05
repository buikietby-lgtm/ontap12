const express = require('express');
const { getDB, saveDB } = require('../db');
const { ensureAuth } = require('../auth');

const router = express.Router();

router.get('/me', ensureAuth, (req, res) => {
    res.json(req.user);
});

router.post('/update-name', ensureAuth, (req, res) => {
    const { displayName } = req.body;
    if (!displayName || displayName.length > 30) {
        return res.status(400).json({ error: 'Tên không hợp lệ (tối đa 30 ký tự)' });
    }
    const db = getDB();
    db.run('UPDATE users SET display_name = ? WHERE id = ?', [displayName, req.user.id]);
    saveDB();
    req.user.displayName = displayName;
    res.json({ success: true, displayName });
});

router.post('/submit-score', ensureAuth, (req, res) => {
    const { subject, chapter, lesson, score, total } = req.body;
    if (!subject || chapter == null || lesson == null || score == null || total == null) {
        return res.status(400).json({ error: 'Thiếu dữ liệu' });
    }
    const db = getDB();
    db.run('INSERT INTO scores (user_id, subject, chapter, lesson, score, total) VALUES (?, ?, ?, ?, ?, ?)', [req.user.id, subject, chapter, lesson, score, total]);

    const xpGain = Math.round((score / total) * 100);
    const today = new Date().toISOString().split('T')[0];
    const existing = db.exec('SELECT xp_earned FROM daily_xp WHERE user_id = ? AND date = ?', [req.user.id, today]);
    if (existing.length > 0) {
        db.run('UPDATE daily_xp SET xp_earned = xp_earned + ? WHERE user_id = ? AND date = ?', [xpGain, req.user.id, today]);
    } else {
        db.run('INSERT INTO daily_xp (user_id, date, xp_earned) VALUES (?, ?, ?)', [req.user.id, today, xpGain]);
    }

    db.run('UPDATE users SET xp = xp + ?, streak = (SELECT COUNT(*) FROM daily_xp WHERE user_id = ? AND date >= date(\'now\', \'-7 days\')) WHERE id = ?', [xpGain, req.user.id, req.user.id]);
    saveDB();

    const userResult = db.exec('SELECT xp, streak FROM users WHERE id = ?', [req.user.id]);
    const newData = userResult[0].values[0];
    req.user.xp = newData[0];

    res.json({ success: true, xpGain, xp: newData[0], streak: newData[1] });
});

router.get('/leaderboard', (req, res) => {
    const db = getDB();
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const result = db.exec(
        'SELECT display_name, avatar_url, xp, vip_level FROM users ORDER BY xp DESC LIMIT ?',
        [limit]
    );
    const list = result.length > 0 ? result[0].values.map((r, i) => ({
        rank: i + 1,
        displayName: r[0],
        avatarUrl: r[1],
        xp: r[2],
        vipLevel: r[3]
    })) : [];
    res.json(list);
});

router.get('/stats', ensureAuth, (req, res) => {
    const db = getDB();
    const totalScores = db.exec('SELECT COUNT(*) FROM scores WHERE user_id = ?', [req.user.id]);
    const avgScore = db.exec('SELECT IFNULL(AVG(CAST(score AS FLOAT) / CAST(total AS FLOAT) * 100), 0) FROM scores WHERE user_id = ?', [req.user.id]);
    const today = new Date().toISOString().split('T')[0];
    const todayXP = db.exec('SELECT IFNULL(SUM(xp_earned), 0) FROM daily_xp WHERE user_id = ? AND date = ?', [req.user.id, today]);
    res.json({
        totalExams: totalScores[0]?.values[0]?.[0] || 0,
        avgScore: Math.round(avgScore[0]?.values[0]?.[0] || 0),
        todayXP: todayXP[0]?.values[0]?.[0] || 0
    });
});

router.get('/history', ensureAuth, (req, res) => {
    const db = getDB();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const result = db.exec(
        'SELECT subject, chapter, lesson, score, total, completed_at FROM scores WHERE user_id = ? ORDER BY completed_at DESC LIMIT ?',
        [req.user.id, limit]
    );
    const list = result.length > 0 ? result[0].values.map(r => ({
        subject: r[0], chapter: r[1], lesson: r[2],
        score: r[3], total: r[4], completedAt: r[5]
    })) : [];
    res.json(list);
});

// VIP management
router.post('/activate-vip', ensureAuth, (req, res) => {
    const { days } = req.body;
    const validDays = [30, 90, 365];
    if (!validDays.includes(days)) {
        return res.status(400).json({ error: 'Gói VIP không hợp lệ' });
    }
    const db = getDB();
    const now = new Date();
    const expires = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    db.run('UPDATE users SET vip_level = 1, vip_expires = ? WHERE id = ?', [expires.toISOString(), req.user.id]);
    saveDB();
    req.user.vipLevel = 1;
    // Reload user
    const userResult = db.exec('SELECT id, display_name, avatar_url, xp, vip_level FROM users WHERE id = ?', [req.user.id]);
    if (userResult.length > 0) {
        const r = userResult[0].values[0];
        req.login({ id: r[0], displayName: r[1], avatarUrl: r[2], xp: r[3], vipLevel: r[4] }, () => {
            res.json({ success: true, vipLevel: 1, expires: expires.toISOString() });
        });
    } else {
        res.json({ success: true, vipLevel: 1 });
    }
});

router.post('/check-vip', ensureAuth, (req, res) => {
    const db = getDB();
    const result = db.exec('SELECT vip_level, vip_expires FROM users WHERE id = ?', [req.user.id]);
    if (result.length > 0) {
        const r = result[0].values[0];
        let isVip = r[0] === 1;
        if (isVip && r[1]) {
            const exp = new Date(r[1]);
            if (exp < new Date()) {
                db.run('UPDATE users SET vip_level = 0, vip_expires = NULL WHERE id = ?', [req.user.id]);
                saveDB();
                isVip = false;
                req.user.vipLevel = 0;
            }
        }
        res.json({ isVip, vipLevel: isVip ? 1 : 0, vipExpires: r[1] || null });
    } else {
        res.json({ isVip: false, vipLevel: 0, vipExpires: null });
    }
});

// Admin routes — kiểm tra user hiện tại có phải là admin không
const ADMIN_EMAILS = ['buikietby@gmail.com']; // Thêm email của bạn vào đây
function isAdmin(req) {
    if (!req.user) return false;
    const db = getDB();
    const r = db.exec('SELECT email FROM users WHERE id = ?', [req.user.id]);
    return r.length > 0 && ADMIN_EMAILS.includes(r[0].values[0]);
}

router.get('/admin/search-users', ensureAuth, (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Không có quyền' });
    const q = req.query.q || '';
    if (q.length < 2) return res.json([]);
    const db = getDB();
    const like = '%' + q + '%';
    const result = db.exec(
        'SELECT id, display_name, email, avatar_url, xp, vip_level FROM users WHERE display_name LIKE ? OR email LIKE ? OR id LIKE ? LIMIT 20',
        [like, like, like]
    );
    const list = result.length > 0 ? result[0].values.map(r => ({
        id: r[0], displayName: r[1], email: r[2], avatarUrl: r[3], xp: r[4], vipLevel: r[5]
    })) : [];
    res.json(list);
});

router.post('/admin/toggle-vip', ensureAuth, (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Không có quyền' });
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Thiếu userId' });
    const db = getDB();
    const result = db.exec('SELECT vip_level FROM users WHERE id = ?', [userId]);
    if (result.length === 0) return res.status(404).json({ error: 'User không tồn tại' });
    const currentLevel = result[0].values[0];
    const newLevel = currentLevel > 0 ? 0 : 1;
    const expires = newLevel === 1 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null;
    db.run('UPDATE users SET vip_level = ?, vip_expires = ? WHERE id = ?', [newLevel, expires, userId]);
    saveDB();
    res.json({ success: true, isVip: newLevel === 1 });
});

router.post('/admin/activate-by-email', ensureAuth, (req, res) => {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Không có quyền' });
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Thiếu email' });
    const db = getDB();
    const result = db.exec('SELECT id, display_name FROM users WHERE email = ?', [email]);
    if (result.length === 0) return res.status(404).json({ error: 'Không tìm thấy user với email này' });
    const r = result[0].values[0];
    const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    db.run('UPDATE users SET vip_level = 1, vip_expires = ? WHERE id = ?', [expires, r[0]]);
    saveDB();
    res.json({ success: true, userId: r[0], displayName: r[1] });
});

module.exports = router;
