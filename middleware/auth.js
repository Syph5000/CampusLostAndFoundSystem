// Require a logged-in user. Remembers the page they wanted so login can
// send them back to it.
function requireLogin(req, res, next) {
    if (!req.session.user) {
        if (req.method === 'GET') {
            req.session.returnTo = req.originalUrl;
        }

        return res.redirect('/login');
    }

    next();
}

module.exports = { requireLogin };
