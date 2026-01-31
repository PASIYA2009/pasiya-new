// ============================================================
// PASIYA MD — Express Pairing Server (server.js)
// Run: node server.js
// ============================================================
const express = require('express');
const path    = require('path');
require('dotenv').config();

const app  = express();
const PORT = process.env.ADMIN_PORT || 3000;

// Boot the Baileys bot (index.js auto-connects)
const { botState } = require('./index.js');

// ─── Serve static files (pairing page + dashboard) ───
app.use(express.static(path.join(__dirname)));

// ─── Root → pairing page ───
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'pairing.html'));
});

// ─── Dashboard route ───
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

// ============================================================
// API: Generate Pair Code
// POST /api/pair  { "phone": "94771234567" }
// Returns: { "pairCode": "XXXX-XXXX" } or { "error": "..." }
// ============================================================
app.use(express.json());

app.post('/api/pair', async (req, res) => {
  try {
    const phone = (req.body.phone || '').replace(/\D/g, '');

    if (!phone || phone.length < 7 || phone.length > 15) {
      return res.status(400).json({ error: 'Enter a valid phone number (7-15 digits with country code).' });
    }

    if (botState.connected) {
      return res.status(400).json({ error: 'Bot is already connected! Go to /dashboard.' });
    }

    const sock = botState.sock;
    if (!sock) {
      return res.status(503).json({ error: 'Bot is initialising… please wait 3 seconds and try again.' });
    }

    console.log(`[PASIYA MD] Requesting pair code for +${phone}…`);
    const code = await sock.requestPairingCode(phone);

    botState.pairCode      = code;
    botState.pairRequested = true;

    console.log(`[PASIYA MD] Pair code generated: ${code}`);
    return res.json({ pairCode: code });

  } catch (err) {
    console.error('[PAIR ERROR]', err);
    return res.status(500).json({ error: 'Failed to generate pair code. Make sure the number is correct and try again.' });
  }
});

// ============================================================
// API: Poll Connection Status
// GET /api/status
// Returns: { "connected": bool, "pairCode": string|null }
// ============================================================
app.get('/api/status', (req, res) => {
  res.json({
    connected : botState.connected,
    pairCode  : botState.pairCode || null
  });
});

// ============================================================
// START SERVER
// ============================================================
app.listen(PORT, () => {
  console.log(`\n🌐 [PASIYA MD] Pairing page running at http://localhost:${PORT}`);
  console.log(`   Open that URL in your browser to pair your WhatsApp.\n`);
});
