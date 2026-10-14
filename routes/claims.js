const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');

function isValidId(value) {
    return /^\d+$/.test(String(value));
}

async function loadItem(id) {
    const [rows] = await db.promise().execute(
        `SELECT id, user_id, title, item_type, status, image
         FROM items WHERE id = ?`,
        [id]
    );

    return rows[0] || null;
}

// ---------------------------------------------------------------
// Claim form
// ---------------------------------------------------------------
router.get('/claims/new/:id', requireLogin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.fail(404, 'Item not found.');
        }

        const item = await loadItem(req.params.id);

        if (!item) {
            return res.fail(404, 'Item not found.');
        }

        if (item.user_id === req.session.user.id) {
            req.session.flash = {
                type: 'error',
                message: 'You cannot claim an item you reported yourself.'
            };

            return res.redirect(`/items/${item.id}`);
        }

        if (item.status !== 'lost' && item.status !== 'found') {
            req.session.flash = {
                type: 'error',
                message: 'This item is no longer open for claims.'
            };

            return res.redirect(`/items/${item.id}`);
        }

        res.render('claim', {
            title: 'Submit a Claim',
            item,
            error: null,
            message: ''
        });
    } catch (error) {
        console.error('Claim form error:', error);
        res.fail(500, 'Unable to load the claim form.');
    }
});

// ---------------------------------------------------------------
// Submit a claim
// ---------------------------------------------------------------
router.post('/claims/new/:id', requireLogin, async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.fail(404, 'Item not found.');
        }

        const item = await loadItem(req.params.id);

        if (!item) {
            return res.fail(404, 'Item not found.');
        }

        const user = req.session.user;
        const message = ((req.body || {}).message || '').trim();

        if (item.user_id === user.id) {
            return res.fail(400, 'You cannot claim an item you reported yourself.');
        }

        if (item.status !== 'lost' && item.status !== 'found') {
            return res.fail(400, 'This item is no longer open for claims.');
        }

        const showError = (error) =>
            res.status(400).render('claim', {
                title: 'Submit a Claim',
                item,
                error,
                message
            });

        if (message.length < 10) {
            return showError(
                'Please describe how you can prove this item is yours (at least 10 characters).'
            );
        }

        if (message.length > 1000) {
            return showError('Your message must be 1000 characters or fewer.');
        }

        const [pending] = await db.promise().execute(
            `SELECT id FROM claims
             WHERE item_id = ? AND claimant_id = ? AND status = 'pending'`,
            [item.id, user.id]
        );

        if (pending.length > 0) {
            req.session.flash = {
                type: 'error',
                message: 'You already have a pending claim for this item.'
            };

            return res.redirect(`/items/${item.id}`);
        }

        await db.promise().execute(
            'INSERT INTO claims (item_id, claimant_id, message) VALUES (?, ?, ?)',
            [item.id, user.id, message]
        );

        req.session.flash = {
            type: 'success',
            message: 'Your claim was submitted. The reporter will review it.'
        };

        res.redirect('/my-reports');
    } catch (error) {
        console.error('Submit claim error:', error);
        res.fail(500, 'Unable to submit your claim.');
    }
});

// ---------------------------------------------------------------
// Approve or reject a claim (item owner or admin)
// ---------------------------------------------------------------
async function reviewClaim(req, res, decision) {
    if (!isValidId(req.params.id)) {
        return res.fail(404, 'Claim not found.');
    }

    const connection = await db.promise().getConnection();

    try {
        await connection.beginTransaction();

        const [rows] = await connection.execute(
            `SELECT claims.id, claims.item_id, claims.status,
                    items.user_id AS owner_id, items.status AS item_status
             FROM claims
             JOIN items ON claims.item_id = items.id
             WHERE claims.id = ?
             FOR UPDATE`,
            [req.params.id]
        );

        if (rows.length === 0) {
            await connection.rollback();
            return res.fail(404, 'Claim not found.');
        }

        const claim = rows[0];
        const user = req.session.user;

        if (claim.owner_id !== user.id && user.role !== 'admin') {
            await connection.rollback();
            return res.fail(403, 'You do not have permission to review this claim.');
        }

        const itemIsOpen =
            claim.item_status === 'lost' || claim.item_status === 'found';

        if (claim.status !== 'pending' || !itemIsOpen) {
            await connection.rollback();

            req.session.flash = {
                type: 'error',
                message: 'This claim can no longer be changed.'
            };

            return res.redirect(`/items/${claim.item_id}`);
        }

        if (decision === 'approve') {
            await connection.execute(
                `UPDATE claims SET status = 'approved' WHERE id = ?`,
                [claim.id]
            );

            await connection.execute(
                `UPDATE claims SET status = 'rejected'
                 WHERE item_id = ? AND id <> ? AND status = 'pending'`,
                [claim.item_id, claim.id]
            );

            await connection.execute(
                `UPDATE items SET status = 'claimed' WHERE id = ?`,
                [claim.item_id]
            );
        } else {
            await connection.execute(
                `UPDATE claims SET status = 'rejected' WHERE id = ?`,
                [claim.id]
            );
        }

        await connection.commit();

        req.session.flash = {
            type: 'success',
            message:
                decision === 'approve'
                    ? 'Claim approved. The claimant can now see your contact details.'
                    : 'Claim rejected.'
        };

        res.redirect(`/items/${claim.item_id}`);
    } catch (error) {
        await connection.rollback().catch(() => {});
        console.error('Review claim error:', error);
        res.fail(500, 'Unable to update this claim.');
    } finally {
        connection.release();
    }
}

router.post('/claims/:id/approve', requireLogin, (req, res) =>
    reviewClaim(req, res, 'approve')
);

router.post('/claims/:id/reject', requireLogin, (req, res) =>
    reviewClaim(req, res, 'reject')
);

module.exports = router;
