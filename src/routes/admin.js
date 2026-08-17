'use strict';

const crypto = require('node:crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { db, photosOf } = require('../db');
const { ageOf, INCOME_RANGES } = require('../util');
const { processUpload, deleteFiles, ALLOWED_MIME } = require('../images');
const { sendPasswordReset } = require('../mailer');

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 12 },
  fileFilter: (req, file, cb) => cb(null, ALLOWED_MIME.has(file.mimetype)),
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!res.locals.user) return res.redirect('/admin/login');
  next();
}

function hasUsers() {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0;
}

// ---------- First-run setup (creates the first organizer account) ----------

router.get('/setup', (req, res) => {
  if (hasUsers()) return res.redirect('/admin/login');
  res.render('admin/setup', { error: null, values: {} });
});

router.post('/setup', async (req, res) => {
  if (hasUsers()) return res.redirect('/admin/login');
  const { name = '', email = '', password = '' } = req.body;
  const error = !name.trim() || !email.includes('@')
    ? 'Please enter a name and a valid email address.'
    : password.length < 10
      ? 'Please choose a password of at least 10 characters.'
      : null;
  if (error) return res.status(422).render('admin/setup', { error, values: { name, email } });

  const hash = await bcrypt.hash(password, 12);
  const result = db
    .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email.trim().toLowerCase(), name.trim(), hash);
  req.session.userId = Number(result.lastInsertRowid);
  flash(req, 'success', 'Welcome! Your organizer account is ready.');
  res.redirect('/admin/profiles');
});

// ---------- Login / logout / password reset ----------

router.get('/login', (req, res) => {
  if (!hasUsers()) return res.redirect('/admin/setup');
  if (res.locals.user) return res.redirect('/admin/profiles');
  res.render('admin/login', { error: null, email: '' });
});

router.post('/login', async (req, res) => {
  const { email = '', password = '' } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase());
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) {
    return res.status(401).render('admin/login', { error: 'Wrong email or password.', email });
  }
  req.session.userId = user.id;
  res.redirect('/admin/profiles');
});

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/');
});

router.get('/forgot', (req, res) => res.render('admin/forgot', { sent: false }));

router.post('/forgot', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(
      "INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+1 hour'))"
    ).run(token, user.id);
    const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    await sendPasswordReset(email, `${base}/admin/reset/${token}`).catch((err) =>
      console.error('Failed to send reset email:', err.message)
    );
  }
  // Same response whether or not the account exists.
  res.render('admin/forgot', { sent: true });
});

function validResetToken(token) {
  return db
    .prepare("SELECT * FROM password_resets WHERE token = ? AND expires_at > datetime('now')")
    .get(token);
}

router.get('/reset/:token', (req, res) => {
  if (!validResetToken(req.params.token)) return res.status(404).render('404');
  res.render('admin/reset', { token: req.params.token, error: null });
});

router.post('/reset/:token', async (req, res) => {
  const reset = validResetToken(req.params.token);
  if (!reset) return res.status(404).render('404');
  const password = req.body.password || '';
  if (password.length < 10) {
    return res.status(422).render('admin/reset', {
      token: req.params.token,
      error: 'Please choose a password of at least 10 characters.',
    });
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, reset.user_id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(reset.user_id);
  req.session.userId = reset.user_id;
  flash(req, 'success', 'Your password has been updated.');
  res.redirect('/admin/profiles');
});

// ---------- Everything below requires a logged-in organizer (FR-12) ----------

router.use(requireAuth);

router.get('/', (req, res) => res.redirect('/admin/profiles'));

router.get('/profiles', (req, res) => {
  const profiles = db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM photos ph WHERE ph.profile_id = p.id) AS photo_count,
        COALESCE(
          (SELECT ph.thumb_filename FROM photos ph WHERE ph.profile_id = p.id AND ph.is_cover = 1 LIMIT 1),
          (SELECT ph.thumb_filename FROM photos ph WHERE ph.profile_id = p.id ORDER BY ph.position, ph.id LIMIT 1)
        ) AS cover
      FROM profiles p ORDER BY p.updated_at DESC`
    )
    .all();
  profiles.forEach((p) => (p.age = ageOf(p)));
  res.render('admin/profiles', { profiles });
});

// ---------- Create / edit ----------

function profileFromForm(body) {
  return {
    name: (body.name || '').trim(),
    date_of_birth: body.date_of_birth || null,
    age_years: body.age_years ? Number(body.age_years) : null,
    location: (body.location || '').trim(),
    living_situation: (body.living_situation || '').trim() || null,
    family_income: (body.family_income || '').trim() || null,
    aspiration: (body.aspiration || '').trim() || null,
    consent_recorded: body.consent_recorded ? 1 : 0,
  };
}

function validateProfile(v) {
  const errors = [];
  if (!v.name) errors.push('Please enter the child’s first name.');
  else if (/\s\S{2,}/.test(v.name)) {
    errors.push('Please use the first name only — no surnames on public pages.');
  }
  if (!v.date_of_birth && v.age_years == null) {
    errors.push('Please enter either a date of birth or an age.');
  }
  if (v.age_years != null && (!Number.isInteger(v.age_years) || v.age_years < 0 || v.age_years > 25)) {
    errors.push('Age must be a whole number between 0 and 25.');
  }
  if (v.date_of_birth && new Date(v.date_of_birth) > new Date()) {
    errors.push('The date of birth cannot be in the future.');
  }
  if (!v.location) errors.push('Please enter a location (region or town — never an address).');
  return errors;
}

router.get('/profiles/new', (req, res) => {
  res.render('admin/form', {
    profile: null,
    photos: [],
    errors: [],
    values: {},
    incomeRanges: INCOME_RANGES,
  });
});

router.post('/profiles', (req, res) => {
  const values = profileFromForm(req.body);
  const errors = validateProfile(values);
  if (errors.length) {
    return res.status(422).render('admin/form', {
      profile: null,
      photos: [],
      errors,
      values,
      incomeRanges: INCOME_RANGES,
    });
  }
  const result = db
    .prepare(
      `INSERT INTO profiles
        (name, date_of_birth, age_years, location, living_situation, family_income, aspiration,
         consent_recorded, consent_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN datetime('now') ELSE NULL END)`
    )
    .run(
      values.name, values.date_of_birth, values.age_years, values.location,
      values.living_situation, values.family_income, values.aspiration,
      values.consent_recorded, values.consent_recorded
    );
  flash(req, 'success', `${values.name}’s profile was created as a draft. You can add photos now.`);
  res.redirect(`/admin/profiles/${result.lastInsertRowid}/edit`);
});

function findProfile(req, res) {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  if (!profile) res.status(404).render('404');
  return profile;
}

router.get('/profiles/:id(\\d+)/edit', (req, res) => {
  const profile = findProfile(req, res);
  if (!profile) return;
  res.render('admin/form', {
    profile,
    photos: photosOf(profile.id),
    errors: [],
    values: profile,
    incomeRanges: INCOME_RANGES,
  });
});

router.post('/profiles/:id(\\d+)', (req, res) => {
  const profile = findProfile(req, res);
  if (!profile) return;
  const values = profileFromForm(req.body);
  const errors = validateProfile(values);
  if (errors.length) {
    return res.status(422).render('admin/form', {
      profile,
      photos: photosOf(profile.id),
      errors,
      values,
      incomeRanges: INCOME_RANGES,
    });
  }
  // Withdrawing consent unpublishes immediately (PS-5).
  const status = values.consent_recorded ? profile.status : 'draft';
  db.prepare(
    `UPDATE profiles SET
       name = ?, date_of_birth = ?, age_years = ?, location = ?, living_situation = ?,
       family_income = ?, aspiration = ?, consent_recorded = ?,
       consent_date = CASE
         WHEN ? = 0 THEN NULL
         WHEN consent_date IS NULL THEN datetime('now')
         ELSE consent_date END,
       status = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(
    values.name, values.date_of_birth, values.age_years, values.location,
    values.living_situation, values.family_income, values.aspiration,
    values.consent_recorded, values.consent_recorded, status, profile.id
  );
  flash(req, 'success', 'Profile saved.');
  res.redirect(`/admin/profiles/${profile.id}/edit`);
});

router.post('/profiles/:id(\\d+)/publish', (req, res) => {
  const profile = findProfile(req, res);
  if (!profile) return;
  if (!profile.consent_recorded) {
    flash(req, 'error', 'Cannot publish: parent/guardian consent has not been recorded yet.');
  } else {
    db.prepare(
      "UPDATE profiles SET status = 'published', updated_at = datetime('now') WHERE id = ?"
    ).run(profile.id);
    flash(req, 'success', `${profile.name}’s profile is now live on the dashboard.`);
  }
  res.redirect(req.get('referer') || '/admin/profiles');
});

router.post('/profiles/:id(\\d+)/unpublish', (req, res) => {
  const profile = findProfile(req, res);
  if (!profile) return;
  db.prepare(
    "UPDATE profiles SET status = 'draft', updated_at = datetime('now') WHERE id = ?"
  ).run(profile.id);
  flash(req, 'success', `${profile.name}’s profile was taken offline.`);
  res.redirect(req.get('referer') || '/admin/profiles');
});

router.post('/profiles/:id(\\d+)/delete', async (req, res) => {
  const profile = findProfile(req, res);
  if (!profile) return;
  const photos = photosOf(profile.id);
  db.prepare('DELETE FROM profiles WHERE id = ?').run(profile.id);
  for (const photo of photos) await deleteFiles(photo);
  flash(req, 'success', `${profile.name}’s profile and photos were deleted.`);
  res.redirect('/admin/profiles');
});

// ---------- Photos ----------

router.post('/profiles/:id(\\d+)/photos', upload.array('photos'), async (req, res, next) => {
  // multer parses multipart bodies after the global CSRF check, so verify here.
  if (req.body._csrf !== req.session.csrf) return res.status(403).send('Invalid CSRF token');
  const profile = findProfile(req, res);
  if (!profile) return;
  if (!req.files || req.files.length === 0) {
    flash(req, 'error', 'No images were uploaded. Please choose JPG, PNG, or WebP files.');
    return res.redirect(`/admin/profiles/${profile.id}/edit`);
  }
  try {
    const maxPos = db
      .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM photos WHERE profile_id = ?')
      .get(profile.id).m;
    const hasCover = db
      .prepare('SELECT COUNT(*) AS n FROM photos WHERE profile_id = ? AND is_cover = 1')
      .get(profile.id).n > 0;
    let pos = maxPos;
    let first = !hasCover;
    for (const file of req.files) {
      const { filename, thumbFilename } = await processUpload(file.buffer);
      db.prepare(
        'INSERT INTO photos (profile_id, filename, thumb_filename, position, is_cover) VALUES (?, ?, ?, ?, ?)'
      ).run(profile.id, filename, thumbFilename, ++pos, first ? 1 : 0);
      first = false;
    }
    flash(req, 'success', `${req.files.length} photo${req.files.length > 1 ? 's' : ''} added.`);
  } catch (err) {
    console.error('Photo upload failed:', err);
    flash(req, 'error', 'One of the images could not be processed. Please try a different file.');
  }
  res.redirect(`/admin/profiles/${profile.id}/edit`);
});

function findPhoto(req, res) {
  const photo = db.prepare('SELECT * FROM photos WHERE id = ?').get(req.params.id);
  if (!photo) res.status(404).render('404');
  return photo;
}

router.post('/photos/:id(\\d+)/delete', async (req, res) => {
  const photo = findPhoto(req, res);
  if (!photo) return;
  db.prepare('DELETE FROM photos WHERE id = ?').run(photo.id);
  await deleteFiles(photo);
  if (photo.is_cover) {
    db.prepare(
      `UPDATE photos SET is_cover = 1 WHERE id =
        (SELECT id FROM photos WHERE profile_id = ? ORDER BY position, id LIMIT 1)`
    ).run(photo.profile_id);
  }
  res.redirect(`/admin/profiles/${photo.profile_id}/edit`);
});

router.post('/photos/:id(\\d+)/cover', (req, res) => {
  const photo = findPhoto(req, res);
  if (!photo) return;
  db.prepare('UPDATE photos SET is_cover = 0 WHERE profile_id = ?').run(photo.profile_id);
  db.prepare('UPDATE photos SET is_cover = 1 WHERE id = ?').run(photo.id);
  res.redirect(`/admin/profiles/${photo.profile_id}/edit`);
});

router.post('/photos/:id(\\d+)/move', (req, res) => {
  const photo = findPhoto(req, res);
  if (!photo) return;
  const dir = req.body.dir === 'up' ? 'up' : 'down';
  const neighbor = db
    .prepare(
      dir === 'up'
        ? 'SELECT * FROM photos WHERE profile_id = ? AND position < ? ORDER BY position DESC LIMIT 1'
        : 'SELECT * FROM photos WHERE profile_id = ? AND position > ? ORDER BY position ASC LIMIT 1'
    )
    .get(photo.profile_id, photo.position);
  if (neighbor) {
    db.prepare('UPDATE photos SET position = ? WHERE id = ?').run(neighbor.position, photo.id);
    db.prepare('UPDATE photos SET position = ? WHERE id = ?').run(photo.position, neighbor.id);
  }
  res.redirect(`/admin/profiles/${photo.profile_id}/edit`);
});

// ---------- Organizer accounts (FR-13) ----------

router.get('/organizers', (req, res) => {
  const organizers = db.prepare('SELECT id, email, name, created_at FROM users ORDER BY name').all();
  res.render('admin/organizers', { organizers, error: null, values: {} });
});

router.post('/organizers', async (req, res) => {
  const { name = '', email = '', password = '' } = req.body;
  let error = null;
  if (!name.trim() || !email.includes('@')) error = 'Please enter a name and a valid email address.';
  else if (password.length < 10) error = 'Please choose a password of at least 10 characters.';
  else if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email.trim().toLowerCase())) {
    error = 'An organizer with this email already exists.';
  }
  if (error) {
    const organizers = db.prepare('SELECT id, email, name, created_at FROM users ORDER BY name').all();
    return res.status(422).render('admin/organizers', { organizers, error, values: { name, email } });
  }
  const hash = await bcrypt.hash(password, 12);
  db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)').run(
    email.trim().toLowerCase(), name.trim(), hash
  );
  flash(req, 'success', `Organizer account for ${name.trim()} created.`);
  res.redirect('/admin/organizers');
});

router.post('/organizers/:id(\\d+)/delete', (req, res) => {
  const id = Number(req.params.id);
  if (id === res.locals.user.id) {
    flash(req, 'error', 'You cannot delete your own account while logged in.');
  } else {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    flash(req, 'success', 'Organizer account removed.');
  }
  res.redirect('/admin/organizers');
});

module.exports = router;
