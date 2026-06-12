/* ============================================================
   CENTURY 21 BE3 — Interview Chat Frontend
   Vanilla-JS port of PropChat's React streaming loop.

   Flow:
   1. Validate and submit lead-capture gate
   2. POST /api/lead (type=new) — captures abandoners
   3. Seed welcome message, show suggested chips
   4. Per send: optimistic user + empty assistant bubbles,
      fetch /api/interview with AbortController,
      getReader() chunk accumulation via array.join(),
      live-update assistant bubble, auto-scroll
   5. On finish: request closing summary from agent,
      POST /api/lead (type=complete) with transcript + summary
   ============================================================ */

'use strict';

/* ── DOM references ──────────────────────────────────────────── */
const gateSection  = document.getElementById('ivGate');
const chatSection  = document.getElementById('ivChat');
const gateForm     = document.getElementById('ivGateForm');
const msgList      = document.getElementById('ivMessages');
const msgInput     = document.getElementById('ivInput');
const sendBtn      = document.getElementById('ivSend');
const finishBtn    = document.getElementById('ivFinish');
const dlBtn        = document.getElementById('ivDownload');
const finishPanel  = document.getElementById('ivFinishPanel');

/* ── State ───────────────────────────────────────────────────── */
let lead        = null;   // { firstName, lastName, email, phone }
let messages    = [];     // [{role, content}] — client-managed history
let isLoading   = false;
let abortCtrl   = null;
let msgCounter  = 0;
let finished    = false;

const WELCOME = `Hi there! I'm the BE3 Advisor — I'm here to learn a little about you and answer any questions you have about Century 21 BE3. There's zero pressure in this conversation.

Before we dive in — what were you doing before real estate, or what are you doing now alongside it?`;

const SUGGESTED_QUESTIONS = [
  "Tell me about the 90% split",
  "What training do you offer?",
  "What markets do you cover?",
  "How does the technology work?",
  "What support will I have?",
];

/* ── Gate form submission ────────────────────────────────────── */
gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const firstName = gateForm.querySelector('#ivFirstName').value.trim();
  const lastName  = gateForm.querySelector('#ivLastName').value.trim();
  const email     = gateForm.querySelector('#ivEmail').value.trim();
  const phone     = gateForm.querySelector('#ivPhone').value.trim();

  if (!firstName || !email) return;

  lead = { firstName, lastName, email, phone };

  /* Show chat, hide gate */
  gateSection.style.display  = 'none';
  chatSection.style.display  = 'flex';

  /* Fire-and-forget lead capture — get the email even if they abandon */
  postLead({ type: 'new', ...lead }).catch(() => {});

  /* Seed welcome message */
  const welcomeContent = WELCOME.replace('Hi there!', `Hi ${firstName}!`);
  appendMessage('assistant', welcomeContent, 'welcome');
  messages.push({ role: 'assistant', content: welcomeContent });

  showChips();
  msgInput.focus();
});

/* ── Suggested question chips ───────────────────────────────── */
function showChips() {
  const userHasSpoken = messages.some(m => m.role === 'user');
  if (userHasSpoken) return;

  const existing = document.getElementById('ivChips');
  if (existing) return;

  const wrap = document.createElement('div');
  wrap.id = 'ivChips';
  wrap.className = 'iv-chips';

  SUGGESTED_QUESTIONS.forEach(q => {
    const btn = document.createElement('button');
    btn.className = 'iv-chip';
    btn.textContent = q;
    btn.addEventListener('click', () => {
      wrap.remove();
      sendMessage(q);
    });
    wrap.appendChild(btn);
  });

  msgList.appendChild(wrap);
  scrollToBottom();
}

/* ── Append a message bubble ────────────────────────────────── */
function appendMessage(role, content, id) {
  const msgId = id || `${role}-${++msgCounter}`;

  const outer = document.createElement('div');
  outer.id = `iv-msg-${msgId}`;
  outer.className = `iv-msg iv-msg--${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'iv-bubble';
  bubble.innerHTML = formatContent(content);

  outer.appendChild(bubble);
  msgList.appendChild(outer);
  scrollToBottom();
  return msgId;
}

/* ── Update an existing bubble (streaming) ──────────────────── */
function updateMessage(id, content) {
  const el = document.getElementById(`iv-msg-${id}`);
  if (!el) return;
  const bubble = el.querySelector('.iv-bubble');
  if (bubble) bubble.innerHTML = formatContent(content);
  scrollToBottom();
}

/* ── Basic markdown-lite renderer ──────────────────────────── */
function formatContent(text) {
  if (!text) return '<span class="iv-typing"><span></span><span></span><span></span></span>';
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

/* ── Auto-scroll ────────────────────────────────────────────── */
function scrollToBottom() {
  msgList.scrollTop = msgList.scrollHeight;
}

/* ── Set loading state ──────────────────────────────────────── */
function setLoading(val) {
  isLoading = val;
  sendBtn.disabled = val;
  msgInput.disabled = val;
  if (!finished) finishBtn.disabled = val;
}

/* ── Core send / stream loop ────────────────────────────────── */
async function sendMessage(text) {
  if (!text.trim() || isLoading) return;

  /* Cancel any in-flight request */
  if (abortCtrl) abortCtrl.abort();
  abortCtrl = new AbortController();

  /* Remove chips */
  document.getElementById('ivChips')?.remove();

  /* Optimistic update: user bubble + empty assistant placeholder */
  appendMessage('user', text);
  const assistantId = `a-${++msgCounter}`;
  appendMessage('assistant', '', assistantId); // empty → shows typing dots

  /* Update client history */
  messages.push({ role: 'user', content: text });
  msgInput.value = '';
  setLoading(true);

  const chunks = []; // string[] — React-19-safe accumulation pattern from PropChat

  try {
    const resp = await fetch('/api/interview', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages, lead: { firstName: lead?.firstName || '' } }),
      signal:  abortCtrl.signal,
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Chat failed' }));
      updateMessage(assistantId, err.error || 'Something went wrong.');
      setLoading(false);
      return;
    }

    if (!resp.body) throw new Error('No response body');

    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(decoder.decode(value, { stream: true }));
      updateMessage(assistantId, chunks.join(''));
    }

    const fullReply = chunks.join('');
    messages.push({ role: 'assistant', content: fullReply });

  } catch (err) {
    if (err.name !== 'AbortError') {
      updateMessage(assistantId, 'Sorry, something went wrong. Please try again.');
      console.error('Chat error:', err);
    }
  } finally {
    setLoading(false);
  }
}

/* ── Input / send button handlers ───────────────────────────── */
sendBtn.addEventListener('click', () => {
  sendMessage(msgInput.value.trim());
});

msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(msgInput.value.trim());
  }
});

/* ── Finish button ──────────────────────────────────────────── */
finishBtn.addEventListener('click', async () => {
  if (finished || isLoading) return;
  finished = true;
  finishBtn.disabled = true;
  setLoading(true);

  /* Ask the agent for a structured closing summary */
  const summaryRequest = [
    ...messages,
    {
      role: 'user',
      content: '[SYSTEM: The recruit has ended the interview. Please provide a structured closing assessment with: (1) Fit tier (Strong Fit / Needs Conversation / Low Fit), (2) a 3–5 sentence summary of the candidate — their experience level, deals in last 12 months if shared, full/part-time, market, income goal, what they want from a brokerage, and your read on their DISC style and coachability. End with the recommended next step and CTA link. Be specific and use only information shared in this conversation.]',
    },
  ];

  let summary = '';
  try {
    const resp = await fetch('/api/interview', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messages: summaryRequest, lead: { firstName: lead?.firstName || '' } }),
    });

    if (resp.ok && resp.body) {
      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      const chunks  = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(decoder.decode(value, { stream: true }));
      }
      summary = chunks.join('');
    }
  } catch (err) {
    console.error('Summary error:', err);
  }

  setLoading(false);

  /* Show finish panel */
  if (finishPanel) {
    finishPanel.style.display = 'block';
    if (summary) {
      const summaryEl = document.getElementById('ivSummaryText');
      if (summaryEl) summaryEl.innerHTML = formatContent(summary);
    }
  }

  /* Build transcript text */
  const transcript = buildTranscript();

  /* Email complete lead */
  postLead({ type: 'complete', ...lead, transcript, summary }).catch(() => {});

  /* Enable download */
  if (dlBtn) {
    dlBtn.disabled = false;
    dlBtn.addEventListener('click', () => downloadTranscript(transcript, summary));
  }
});

/* ── Build plain-text transcript ────────────────────────────── */
function buildTranscript() {
  const lines = [
    `Century 21 BE3 — Interview Transcript`,
    `Recruit: ${lead?.firstName || ''} ${lead?.lastName || ''}`.trim(),
    `Email: ${lead?.email || ''}`,
    `Phone: ${lead?.phone || ''}`,
    `Date: ${new Date().toLocaleString()}`,
    '',
    '─'.repeat(60),
    '',
  ];

  messages.forEach(m => {
    if (m.role === 'assistant') {
      lines.push(`BE3 Advisor:\n${m.content}`);
    } else if (m.role === 'user') {
      lines.push(`${lead?.firstName || 'Recruit'}:\n${m.content}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

/* ── Download transcript ────────────────────────────────────── */
function downloadTranscript(transcript, summary) {
  const full = summary
    ? `${transcript}\n${'─'.repeat(60)}\n\nAGENT FIT ASSESSMENT\n\n${summary}\n`
    : transcript;

  const blob = new Blob([full], { type: 'text/plain; charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `BE3-Interview-${(lead?.firstName || 'transcript').replace(/\s+/g, '-')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/* ── POST to /api/lead ───────────────────────────────────────── */
async function postLead(payload) {
  await fetch('/api/lead', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });
}
