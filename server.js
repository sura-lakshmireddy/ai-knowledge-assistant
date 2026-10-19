require('dotenv').config();
const dns = require('node:dns');
const dnsServers = process.env.DNS_SERVERS?.split(',').map(server => server.trim()).filter(Boolean);
if (dnsServers?.length) dns.setServers(dnsServers);

const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { User, Doc, Test } = require('./models');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const MODELS = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').split(',').map(model => model.trim()).filter(Boolean);
const AI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 90000);
if (!MODELS.length) throw new Error('GEMINI_MODEL must contain at least one model.');
if (!Number.isFinite(AI_TIMEOUT_MS) || AI_TIMEOUT_MS <= 0) throw new Error('GEMINI_TIMEOUT_MS must be a positive number.');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error(e);
  res.status(e.status || 500).json({ error: e.message || 'Server error' });
});
const fail = (status, message) => Object.assign(new Error(message), { status });

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Please log in again.' }); }
}

async function callGemini(system, messages, maxTokens = 2000) {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.startsWith('your_')) throw fail(500, 'GEMINI_API_KEY is missing. Add it to the .env file and restart the server.');

  const contents = messages.map(message => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }]
  }));
  let lastModelError;

  for (const model of MODELS) {
    let response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents,
          generationConfig: { maxOutputTokens: maxTokens }
        }),
        signal: AbortSignal.timeout(AI_TIMEOUT_MS)
      });
    } catch (error) {
      if (error.name === 'TimeoutError') throw fail(504, `Gemini request timed out after ${AI_TIMEOUT_MS} ms.`);
      throw error;
    }

    const data = await response.json();
    if (!response.ok) {
      const message = data.error?.message || response.statusText;
      if (response.status === 404) {
        lastModelError = message;
        continue;
      }
      throw fail(502, 'Gemini error: ' + message);
    }

    const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('');
    if (!text) throw fail(502, 'Gemini returned an empty response. Please try again.');
    return text;
  }

  throw fail(502, 'No configured Gemini model is available: ' + lastModelError);
}

async function extractText(file) {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.pdf')) return (await pdfParse(file.buffer)).text;
  if (name.endsWith('.docx')) return (await mammoth.extractRawText({ buffer: file.buffer })).value;
  if (/\.(txt|md|csv|json|html?)$/.test(name)) return file.buffer.toString('utf8');
  throw fail(400, 'Unsupported file type. Use PDF, DOCX, TXT, MD, CSV or HTML.');
}

const publicUser = u => ({ id: u._id, name: u.name, email: u.email, points: u.points, level: Math.floor(u.points / 100) + 1, testsTaken: u.testsTaken, badges: u.badges });

// ---------- auth ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password || password.length < 6) throw fail(400, 'Name, email and a password of 6+ characters are required.');
  if (await User.findOne({ email: email.toLowerCase() })) throw fail(409, 'This email is already registered.');
  const user = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
  res.json({ token: jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' }), user: publicUser(user) });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const user = await User.findOne({ email: (req.body.email || '').toLowerCase() });
  if (!user || !(await bcrypt.compare(req.body.password || '', user.password))) throw fail(401, 'Wrong email or password.');
  res.json({ token: jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' }), user: publicUser(user) });
}));

app.get('/api/me', auth, wrap(async (req, res) => res.json(publicUser(await User.findById(req.userId)))));

// ---------- documents ----------
app.get('/api/docs', auth, wrap(async (req, res) => {
  res.json(await Doc.find({ user: req.userId }).select('filename size createdAt').sort('-createdAt'));
}));

app.post('/api/docs', auth, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw fail(400, 'Choose a file to upload.');
  const text = (await extractText(req.file)).trim();
  if (text.length < 20) throw fail(400, 'No readable text found. Scanned PDFs are not supported.');
  const doc = await Doc.create({ user: req.userId, filename: req.file.originalname, mimetype: req.file.mimetype, size: req.file.size, text, file: req.file.buffer });
  res.json({ _id: doc._id, filename: doc.filename, size: doc.size, createdAt: doc.createdAt });
}));

app.delete('/api/docs/:id', auth, wrap(async (req, res) => {
  await Doc.deleteOne({ _id: req.params.id, user: req.userId });
  res.json({ ok: true });
}));

app.get('/api/docs/:id/download', auth, wrap(async (req, res) => {
  const doc = await Doc.findOne({ _id: req.params.id, user: req.userId }).select('+file');
  if (!doc) throw fail(404, 'Document not found.');
  res.set({ 'Content-Type': doc.mimetype, 'Content-Disposition': `attachment; filename="${encodeURIComponent(doc.filename)}"` }).send(doc.file);
}));

// ---------- chat / learning ----------
const MODES = {
  chat: 'Answer the learner\'s question clearly.',
  teach: 'Teach the topic like a friendly tutor: explain step by step with simple language, examples and a short recap at the end.',
  keypoints: 'Extract the KEY POINTS the learner must remember. Use short numbered points with bold terms.',
  bullets: 'Summarise the material as concise, well-organised bullet points grouped under headings.'
};

app.post('/api/chat', auth, wrap(async (req, res) => {
  const { docId, message, mode = 'chat', history = [] } = req.body;
  if (!message) throw fail(400, 'Type a message first.');
  let system = 'You are a Personal AI Knowledge Assistant for students. Use Markdown. ' + (MODES[mode] || MODES.chat);
  if (docId) {
    const doc = await Doc.findOne({ _id: docId, user: req.userId });
    if (!doc) throw fail(404, 'Document not found.');
    system += `\n\nBase your answer on this study material (document "${doc.filename}"). If the answer is not in it, say so, then help with general knowledge.\n\n<material>\n${doc.text.slice(0, 80000)}\n</material>`;
  }
  const msgs = [...history.slice(-10).map(m => ({ role: m.role, content: m.content })), { role: 'user', content: message }];
  res.json({ reply: await callGemini(system, msgs) });
}));

// ---------- mock tests ----------
app.post('/api/tests', auth, wrap(async (req, res) => {
  const { docId, count = 5, difficulty = 'medium', topic = '' } = req.body;
  const doc = await Doc.findOne({ _id: docId, user: req.userId });
  if (!doc) throw fail(404, 'Select a document to create a test from.');
  const n = Math.min(Math.max(parseInt(count) || 5, 3), 15);
  const system = 'You write exam questions. Reply with ONLY a JSON array, no markdown fences, no commentary.';
  const prompt = `Create ${n} ${difficulty} multiple-choice questions${topic ? ' about: ' + topic : ''} from this material. Each item: {"q": string, "options": [4 strings], "answer": index 0-3 of the correct option, "explanation": short string}.\n\n<material>\n${doc.text.slice(0, 60000)}\n</material>`;
  const raw = await callGemini(system, [{ role: 'user', content: prompt }], 4000);
  let qs;
  try { qs = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)); }
  catch { throw fail(502, 'AI returned an invalid test. Please try again.'); }
  qs = qs.filter(x => x.q && Array.isArray(x.options) && x.options.length === 4 && Number.isInteger(x.answer));
  if (!qs.length) throw fail(502, 'AI returned an invalid test. Please try again.');
  const test = await Test.create({ user: req.userId, doc: doc._id, title: `${doc.filename} (${difficulty})`, questions: qs });
  res.json({ id: test._id, title: test.title, questions: qs.map(({ q, options }) => ({ q, options })) }); // answers stay on server
}));

app.post('/api/tests/:id/submit', auth, wrap(async (req, res) => {
  const test = await Test.findOne({ _id: req.params.id, user: req.userId });
  if (!test) throw fail(404, 'Test not found.');
  if (test.submitted) throw fail(400, 'This test was already submitted.');
  const answers = req.body.answers || [];
  const results = test.questions.map((q, i) => ({ q: q.q, options: q.options, correct: q.answer, chosen: answers[i] ?? -1, explanation: q.explanation, isRight: answers[i] === q.answer }));
  const score = results.filter(r => r.isRight).length;
  const total = results.length;
  const perfect = score === total;
  const pointsEarned = score * 10 + (perfect ? 20 : 0);
  test.set({ submitted: true, score, pointsEarned }); await test.save();

  const user = await User.findById(req.userId);
  user.points += pointsEarned; user.testsTaken += 1;
  const earned = [];
  const give = (b, cond) => { if (cond && !user.badges.includes(b)) { user.badges.push(b); earned.push(b); } };
  give('🎯 First Test', user.testsTaken >= 1);
  give('💯 Perfect Score', perfect);
  give('📚 5 Tests Done', user.testsTaken >= 5);
  give('🔥 500 Points', user.points >= 500);
  give('🏆 Level 5', Math.floor(user.points / 100) + 1 >= 5);
  await user.save();
  res.json({ score, total, pointsEarned, newBadges: earned, results, user: publicUser(user) });
}));

app.get('/api/leaderboard', auth, wrap(async (req, res) => {
  res.json(await User.find().sort('-points').limit(10).select('name points'));
}));

app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/ai_knowledge_assistant')
  .then(() => app.listen(PORT, () => console.log(`✅ MongoDB connected. Open http://localhost:${PORT}`)))
  .catch(e => { console.error('❌ MongoDB connection failed:', e.message); process.exit(1); });
