/* TekStation — Cloudflare Pages advanced-mode Worker
 *
 * This file makes the server API work even when the Pages project is deployed
 * with dashboard Drag & Drop. Pages dashboard Direct Upload does not compile
 * a /functions directory, but it does support a root _worker.js.
 *
 * /api/servers -> Wildcard official ASA server list proxy
 * everything else -> Pages static assets
 */

const SOURCE = 'https://cdn2.arkdedicated.com/servers/asa/officialserverlist.json';
const TTL = 60; // seconds
const API_CACHE_PATH = '/api/servers';
const API_HEALTH_PATH = '/api/health';
const API_VAULT_PATH = '/api/vault';
const API_ACCOUNT_PATH = '/api/account';
const ACCOUNT_SESSION_DAYS = 30;
const ACCOUNT_PBKDF2_ITERATIONS = 150000;
const ACCOUNT_RATE = new Map();
const RECOVERY_SESSION_MINUTES = 15;
const LOGIN_CHALLENGE_MINUTES = 5;
const EMAIL_FROM = 'TekStation <welcome@tekstation.app>';
const EMAIL_SITE_URL = 'https://tekstation.app/';

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function handleVault(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400'
    }
  });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { allow: 'POST,OPTIONS' });
  if (!env.TEKSTATION_DB) return json({ error: 'vault_not_configured', message: 'Cloud sync is not configured on this deployment yet. Add the TEKSTATION_DB D1 binding.' }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_json' }, 400); }
  const token = String(body?.token || '').trim();
  const action = String(body?.action || '');
  if (token.length < 24) return json({ error: 'invalid_token' }, 400);
  const id = await sha256Hex(token);
  if (action === 'put') {
    const blob = String(body?.blob || '');
    if (!blob || blob.length > 6000000) return json({ error: 'invalid_blob' }, 400);
    const now = Date.now();
    await env.TEKSTATION_DB.prepare(
      'INSERT INTO tekstation_vault (id, blob, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET blob=excluded.blob, updated_at=excluded.updated_at'
    ).bind(id, blob, now).run();
    return json({ ok: true, updatedAt: now });
  }
  if (action === 'get') {
    const row = await env.TEKSTATION_DB.prepare('SELECT blob, updated_at FROM tekstation_vault WHERE id = ?').bind(id).first();
    if (!row) return json({ ok: true, blob: null });
    return json({ ok: true, blob: row.blob, updatedAt: row.updated_at });
  }
  if (action === 'delete') {
    await env.TEKSTATION_DB.prepare('DELETE FROM tekstation_vault WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }
  return json({ error: 'unknown_action' }, 400);
}


function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function toB64u(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/,'');
}

function fromB64u(s) {
  s = String(s || '').replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i=0;i<raw.length;i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function hashText(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text || '')));
  return toB64u(buf);
}

async function hmacB64(keyBytes, text) {
  const k = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return toB64u(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(String(text || ''))));
}

async function createLoginChallenge(env, accountId) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const challenge = toB64u(raw);
  const challengeHash = await hashText(challenge);
  const expiresAt = Date.now() + LOGIN_CHALLENGE_MINUTES * 60000;
  await env.TEKSTATION_DB.prepare('INSERT INTO tekstation_login_challenges (challenge_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)').bind(challengeHash,accountId,expiresAt,Date.now()).run();
  return {challenge,expiresAt};
}

async function getLoginChallenge(env, challenge) {
  const challengeHash = await hashText(challenge);
  return await env.TEKSTATION_DB.prepare('SELECT challenge_hash,account_id,expires_at FROM tekstation_login_challenges WHERE challenge_hash=? AND expires_at>?').bind(challengeHash,Date.now()).first();
}

async function deriveAccountVerifier(password, saltB64) {
  const salt = fromB64u(saltB64);
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:ACCOUNT_PBKDF2_ITERATIONS}, baseKey, 256);
  const hmacKey = await crypto.subtle.importKey('raw', master, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const verifier = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode('TekStation account verifier v1'));
  return toB64u(verifier);
}

async function deriveAccountWrapKey(password, saltB64) {
  const salt = fromB64u(saltB64);
  const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
  const master = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations:ACCOUNT_PBKDF2_ITERATIONS}, baseKey, 256);
  const hmacKey = await crypto.subtle.importKey('raw', master, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const raw = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode('TekStation vault wrap key v1'));
  return toB64u(new Uint8Array(raw));
}

async function accountKeyRecord(env, accountId) {
  try { return await env.TEKSTATION_DB.prepare('SELECT account_id,password_wrap,recovery_hash,recovery_wrap,updated_at FROM tekstation_account_keys WHERE account_id=?').bind(accountId).first(); } catch { return null; }
}

async function createRecoverySession(env, accountId) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toB64u(tokenBytes);
  const tokenHash = await hashText(token);
  const expiresAt = Date.now() + RECOVERY_SESSION_MINUTES * 60000;
  await env.TEKSTATION_DB.prepare('INSERT INTO tekstation_recovery_sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)').bind(tokenHash,accountId,expiresAt,Date.now()).run();
  return {token,expiresAt};
}

async function recoverySession(env, token) {
  if (!token) return null;
  const tokenHash = await hashText(token);
  return await env.TEKSTATION_DB.prepare('SELECT token_hash,account_id,expires_at FROM tekstation_recovery_sessions WHERE token_hash=? AND expires_at>?').bind(tokenHash,Date.now()).first();
}

function constantTimeStringEqual(a,b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i=0;i<a.length;i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

function rateAllowed(key) {
  const now = Date.now();
  const hit = ACCOUNT_RATE.get(key) || {n:0, at:now};
  if (now - hit.at > 10 * 60 * 1000) { hit.n = 0; hit.at = now; }
  hit.n += 1;
  ACCOUNT_RATE.set(key, hit);
  return hit.n <= 8;
}

function newAccountId() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2,'0'));
  return h.slice(0,4).join('')+'-'+h.slice(4,6).join('')+'-'+h.slice(6,8).join('')+'-'+h.slice(8,10).join('')+'-'+h.slice(10).join('');
}

async function createSession(env, accountId, now = Date.now()) {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const token = toB64u(tokenBytes);
  const tokenHash = await hashText(token);
  const expiresAt = now + ACCOUNT_SESSION_DAYS * 86400000;
  await env.TEKSTATION_DB.prepare(
    'INSERT INTO tekstation_sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(tokenHash, accountId, expiresAt, now).run();
  return {token, expiresAt, tokenHash};
}

async function accountFromSession(env, token) {
  if (!token) return null;
  const tokenHash = await hashText(token);
  const row = await env.TEKSTATION_DB.prepare(
    'SELECT s.account_id, a.email_hash, a.salt FROM tekstation_sessions s JOIN tekstation_accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?'
  ).bind(tokenHash, Date.now()).first();
  return row || null;
}

async function sendWelcomeEmail(env, email, accountId) {
  const key = String(env.RESEND_API_KEY || '').trim();
  if (!key || !email) return { configured: false, sent: false };

  const safeEmail = String(email).trim().toLowerCase();
  const local = safeEmail.split('@')[0].replace(/[._-]+/g, ' ').trim();
  const display = local ? local.replace(/\b\w/g, c => c.toUpperCase()).slice(0, 48) : 'Survivor';
  const site = EMAIL_SITE_URL || 'https://tekstation.app';
  const logoUrl = `${site.replace(/\/$/, '')}/icon-192.png`;

  const featureRows = [
    ['PLAN', 'Boss encounters, ascensions, level ceilings, Tekgram tracking and your complete progression planner.'],
    ['SCAN', 'The TekStation implant scanner can read a survivor implant screenshot and turn it into a build.'],
    ['SURVIVOR OPS', 'Goals, checklists, tame planning, boss prep, progression milestones and personal planning tools.'],
    ['CREATURES', 'A full creature database with taming information, kibble, roles and creature-focused planning.'],
    ['CRAFTING', 'Recipes, crafting chains, dependencies and the materials you need to prepare for objectives.'],
    ['SERVERS', 'Live official server browsing, Small Tribes, favorites, comparison, matchmaking and server intelligence.'],
    ['MAPS', 'Interactive ARK maps connected to bosses, artifacts, creatures, resources, notes and active servers.'],
    ['DATA VAULT', 'Local-first storage, backups, encrypted cloud sync, account recovery and cross-device continuity.']
  ];

  const featureHtml = featureRows.map(([label, text]) => `
    <tr>
      <td style="padding:0 0 14px 0;vertical-align:top">
        <div style="display:inline-block;padding:5px 9px;border:1px solid #2e6375;border-radius:999px;color:#63e4fb;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;background:#0e2029">${escapeHtml(label)}</div>
        <div style="margin-top:7px;color:#b8cbd4;font-size:14px;line-height:1.65">${escapeHtml(text)}</div>
      </td>
    </tr>`).join('');

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Welcome to TekStation</title>
</head>
<body style="margin:0;padding:0;background:#070d12;color:#eaf8ff;font-family:Arial,Helvetica,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">Welcome to TekStation — your ARK: Survival Ascended planning command center.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#070d12">
    <tr>
      <td align="center" style="padding:28px 14px">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px">
          <tr>
            <td style="padding:0 0 14px 6px;color:#58dff7;font-size:10px;letter-spacing:.25em;text-transform:uppercase">ARK: SURVIVAL ASCENDED · TEKSTATION COMMUNITY</td>
          </tr>
          <tr>
            <td style="border:1px solid #2a6071;border-radius:22px;background:#0e1922;box-shadow:0 20px 50px rgba(0,0,0,.35);overflow:hidden">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="padding:30px 30px 12px 30px">
                    <img src="${logoUrl}" width="56" height="56" alt="TekStation" style="display:block;border-radius:14px;border:1px solid #2c7183;background:#0b151d">
                    <div style="margin-top:18px;color:#5be1f8;font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase">WELCOME, ${escapeHtml(display)}</div>
                    <h1 style="margin:10px 0 12px;color:#f2fbff;font-size:38px;line-height:1.08;font-weight:700">Welcome to TekStation.</h1>
                    <p style="margin:0;color:#aec2cc;font-size:16px;line-height:1.75">Your account is ready, your encrypted Data Vault can travel with you, and your ARK planning toolkit is now connected in one place.</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:8px 30px 0 30px">
                    <div style="border-left:3px solid #45d7f3;padding:16px 18px;background:#0a151d;border-radius:0 14px 14px 0;color:#dbeaf0;font-size:15px;line-height:1.8">
                      <strong style="color:#ffffff">A personal note from Fresh</strong><br>
                      Thank you for joining the TekStation community. I built TekStation to make ARK planning feel less like keeping a dozen tabs open and more like having your own survivor command center. I hope it saves you time, helps you prepare with confidence, and makes the next boss, tame, build or server a little easier to tackle.
                      <div style="margin-top:10px;color:#67e4f8;font-weight:700">— Fresh · Creator of TekStation</div>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:24px 30px 6px 30px">
                    <div style="color:#6fe7fb;font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase">YOUR TEKSTATION TOOLKIT</div>
                    <h2 style="margin:8px 0 8px;color:#f4fbff;font-size:24px;line-height:1.25">Everything in one survivor workspace.</h2>
                    <p style="margin:0;color:#8fa5b0;font-size:14px;line-height:1.7">Here is what you can use today:</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 30px 6px 30px">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">${featureHtml}</table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 30px 30px 30px">
                    <a href="${site}" style="display:inline-block;padding:15px 24px;border-radius:999px;background:#49d8f3;color:#061016;text-decoration:none;font-size:14px;font-weight:700;letter-spacing:.05em">OPEN TEKSTATION →</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 30px 30px 30px">
                    <div style="height:1px;background:#20343f"></div>
                    <p style="margin:18px 0 0;color:#708792;font-size:11px;line-height:1.65">You received this message because a TekStation account was created with this email address. Your account credentials and encrypted survivor data are protected by TekStation's account and Data Vault system.</p>
                    <p style="margin:8px 0 0;color:#526873;font-size:11px;line-height:1.65">TekStation is an independent ARK: Survival Ascended community tool and is not affiliated with Studio Wildcard.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 6px 0;color:#516975;text-align:center;font-size:10px;line-height:1.6">TekStation · Boss, Tekgram &amp; Crafting Planner · tekstation.app</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Welcome to TekStation, ${display}.`,
    '',
    'Your account is ready, your encrypted Data Vault can travel with you, and your ARK planning toolkit is now connected in one place.',
    '',
    'A personal note from Fresh:',
    'Thank you for joining the TekStation community. I built TekStation to make ARK planning feel less like keeping a dozen tabs open and more like having your own survivor command center. I hope it saves you time, helps you prepare with confidence, and makes the next boss, tame, build or server a little easier to tackle.',
    '— Fresh · Creator of TekStation',
    '',
    'YOUR TEKSTATION TOOLKIT',
    '',
    ...featureRows.map(([label, desc]) => `${label}: ${desc}`),
    '',
    `Open TekStation: ${site}`,
    '',
    'You received this message because a TekStation account was created with this email address.',
    'TekStation is an independent ARK: Survival Ascended community tool and is not affiliated with Studio Wildcard.'
  ].join('\n');

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `welcome-user/${accountId}`
      },
      body: JSON.stringify({
        from: EMAIL_FROM,
        to: [safeEmail],
        subject: `Welcome to the TekStation community, ${display}!`,
        html,
        text,
        tags: [{name:'category',value:'welcome'},{name:'product',value:'tekstation'}]
      })
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('TekStation welcome email failed:', r.status, detail.slice(0, 500));
      return { configured: true, sent: false };
    }
    return { configured: true, sent: true };
  } catch (e) {
    console.error('TekStation welcome email exception:', String(e?.message || e));
    return { configured: true, sent: false };
  }
}

function escapeHtml(text) {
  return String(text || '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

async function handleAccount(request, env, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, {
    status:204,
    headers:{
      'access-control-allow-origin':'*',
      'access-control-allow-methods':'POST,OPTIONS',
      'access-control-allow-headers':'content-type,authorization',
      'access-control-max-age':'86400'
    }
  });
  if (request.method !== 'POST') return json({error:'method_not_allowed'},405,{allow:'POST,OPTIONS'});
  if (!env.TEKSTATION_DB) return json({error:'vault_not_configured',message:'Cloud account sync is not configured yet. Add the TEKSTATION_DB D1 binding.'},503);
  let body;
  try { body = await request.json(); } catch { return json({error:'invalid_json'},400); }
  const action = String(body?.action || '');

  if (action === 'health') {
    try {
      const tables = await env.TEKSTATION_DB.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tekstation_accounts','tekstation_sessions','tekstation_account_vault','tekstation_account_keys','tekstation_recovery_sessions','tekstation_login_challenges') ORDER BY name"
      ).all();
      return json({ok:true,db:true,tables:(tables.results||[]).map(r=>r.name)});
    } catch (e) {
      console.error('TekStation account health check failed:', String(e?.message || e));
      return json({error:'db_unavailable',message:'The TekStation account database is not responding.'},503);
    }
  }

  // Clean expired sessions opportunistically.
  try { await env.TEKSTATION_DB.prepare('DELETE FROM tekstation_sessions WHERE expires_at <= ?').bind(Date.now()).run(); } catch {}
  try { await env.TEKSTATION_DB.prepare('DELETE FROM tekstation_login_challenges WHERE expires_at <= ?').bind(Date.now()).run(); } catch {}

  if (action === 'register') {
    const emailHash = String(body?.emailHash || '').trim();
    const email = normalizeEmail(body?.email);
    const salt = String(body?.salt || '').trim();
    const verifier = String(body?.verifier || '').trim();
    if (!validEmail(email) || email.length > 254 || !/^[A-Za-z0-9_-]{40,64}$/.test(emailHash) || !/^[A-Za-z0-9_-]{20,64}$/.test(salt) || !/^ak1:[A-Za-z0-9_-]{43,60}$/.test(verifier)) {
      return json({error:'invalid_registration',message:'Registration details are invalid. Please try again.'},400);
    }
    if (!rateAllowed(emailHash)) return json({error:'rate_limited',message:'Too many registration attempts. Please wait a few minutes and try again.'},429);
    const id = newAccountId();
    const now = Date.now();
    const sessionTokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const sessionToken = toB64u(sessionTokenBytes);
    const sessionTokenHash = await hashText(sessionToken);
    const expiresAt = now + ACCOUNT_SESSION_DAYS * 86400000;
    try {
      const results = await env.TEKSTATION_DB.batch([
        env.TEKSTATION_DB.prepare('INSERT INTO tekstation_accounts (id,email_hash,salt,verifier,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(id,emailHash,salt,verifier,now,now),
        env.TEKSTATION_DB.prepare('INSERT INTO tekstation_sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)').bind(sessionTokenHash,id,expiresAt,now)
      ]);
      if (!Array.isArray(results) || results.length !== 2) throw new Error('registration_transaction_incomplete');
      if (ctx?.waitUntil) {
        ctx.waitUntil(Promise.resolve().then(() => sendWelcomeEmail(env, email, id)).catch(e => console.error('TekStation welcome-email task failed:', String(e?.message || e))));
      }
      return json({ok:true,accountId:id,emailHash,salt,sessionToken,expiresAt,hasCloudData:false,hasKeyEnvelope:false,welcomeEmailQueued:!!env.RESEND_API_KEY});
    } catch (e) {
      const msg = String(e?.message || e || 'database write failed');
      const stage = /UNIQUE|constraint/i.test(msg) ? 'constraint' : /foreign key/i.test(msg) ? 'foreign_key' : /no such table/i.test(msg) ? 'missing_table' : 'database';
      if (stage === 'constraint') return json({error:'account_exists',message:'An account with that email already exists. Sign in instead.'},409);
      console.error('TekStation account registration failed:', msg, e?.stack || '');
      return json({error:'account_registration_failed',stage,message:'TekStation could not create the account right now. Please try again in a moment.'},500);
    }
  }

  if (action === 'login-begin') {
    const emailHash = String(body?.emailHash || '').trim();
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(emailHash)) return json({error:'invalid_login',message:'Email or password is incorrect.'},401);
    if (!rateAllowed(emailHash)) return json({error:'rate_limited',message:'Too many sign-in attempts. Please wait a few minutes and try again.'},429);
    const account = await env.TEKSTATION_DB.prepare('SELECT id,email_hash,salt,verifier FROM tekstation_accounts WHERE email_hash=?').bind(emailHash).first();
    if (!account) return json({error:'invalid_login',message:'Email or password is incorrect.'},401);
    if (!String(account.verifier || '').startsWith('ak1:')) return json({error:'account_upgrade_required',message:'This account uses an older sign-in format. Use your recovery key to secure it again.'},409);
    const challenge = await createLoginChallenge(env, account.id);
    return json({ok:true,accountId:account.id,emailHash:account.email_hash,salt:account.salt,challenge:challenge.challenge,expiresAt:challenge.expiresAt});
  }

  if (action === 'login-complete') {
    const emailHash=String(body?.emailHash||'').trim(); const challenge=String(body?.challenge||'').trim(); const proof=String(body?.proof||'').trim();
    if(!challenge||!proof) return json({error:'invalid_login',message:'Email or password is incorrect.'},401);
    const ch=await getLoginChallenge(env,challenge);
    if(!ch) return json({error:'invalid_login',message:'Email or password is incorrect.'},401);
    const account=await env.TEKSTATION_DB.prepare('SELECT id,email_hash,salt,verifier FROM tekstation_accounts WHERE id=? AND email_hash=?').bind(ch.account_id,emailHash).first();
    if(!account||!String(account.verifier||'').startsWith('ak1:')) return json({error:'invalid_login',message:'Email or password is incorrect.'},401);
    const authKey=fromB64u(String(account.verifier).slice(4));
    const expected=await hmacB64(authKey,challenge);
    if(!constantTimeStringEqual(expected,proof)) return json({error:'invalid_login',message:'Email or password is incorrect.'},401);
    await env.TEKSTATION_DB.prepare('DELETE FROM tekstation_login_challenges WHERE challenge_hash=?').bind(ch.challenge_hash).run();
    const session=await createSession(env,account.id);
    const row=await env.TEKSTATION_DB.prepare('SELECT updated_at FROM tekstation_account_vault WHERE account_id=?').bind(account.id).first();
    const keyRow=await accountKeyRecord(env,account.id);
    return json({ok:true,accountId:account.id,emailHash:account.email_hash,salt:account.salt,sessionToken:session.token,expiresAt:session.expiresAt,hasCloudData:!!row,updatedAt:row?.updated_at||0,hasKeyEnvelope:!!keyRow,keyWrap:keyRow?.password_wrap||'',recoveryConfigured:!!keyRow?.recovery_hash});
  }

  if (action === 'recovery-begin') {
    const email=normalizeEmail(body?.email); const code=String(body?.recoveryKey || '');
    if (!validEmail(email) || !code) return json({error:'invalid_recovery',message:'Recovery details could not be verified.'},401);
    const emailHash=await hashText(email);
    if (!rateAllowed(emailHash+':recovery')) return json({error:'rate_limited',message:'Too many recovery attempts. Please wait a few minutes and try again.'},429);
    const account=await env.TEKSTATION_DB.prepare('SELECT id,salt FROM tekstation_accounts WHERE email_hash=?').bind(emailHash).first();
    if (!account) return json({error:'invalid_recovery',message:'Recovery details could not be verified.'},401);
    const recoveryHash=await hashText(String(code).replace(/[^A-Za-z0-9]/g,'').toUpperCase());
    const keyRow=await accountKeyRecord(env,account.id);
    if (!keyRow || !constantTimeStringEqual(recoveryHash,String(keyRow.recovery_hash))) return json({error:'invalid_recovery',message:'Recovery details could not be verified.'},401);
    const rs=await createRecoverySession(env,account.id);
    return json({ok:true,recoveryToken:rs.token,expiresAt:rs.expiresAt,recoveryWrap:keyRow.recovery_wrap,salt:account.salt,emailHash});
  }

  if (action === 'recovery-complete') {
    const recoveryToken=String(body?.recoveryToken || '');
    const rs=await recoverySession(env,recoveryToken);
    if (!rs) return json({error:'recovery_expired',message:'Recovery session expired. Start the recovery process again.'},401);
    const salt=String(body?.salt || ''); const verifier=String(body?.verifier || ''); const passwordWrap=String(body?.passwordWrap || '');
    if (!salt || !verifier || !passwordWrap) return json({error:'invalid_recovery_complete'},400);
    const now=Date.now();
    await env.TEKSTATION_DB.prepare('UPDATE tekstation_accounts SET salt=?,verifier=?,updated_at=? WHERE id=?').bind(salt,verifier,now,rs.account_id).run();
    await env.TEKSTATION_DB.prepare('UPDATE tekstation_account_keys SET password_wrap=?,updated_at=? WHERE account_id=?').bind(passwordWrap,now,rs.account_id).run();
    await env.TEKSTATION_DB.prepare('DELETE FROM tekstation_recovery_sessions WHERE token_hash=?').bind(rs.token_hash).run();
    const session2=await createSession(env,rs.account_id);
    const account=await env.TEKSTATION_DB.prepare('SELECT id,email_hash,salt FROM tekstation_accounts WHERE id=?').bind(rs.account_id).first();
    return json({ok:true,accountId:account.id,emailHash:account.email_hash,salt:account.salt,sessionToken:session2.token,expiresAt:session2.expiresAt});
  }

  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const session = await accountFromSession(env, token);
  if (!session) return json({error:'unauthorized',message:'Your TekStation session expired. Sign in again.'},401);
  if (action === 'keys-setup') {
    const passwordWrap=String(body?.passwordWrap||''); const recoveryHash=String(body?.recoveryHash||''); const recoveryWrap=String(body?.recoveryWrap||'');
    if (!passwordWrap || passwordWrap.length>10000 || !recoveryHash || !recoveryWrap) return json({error:'invalid_recovery_setup'},400);
    const existing=await accountKeyRecord(env,session.account_id);
    if (existing) return json({error:'recovery_already_configured',message:'A recovery key is already configured for this account.'},409);
    const now=Date.now();
    await env.TEKSTATION_DB.prepare('INSERT INTO tekstation_account_keys (account_id,password_wrap,recovery_hash,recovery_wrap,updated_at) VALUES (?,?,?,?,?)').bind(session.account_id,passwordWrap,recoveryHash,recoveryWrap,now).run();
    return json({ok:true,updatedAt:now});
  }


  if (action === 'get') {
    const row = await env.TEKSTATION_DB.prepare('SELECT blob, updated_at FROM tekstation_account_vault WHERE account_id=?').bind(session.account_id).first();
    return json({ok:true,blob:row?.blob||null,updatedAt:row?.updated_at||0});
  }

  if (action === 'put') {
    const blob = String(body?.blob || '');
    if (!blob || blob.length > 6000000) return json({error:'invalid_blob'},400);
    const now = Date.now();
    await env.TEKSTATION_DB.prepare(
      'INSERT INTO tekstation_account_vault (account_id,blob,updated_at) VALUES (?,?,?) ON CONFLICT(account_id) DO UPDATE SET blob=excluded.blob,updated_at=excluded.updated_at'
    ).bind(session.account_id,blob,now).run();
    await env.TEKSTATION_DB.prepare('UPDATE tekstation_accounts SET updated_at=? WHERE id=?').bind(now,session.account_id).run();
    return json({ok:true,updatedAt:now});
  }

  if (action === 'logout') {
    const tokenHash = await hashText(token);
    await env.TEKSTATION_DB.prepare('DELETE FROM tekstation_sessions WHERE token_hash=?').bind(tokenHash).run();
    return json({ok:true});
  }

  return json({error:'unknown_action'},400);
}


function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      ...extra
    }
  });
}

function normalizeServers(raw) {
  // Wildcard's documented ASA endpoint is a JSON array, but tolerate an
  // object wrapper as well so a harmless upstream format change does not
  // blank the entire server browser.
  const all = Array.isArray(raw)
    ? raw
    : Array.isArray(raw?.servers)
      ? raw.servers
      : Array.isArray(raw?.data)
        ? raw.data
        : [];

  return all.map(s => ({
    n: s?.Name || s?.SessionName || '',
    m: s?.MapName || '',
    p: Number.isFinite(s?.NumPlayers) ? s.NumPlayers : Number(s?.NumPlayers) || 0,
    x: Number.isFinite(s?.MaxPlayers) ? s.MaxPlayers : Number(s?.MaxPlayers) || 0,
    c: s?.ClusterId || '',
    ping: Number.isFinite(s?.ServerPing) ? s.ServerPing : Number(s?.ServerPing) || 0,
    platform: s?.PlatformType || '',
    ip: s?.IP || '',
    port: Number.isFinite(s?.Port) ? s.Port : Number(s?.Port) || 0,
    game: s?.GameMode || '',
    last: Number.isFinite(s?.LastUpdated) ? s.LastUpdated : Number(s?.LastUpdated) || 0
  })).filter(s => s.n);
}

async function getOfficialServers() {
  const upstreamAbort = new AbortController();
  const timer = setTimeout(() => upstreamAbort.abort(), 8000);

  try {
    const r = await fetch(SOURCE, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'user-agent': 'TekStation/1.0 (+https://tekstation.app)'
      },
      signal: upstreamAbort.signal,
      cf: { cacheTtl: TTL, cacheEverything: true }
    });

    if (!r.ok) throw new Error(`upstream HTTP ${r.status}`);

    const raw = await r.json();
    const servers = normalizeServers(raw);
    if (!servers.length) throw new Error('upstream returned no servers');

    return { servers, stale: false, error: null };
  } finally {
    clearTimeout(timer);
  }
}

async function handleServers(request, ctx) {
  if (request.method === 'OPTIONS') return new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,HEAD,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-max-age': '86400'
    }
  });

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json({ error: 'method_not_allowed' }, 405, { allow: 'GET,HEAD,OPTIONS' });
  }

  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = API_CACHE_PATH;
  cacheUrl.search = '';
  const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) {
    const response = new Response(hit.body, hit);
    response.headers.set('x-tekstation-cache', 'hit');
    return request.method === 'HEAD' ? new Response(null, response) : response;
  }

  try {
    const result = await getOfficialServers();
    const body = JSON.stringify({
      t: Date.now(),
      stale: false,
      servers: result.servers
    });

    const response = new Response(body, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, max-age=${TTL}`,
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'x-tekstation-cache': 'miss'
      }
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return request.method === 'HEAD' ? new Response(null, response) : response;
  } catch (e) {
    // Do not cache an error and do not return a fake empty server list.
    return json({
      error: 'upstream_unavailable',
      message: 'Wildcard official server list is currently unavailable.'
    }, 502, { 'cache-control': 'no-store' });
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === API_HEALTH_PATH) {
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'GET,HEAD,OPTIONS'
          }
        });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return json({ error: 'method_not_allowed' }, 405, { allow: 'GET,HEAD,OPTIONS' });
      }
      return json({ ok: true, service: 'tekstation-api', time: Date.now() });
    }

    if (url.pathname === API_VAULT_PATH) {
      return handleVault(request, env);
    }

    if (url.pathname === API_ACCOUNT_PATH) {
      return handleAccount(request, env, ctx);
    }

    if (url.pathname === API_CACHE_PATH) {
      return handleServers(request, ctx);
    }

    // Pages Advanced Mode must explicitly pass all non-API traffic to the
    // project's static asset binding. Clean tab routes (/servers, /maps, etc.)
    // are SPA routes, so if no real asset exists, fall back to index.html.
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404 || request.method !== 'GET') return assetResponse;
    const accept = request.headers.get('accept') || '';
    if (accept.includes('text/html')) {
      const shell = new URL('/index.html', request.url);
      return env.ASSETS.fetch(new Request(shell.toString(), request));
    }
    return assetResponse;
  }
};
