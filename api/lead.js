/* ============================================================
   CENTURY 21 BE3 — /api/lead
   Serverless function (@vercel/node)

   POST {
     type:       'new' | 'complete',
     firstName:  string,
     lastName:   string,
     email:      string,
     phone:      string,
     transcript: string  (complete only)
     summary:    string  (complete only)
   }

   'new'      → emails contact info immediately (captures abandoners)
   'complete' → emails full transcript + fit assessment

   Degrades gracefully if RESEND_API_KEY / LEAD_FROM_EMAIL are absent:
   returns { ok: true } so the client still shows the downloadable transcript.
   ============================================================ */

'use strict';

const RESEND_API = 'https://api.resend.com/emails';
const TO_EMAIL   = process.env.LEAD_TO_EMAIL   || 'MikePuma@c21be.com';
const FROM_EMAIL = process.env.LEAD_FROM_EMAIL || 'interviews@joinc21be3.com';
const API_KEY    = process.env.RESEND_API_KEY;

/* ── helpers ─────────────────────────────────────────────────── */

function esc(str) {
  return String(str || '')
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;');
}

function newLeadHtml({ firstName, lastName, email, phone }) {
  return `
<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;background:#111;color:#fff;border-radius:8px;overflow:hidden;">
  <div style="background:#b6a888;padding:20px 28px;">
    <p style="margin:0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#080808;">Century 21 BE3</p>
    <h1 style="margin:4px 0 0;font-size:22px;color:#080808;font-family:sans-serif;">New Interview Started</h1>
  </div>
  <div style="padding:28px;">
    <p style="color:#bbb;margin:0 0 20px;">A recruit has begun the AI interview. Contact info captured:</p>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:#777;font-size:13px;width:110px;">Name</td><td style="padding:8px 0;font-weight:600;">${esc(firstName)} ${esc(lastName)}</td></tr>
      <tr><td style="padding:8px 0;color:#777;font-size:13px;">Email</td><td style="padding:8px 0;"><a href="mailto:${esc(email)}" style="color:#b6a888;">${esc(email)}</a></td></tr>
      <tr><td style="padding:8px 0;color:#777;font-size:13px;">Phone</td><td style="padding:8px 0;">${esc(phone) || '—'}</td></tr>
    </table>
    <p style="color:#777;font-size:12px;margin:24px 0 0;">If they don't finish, follow up within 24 hours.</p>
  </div>
</div>`.trim();
}

function completeLeadHtml({ firstName, lastName, email, phone, transcript, summary }) {
  const transcriptHtml = esc(transcript || '')
    .replace(/\n/g, '<br>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  const summaryHtml = esc(summary || '')
    .replace(/\n/g, '<br>');

  return `
<div style="font-family:Inter,sans-serif;max-width:680px;margin:0 auto;background:#111;color:#fff;border-radius:8px;overflow:hidden;">
  <div style="background:#b6a888;padding:20px 28px;">
    <p style="margin:0;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#080808;">Century 21 BE3</p>
    <h1 style="margin:4px 0 0;font-size:22px;color:#080808;font-family:sans-serif;">Interview Complete — ${esc(firstName)} ${esc(lastName)}</h1>
  </div>
  <div style="padding:28px;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr><td style="padding:6px 0;color:#777;font-size:13px;width:110px;">Name</td><td style="padding:6px 0;font-weight:600;">${esc(firstName)} ${esc(lastName)}</td></tr>
      <tr><td style="padding:6px 0;color:#777;font-size:13px;">Email</td><td style="padding:6px 0;"><a href="mailto:${esc(email)}" style="color:#b6a888;">${esc(email)}</a></td></tr>
      <tr><td style="padding:6px 0;color:#777;font-size:13px;">Phone</td><td style="padding:6px 0;">${esc(phone) || '—'}</td></tr>
    </table>

    ${summary ? `
    <div style="background:#181818;border:1px solid #252525;border-radius:6px;padding:20px;margin-bottom:28px;">
      <p style="margin:0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#b6a888;">Agent Fit Assessment</p>
      <div style="color:#bbb;font-size:14px;line-height:1.7;">${summaryHtml}</div>
    </div>` : ''}

    <div style="background:#181818;border:1px solid #252525;border-radius:6px;padding:20px;">
      <p style="margin:0 0 16px;font-size:11px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#777;">Full Interview Transcript</p>
      <div style="color:#bbb;font-size:13px;line-height:1.8;">${transcriptHtml}</div>
    </div>
  </div>
</div>`.trim();
}

async function sendEmail(subject, html) {
  if (!API_KEY) return; // degrade gracefully

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, to: [TO_EMAIL], subject, html }),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Resend error:', res.status, txt);
  }
}

/* ── main handler ────────────────────────────────────────────── */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let body;
  try {
    body = typeof req.body === 'object' ? req.body : JSON.parse(req.body);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const { type, firstName, lastName, email, phone, transcript, summary } = body || {};

  if (!type || !firstName || !email) {
    return res.status(400).json({ error: 'type, firstName, and email are required' });
  }

  try {
    if (type === 'new') {
      await sendEmail(
        `BE3 Interview Started — ${firstName} ${lastName || ''}`.trim(),
        newLeadHtml({ firstName, lastName, email, phone })
      );
    } else if (type === 'complete') {
      await sendEmail(
        `BE3 Interview Complete — ${firstName} ${lastName || ''}`.trim(),
        completeLeadHtml({ firstName, lastName, email, phone, transcript, summary })
      );
    }
  } catch (err) {
    /* Don't block the client if email fails */
    console.error('Lead email error:', err);
  }

  return res.status(200).json({ ok: true });
};
