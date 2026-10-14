const express = require('express');
const router = express.Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function renderRegister(res, status, error, old = {}) {
    return res.status(status).render('register', {
        title: 'Register',
        error,
        old
    });
}

// Show login page
router.get('/login', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }

    res.render('login', { title: 'Login', error: null });
});

// Show registration page
router.get('/register', (req, res) => {
    if (req.session.user) {
        return res.redirect('/');
    }

    renderRegister(res, 200, null);
});

// Register a student
router.post('/register', async (req, res) => {
    const body = req.body || {};
    const old = {
        full_name: body.full_name || '',
        student_id: body.student_id || '',
        email: body.email || ''
    };

    try {
        const { full_name, student_id, email, password, confirm_password } = body;

        if (
            !full_name?.trim() ||
            !student_id?.trim() ||
            !email?.trim() ||
            !password ||
            !confirm_password
        ) {
            return renderRegister(res, 400, 'Please complete all fields.', old);
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (!EMAIL_PATTERN.test(normalizedEmail)) {
            return renderRegister(res, 400, 'Please enter a valid email address.', old);
        }

        if (password.length < 8) {
            return renderRegister(
                res, 400, 'Password must be at least 8 characters.', old
            );
        }

        if (password !== confirm_password) {
            return renderRegister(res, 400, 'Passwords do not match.', old);
        }

        const [existingUsers] = await db.promise().execute(
            'SELECT id FROM users WHERE student_id = ? OR email = ?',
            [student_id.trim(), normalizedEmail]
        );

        if (existingUsers.length > 0) {
            return renderRegister(
                res, 409, 'Student ID or email is already registered.', old
            );
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await db.promise().execute(
            `INSERT INTO users
            (full_name, student_id, email, password, role)
            VALUES (?, ?, ?, ?, ?)`,
            [
                full_name.trim(),
                student_id.trim(),
                normalizedEmail,
                hashedPassword,
                'student'
            ]
        );

        req.session.flash = {
            type: 'success',
            message: 'Account created! You can now sign in.'
        };

        res.redirect('/login');
    } catch (error) {
        console.error('Registration error:', error);

        if (error.code === 'ER_DUP_ENTRY') {
            return renderRegister(
                res, 409, 'Student ID or email is already registered.', old
            );
        }

        renderRegister(res, 500, 'Unable to register. Please try again.', old);
    }
});

// Log in a student
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (!email?.trim() || !password) {
            return res.status(400).render('login', {
                title: 'Login',
                error: 'Please enter your email and password.'
            });
        }

        const [users] = await db.promise().execute(
            'SELECT id, full_name, student_id, email, password, role FROM users WHERE email = ?',
            [email.trim().toLowerCase()]
        );

        if (users.length === 0) {
            return res.status(401).render('login', {
                title: 'Login',
                error: 'Invalid email or password.'
            });
        }

        const user = users[0];
        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
            return res.status(401).render('login', {
                title: 'Login',
                error: 'Invalid email or password.'
            });
        }

        // Remember the page they were trying to reach before regenerating
        const returnTo = req.session.returnTo;

        // Prevent session fixation by creating a fresh session
        req.session.regenerate((err) => {
            if (err) {
                console.error('Session error:', err);
                return res.fail(500, 'Unable to start your session. Please try again.');
            }

            req.session.user = {
                id: user.id,
                full_name: user.full_name,
                student_id: user.student_id,
                email: user.email,
                role: user.role
            };

            req.session.save((saveErr) => {
                if (saveErr) {
                    console.error('Session save error:', saveErr);
                    return res.fail(500, 'Unable to save your session. Please try again.');
                }

                // Only follow same-site paths
                const safeReturn =
                    typeof returnTo === 'string' &&
                    returnTo.startsWith('/') &&
                    !returnTo.startsWith('//')
                        ? returnTo
                        : '/';

                res.redirect(safeReturn);
            });
        });
    } catch (error) {
        console.error('Login error:', error);

        res.status(500).render('login', {
            title: 'Login',
            error: 'Something went wrong. Please try again.'
        });
    }
});

// Log out
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err);
            return res.fail(500, 'Unable to log out.');
        }

        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

module.exports = router;
