require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');

// Connects to MySQL and prints the connection status
require('./config/db');

const authRoutes = require('./routes/auth');
const itemRoutes = require('./routes/items');
const claimRoutes = require('./routes/claims');

const app = express();
const PORT = process.env.PORT || 3000;

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files (css, images, uploaded item photos)
app.use(express.static(path.join(__dirname, 'public')));

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-secret-before-deployment',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 2
    }
}));

// Browsers ask for a favicon on every page; answer it here so it cannot
// use up the one-time flash message meant for the page itself.
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Values available in every EJS view
app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;

    // One-time message set before a redirect (see req.session.flash)
    res.locals.flash = req.session.flash || null;
    delete req.session.flash;

    // "2026-10-14" or "2026-10-14 09:30:00" -> "Oct 14, 2026"
    res.locals.formatDate = (value) => {
        if (!value) return '';

        const date = new Date(String(value).replace(' ', 'T'));

        if (Number.isNaN(date.getTime())) return String(value);

        return date.toLocaleDateString('en-PH', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    // Label and colour class for an item's badge
    res.locals.itemBadge = (item) => {
        if (item.status === 'claimed') {
            return { cls: 'claimed', label: 'Claimed' };
        }

        if (item.status === 'returned') {
            return { cls: 'returned', label: 'Returned' };
        }

        return item.item_type === 'found'
            ? { cls: 'found', label: 'Found' }
            : { cls: 'lost', label: 'Lost' };
    };

    // Render the friendly error page: res.fail(404, 'Item not found.')
    res.fail = (status, message) => {
        res.status(status).render('error', {
            title: status === 404 ? 'Page not found' : 'Something went wrong',
            status,
            message
        });
    };

    next();
});

// Routes
app.use('/', authRoutes);
app.use('/', itemRoutes);
app.use('/', claimRoutes);

// 404 for anything else
app.use((req, res) => {
    res.fail(404, 'The page you are looking for does not exist.');
});

// Unexpected errors
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);

    if (res.headersSent) {
        return next(err);
    }

    res.fail(500, 'Something went wrong on our side. Please try again.');
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
