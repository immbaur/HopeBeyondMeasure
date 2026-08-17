'use strict';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env file — env vars can still come from the environment itself
}

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const cookieSession = require('cookie-session');

const { db, DATA_DIR, UPLOADS_DIR } = require('./src/db');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Behind the Cloudflare Tunnel the app sees proxied requests (NFR-6).
app.set('trust proxy', 1);

app.use(express.urlencoded({ extended: false }));
app.use('/static', express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '30d', immutable: true }));

// Session secret persists in the data dir so logins survive restarts.
const secretFile = path.join(DATA_DIR, '.session-secret');
if (!fs.existsSync(secretFile)) {
  fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
}
app.use(
  cookieSession({
    name: 'hbm.session',
    keys: [process.env.SESSION_SECRET || fs.readFileSync(secretFile, 'utf8')],
    maxAge: 14 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    httpOnly: true,
  })
);

// Current user + CSRF token for every view; validate CSRF on form posts.
app.use((req, res, next) => {
  res.locals.user = req.session.userId
    ? db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.session.userId) || null
    : null;
  if (!res.locals.user) req.session.userId = null;

  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  res.locals.mainSite = 'https://thehopebeyondmeasure.org/';

  // Multipart posts (photo uploads) are checked in their route after multer runs.
  if (req.method === 'POST' && !req.is('multipart/form-data')) {
    if ((req.body && req.body._csrf) !== req.session.csrf) {
      return res.status(403).send('Invalid CSRF token — please go back and try again.');
    }
  }
  next();
});

app.use('/', publicRoutes);
app.use('/admin', adminRoutes);

app.use((req, res) => res.status(404).render('404'));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).send('Something went wrong. Please try again.');
});

app.listen(PORT, () => {
  console.log(`Hope Beyond Measure dashboard running at http://localhost:${PORT}`);
  const hasUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
  if (!hasUsers) {
    console.log(`First run: open http://localhost:${PORT}/admin/setup to create the organizer account.`);
  }
});
