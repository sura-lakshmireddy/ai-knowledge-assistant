const $ = s => document.querySelector(s);
let token = localStorage.getItem('token');
let isReg = false, mode = 'chat', docId = null, history = [], currentTest = null;

// ---------- helpers ----------
async function api(url, opts = {}) {
  opts.headers = Object.assign({ Authorization: 'Bearer ' + token }, opts.headers || {});
  if (opts.body && !(opts.body instanceof FormData)) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(); }
  if (!r.ok) throw new Error(d.error || 'Something went wrong');
  return d;
}
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('show'); setTimeout(() => el.classList.remove('show'), 3000); }
const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function md(src) {                      // tiny markdown renderer
  const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  let html = '', list = null;
  const close = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const line of src.split('\n')) {
    let m;
    if ((m = line.match(/^#{1,4}\s+(.*)/))) { close(); html += `<h4>${inline(m[1])}</h4>`; }
    else if ((m = line.match(/^\s*[-*•]\s+(.*)/))) { if (list !== 'ul') { close(); html += '<ul>'; list = 'ul'; } html += `<li>${inline(m[1])}</li>`; }
    else if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) { if (list !== 'ol') { close(); html += '<ol>'; list = 'ol'; } html += `<li>${inline(m[1])}</li>`; }
    else if (line.trim()) { close(); html += `<p>${inline(line)}</p>`; }
    else close();
  }
  close(); return html;
}

// ---------- auth ----------
function setAuthMode(reg) {
  isReg = reg;
  $('#tabLogin').classList.toggle('active', !reg); $('#tabReg').classList.toggle('active', reg);
  $('#aName').hidden = !reg; $('#aName').required = reg;
  $('#authBtn').textContent = reg ? 'Create account' : 'Log in'; $('#authErr').textContent = '';
}
$('#tabLogin').onclick = () => setAuthMode(false);
$('#tabReg').onclick = () => setAuthMode(true);
$('#authForm').onsubmit = async e => {
  e.preventDefault(); $('#authErr').textContent = '';
  try {
    const d = await api('/api/auth/' + (isReg ? 'register' : 'login'), { method: 'POST', body: { name: $('#aName').value, email: $('#aEmail').value, password: $('#aPass').value } });
    token = d.token; localStorage.setItem('token', token); start(d.user);
  } catch (err) { $('#authErr').textContent = err.message; }
};
function logout() { localStorage.removeItem('token'); token = null; $('#app').hidden = true; $('#auth').hidden = false; }
$('#logout').onclick = logout;

async function start(user) {
  $('#auth').hidden = true; $('#app').hidden = false;
  showUser(user || await api('/api/me'));
  loadDocs(); loadBoard();
}
function showUser(u) {
  $('#uName').textContent = u.name; $('#uLevel').textContent = u.level; $('#uPoints').textContent = u.points;
  $('#uBar').style.width = (u.points % 100) + '%';
  $('#uBadges').innerHTML = u.badges.map(b => `<span>${esc(b)}</span>`).join('') || '<span class="muted" style="background:none">Complete a test to earn badges</span>';
}
async function loadBoard() {
  try { const l = await api('/api/leaderboard'); $('#board').innerHTML = l.map(u => `<li>${esc(u.name)} – ${u.points} pts</li>`).join(''); } catch {}
}

// ---------- documents ----------
async function loadDocs() {
  const docs = await api('/api/docs');
  $('#docs').innerHTML = docs.length ? '' : '<li class="muted" style="cursor:default">No documents yet</li>';
  docs.forEach(d => {
    const li = document.createElement('li'); if (d._id === docId) li.className = 'sel';
    li.innerHTML = `<span title="${esc(d.filename)}">📄 ${esc(d.filename)}</span><button title="Delete">✕</button>`;
    li.onclick = () => selectDoc(d._id === docId ? null : d._id, d.filename);
    li.querySelector('button').onclick = async ev => {
      ev.stopPropagation(); if (!confirm('Delete ' + d.filename + '?')) return;
      await api('/api/docs/' + d._id, { method: 'DELETE' }); if (docId === d._id) selectDoc(null); loadDocs();
    };
    $('#docs').appendChild(li);
  });
}
function selectDoc(id, name) {
  docId = id; history = [];
  $('#current').textContent = id ? 'Using: ' + name : 'No document selected – chatting freely';
  loadDocs();
}
$('#fileIn').onchange = async e => {
  const f = e.target.files[0]; if (!f) return;
  const fd = new FormData(); fd.append('file', f); $('#upLabel').textContent = 'Reading ' + f.name + '…';
  try { const d = await api('/api/docs', { method: 'POST', body: fd }); toast('Uploaded ✔'); selectDoc(d._id, d.filename); }
  catch (err) { toast(err.message); }
  $('#upLabel').textContent = '+ Upload study material'; e.target.value = '';
};

// ---------- views ----------
document.querySelectorAll('.views button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.views button').forEach(x => x.classList.toggle('active', x === b));
  $('#chat').hidden = b.dataset.v !== 'chat'; $('#test').hidden = b.dataset.v !== 'test';
});
document.querySelectorAll('.modes button').forEach(b => b.onclick = () => {
  mode = b.dataset.m; document.querySelectorAll('.modes button').forEach(x => x.classList.toggle('active', x === b));
  const hints = { chat: 'Ask a question…', teach: 'What topic should I teach you?', keypoints: 'Which topic? (or type "all")', bullets: 'Which part to summarise? (or type "all")' };
  $('#msg').placeholder = hints[mode];
});

// ---------- chat ----------
function addMsg(role, html) {
  const log = $('#log'); log.querySelector('.empty')?.remove();
  const d = document.createElement('div'); d.className = 'msg ' + role; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
$('#chatForm').onsubmit = async e => {
  e.preventDefault(); const text = $('#msg').value.trim(); if (!text) return; $('#msg').value = '';
  addMsg('user', esc(text)); const wait = addMsg('ai', '<span class="typing">Thinking…</span>');
  try {
    const d = await api('/api/chat', { method: 'POST', body: { docId, message: text, mode, history } });
    wait.innerHTML = md(d.reply); history.push({ role: 'user', content: text }, { role: 'assistant', content: d.reply });
  } catch (err) { wait.innerHTML = `<span class="err">${esc(err.message)}</span>`; }
  $('#log').scrollTop = $('#log').scrollHeight;
};

// ---------- tests ----------
$('#tStart').onclick = async () => {
  $('#tErr').textContent = '';
  if (!docId) return $('#tErr').textContent = 'Select a document in the left panel first.';
  $('#tStart').disabled = true; $('#tStart').textContent = 'Generating…';
  try {
    currentTest = await api('/api/tests', { method: 'POST', body: { docId, count: $('#tCount').value, difficulty: $('#tDiff').value, topic: $('#tTopic').value } });
    renderTest();
  } catch (err) { $('#tErr').textContent = err.message; }
  $('#tStart').disabled = false; $('#tStart').textContent = 'Generate test';
};
function renderTest() {
  $('#testSetup').hidden = true; $('#testResult').hidden = true; $('#testRun').hidden = false;
  $('#testRun').innerHTML = `<h2>${esc(currentTest.title)}</h2>` + currentTest.questions.map((q, i) =>
    `<div class="q"><p>${i + 1}. ${esc(q.q)}</p>${q.options.map((o, j) => `<label class="opt"><input type="radio" name="q${i}" value="${j}">${esc(o)}</label>`).join('')}</div>`).join('') +
    `<button class="primary" id="tSubmit">Submit test</button>`;
  $('#tSubmit').onclick = submitTest;
}
async function submitTest() {
  const answers = currentTest.questions.map((_, i) => { const c = document.querySelector(`input[name=q${i}]:checked`); return c ? +c.value : -1; });
  if (answers.includes(-1) && !confirm('Some questions are unanswered. Submit anyway?')) return;
  try {
    const r = await api(`/api/tests/${currentTest.id}/submit`, { method: 'POST', body: { answers } });
    showUser(r.user); loadBoard(); $('#testRun').hidden = true; $('#testResult').hidden = false;
    $('#testResult').innerHTML = `<h2>Your result</h2><div class="score">${r.score} / ${r.total}</div>
      <div class="reward">⭐ You earned <b>${r.pointsEarned} points</b>${r.score === r.total ? ' (includes +20 perfect-score bonus)' : ''}.${r.newBadges.length ? '<br>New badge: ' + r.newBadges.map(esc).join(', ') : ''}</div>` +
      r.results.map((x, i) => `<div class="q"><p>${i + 1}. ${esc(x.q)}</p>${x.options.map((o, j) => `<div class="opt ${j === x.correct ? 'right' : j === x.chosen ? 'wrong' : ''}">${esc(o)}${j === x.correct ? ' ✔' : j === x.chosen ? ' ✘ (your answer)' : ''}</div>`).join('')}<p class="expl">${esc(x.explanation || '')}</p></div>`).join('') +
      `<button class="primary" id="tAgain">Take another test</button>`;
    $('#tAgain').onclick = () => { $('#testResult').hidden = true; $('#testSetup').hidden = false; };
  } catch (err) { toast(err.message); }
}

if (token) start().catch(logout);
