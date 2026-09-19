const express = require('express');
const path = require('path');
const { Firestore } = require('@google-cloud/firestore');
const Anthropic = require('@anthropic-ai/sdk');

const PORT = process.env.PORT || 8080;
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT || 'metal-celerity-236019';
const FIRESTORE_DB = process.env.FIRESTORE_DATABASE_ID || 'cover-sheet';

const SITE_LOGIN_USERNAME = process.env.SITE_LOGIN_USERNAME || '';
const SITE_LOGIN_PASSWORD = process.env.SITE_LOGIN_PASSWORD || '';

const db = new Firestore({ projectId: PROJECT_ID, databaseId: FIRESTORE_DB });
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from env

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ---------------------------------------------------------------------------
// Auth: HTTP Basic, route-scoped. Gates only routes that spend API tokens or
// serve the vacation app (which contains real family PII).
// ---------------------------------------------------------------------------
function requireLogin(req, res, next) {
  if (!SITE_LOGIN_USERNAME || !SITE_LOGIN_PASSWORD) {
    return res.status(500).json({ error: 'Server login is not configured.' });
  }
  const header = req.headers.authorization || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    if (user === SITE_LOGIN_USERNAME && pass === SITE_LOGIN_PASSWORD) {
      return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="Cover Sheet"');
  return res.status(401).send('Login required.');
}

// ---------------------------------------------------------------------------
// Public read routes - Cover Sheet data, no login required.
// ---------------------------------------------------------------------------
app.get('/api/games', async (req, res) => {
  try {
    const snap = await db.collection('games').get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('GET /api/games', err);
    res.status(500).json({ error: 'Failed to load games.' });
  }
});

app.get('/api/asks', async (req, res) => {
  try {
    const snap = await db.collection('asks').orderBy('createdAt', 'desc').limit(50).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('GET /api/asks', err);
    res.status(500).json({ error: 'Failed to load research asks.' });
  }
});

app.get('/api/changelog', async (req, res) => {
  try {
    const snap = await db.collection('changelog').orderBy('createdAt', 'desc').limit(50).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('GET /api/changelog', err);
    res.status(500).json({ error: 'Failed to load changelog.' });
  }
});

app.get('/api/uga', async (req, res) => {
  try {
    const snap = await db.collection('uga').orderBy('createdAt', 'desc').limit(50).get();
    res.json(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
  } catch (err) {
    console.error('GET /api/uga', err);
    res.status(500).json({ error: 'Failed to load My Dawgs content.' });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const doc = await db.collection('meta').doc('status').get();
    res.json(doc.exists ? doc.data() : {});
  } catch (err) {
    console.error('GET /api/status', err);
    res.status(500).json({ error: 'Failed to load status.' });
  }
});

// ---------------------------------------------------------------------------
// Login-gated: anything that calls the Anthropic API.
// ---------------------------------------------------------------------------
async function runResearch({ prompt, systemPrompt }) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-5',
    max_tokens: 4096,
    system: systemPrompt,
    tools: [
      {
        type: 'web_search_20260209',
        name: 'web_search',
        max_uses: 5,
      },
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  const textBlocks = response.content.filter((b) => b.type === 'text');
  return textBlocks.map((b) => b.text).join('\n\n');
}

app.post('/api/research/refresh', requireLogin, async (req, res) => {
  try {
    const { gameId, matchup } = req.body || {};
    if (!gameId || !matchup) {
      return res.status(400).json({ error: 'gameId and matchup are required.' });
    }
    const text = await runResearch({
      systemPrompt:
        'You are a college football betting research assistant. Give a concise, current, ' +
        'factual research summary for the given matchup: injuries, line movement, recent form, ' +
        'weather if relevant, and any other betting-relevant news. Cite what you find via web search. ' +
        'Never invent a score, injury, or line - if you cannot verify something, say so.',
      prompt: `Research this matchup for betting purposes: ${matchup}`,
    });

    const docRef = await db.collection('asks').add({
      gameId,
      matchup,
      type: 'refresh',
      answer: text,
      createdAt: Firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: docRef.id, answer: text });
  } catch (err) {
    console.error('POST /api/research/refresh', err);
    res.status(500).json({ error: 'Research request failed.' });
  }
});

app.post('/api/research/custom', requireLogin, async (req, res) => {
  try {
    const { question, gameId, matchup } = req.body || {};
    if (!question) {
      return res.status(400).json({ error: 'question is required.' });
    }
    const text = await runResearch({
      systemPrompt:
        'You are a college football betting research assistant. Answer the user\'s question ' +
        'using current, verifiable information from web search. Never invent a score, injury, ' +
        'or line - if you cannot verify something, say so.',
      prompt: matchup ? `Regarding ${matchup}: ${question}` : question,
    });

    const docRef = await db.collection('asks').add({
      gameId: gameId || null,
      matchup: matchup || null,
      type: 'custom',
      question,
      answer: text,
      createdAt: Firestore.FieldValue.serverTimestamp(),
    });

    res.json({ id: docRef.id, answer: text });
  } catch (err) {
    console.error('POST /api/research/custom', err);
    res.status(500).json({ error: 'Research request failed.' });
  }
});

// ---------------------------------------------------------------------------
// Vacation app - fully gated (contains real family PII), not just its AI calls.
// ---------------------------------------------------------------------------
app.use('/vacation', requireLogin, express.static(path.join(__dirname, 'vacation')));

app.get('/vacation', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'vacation', 'index.html'));
});

app.post('/api/vacation/research', requireLogin, async (req, res) => {
  try {
    const { prompt } = req.body || {};
    if (!prompt) return res.status(400).json({ error: 'prompt is required.' });
    const text = await runResearch({
      systemPrompt:
        'You are helping a family plan a beach vacation. Be concise and practical. ' +
        'If you are not confident about a specific fact like hours or price, say so rather than inventing one.',
      prompt,
    });
    res.json({ answer: text });
  } catch (err) {
    console.error('POST /api/vacation/research', err);
    res.status(500).json({ error: 'Research request failed.' });
  }
});

app.post('/api/vacation/chat', requireLogin, async (req, res) => {
  try {
    const { question } = req.body || {};
    if (!question) return res.status(400).json({ error: 'question is required.' });
    const text = await runResearch({
      systemPrompt:
        'You are a helpful assistant for a family beach vacation to Santa Rosa Beach, FL, ' +
        'Sep 22-27, 2026, traveling with a 6-year-old and a 3-year-old. Answer questions about ' +
        'the trip, or use web search for current info like weather. Be concise and practical.',
      prompt: question,
    });

    await db.collection('vacation-chat').add({
      question,
      answer: text,
      createdAt: Firestore.FieldValue.serverTimestamp(),
    });

    res.json({ answer: text });
  } catch (err) {
    console.error('POST /api/vacation/chat', err);
    res.status(500).json({ error: 'Chat request failed.' });
  }
});

// ---------------------------------------------------------------------------
app.get('/healthz', (req, res) => res.status(200).send('ok'));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Cover Sheet listening on :${PORT}`);
});
