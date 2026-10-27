const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const axios = require('axios');
const fs = require('fs');

// Helper to extract invite code from a WhatsApp chat link
function getInviteCode(link) {
  if (!link) return null;
  const match = link.match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

// Option 1: Send via whatsapp-web.js (Free Self-Hosted)
async function sendViaWhatsappWeb(message, inviteLink, groupJid) {
  return new Promise((resolve, reject) => {
    console.log("Initializing WhatsApp Web Client...");
    
    // Configure client with local authentication persistence
    const client = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(__dirname, '.wwebjs_auth')
      }),
      webVersionCache: {
        type: 'remote',
        remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html'
      },
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-site-isolation-trials',
          '--no-first-run',
          '--no-zygote'
        ]
      }
    });

    let qrTimeout = null;

    client.on('qr', (qr) => {
      console.log('------------------------------------------------------------------');
      console.log('📱 ACTION REQUIRED: Scan the QR code below using your WhatsApp app:');
      console.log('👉 WhatsApp -> Linked Devices -> Link a Device');
      console.log('------------------------------------------------------------------');
      qrcode.generate(qr, { small: true });
      console.log('------------------------------------------------------------------');
      
      // If running in a CI/CD or non-interactive environment, alert the user
      if (process.env.CI) {
        console.warn("⚠️ Warning: Running in non-interactive environment (CI). QR code cannot be scanned easily.");
      }
    });

    client.on('ready', async () => {
      console.log('⚡ WhatsApp Client is ready!');
      
      let targetJid = groupJid;
      const inviteCode = getInviteCode(inviteLink);

      try {
        // 1. If we don't have the Group JID but have an invite link, try to join/resolve it
        if (!targetJid && inviteCode) {
          console.log(`Joining group using invite code: ${inviteCode}...`);
          try {
            targetJid = await client.acceptInvite(inviteCode);
            console.log(`✅ Successfully joined the group! JID: ${targetJid}`);
            
            // Try to write the JID back to .env if possible to speed up future runs
            saveJidToEnv(targetJid);
          } catch (joinError) {
            console.warn("Could not join group (might already be a member). Scanning chat list...");
            
            // Scan chats to see if we're already in it
            const chats = await client.getChats();
            const groupChat = chats.find(c => 
              c.isGroup && 
              (c.name.toLowerCase().includes("growthapex") || 
               c.name.toLowerCase().includes("ems") ||
               c.id._serialized.includes(inviteCode))
            );

            if (groupChat) {
              targetJid = groupChat.id._serialized;
              console.log(`✅ Found existing group chat JID: ${targetJid} (${groupChat.name})`);
              saveJidToEnv(targetJid);
            } else {
              throw new Error("Could not find the target group in active chats. Please ensure the linked account is added to the group.");
            }
          }
        }

        // 2. Send the message
        if (targetJid) {
          console.log(`Sending report to JID: ${targetJid}...`);
          await client.sendMessage(targetJid, message);
          console.log("🎉 Report sent successfully via WhatsApp Web!");
          
          // Wait 5 seconds to ensure the WebSocket completes transmission over the network
          console.log("Waiting 5s for network synchronization...");
          await new Promise(r => setTimeout(r, 5000));
          
          // Clean shutdown
          console.log("Shutting down WhatsApp Web client...");
          try {
            await client.destroy();
          } catch (destroyError) {
            // Ignore target closed errors during cleanup
          }
          resolve(true);
        } else {
          throw new Error("Target Group JID or Invite Link is missing.");
        }
      } catch (err) {
        console.error("❌ Error sending message via WhatsApp Web:", err.message);
        await client.destroy();
        reject(err);
      }
    });

    client.on('auth_failure', async (msg) => {
      console.error('❌ WhatsApp Authentication failure:', msg);
      reject(new Error('Auth failure'));
    });

    client.on('disconnected', (reason) => {
      console.log('🔌 WhatsApp Client was disconnected:', reason);
    });

    client.initialize().catch(err => {
      console.error("❌ Failed to initialize WhatsApp Web client:", err.message);
      reject(err);
    });
  });
}

// Option 2: Send via Green-API (Cloud / Serverless)
async function sendViaGreenApi(message, groupJid) {
  const instanceId = process.env.GREEN_API_INSTANCE_ID;
  const apiToken = process.env.GREEN_API_TOKEN;

  if (!instanceId || !apiToken) {
    throw new Error("GREEN_API_INSTANCE_ID and GREEN_API_TOKEN must be set in your .env file to use green-api.");
  }

  if (!groupJid) {
    throw new Error(
      "WA_GROUP_JID (e.g. 12036302482394@g.us) must be configured in .env for Green-API. " +
      "Green-API cannot automatically join groups via invite links."
    );
  }

  await assertGreenApiAuthorized(instanceId, apiToken);

  console.log(`Sending message to group ${groupJid} via Green-API...`);
  const url = `${greenApiBase()}/waInstance${instanceId}/sendMessage/${apiToken}`;

  const response = await axios.post(url, {
    chatId: groupJid,
    message: message
  }, { timeout: 30000 });

  if (response.data && response.data.idMessage) {
    console.log("🎉 Report sent successfully via Green-API! Message ID:", response.data.idMessage);
    return true;
  } else {
    throw new Error(`Green-API response error: ${JSON.stringify(response.data)}`);
  }
}

// Each instance has its own host (apiUrl in the Green-API console)
function greenApiBase() {
  return (process.env.GREEN_API_URL || 'https://api.green-api.com').replace(/\/+$/, '');
}

// Green-API silently stops delivering when the phone is unlinked, so check the instance first.
// Result is cached for 5 minutes to avoid an extra call per alert.
let greenApiStateCache = { state: null, at: 0 };

async function getGreenApiState(instanceId, apiToken) {
  if (greenApiStateCache.state && Date.now() - greenApiStateCache.at < 5 * 60 * 1000) {
    return greenApiStateCache.state;
  }
  const url = `${greenApiBase()}/waInstance${instanceId}/getStateInstance/${apiToken}`;
  const { data } = await axios.get(url, { timeout: 15000 });
  greenApiStateCache = { state: data.stateInstance, at: Date.now() };
  return data.stateInstance;
}

async function assertGreenApiAuthorized(instanceId, apiToken) {
  let state;
  try {
    state = await getGreenApiState(instanceId, apiToken);
  } catch (err) {
    if (err.response && (err.response.status === 401 || err.response.status === 403)) {
      const e = new Error('Green-API rejected the instance id / token. Check GREEN_API_INSTANCE_ID and GREEN_API_TOKEN.');
      e.permanent = true;
      throw e;
    }
    throw err; // network issue — caller will retry / queue
  }
  if (state !== 'authorized') {
    greenApiStateCache = { state: null, at: 0 };
    const e = new Error(
      `Green-API instance is "${state}". WhatsApp is not linked — open console.green-api.com and scan the QR code ` +
      `(WhatsApp -> Linked Devices -> Link a Device). Messages are kept in the queue until then.`
    );
    e.permanent = true;
    throw e;
  }
}

// Helper: Save resolved Group JID back to .env
function saveJidToEnv(jid) {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    
    let envContent = fs.readFileSync(envPath, 'utf8');
    if (envContent.includes('WA_GROUP_JID=')) {
      // Check if WA_GROUP_JID is empty
      const regex = /WA_GROUP_JID=([^\r\n]*)/;
      const match = envContent.match(regex);
      if (match && !match[1].trim()) {
        envContent = envContent.replace(regex, `WA_GROUP_JID=${jid}`);
        fs.writeFileSync(envPath, envContent, 'utf8');
        console.log(`💾 Saved resolved Group JID (${jid}) to .env for future runs.`);
      }
    }
  } catch (err) {
    console.warn("Could not save Group JID to .env file:", err.message);
  }
}

// Main Send Router
async function sendReport(message) {
  const provider = (process.env.PROVIDER || 'whatsapp-web-js').toLowerCase();
  const inviteLink = process.env.WA_INVITE_LINK;
  const groupJid = process.env.WA_GROUP_JID;

  if (provider === 'green-api') {
    return await sendViaGreenApi(message, groupJid);
  } else if (provider === 'whatsapp-web-js') {
    return await sendViaWhatsappWeb(message, inviteLink, groupJid);
  } else {
    throw new Error(`Unknown provider: ${provider}. Use 'whatsapp-web-js' or 'green-api'.`);
  }
}

module.exports = {
  sendReport,
  getGreenApiState
};
