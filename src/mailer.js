'use strict';

const nodemailer = require('nodemailer');

/**
 * Sends the password-reset email when SMTP is configured via env
 * (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM). Without SMTP
 * config the reset link is printed to the server console instead, so the
 * feature still works on a fresh local install.
 */
async function sendPasswordReset(email, resetUrl) {
  if (!process.env.SMTP_HOST) {
    console.log(`[mail not configured] Password reset link for ${email}: ${resetUrl}`);
    return { delivered: false };
  }
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
  await transport.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to: email,
    subject: 'Reset your Hope Beyond Measure dashboard password',
    text:
      'Hello,\n\nA password reset was requested for your organizer account. ' +
      `Open this link to choose a new password (valid for 1 hour):\n\n${resetUrl}\n\n` +
      'If you did not request this, you can ignore this email.',
  });
  return { delivered: true };
}

module.exports = { sendPasswordReset };
