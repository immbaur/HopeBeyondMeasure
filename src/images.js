'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { UPLOADS_DIR } = require('./db');

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/**
 * Process an uploaded image buffer into a web-sized image and a thumbnail.
 * sharp does not copy input metadata unless asked to, so EXIF/GPS data is
 * stripped from the output (PS-4). `.rotate()` bakes in the EXIF orientation
 * first so photos are not sideways after stripping.
 * Returns { filename, thumbFilename }.
 */
async function processUpload(buffer) {
  const base = crypto.randomBytes(12).toString('hex');
  const filename = `${base}.webp`;
  const thumbFilename = `${base}_thumb.webp`;
  const img = sharp(buffer, { failOn: 'error' }).rotate();

  await img
    .clone()
    .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toFile(path.join(UPLOADS_DIR, filename));

  await img
    .clone()
    .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78 })
    .toFile(path.join(UPLOADS_DIR, thumbFilename));

  return { filename, thumbFilename };
}

async function deleteFiles(photo) {
  for (const f of [photo.filename, photo.thumb_filename]) {
    await fs.unlink(path.join(UPLOADS_DIR, f)).catch(() => {});
  }
}

module.exports = { processUpload, deleteFiles, ALLOWED_MIME };
