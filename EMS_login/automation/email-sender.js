// Email copy of the WhatsApp reports (check-in alerts, daily, weekly, monthly) via SMTP.
// .env: EMAIL_USER (sender, e.g. support@growthapex.in), EMAIL_APP_PASSWORD (mailbox password,
//       or a Google App Password for Gmail),
//       EMAIL_TO (comma-separated recipients, defaults to EMAIL_USER),
//       SMTP_HOST / SMTP_PORT (Hostinger: smtp.hostinger.com / 465; default Gmail).
const nodemailer = require('nodemailer');

let transporter = null;

function emailEnabled() {
  return !!(process.env.EMAIL_USER && process.env.EMAIL_APP_PASSWORD);
}

function getTransporter() {
  if (transporter) return transporter;
  const port = parseInt(process.env.SMTP_PORT, 10) || 465;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  // Google shows App Passwords with spaces ("abcd efgh ..."); a normal mailbox password is used as-is
  const pass = host === 'smtp.gmail.com' ? process.env.EMAIL_APP_PASSWORD.replace(/\s+/g, '') : process.env.EMAIL_APP_PASSWORD;
  transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: process.env.EMAIL_USER, pass } });
  return transporter;
}

// Which outbox items also go by email, and their subject line
function emailSubject(item) {
  const id = String(item.id);
  if (id.startsWith('checkin_')) {
    const name = (String(item.message).match(/\*Employee:\* ([^\n]+)/) || [])[1] || 'Employee';
    return `📍 Check-in: ${name}${/Late Check-In/.test(item.message) ? ' (Late)' : ''}`;
  }
  if (id.startsWith('daily_')) return `🚀 Daily Attendance Report — ${id.slice(6)}`;
  if (id.startsWith('weekly_')) return `📊 Weekly Report — week of ${id.slice(7)}`;
  if (id.startsWith('monthly_')) return `🏆 Monthly Report — ${id.slice(8)}`;
  return null;
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// WhatsApp markup -> simple HTML (*bold*, _italic_, links, line breaks)
function toHtml(message) {
  const body = escapeHtml(message)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,]|$)/gm, '$1<i>$2</i>')
    .replace(/\n/g, '<br>');
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">${body}</div>`;
}

async function sendEmail(subject, message) {
  if (!emailEnabled()) {
    const err = new Error('Email not configured (EMAIL_USER / EMAIL_APP_PASSWORD missing in .env)');
    err.permanent = true;
    throw err;
  }
  const info = await getTransporter().sendMail({
    from: `"GrowthApex EMS" <${process.env.EMAIL_USER}>`,
    to: process.env.EMAIL_TO || process.env.EMAIL_USER,
    subject,
    text: message.replace(/\*([^*\n]+)\*/g, '$1'),
    html: toHtml(message)
  });
  console.log(`📧 Email sent: ${info.messageId}`);
  return info;
}

module.exports = { sendEmail, emailSubject, emailEnabled };
