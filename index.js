// ============================================================
// PASIYA MD — WhatsApp Bot Core v3  (index.js)
// Features: Auto-seen, Auto-react, Ping, Settings, Creative,
//           AI, Owner panel, persisted config
// ============================================================
const { default: makeWASocket, DisconnectReason, proto } = require('baileys');
const { useMultiFileAuthState, generateWAMessageFromContent, prepareWAMessageMedia } = require('baileys');
const { promises: fs, existsSync, mkdirSync, readFileSync, writeFileSync } = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// =============================================
// CONFIG
// =============================================
const OWNER      = process.env.OWNER_NUMBER || '94xxxxxxxxx';
const BOT_NAME   = process.env.BOT_NAME     || 'PASIYA MD';
const SESSION_DIR = path.join(__dirname, 'session');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';

if (!existsSync(SESSION_DIR)) mkdirSync(SESSION_DIR, { recursive: true });

// =============================================
// PERSISTENT CONFIG  (survives restarts)
// =============================================
function loadConfig() {
  try {
    if (existsSync(CONFIG_FILE)) return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
  } catch(e) { console.error('[CONFIG] Load error:', e.message); }
  return {
    mode: 'public',           // public | private | group
    autoAI: false,            // auto AI assistant on every message
    autoSeen: true,           // auto mark seen
    autoReact: true           // auto react
  };
}
function saveConfig() {
  try { writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8'); } catch(e) {}
}
let config = loadConfig();

// =============================================
// SHARED STATE  (exported for server.js)
// =============================================
let _sock = null, _connected = false, _pairCode = null, _pairRequested = false;
const botState = {
  get sock()          { return _sock; },
  get connected()     { return _connected; },
  get pairCode()      { return _pairCode; },
  get pairRequested() { return _pairRequested; },
  set pairRequested(v){ _pairRequested = v; },
  set pairCode(v)     { _pairCode = v; }
};
module.exports = { botState };

// =============================================
// DATA STORES
// =============================================
const APK_STORE = [
  { name:'WhatsApp Business', version:'2.24.1', link:'https://www.mediafire.com/apk1' },
  { name:'YouTube ReVanced',  version:'2024.01',link:'https://www.mediafire.com/apk2' },
  { name:'Instagram Mod',     version:'240.0',  link:'https://www.mediafire.com/apk3' },
  { name:'Facebook Lite',     version:'400.0',  link:'https://www.mediafire.com/apk4' }
];
const PAST_PAPERS = [
  { subject:'Mathematics', year:'2023', grade:'A/L', link:'https://www.mediafire.com/pp1' },
  { subject:'Physics',     year:'2023', grade:'A/L', link:'https://www.mediafire.com/pp2' },
  { subject:'Chemistry',   year:'2023', grade:'A/L', link:'https://www.mediafire.com/pp3' },
  { subject:'English',     year:'2023', grade:'O/L', link:'https://www.mediafire.com/pp4' },
  { subject:'Biology',     year:'2022', grade:'A/L', link:'https://www.mediafire.com/pp5' }
];
const MEDIAFIRE_LINKS = [
  { name:'🎵 Music Collection 2024', link:'https://www.mediafire.com/mf1' },
  { name:'🎥 Movie Pack 2024',       link:'https://www.mediafire.com/mf2' },
  { name:'📦 APK Collection',        link:'https://www.mediafire.com/mf3' },
  { name:'📝 Study Materials',       link:'https://www.mediafire.com/mf4' },
  { name:'🎮 Games Collection',      link:'https://www.mediafire.com/mf5' }
];

// =============================================
// USER STATE & HELPERS
// =============================================
let userState = {};   // chatId → current menu state
let aiHistory = {};   // chatId → [{role,content}…] for conversation context

const REACT_EMOJIS = ['👍','❤️','🔥','😂','👏','⭐','💯','😍','🎉','✅','💪','🙌','😊','👌','🤩'];

function randEmoji() { return REACT_EMOJIS[Math.floor(Math.random() * REACT_EMOJIS.length)]; }

function isOwner(chatId) {
  // chatId format: "94771234567@s.whatsapp.net"
  const num = chatId.replace(/@s\.whatsapp\.net/, '').replace(/@g\.us/, '');
  return num === OWNER;
}

// =============================================
// MENU FORMATTERS
// =============================================
function fmt_main() {
  return (
    `🌟 *${BOT_NAME}* 🌟\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  1. 🎵 Songs / Music\n` +
    `  2. 🎥 Videos\n` +
    `  3. 📘 Facebook Videos\n` +
    `  4. 🎭 TikTok Videos\n` +
    `  5. 📦 APK Downloads\n` +
    `  6. 📝 Past Papers\n` +
    `  7. 📋 Mediafire Links\n` +
    `  8. 🤖 AI Menu\n` +
    `  9. 🎨 Creative\n` +
    `  10. ⚙️ Settings\n` +
    (isOwner((userState._current||''))||true ? `  11. 👑 Owner Panel\n` : '') +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  ping  → Ping\n` +
    `  alive → Alive check\n` +
    `  help  → Help\n` +
    `━━━━━━━━━━━━━━━━━━━━━`
  );
}
function fmt_main_for(chatId) {
  let m =
    `🌟 *${BOT_NAME}* 🌟\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  1. 🎵 Songs / Music\n` +
    `  2. 🎥 Videos\n` +
    `  3. 📘 Facebook Videos\n` +
    `  4. 🎭 TikTok Videos\n` +
    `  5. 📦 APK Downloads\n` +
    `  6. 📝 Past Papers\n` +
    `  7. 📋 Mediafire Links\n` +
    `  8. 🤖 AI Menu\n` +
    `  9. 🎨 Creative\n` +
    `  10. ⚙️ Settings\n`;
  if (isOwner(chatId)) m += `  11. 👑 Owner Panel\n`;
  m +=
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  ping  → Ping\n` +
    `  alive → Alive check\n` +
    `  help  → Help\n` +
    `━━━━━━━━━━━━━━━━━━━━━`;
  return m;
}
function fmt_apk() {
  let m = '📦 *APK Store*\n━━━━━━━━━━━━━━━━━━━━━\n';
  APK_STORE.forEach((a,i) => { m += `  ${i+1}. ${a.name} (v${a.version})\n`; });
  return m + '━━━━━━━━━━━━━━━━━━━━━\nSend number or *back*';
}
function fmt_papers() {
  let m = '📝 *Past Papers*\n━━━━━━━━━━━━━━━━━━━━━\n';
  PAST_PAPERS.forEach((p,i) => { m += `  ${i+1}. ${p.subject} | ${p.year} | ${p.grade}\n`; });
  return m + '━━━━━━━━━━━━━━━━━━━━━\nSend number or *back*';
}
function fmt_mediafire() {
  let m = '📋 *Mediafire Links*\n━━━━━━━━━━━━━━━━━━━━━\n';
  MEDIAFIRE_LINKS.forEach((l,i) => { m += `  ${i+1}. ${l.name}\n`; });
  return m + '━━━━━━━━━━━━━━━━━━━━━\nSend number or *back*';
}
function fmt_ai_menu() {
  return (
    `🤖 *AI Menu*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  1. 💬 AI Chat\n` +
    `  2. 🖼️  AI Image (describe)\n` +
    `  3. 🤖 AI Auto Assistant — ${config.autoAI ? '✅ ON' : '❌ OFF'}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\nSend number or *back*`
  );
}
function fmt_creative() {
  return (
    `🎨 *Creative*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  1. 🏷️  Logo (send text)\n` +
    `  2. 🎟️  Sticker (send text)\n` +
    `━━━━━━━━━━━━━━━━━━━━━\nSend number or *back*`
  );
}
function fmt_settings() {
  return (
    `⚙️ *Settings*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  Mode : ${config.mode === 'private' ? '🔒 Private' : config.mode === 'group' ? '👥 Group' : '🌐 Public'}\n` +
    `  Auto Seen   : ${config.autoSeen ? '✅ ON' : '❌ OFF'}\n` +
    `  Auto React  : ${config.autoReact ? '✅ ON' : '❌ OFF'}\n` +
    `  Auto AI     : ${config.autoAI ? '✅ ON' : '❌ OFF'}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  1. 🔒 Bot Private\n` +
    `  2. 🌐 Bot Public\n` +
    `  3. 👥 Bot Group\n` +
    `  4. 🤖 Auto AI — ${config.autoAI ? 'ON (tap to OFF)' : 'OFF (tap to ON)'}\n` +
    `━━━━━━━━━━━━━━━━━━━━━\nSend number or *back*`
  );
}
function fmt_owner() {
  return (
    `👑 *Owner Panel*\n` +
    `━━━━━━━━━━━━━━━━━━━━━\n` +
    `  1. ⚙️  Settings\n` +
    `  2. 📊 Bot Status\n` +
    `  3. 🔄 Reset Config\n` +
    `  4. 📋 Show Config\n` +
    `━━━━━━━━━━━━━━━━━━━━━\nSend number or *back*`
  );
}

// =============================================
// AI HELPERS  (Anthropic API)
// =============================================
async function callAI(prompt, systemMsg) {
  if (!ANTHROPIC_KEY) return '⚠️ *AI not configured.*\nSet ANTHROPIC_API_KEY in your .env file.';
  try {
    const https = require('https');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemMsg || 'You are a helpful assistant called PASIYA MD. Reply concisely.',
      messages: [{ role: 'user', content: prompt }]
    });
    return await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.content?.[0]?.text || '⚠️ No response from AI.');
          } catch(e) { resolve('⚠️ AI parse error.'); }
        });
      });
      req.on('error', () => resolve('⚠️ AI request failed. Check your API key.'));
      req.write(body);
      req.end();
    });
  } catch(e) { return '⚠️ AI error: ' + e.message; }
}

async function callAIConversation(chatId, userMsg) {
  if (!ANTHROPIC_KEY) return '⚠️ *AI not configured.* Set ANTHROPIC_API_KEY in .env';
  if (!aiHistory[chatId]) aiHistory[chatId] = [];
  aiHistory[chatId].push({ role: 'user', content: userMsg });
  // Keep last 10 messages only
  if (aiHistory[chatId].length > 10) aiHistory[chatId] = aiHistory[chatId].slice(-10);

  try {
    const https = require('https');
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: 'You are PASIYA MD, a helpful WhatsApp bot assistant. Reply concisely and helpfully.',
      messages: aiHistory[chatId]
    });
    const reply = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01'
        }
      }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.content?.[0]?.text || '⚠️ No response.');
          } catch(e) { resolve('⚠️ Parse error.'); }
        });
      });
      req.on('error', () => resolve('⚠️ Request failed.'));
      req.write(body);
      req.end();
    });
    aiHistory[chatId].push({ role: 'assistant', content: reply });
    return reply;
  } catch(e) { return '⚠️ AI error.'; }
}

// =============================================
// AUTO SEEN + AUTO REACT
// =============================================
async function autoSeen(sock, msg) {
  if (!config.autoSeen) return;
  try {
    const chatId = msg.key.remoteJid;
    // Send "seen" (read receipt)
    await sock.sendReadReceipt(chatId, [msg.key]);
    // Send typing presence briefly
    await sock.sendPresence('composing', chatId);
    await new Promise(r => setTimeout(r, 400 + Math.random()*600));
    await sock.sendPresence('paused', chatId);
  } catch(e) { /* silent */ }
}

async function autoReact(sock, msg) {
  if (!config.autoReact) return;
  try {
    const emoji = randEmoji();
    await sock.sendMessage(msg.key.remoteJid, {
      react: { text: emoji, key: msg.key }
    });
  } catch(e) { /* silent */ }
}

// =============================================
// LOGO / STICKER GENERATION (text-based image via sharp)
// =============================================
async function generateLogo(text) {
  try {
    const sharp = require('sharp');
    const w = 400, h = 200;
    // Build SVG dynamically
    const fontSize = text.length > 12 ? 32 : text.length > 6 ? 42 : 52;
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#0a0c10"/>
          <stop offset="100%" stop-color="#111520"/>
        </linearGradient>
        <linearGradient id="txt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00c8ff"/>
          <stop offset="50%" stop-color="#7c4dff"/>
          <stop offset="100%" stop-color="#00c8ff"/>
        </linearGradient>
      </defs>
      <rect width="${w}" height="${h}" rx="24" fill="url(#bg)" stroke="#00c8ff" stroke-width="2" stroke-opacity="0.3"/>
      <rect width="${w}" height="${h}" rx="24" fill="none" stroke="#00c8ff" stroke-width="1" stroke-opacity="0.08" x="4" y="4"/>
      <circle cx="30" cy="30" r="6" fill="#00c8ff" opacity="0.6"/>
      <circle cx="${w-30}" cy="30" r="4" fill="#7c4dff" opacity="0.5"/>
      <circle cx="30" cy="${h-30}" r="4" fill="#7c4dff" opacity="0.4"/>
      <circle cx="${w-30}" cy="${h-30}" r="6" fill="#00c8ff" opacity="0.5"/>
      <line x1="36" y1="30" x2="${w-34}" y2="30" stroke="#00c8ff" stroke-width="0.5" stroke-opacity="0.15"/>
      <line x1="30" y1="36" x2="30" y2="${h-34}" stroke="#00c8ff" stroke-width="0.5" stroke-opacity="0.15"/>
      <line x1="${w-30}" y1="36" x2="${w-30}" y2="${h-34}" stroke="#7c4dff" stroke-width="0.5" stroke-opacity="0.15"/>
      <line x1="36" y1="${h-30}" x2="${w-34}" y2="${h-30}" stroke="#00c8ff" stroke-width="0.5" stroke-opacity="0.15"/>
      <text x="${w/2}" y="${h/2 + fontSize*0.35}" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="${fontSize}" font-weight="900" fill="url(#txt)" letter-spacing="3">${text.toUpperCase()}</text>
      <text x="${w/2}" y="${h/2 + fontSize*0.35 + 28}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#00c8ff" opacity="0.5" letter-spacing="4">PASIYA MD</text>
    </svg>`;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    return buf;
  } catch(e) {
    console.error('[LOGO]', e.message);
    return null;
  }
}

async function generateSticker(text) {
  try {
    const sharp = require('sharp');
    const w = 512, h = 512;
    const fontSize = text.length > 18 ? 36 : text.length > 10 ? 48 : 64;
    const lines = text.length > 20 ? [text.slice(0, Math.ceil(text.length/2)), text.slice(Math.ceil(text.length/2))] : [text];
    let textElems = '';
    lines.forEach((line, i) => {
      const yPos = h/2 - (lines.length-1)*fontSize*0.3 + i*fontSize*1.1;
      textElems += `<text x="${w/2}" y="${yPos}" text-anchor="middle" font-family="Arial Black, sans-serif" font-size="${fontSize}" font-weight="900" fill="url(#g1)" letter-spacing="2">${line.toUpperCase()}</text>`;
    });
    const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#00e5ff"/>
          <stop offset="50%" stop-color="#ff6f00"/>
          <stop offset="100%" stop-color="#7c4dff"/>
        </linearGradient>
        <radialGradient id="bg1" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#1a1a2e"/>
          <stop offset="100%" stop-color="#0a0a15"/>
        </radialGradient>
      </defs>
      <rect width="${w}" height="${h}" rx="60" fill="url(#bg1)"/>
      <circle cx="${w/2}" cy="${h/2}" r="200" fill="none" stroke="#00e5ff" stroke-width="2" stroke-opacity="0.15"/>
      <circle cx="${w/2}" cy="${h/2}" r="160" fill="none" stroke="#7c4dff" stroke-width="1" stroke-opacity="0.1"/>
      <circle cx="60" cy="60" r="10" fill="#00e5ff" opacity="0.4"/>
      <circle cx="${w-60}" cy="60" r="7" fill="#ff6f00" opacity="0.35"/>
      <circle cx="60" cy="${h-60}" r="7" fill="#7c4dff" opacity="0.35"/>
      <circle cx="${w-60}" cy="${h-60}" r="10" fill="#00e5ff" opacity="0.3"/>
      ${textElems}
    </svg>`;
    const buf = await sharp(Buffer.from(svg)).png().toBuffer();
    return buf;
  } catch(e) {
    console.error('[STICKER]', e.message);
    return null;
  }
}

// =============================================
// MAIN MESSAGE HANDLER
// =============================================
async function handleMessage(sock, chatId, text, msg) {
  const input = text.trim().toLowerCase();
  const state = userState[chatId] || 'main';

  try {
    // ─────────────────────────────────────────
    // GLOBAL COMMANDS (work from any state)
    // ─────────────────────────────────────────
    if (['hi','hello','hey','start','/start'].includes(input)) {
      userState[chatId] = 'main';
      aiHistory[chatId] = [];
      return await sock.sendMessage(chatId, { text: fmt_main_for(chatId) });
    }
    if (['back','menu','main'].includes(input)) {
      userState[chatId] = 'main';
      return await sock.sendMessage(chatId, { text: fmt_main_for(chatId) });
    }

    // ── PING ──
    if (input === 'ping') {
      const start = Date.now();
      await sock.sendMessage(chatId, { text: '🏓 *Pong!*' });
      const latency = Date.now() - start;
      return await sock.sendMessage(chatId, { text: `⚡ Latency: *${latency}ms*\n🟢 Bot is alive and running!` });
    }

    // ── ALIVE ──
    if (input === 'alive') {
      const upMs = process.uptime() * 1000;
      const h = Math.floor(upMs / 3600000);
      const m = Math.floor((upMs % 3600000) / 60000);
      const s = Math.floor((upMs % 60000) / 1000);
      return await sock.sendMessage(chatId, {
        text:
          `✅ *${BOT_NAME} is Alive!*\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `⏱️  Uptime : ${h}h ${m}m ${s}s\n` +
          `🔧 Mode   : ${config.mode}\n` +
          `👁️  Auto Seen : ${config.autoSeen ? 'ON' : 'OFF'}\n` +
          `😄 Auto React : ${config.autoReact ? 'ON' : 'OFF'}\n` +
          `🤖 Auto AI   : ${config.autoAI ? 'ON' : 'OFF'}\n` +
          `━━━━━━━━━━━━━━━━━━━━━`
      });
    }

    // ── HELP ──
    if (input === 'help') {
      return await sock.sendMessage(chatId, {
        text:
          `📖 *${BOT_NAME} Help*\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `• *hi* / *start* → Main Menu\n` +
          `• *back* / *menu* → Go Back\n` +
          `• *ping* → Ping test\n` +
          `• *alive* → Bot status\n` +
          `• *help* → This message\n` +
          `• *ai <question>* → Quick AI\n` +
          `• YouTube / FB / TikTok link → Download\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `Bot runs 24/7. No errors!`
      });
    }

    // ── QUICK AI (from anywhere: "ai what is python?") ──
    if (input.startsWith('ai ') && input.length > 3) {
      const question = text.trim().slice(3);
      await sock.sendMessage(chatId, { text: '🤖 *Thinking…*' });
      const answer = await callAI(question);
      return await sock.sendMessage(chatId, { text: `🤖 *AI Answer:*\n━━━━━━━━━━━━━━━━━━━━━\n${answer}\n━━━━━━━━━━━━━━━━━━━━━` });
    }

    // ─────────────────────────────────────────
    // MAIN MENU ROUTING
    // ─────────────────────────────────────────
    if (state === 'main') {
      // Songs
      if (input === '1') { userState[chatId]='songs'; return await sock.sendMessage(chatId,{ text:`🎵 *Songs Download*\n━━━━━━━━━━━━━━━━━━━━━\nSend a YouTube song link!\nExample: https://youtube.com/watch?v=xxxxx\n━━━━━━━━━━━━━━━━━━━━━\nSend *back* to return` }); }
      // Videos
      if (input === '2') { userState[chatId]='videos'; return await sock.sendMessage(chatId,{ text:`🎥 *Video Download*\n━━━━━━━━━━━━━━━━━━━━━\nSend a YouTube video link!\nExample: https://youtube.com/watch?v=xxxxx\n━━━━━━━━━━━━━━━━━━━━━\nSend *back* to return` }); }
      // Facebook
      if (input === '3') { userState[chatId]='facebook'; return await sock.sendMessage(chatId,{ text:`📘 *Facebook Video Download*\n━━━━━━━━━━━━━━━━━━━━━\nSend a Facebook video link!\n━━━━━━━━━━━━━━━━━━━━━\nSend *back* to return` }); }
      // TikTok
      if (input === '4') { userState[chatId]='tiktok'; return await sock.sendMessage(chatId,{ text:`🎭 *TikTok Video Download*\n━━━━━━━━━━━━━━━━━━━━━\nSend a TikTok video link!\n━━━━━━━━━━━━━━━━━━━━━\nSend *back* to return` }); }
      // APK
      if (input === '5') { userState[chatId]='apk'; return await sock.sendMessage(chatId,{ text: fmt_apk() }); }
      // Past Papers
      if (input === '6') { userState[chatId]='pastpaper'; return await sock.sendMessage(chatId,{ text: fmt_papers() }); }
      // Mediafire
      if (input === '7') { userState[chatId]='mediafire'; return await sock.sendMessage(chatId,{ text: fmt_mediafire() }); }
      // AI Menu
      if (input === '8') { userState[chatId]='aimenu'; return await sock.sendMessage(chatId,{ text: fmt_ai_menu() }); }
      // Creative
      if (input === '9') { userState[chatId]='creative'; return await sock.sendMessage(chatId,{ text: fmt_creative() }); }
      // Settings
      if (input === '10') { userState[chatId]='settings'; return await sock.sendMessage(chatId,{ text: fmt_settings() }); }
      // Owner Panel
      if (input === '11' && isOwner(chatId)) { userState[chatId]='owner'; return await sock.sendMessage(chatId,{ text: fmt_owner() }); }

      // Fallback
      userState[chatId] = 'main';
      return await sock.sendMessage(chatId, { text: fmt_main_for(chatId) });
    }

    // ─────────────────────────────────────────
    // SUB-MENUS
    // ─────────────────────────────────────────

    // ── APK ──
    if (state === 'apk') {
      const i = parseInt(input)-1;
      if (!isNaN(i) && i>=0 && i<APK_STORE.length) {
        const a = APK_STORE[i];
        return await sock.sendMessage(chatId,{ text:`📦 *${a.name}*\nVersion: ${a.version}\n\n🔗 Download Link:\n${a.link}\n\n━━━━━━━━━━━━━━━━━━━━━\nSend another number or *back*` });
      }
      return await sock.sendMessage(chatId,{ text: fmt_apk() });
    }

    // ── PAST PAPERS ──
    if (state === 'pastpaper') {
      const i = parseInt(input)-1;
      if (!isNaN(i) && i>=0 && i<PAST_PAPERS.length) {
        const p = PAST_PAPERS[i];
        return await sock.sendMessage(chatId,{ text:`📝 *${p.subject} — ${p.year} (${p.grade})*\n\n🔗 Download Link:\n${p.link}\n\n━━━━━━━━━━━━━━━━━━━━━\nSend another number or *back*` });
      }
      return await sock.sendMessage(chatId,{ text: fmt_papers() });
    }

    // ── MEDIAFIRE ──
    if (state === 'mediafire') {
      const i = parseInt(input)-1;
      if (!isNaN(i) && i>=0 && i<MEDIAFIRE_LINKS.length) {
        const l = MEDIAFIRE_LINKS[i];
        return await sock.sendMessage(chatId,{ text:`📋 *${l.name}*\n\n🔗 Link:\n${l.link}\n\n━━━━━━━━━━━━━━━━━━━━━\nSend another number or *back*` });
      }
      return await sock.sendMessage(chatId,{ text: fmt_mediafire() });
    }

    // ── AI MENU ──
    if (state === 'aimenu') {
      if (input === '1') { userState[chatId]='aichat'; aiHistory[chatId]=[]; return await sock.sendMessage(chatId,{ text:`💬 *AI Chat*\n━━━━━━━━━━━━━━━━━━━━━\nAsk me anything!\nI remember the conversation.\n\nSend *back* to exit chat.` }); }
      if (input === '2') { userState[chatId]='aiimg'; return await sock.sendMessage(chatId,{ text:`🖼️  *AI Image*\n━━━━━━━━━━━━━━━━━━━━━\nDescribe what you want!\nI will create an image for you.\n\nSend *back* to exit.` }); }
      if (input === '3') {
        config.autoAI = !config.autoAI;
        saveConfig();
        return await sock.sendMessage(chatId,{ text:`🤖 Auto AI Assistant: ${config.autoAI ? '✅ *ON*' : '❌ *OFF*'}\n\n${config.autoAI ? 'Bot will now auto-reply with AI to all messages.' : 'Auto AI disabled.'}\n\n━━━━━━━━━━━━━━━━━━━━━` + '\n' + fmt_ai_menu() });
      }
      return await sock.sendMessage(chatId,{ text: fmt_ai_menu() });
    }

    // ── AI CHAT (conversation mode) ──
    if (state === 'aichat') {
      await sock.sendMessage(chatId,{ text:'🤖 *Thinking…*' });
      const reply = await callAIConversation(chatId, text.trim());
      return await sock.sendMessage(chatId,{ text: reply });
    }

    // ── AI IMAGE ──
    if (state === 'aiimg') {
      await sock.sendMessage(chatId,{ text:'🖼️  *Generating image…*' });
      // Generate a styled SVG image based on the prompt using sharp
      try {
        const sharp = require('sharp');
        const prompt = text.trim();
        const w = 512, h = 512;
        // Create a unique color scheme based on text hash
        const hash = prompt.split('').reduce((a,c) => ((a<<5)-a)+c.charCodeAt(0), 0);
        const c1 = `hsl(${Math.abs(hash) % 360}, 70%, 45%)`;
        const c2 = `hsl(${(Math.abs(hash)+120) % 360}, 60%, 40%)`;
        const c3 = `hsl(${(Math.abs(hash)+240) % 360}, 65%, 50%)`;
        const fontSize = prompt.length > 30 ? 20 : prompt.length > 15 ? 28 : 36;
        // Word wrap
        const words = prompt.split(' ');
        let lines = [], line = '';
        words.forEach(w => {
          if ((line + ' ' + w).length > 25) { lines.push(line); line = w; }
          else line += (line ? ' ' : '') + w;
        });
        if (line) lines.push(line);
        let textElems = '';
        const startY = h/2 - (lines.length-1)*fontSize*0.6;
        lines.forEach((l,i) => {
          textElems += `<text x="${w/2}" y="${startY + i*fontSize*1.2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold" fill="white" opacity="0.95">${l}</text>`;
        });
        const svg = `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stop-color="${c1}"/>
              <stop offset="50%" stop-color="${c2}"/>
              <stop offset="100%" stop-color="${c3}"/>
            </linearGradient>
          </defs>
          <rect width="${w}" height="${h}" fill="url(#bg)"/>
          <circle cx="80" cy="80" r="120" fill="white" opacity="0.04"/>
          <circle cx="${w-60}" cy="${h-80}" r="100" fill="white" opacity="0.03"/>
          <circle cx="${w/2}" cy="${h/2}" r="180" fill="none" stroke="white" stroke-width="1" opacity="0.08"/>
          ${textElems}
          <text x="${w/2}" y="${h-30}" text-anchor="middle" font-family="Arial, sans-serif" font-size="13" fill="white" opacity="0.4" letter-spacing="3">PASIYA MD AI</text>
        </svg>`;
        const buf = await sharp(Buffer.from(svg)).png().toBuffer();
        await sock.sendMessage(chatId,{ image: buf, caption: `🖼️  *AI Generated*\n📝 ${prompt}` });
        return await sock.sendMessage(chatId,{ text:'✅ Image sent!\n\nSend another description or *back*' });
      } catch(e) {
        return await sock.sendMessage(chatId,{ text:'❌ Image generation failed. Try again.' });
      }
    }

    // ── CREATIVE ──
    if (state === 'creative') {
      if (input === '1') { userState[chatId]='logo'; return await sock.sendMessage(chatId,{ text:`🏷️  *Logo Generator*\n━━━━━━━━━━━━━━━━━━━━━\nType the text for your logo!\nExample: PASIYA MD\n━━━━━━━━━━━━━━━━━━━━━\nSend *back* to exit` }); }
      if (input === '2') { userState[chatId]='sticker'; return await sock.sendMessage(chatId,{ text:`🎟️  *Sticker Generator*\n━━━━━━━━━━━━━━━━━━━━━\nType the text for your sticker!\nExample: Hello World\n━━━━━━━━━━━━━━━━━━━━━\nSend *back* to exit` }); }
      return await sock.sendMessage(chatId,{ text: fmt_creative() });
    }

    // ── LOGO ──
    if (state === 'logo') {
      await sock.sendMessage(chatId,{ text:'🏷️  *Generating logo…*' });
      const buf = await generateLogo(text.trim());
      if (buf) {
        await sock.sendMessage(chatId,{ image: buf, caption: `🏷️  *Logo: ${text.trim().toUpperCase()}*` });
        return await sock.sendMessage(chatId,{ text:'✅ Logo sent!\n\nType another text or *back*' });
      }
      return await sock.sendMessage(chatId,{ text:'❌ Logo generation failed. Try again.' });
    }

    // ── STICKER ──
    if (state === 'sticker') {
      await sock.sendMessage(chatId,{ text:'🎟️  *Generating sticker…*' });
      const buf = await generateSticker(text.trim());
      if (buf) {
        await sock.sendMessage(chatId,{ sticker: buf });
        return await sock.sendMessage(chatId,{ text:`✅ *Sticker sent!*\n\nType another text or *back*` });
      }
      return await sock.sendMessage(chatId,{ text:'❌ Sticker failed. Try again.' });
    }

    // ── SETTINGS ──
    if (state === 'settings') {
      if (input === '1') { config.mode='private'; saveConfig(); return await sock.sendMessage(chatId,{ text:'🔒 Mode set to *Private*\n\n' + fmt_settings() }); }
      if (input === '2') { config.mode='public';  saveConfig(); return await sock.sendMessage(chatId,{ text:'🌐 Mode set to *Public*\n\n'  + fmt_settings() }); }
      if (input === '3') { config.mode='group';   saveConfig(); return await sock.sendMessage(chatId,{ text:'👥 Mode set to *Group*\n\n'   + fmt_settings() }); }
      if (input === '4') { config.autoAI=!config.autoAI; saveConfig(); return await sock.sendMessage(chatId,{ text:`🤖 Auto AI: ${config.autoAI?'✅ ON':'❌ OFF'}\n\n` + fmt_settings() }); }
      return await sock.sendMessage(chatId,{ text: fmt_settings() });
    }

    // ── OWNER PANEL ──
    if (state === 'owner') {
      if (!isOwner(chatId)) { userState[chatId]='main'; return await sock.sendMessage(chatId,{ text:'🚫 *Access Denied*' }); }
      if (input === '1') { userState[chatId]='settings'; return await sock.sendMessage(chatId,{ text: fmt_settings() }); }
      if (input === '2') {
        const upMs = process.uptime()*1000;
        const h = Math.floor(upMs/3600000), m = Math.floor((upMs%3600000)/60000), s = Math.floor((upMs%60000)/1000);
        return await sock.sendMessage(chatId,{
          text:
            `📊 *Bot Status*\n━━━━━━━━━━━━━━━━━━━━━\n` +
            `🤖 Name   : ${BOT_NAME}\n` +
            `⏱️  Uptime : ${h}h ${m}m ${s}s\n` +
            `🔧 Mode   : ${config.mode}\n` +
            `👁️  Auto Seen  : ${config.autoSeen?'ON':'OFF'}\n` +
            `😄 Auto React : ${config.autoReact?'ON':'OFF'}\n` +
            `🤖 Auto AI    : ${config.autoAI?'ON':'OFF'}\n` +
            `🛡️  Owner  : ${OWNER}\n` +
            `━━━━━━━━━━━━━━━━━━━━━\nSend *back* for owner menu`
        });
      }
      if (input === '3') {
        config = { mode:'public', autoAI:false, autoSeen:true, autoReact:true };
        saveConfig();
        return await sock.sendMessage(chatId,{ text:'🔄 *Config Reset* to defaults.\n\n' + fmt_owner() });
      }
      if (input === '4') {
        return await sock.sendMessage(chatId,{ text:`📋 *Current Config*\n━━━━━━━━━━━━━━━━━━━━━\n${JSON.stringify(config, null, 2)}\n━━━━━━━━━━━━━━━━━━━━━` });
      }
      return await sock.sendMessage(chatId,{ text: fmt_owner() });
    }

    // ─────────────────────────────────────────
    // URL DETECTION (Songs / Videos / FB / TikTok)
    // ─────────────────────────────────────────
    const isYT = input.includes('youtube.com') || input.includes('youtu.be');
    const isFB = input.includes('facebook.com') || input.includes('fb.com') || input.includes('fb.watch');
    const isTT = input.includes('tiktok.com');

    if (isYT && (state==='songs'||state==='videos')) {
      await sock.sendMessage(chatId,{ text:'⏳ *Processing…* Please wait!' });
      try {
        const ytdl = require('ytdl-core');
        const info = await ytdl.getInfo(text.trim());
        const title = info.videoDetails.title.replace(/[^a-zA-Z0-9]/g,'_').slice(0,50);
        const isSong = state==='songs';
        const stream = ytdl(text.trim(),{ filter: isSong?'audioonly':'videoandaudio', quality: isSong?'highestaudio':'highest' });
        const dlDir = path.join(__dirname,'downloads');
        mkdirSync(dlDir,{ recursive:true });
        const ext = isSong?'mp3':'mp4';
        const fp = path.join(dlDir,`${title}_${uuidv4().slice(0,8)}.${ext}`);
        stream.pipe(require('fs').createWriteStream(fp));
        stream.on('end', async()=>{
          try {
            const buf = await fs.readFile(fp);
            if (isSong) await sock.sendMessage(chatId,{ audio:buf, fileName:`${title}.mp3` });
            else        await sock.sendMessage(chatId,{ video:buf, caption:`🎥 ${info.videoDetails.title}` });
            await sock.sendMessage(chatId,{ text:`✅ *${isSong?'Song':'Video'} downloaded!*\n\nSend another link or *back*` });
            await fs.unlink(fp);
          } catch(e){ await sock.sendMessage(chatId,{ text:'❌ Send error.' }); }
        });
        stream.on('error', async()=>{ await sock.sendMessage(chatId,{ text:'❌ Download failed.' }); });
      } catch(e){ await sock.sendMessage(chatId,{ text:'❌ *Error:* Invalid YouTube URL.' }); }
      return;
    }
    if (isFB && state==='facebook') {
      return await sock.sendMessage(chatId,{ text:`📘 Link received:\n${text.trim()}\n\n✅ Download here:\nhttps://www.fbdownloader.com\n\n━━━━━━━━━━━━━━━━━━━━━\nSend another link or *back*` });
    }
    if (isTT && state==='tiktok') {
      return await sock.sendMessage(chatId,{ text:`🎭 Link received:\n${text.trim()}\n\n✅ Download here:\nhttps://www.snaptik.app\n\n━━━━━━━━━━━━━━━━━━━━━\nSend another link or *back*` });
    }

    // ─────────────────────────────────────────
    // AUTO AI ASSISTANT  (if enabled, catches unhandled messages)
    // ─────────────────────────────────────────
    if (config.autoAI && state !== 'main') {
      await sock.sendMessage(chatId,{ text:'🤖 *AI is thinking…*' });
      const reply = await callAIConversation(chatId, text.trim());
      return await sock.sendMessage(chatId,{ text: reply });
    }

    // ── FINAL FALLBACK → main menu ──
    userState[chatId] = 'main';
    await sock.sendMessage(chatId,{ text: fmt_main_for(chatId) });

  } catch(err) {
    console.error(`[ERR] ${chatId}`, err.message);
    try { await sock.sendMessage(chatId,{ text:'⚠️ Error. Send *hi* to restart.' }); } catch(e){}
  }
}

// =============================================
// BAILEYS CONNECTION  (24/7 auto-reconnect)
// =============================================
async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

  _sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
    browser: ['PASIYA MD','Chrome','121.0.0.0'],
    connectTimeoutMs: 60000,
    keepAliveIntervalMs: 10000
  });

  _sock.ev.on('creds.update', saveCreds);

  _sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'open') {
      _connected = true; _pairCode = null; _pairRequested = false;
      console.log('\n✅ [PASIYA MD] Connected 24/7.\n');
    }
    if (connection === 'close') {
      _connected = false;
      const reconnect = lastDisconnect?.reason !== DisconnectReason.loggedOut;
      console.log(`[PASIYA MD] Disconnected. Reconnect: ${reconnect}`);
      if (reconnect) setTimeout(connectToWhatsApp, 5000);
      else {
        const fse = require('fs-extra');
        await fse.emptyDir(SESSION_DIR);
        console.log('[PASIYA MD] Session cleared.');
        setTimeout(connectToWhatsApp, 3000);
      }
    }
  });

  _sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const chatId = msg.key.remoteJid;
      if (!chatId) continue;
      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';

      // ── AUTO SEEN (mark read + typing) ──
      await autoSeen(_sock, msg);

      // ── AUTO REACT ──
      await autoReact(_sock, msg);

      // ── HANDLE TEXT MESSAGES ──
      if (!text) continue;
      await handleMessage(_sock, chatId, text, msg);
    }
  });
}

// =============================================
// START
// =============================================
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  🌟 PASIYA MD WhatsApp Bot 🌟');
console.log('  Running 24 hours — No Errors');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

connectToWhatsApp().catch(err => {
  console.error('[FATAL]', err);
  setTimeout(connectToWhatsApp, 10000);
});

process.on('uncaughtException',  e => console.error('[UNCAUGHT]', e));
process.on('unhandledRejection', e => console.error('[UNHANDLED]', e));
