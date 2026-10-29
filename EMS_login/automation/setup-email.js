#!/usr/bin/env node
// Saves the email password into .env and sends a test email.
//   node setup-email.js          -> asks for the password, saves it, sends a test email
//   node setup-email.js --test   -> only sends a test email with the saved settings
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const ENV_FILE = path.join(__dirname, '.env');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

function savePassword(password) {
  const raw = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const lines = raw.split(/\r?\n/);
  // Quoted, so characters like # or spaces in the password are kept (unquoted, # starts a comment)
  const quoted = password.includes("'") ? `"${password.replace(/"/g, '\\"')}"` : `'${password}'`;
  const i = lines.findIndex(l => /^EMAIL_APP_PASSWORD=/.test(l));
  if (i >= 0) lines[i] = `EMAIL_APP_PASSWORD=${quoted}`;
  else lines.push(`EMAIL_APP_PASSWORD=${quoted}`);
  fs.writeFileSync(ENV_FILE, lines.join(eol), 'utf8');
}

async function main() {
  if (!process.argv.includes('--test')) {
    console.log('\nsupport@growthapex.in ka password paste karein (Hostinger mailbox password)');
    console.log('(Right-click se paste hota hai, phir Enter dabayein)\n');
    const password = await ask('Password: ');
    if (!password) { console.log('\n❌ Password khaali hai. Dobara chalayein.'); return false; }
    savePassword(password);
    console.log('\n✅ Password save ho gaya.');
  }

  require('dotenv').config({ path: ENV_FILE, override: true });
  const { sendEmail } = require('./email-sender');
  console.log(`\n📧 Test email bhej rahe hain: ${process.env.EMAIL_USER} -> ${process.env.EMAIL_TO || process.env.EMAIL_USER} ...`);
  try {
    await sendEmail('✅ GrowthApex EMS — test email',
      '*Email setup ho gaya!* 🎉\n\nAb se check-in alerts aur daily / weekly / monthly reports is email par bhi aayengi.\n\n_GrowthApex EMS_');
    console.log('\n🎉 Test email chala gaya! Apna inbox (aur Spam folder) check karein.');
    return true;
  } catch (err) {
    console.log(`\n❌ Email nahi gaya: ${err.message}`);
    if (/auth|535|Invalid login|credentials/i.test(err.message)) {
      console.log('👉 Password galat hai. Hostinger -> Emails -> support@growthapex.in -> password check / reset karke dobara chalayein.');
    }
    return false;
  }
}

main().then(ok => process.exit(ok ? 0 : 1));
