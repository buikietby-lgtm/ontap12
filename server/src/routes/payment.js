const express = require('express');
const { ensureAuth } = require('../auth');

const router = express.Router();

const BANK_BIN = '970422'; // MB Bank
const BANK_ACCOUNT = '8030092009';
const BANK_NAME = 'BUI NHAT LONG';

const PACKAGES = {
    30: { amount: 10000, label: 'VIP Tháng' },
    90: { amount: 25000, label: 'VIP Quý' },
    365: { amount: 100000, label: 'VIP Năm' },
};

router.post('/create-payment', ensureAuth, async (req, res) => {
    const { days } = req.body;
    const pkg = PACKAGES[days];
    if (!pkg) {
        return res.status(400).json({ error: 'Gói VIP không hợp lệ' });
    }
    const userId = req.user.id;
    const orderCode = Date.now().toString().slice(-8);
    const description = 'VIP ' + days + 'ngay ' + userId.slice(0, 8);
    const amount = pkg.amount;

    const qrUrl = 'https://api.vietqr.io/image/'
        + BANK_BIN + '-' + BANK_ACCOUNT + '-compact2.jpg'
        + '?amount=' + amount
        + '&addInfo=' + encodeURIComponent(description)
        + '&accountName=' + encodeURIComponent(BANK_NAME);

    res.json({
        success: true,
        qrCode: qrUrl,
        checkoutUrl: qrUrl,
        orderCode: orderCode,
        amount: amount,
        description: description,
    });
});

module.exports = { router, PACKAGES };
