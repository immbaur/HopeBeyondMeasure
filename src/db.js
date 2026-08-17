'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'app.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    date_of_birth TEXT,
    age_years INTEGER,
    location TEXT NOT NULL,
    living_situation TEXT,
    family_income TEXT,
    aspiration TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    consent_recorded INTEGER NOT NULL DEFAULT 0,
    consent_date TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    thumb_filename TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    is_cover INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_photos_profile ON photos(profile_id, position);
  CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
`);

/** Photos of a profile, cover first, then by manual order. */
function photosOf(profileId) {
  return db
    .prepare('SELECT * FROM photos WHERE profile_id = ? ORDER BY is_cover DESC, position, id')
    .all(profileId);
}

module.exports = { db, DATA_DIR, UPLOADS_DIR, photosOf };
