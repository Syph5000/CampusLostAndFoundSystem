const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { requireLogin } = require('../middleware/auth');
const { uploadImage, removeFile: removeUploadedFile } = require('../middleware/upload');
const { CATEGORIES } = require('../config/constants');

function isValidId(value) {
    return /^\d+$/.test(String(value));
}

function renderReport(res, status, error, form = {}) {
    return res.status(status).render('report', {
        title: 'Report an Item',
        error,
        form,
        categories: CATEGORIES
    });
}

// ---------------------------------------------------------------
// Home page
// ---------------------------------------------------------------
router.get('/', async (req, res) => {
    try {
        const [[counts]] = await db.promise().query(
            `SELECT
                COUNT(*) AS total,
                COALESCE(SUM(status = 'lost'), 0) AS lost,
                COALESCE(SUM(status = 'found'), 0) AS found
             FROM items`
        );

        const [items] = await db.promise().query(
            `SELECT items.*, users.full_name AS reporter_name
             FROM items
             LEFT JOIN users ON items.user_id = users.id
             ORDER BY items.created_at DESC, items.id DESC
             LIMIT 4`
        );

        res.render('index', {
            title: 'Campus Lost and Found',
            items,
            stats: {
                total: Number(counts.total),
                lost: Number(counts.lost),
                found: Number(counts.found)
            }
        });
    } catch (error) {
        console.error('Home page error:', error);
        res.fail(500, 'Unable to load the home page.');
    }
});

// ---------------------------------------------------------------
// Browse and search items
// ---------------------------------------------------------------
router.get('/items', async (req, res) => {
    try {
        const search = (req.query.search || '').toString().trim();
        const status = (req.query.status || '').toString().trim().toLowerCase();

        let sql = `
            SELECT items.*, users.full_name AS reporter_name
            FROM items
            LEFT JOIN users ON items.user_id = users.id
            WHERE 1 = 1
        `;

        const params = [];

        if (search) {
            sql += `
                AND (
                    items.title LIKE ?
                    OR items.description LIKE ?
                    OR items.category LIKE ?
                    OR items.location LIKE ?
                )
            `;

            const keyword = `%${search}%`;
            params.push(keyword, keyword, keyword, keyword);
        }

        if (status === 'lost' || status === 'found') {
            sql += ' AND items.item_type = ?';
            params.push(status);
        }

        sql += ' ORDER BY items.created_at DESC, items.id DESC';

        const [items] = await db.promise().execute(sql, params);

        res.render('items', {
            title: 'Lost and Found Items',
            items,
            search,
            status
        });
    } catch (error) {
        console.error('Browse items error:', error);
        res.fail(500, 'Unable to load items.');
    }
});

// ---------------------------------------------------------------
// Report an item
// ---------------------------------------------------------------
router.get('/report', requireLogin, (req, res) => {
    renderReport(res, 200, null);
});

router.post('/report', requireLogin, uploadImage('image'), async (req, res) => {
    const form = req.body || {};

    if (req.uploadError) {
        return renderReport(res, 400, req.uploadError, form);
    }

    const savedImage = req.file ? `uploads/${req.file.filename}` : null;

    try {
        const {
            title,
            description,
            category,
            location,
            date_lost_found,
            item_type
        } = form;

        const reportedDate = new Date(date_lost_found);
        const tomorrow = Date.now() + 24 * 60 * 60 * 1000;

        let problem = null;

        if (
            !title?.trim() ||
            !description?.trim() ||
            !category?.trim() ||
            !location?.trim() ||
            !date_lost_found ||
            !['lost', 'found'].includes(item_type)
        ) {
            problem = 'Please complete all fields correctly.';
        } else if (!CATEGORIES.includes(category)) {
            problem = 'Please choose a valid category.';
        } else if (title.trim().length > 150) {
            problem = 'The item name must be 150 characters or fewer.';
        } else if (location.trim().length > 255) {
            problem = 'The location must be 255 characters or fewer.';
        } else if (
            Number.isNaN(reportedDate.getTime()) ||
            reportedDate.getTime() > tomorrow
        ) {
            problem = 'Please enter a valid date that is not in the future.';
        }

        if (problem) {
            removeUploadedFile(savedImage);
            return renderReport(res, 400, problem, form);
        }

        await db.promise().execute(
            `INSERT INTO items
                (user_id, title, description, category, location,
                 date_lost_found, item_type, status, image)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                req.session.user.id,
                title.trim(),
                description.trim(),
                category,
                location.trim(),
                date_lost_found,
                item_type,
                item_type,
                savedImage
            ]
        );

        req.session.flash = {
            type: 'success',
            message: 'Your report was submitted. Thank you for helping!'
        };

        res.redirect('/my-reports');
    } catch (error) {
        console.error('Report item error:', error);
        removeUploadedFile(savedImage);
        renderReport(res, 500, 'Unable to submit your report. Please try again.', form);
    }
});

// ---------------------------------------------------------------
// My reports and my claims
// ---------------------------------------------------------------
router.get('/my-reports', requireLogin, async (req, res) => {
    try {
        const userId = req.session.user.id;

        const [items] = await db.promise().execute(
            `SELECT items.*,
                (SELECT COUNT(*) FROM claims
                 WHERE claims.item_id = items.id
                   AND claims.status = 'pending') AS pending_claims
             FROM items
             WHERE items.user_id = ?
             ORDER BY items.created_at DESC, items.id DESC`,
            [userId]
        );

        const [claims] = await db.promise().execute(
            `SELECT claims.id, claims.item_id, claims.message, claims.status,
                    claims.created_at,
                    items.title AS item_title,
                    owner.full_name AS owner_name,
                    owner.email AS owner_email
             FROM claims
             JOIN items ON claims.item_id = items.id
             JOIN users owner ON items.user_id = owner.id
             WHERE claims.claimant_id = ?
             ORDER BY claims.created_at DESC, claims.id DESC`,
            [userId]
        );

        res.render('my-reports', {
            title: 'My Reports',
            items,
            claims
        });
    } catch (error) {
        console.error('My reports error:', error);
        res.fail(500, 'Unable to load your reports.');
    }
});

// ---------------------------------------------------------------
// View an individual item
// ---------------------------------------------------------------
router.get('/items/:id', async (req, res) => {
    try {
        if (!isValidId(req.params.id)) {
            return res.fail(404, 'Item not found.');
        }

        const [items] = await db.promise().execute(
            `SELECT items.*, users.full_name AS reporter_name
             FROM items
             LEFT JOIN users ON items.user_id = users.id
             WHERE items.id = ?`,
            [req.params.id]
        );

        if (items.length === 0) {
            return res.fail(404, 'Item not found.');
        }

        const item = items[0];
        const user = req.session.user;
        const isManager = Boolean(
            user && (user.id === item.user_id || user.role === 'admin')
        );

        let claims = [];
        let myClaim = null;

        if (isManager) {
            [claims] = await db.promise().execute(
                `SELECT claims.id, claims.message, claims.status, claims.created_at,
                        users.full_name, users.student_id, users.email
                 FROM claims
                 JOIN users ON claims.claimant_id = users.id
                 WHERE claims.item_id = ?
                 ORDER BY claims.created_at DESC, claims.id DESC`,
                [item.id]
            );
        }

        if (user && user.id !== item.user_id) {
            const [mine] = await db.promise().execute(
                `SELECT id, status FROM claims
                 WHERE item_id = ? AND claimant_id = ?
                 ORDER BY id DESC LIMIT 1`,
                [item.id, user.id]
            );

            myClaim = mine[0] || null;
        }

        res.render('item-details', {
            title: item.title,
            item,
            isManager,
            isOpen: item.status === 'lost' || item.status === 'found',
            claims,
            myClaim
        });
    } catch (error) {
        console.error('Item details error:', error);
        res.fail(500, 'Unable to load item details.');
    }
});

// ---------------------------------------------------------------
// Owner / admin actions: mark as returned, delete
// ---------------------------------------------------------------
async function loadManagedItem(req, res) {
    if (!isValidId(req.params.id)) {
        res.fail(404, 'Item not found.');
        return null;
    }

    const [rows] = await db.promise().execute(
        'SELECT id, user_id, image FROM items WHERE id = ?',
        [req.params.id]
    );

    if (rows.length === 0) {
        res.fail(404, 'Item not found.');
        return null;
    }

    const user = req.session.user;

    if (rows[0].user_id !== user.id && user.role !== 'admin') {
        res.fail(403, 'You do not have permission to change this report.');
        return null;
    }

    return rows[0];
}

router.post('/items/:id/returned', requireLogin, async (req, res) => {
    try {
        const item = await loadManagedItem(req, res);
        if (!item) return;

        await db.promise().execute(
            `UPDATE items SET status = 'returned' WHERE id = ?`,
            [item.id]
        );

        // Any claim still waiting is closed
        await db.promise().execute(
            `UPDATE claims SET status = 'rejected'
             WHERE item_id = ? AND status = 'pending'`,
            [item.id]
        );

        req.session.flash = {
            type: 'success',
            message: 'The item was marked as returned.'
        };

        res.redirect(`/items/${item.id}`);
    } catch (error) {
        console.error('Mark returned error:', error);
        res.fail(500, 'Unable to update this report.');
    }
});

router.post('/items/:id/delete', requireLogin, async (req, res) => {
    try {
        const item = await loadManagedItem(req, res);
        if (!item) return;

        await db.promise().execute('DELETE FROM items WHERE id = ?', [item.id]);
        removeUploadedFile(item.image);

        req.session.flash = {
            type: 'success',
            message: 'The report was deleted.'
        };

        res.redirect('/my-reports');
    } catch (error) {
        console.error('Delete item error:', error);
        res.fail(500, 'Unable to delete this report.');
    }
});

module.exports = router;
