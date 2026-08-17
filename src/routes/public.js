'use strict';

const express = require('express');
const { db, photosOf } = require('../db');
const { ageOf } = require('../util');

const router = express.Router();

const COVER_SQL = `
  SELECT p.*, COALESCE(
    (SELECT ph.thumb_filename FROM photos ph WHERE ph.profile_id = p.id AND ph.is_cover = 1 LIMIT 1),
    (SELECT ph.thumb_filename FROM photos ph WHERE ph.profile_id = p.id ORDER BY ph.position, ph.id LIMIT 1)
  ) AS cover
  FROM profiles p
  WHERE p.status = 'published'
`;

function requireGateAccess(req, res, next) {
  const sitePassword = process.env.SITE_PASSWORD;
  if (!sitePassword || req.session.galleryUnlocked || res.locals.isOrganizer) return next();
  res.redirect(`/unlock?next=${encodeURIComponent(req.originalUrl)}`);
}

router.get('/unlock', (req, res) => {
  const next = typeof req.query.next === 'string' ? req.query.next : '/';
  if (!process.env.SITE_PASSWORD || req.session.galleryUnlocked) return res.redirect(next);
  res.render('unlock', { error: null, next });
});

router.post('/unlock', (req, res) => {
  const next = typeof req.body.next === 'string' ? req.body.next : '/';
  if (req.body.password === process.env.SITE_PASSWORD) {
    req.session.galleryUnlocked = true;
    return res.redirect(next);
  }
  res.status(401).render('unlock', { error: 'Incorrect password.', next });
});

router.get('/', requireGateAccess, (req, res) => {
  let profiles = db.prepare(COVER_SQL).all();
  profiles.forEach((p) => (p.age = ageOf(p)));

  const locations = [...new Set(profiles.map((p) => p.location))].sort((a, b) =>
    a.localeCompare(b)
  );

  const { location = '', sort = 'newest' } = req.query;
  if (location) profiles = profiles.filter((p) => p.location === location);
  const sorters = {
    newest: (a, b) => b.created_at.localeCompare(a.created_at),
    youngest: (a, b) => (a.age ?? 999) - (b.age ?? 999),
    oldest: (a, b) => (b.age ?? -1) - (a.age ?? -1),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  profiles.sort(sorters[sort] || sorters.newest);

  res.render('dashboard', { profiles, locations, location, sort });
});

router.get('/children/:id(\\d+)', requireGateAccess, (req, res) => {
  const profile = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.params.id);
  // Organizers may preview drafts; visitors only see published profiles (FR-12 side).
  if (!profile || (profile.status !== 'published' && !res.locals.isOrganizer)) {
    return res.status(404).render('404');
  }
  res.render('profile', {
    profile,
    age: ageOf(profile),
    photos: photosOf(profile.id),
    isPreview: profile.status !== 'published',
  });
});

router.get('/privacy', (req, res) => res.render('privacy'));

module.exports = router;
