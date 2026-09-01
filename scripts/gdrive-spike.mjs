#!/usr/bin/env node
/**
 * gdrive-spike.mjs — Phase 0 validation spike for the Google Drive publish
 * provider (issue #221).
 *
 * REMOVAL: the plan's ORIGINAL trigger — "delete this file once
 * packages/cli/src/lib/publish/providers/gdrive.ts exists and its tests
 * pass" — has already fired; both exist. This file is being kept PAST that
 * trigger deliberately, ONLY for the two still-open manual follow-ups that
 * have no other home: P12 (folder-move survival — re-run with --folder-id)
 * and P14 (Testing-mode 7-day refresh-token expiry — re-run with
 * --refresh-only). Once the product owner confirms both P12 and P14 are
 * done, delete this file; do not let it linger past that as dead weight.
 *
 * Purpose: prove the DESIGN against real Google before writing production
 * code. Every assumption in the plan that depends on Google's actual behavior
 * is exercised here and reported PASS/FAIL with evidence. Zero dependencies,
 * zero repo coupling — plain `node scripts/gdrive-spike.mjs`.
 *
 * SETUP (~10 min, no verification needed — a Testing-mode app is enough):
 *   1. console.cloud.google.com → new project
 *   2. APIs & Services → Library → enable "Google Drive API"
 *   3. OAuth consent screen → External → fill app name + your email.
 *      Add scopes: .../auth/drive.file, openid, email
 *      ** While adding drive.file, LOOK AT THE TABLE: Google labels each scope
 *         Non-sensitive / Sensitive / Restricted. Screenshot it — that single
 *         screen settles the D1 verification question. **
 *      Add yourself under "Test users".
 *   4. Credentials → Create credentials → OAuth client ID → **Desktop app**
 *   5. export GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=...
 *
 * RUN (machine with a browser):
 *   node scripts/gdrive-spike.mjs                    # full run
 *   node scripts/gdrive-spike.mjs --folder-id <id>   # re-check a moved folder (P12)
 *   node scripts/gdrive-spike.mjs --keep-token       # skip P11's revoke and SAVE the
 *                                                    # refresh token, so P14 is possible
 *   node scripts/gdrive-spike.mjs --refresh-only     # P14: 8 days later, does that
 *                                                    # saved refresh token still work?
 *
 * RUN (headless / remote / SSH — browser is on a DIFFERENT machine):
 *   node scripts/gdrive-spike.mjs --manual                       # prints the URL
 *   node scripts/gdrive-spike.mjs --manual --resume "<url>"      # finish with the
 *                                                                # redirect URL you
 *                                                                # were bounced to
 */
import http from "node:http";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, statSync, openSync, readSync, closeSync, unlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID?.trim();
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET?.trim();
const SCOPES = "https://www.googleapis.com/auth/drive.file openid email";
const FOLDER_NAME = "Gutterpress";
// Deliberately the 256 KiB minimum so even a ~1 MB file produces several
// chunks and genuinely exercises the 308-resume path.
const CHUNK = 256 * 1024;

const results = [];
const pass = (id, what, ev) => { results.push({ id, ok: true, what, ev }); console.log(`  \x1b[32mPASS\x1b[0m ${id} ${what}\n       ${ev}`); };
const fail = (id, what, ev) => { results.push({ id, ok: false, what, ev }); console.log(`  \x1b[31mFAIL\x1b[0m ${id} ${what}\n       ${ev}`); };
const step = (t) => console.log(`\n\x1b[1m── ${t}\x1b[0m`);

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first (see header for the 10-minute setup).");
  process.exit(2);
}

const b64url = (b) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const jfetch = async (url, init) => {
  const r = await fetch(url, init);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, headers: r.headers, body };
};
const authHdr = (t) => ({ Authorization: `Bearer ${t}` });

const TOKEN_FILE = path.join(homedir(), ".gutterpress-spike-refresh.json");

// ── P14 (--refresh-only): does a saved refresh token still work N days later? ──
// Runs BEFORE any consent — that is the whole point: no re-auth.
if (process.argv.includes("--refresh-only")) {
  step("P14  Does a previously saved refresh token still work?  (Testing-mode 7-day expiry)");
  let saved;
  try { saved = JSON.parse(readFileSync(TOKEN_FILE, "utf8")); }
  catch { console.error(`No saved token at ${TOKEN_FILE}. Do a full run with --keep-token first.`); process.exit(2); }
  const ageDays = ((Date.now() - saved.savedAt) / 86400000).toFixed(1);
  const r = await jfetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: saved.refresh_token, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  r.status === 200
    ? pass("P14", `refresh token STILL VALID after ${ageDays} days`, "no weekly re-consent needed during development")
    : fail("P14", `refresh token DEAD after ${ageDays} days`, `${JSON.stringify(r.body).slice(0, 200)} — plan for periodic re-consent until the app is published`);
  console.log(`\n  Delete the saved credential when done:  rm ${TOKEN_FILE}`);
  process.exit(r.status === 200 ? 0 : 1);
}

// ── P1: obtain an authorization code (loopback, or headless two-step) ────────
// Three modes:
//   (default)            local listener on 127.0.0.1:<ephemeral>  — full P1 proof
//   --manual             print the URL + persist PKCE state, then exit (phase A)
//   --manual --resume U  finish using the redirect URL you were bounced to (phase B)
// The manual pair exists for HEADLESS/REMOTE boxes (SSH, containers, this repo's
// cloud sessions) where the machine running the script has no browser and your
// browser cannot reach the script's 127.0.0.1. Your browser will show
// "connection refused" on the redirect — that is expected; the code is in the
// URL bar. Google still had to ACCEPT the un-registered ephemeral loopback port
// to issue that code, so P1's substantive claim is proven either way.
const MANUAL = process.argv.includes("--manual");
const RESUME = process.argv.includes("--resume") ? process.argv[process.argv.indexOf("--resume") + 1] : null;
const STATE_FILE = path.join(tmpdir(), "gutterpress-spike-pkce.json");

step("P1  Loopback redirect on an ephemeral port + PKCE S256");

let verifier, state, redirectUri, code, port;

if (RESUME) {
  // ---- phase B: finish a --manual run -------------------------------------
  let saved;
  try { saved = JSON.parse(readFileSync(STATE_FILE, "utf8")); }
  catch { console.error(`No pending run found (${STATE_FILE}). Run with --manual first.`); process.exit(2); }
  ({ verifier, state, redirectUri, port } = saved);
  let got;
  try { got = new URL(RESUME.trim()); }
  catch { console.error("--resume needs the FULL redirect URL you were bounced to (starts with http://127.0.0.1:...)"); process.exit(2); }
  const err = got.searchParams.get("error");
  if (err) { fail("P1", "consent denied", err); process.exit(1); }
  if (got.searchParams.get("state") !== state) {
    fail("P1", "STATE MISMATCH — refusing the code", `expected ${state}, got ${got.searchParams.get("state")}`);
    process.exit(1);
  }
  code = got.searchParams.get("code");
  if (!code) { fail("P1", "no code in the pasted URL", RESUME.slice(0, 120)); process.exit(1); }
  try { unlinkSync(STATE_FILE); } catch {}
  pass("P1", "authorization code obtained (headless two-step)", `Google accepted un-registered loopback port ${port} and issued a code; state matched`);
} else {
  // ---- fresh run: build the PKCE challenge --------------------------------
  verifier = b64url(crypto.randomBytes(32));
  state = b64url(crypto.randomBytes(16));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

  let server = null;
  if (MANUAL) {
    port = 8765; // fixed in manual mode: nothing listens, it only has to be a loopback URI
    redirectUri = `http://127.0.0.1:${port}`;
  } else {
    server = http.createServer();
    await new Promise((res) => server.listen(0, "127.0.0.1", res));
    port = server.address().port;
    redirectUri = `http://127.0.0.1:${port}`;
    console.log(`  listener bound: ${redirectUri}  (port was NOT pre-registered in Cloud Console)`);
  }

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` + new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPES,
    code_challenge: challenge, code_challenge_method: "S256", state,
    access_type: "offline", prompt: "consent",
  });

  if (MANUAL) {
    writeFileSync(STATE_FILE, JSON.stringify({ verifier, state, redirectUri, port }), { mode: 0o600 });
    console.log(`
  \x1b[1mSTEP 1 — open this in your browser and approve:\x1b[0m

  ${authUrl}

  \x1b[1mSTEP 2 —\x1b[0m your browser will then fail to load a 127.0.0.1 page
  ("connection refused"). That is EXPECTED. Copy the full URL from the
  address bar — it contains ?code=... — and run:

     node scripts/gdrive-spike.mjs --manual --resume "<paste that URL>"

  (PKCE verifier saved to ${STATE_FILE}, mode 0600.)
`);
    process.exit(0);
  }

  const codePromise = new Promise((resolve, reject) => {
    server.on("request", (req, res) => {
      const u = new URL(req.url, redirectUri);
      const err = u.searchParams.get("error");
      const got = u.searchParams.get("code");
      const gotState = u.searchParams.get("state");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="font:16px system-ui;padding:3rem"><h2>${err ? "Denied" : "Connected"}</h2><p>Return to the terminal.</p></body></html>`);
      server.close();
      if (err) return reject(new Error(`consent denied: ${err}`));
      if (gotState !== state) return reject(new Error(`STATE MISMATCH (got ${gotState})`));
      resolve(got);
    });
    setTimeout(() => reject(new Error("timed out after 5 min")), 5 * 60_000).unref?.();
  });

  console.log(`\n  Opening your browser. If it doesn't open, paste:\n  ${authUrl}\n`);
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(opener, [authUrl], { detached: true, stdio: "ignore" });
    // spawn reports ENOENT asynchronously; without this handler a headless box
    // (no xdg-open) crashes the spike instead of falling back to the printed URL.
    child.on("error", () => console.log("  (couldn't auto-open a browser — use the URL above, or re-run with --manual)"));
    child.unref();
  } catch { /* URL is printed above */ }

  try { code = await codePromise; pass("P1", "loopback + state + PKCE round-trip", `un-registered port ${port} accepted by Google; state matched`); }
  catch (e) { fail("P1", "loopback round-trip", String(e.message)); process.exit(1); }
}

// ── P2: does the Desktop client REALLY need client_secret with PKCE? ─────────
step("P2  Is client_secret required for a Desktop client using PKCE?  (settles D3 / ADR 0011)");
const exchange = (withSecret) => jfetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "authorization_code", code, client_id: CLIENT_ID,
    ...(withSecret ? { client_secret: CLIENT_SECRET } : {}),
    redirect_uri: redirectUri, code_verifier: verifier,
  }),
});

let tok = await exchange(false);
let neededSecret = false;
if (tok.status === 200) {
  fail("P2", "secret NOT required — D3/ADR 0011 may be unnecessary!", `PKCE-only exchange returned 200. Re-run D3: we may be able to ship with NO embedded secret. (Marked FAIL only to make it loud.)`);
} else {
  neededSecret = true;
  const e1 = typeof tok.body === "object" ? tok.body.error : tok.status;
  tok = await exchange(true);
  if (tok.status === 200) pass("P2", "client_secret IS required (D3 confirmed)", `PKCE-only → ${tok.status === 200 ? "" : ""}${e1}; with secret → 200. ADR 0011 is justified.`);
  else { fail("P2", "token exchange failed even WITH secret", JSON.stringify(tok.body).slice(0, 300)); process.exit(1); }
}
const { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn } = tok.body;

// ── P3: refresh token issued ────────────────────────────────────────────────
step("P3  Refresh token issued with access_type=offline&prompt=consent  (D4)");
refreshToken
  ? pass("P3", "refresh_token present", `access token expires in ${expiresIn}s; refresh_token len=${refreshToken.length} (this is the durable secret we store)`)
  : fail("P3", "NO refresh_token returned", "D4's storage model assumes one. Check access_type/prompt.");

// ── P4: about.get — email + quota ───────────────────────────────────────────
step("P4  about.get → account email + storageQuota  (D4 label, quota fail-fast)");
const about = await jfetch("https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName),storageQuota", { headers: authHdr(accessToken) });
if (about.status === 200) {
  const q = about.body.storageQuota ?? {};
  const free = q.limit ? (Number(q.limit) - Number(q.usage)) : null;
  pass("P4", "about.get works", `user=${about.body.user?.emailAddress}; quota limit=${q.limit ?? "unlimited"} usage=${q.usage} free=${free ?? "n/a"}`);
} else fail("P4", "about.get failed", JSON.stringify(about.body).slice(0, 300));

// ── P5/P6: folder create + drive.file scope containment ─────────────────────
step("P5  Find-or-create the folder  /  P6  does drive.file hide the rest of Drive?");
const q = `mimeType='application/vnd.google-apps.folder' and trashed=false`;
let list = await jfetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`, { headers: authHdr(accessToken) });
const visibleBefore = list.body.files ?? [];
let folderId = process.argv.includes("--folder-id")
  ? process.argv[process.argv.indexOf("--folder-id") + 1]
  : visibleBefore.find((f) => f.name === FOLDER_NAME)?.id;

if (!folderId) {
  const mk = await jfetch("https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST", headers: { ...authHdr(accessToken), "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (mk.status === 200) { folderId = mk.body.id; pass("P5", "folder created at My Drive root", `id=${folderId}`); }
  else fail("P5", "folder create failed", JSON.stringify(mk.body).slice(0, 300));
} else pass("P5", "existing folder resolved (find-or-create path)", `id=${folderId}`);

list = await jfetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=100`, { headers: authHdr(accessToken) });
const visible = list.body.files ?? [];
pass("P6", "folders visible under drive.file", `${visible.length} folder(s): ${visible.map((f) => f.name).join(", ") || "(none)"}\n       >> COMPARE with your real Drive. If this lists ONLY app-created folders, D1/D5's containment assumption holds.`);

// ── P7/P8: resumable upload in chunks ───────────────────────────────────────
step("P7  Resumable upload with 308 resume  /  P8  webViewLink returned");
const tmp = path.join(tmpdir(), "gutterpress-spike.pdf");
writeFileSync(tmp, Buffer.concat([Buffer.from("%PDF-1.4\n% spike\n"), crypto.randomBytes(900 * 1024)]));
const total = statSync(tmp).size;

async function resumableUpload({ fileId }) {
  const base = "https://www.googleapis.com/upload/drive/v3/files";
  const url = fileId ? `${base}/${fileId}?uploadType=resumable&fields=id,name,webViewLink`
                     : `${base}?uploadType=resumable&fields=id,name,webViewLink`;
  const start = await fetch(url, {
    method: fileId ? "PATCH" : "POST",
    headers: { ...authHdr(accessToken), "Content-Type": "application/json; charset=UTF-8",
               "X-Upload-Content-Type": "application/pdf", "X-Upload-Content-Length": String(total) },
    body: JSON.stringify(fileId ? {} : { name: "spike-book.pdf", parents: [folderId] }),
  });
  const session = start.headers.get("location");
  if (!session) throw new Error(`no resumable session (HTTP ${start.status}) ${(await start.text()).slice(0, 200)}`);

  const fd = openSync(tmp, "r");
  let offset = 0, chunks = 0, resumes = 0;
  try {
    while (offset < total) {
      const len = Math.min(CHUNK, total - offset);
      const buf = Buffer.alloc(len);
      readSync(fd, buf, 0, len, offset);
      const r = await fetch(session, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${offset}-${offset + len - 1}/${total}`, "Content-Length": String(len) },
        body: buf,
      });
      chunks++;
      if (r.status === 308) {
        resumes++;
        const range = r.headers.get("range");            // e.g. "bytes=0-262143"
        offset = range ? Number(range.split("-")[1]) + 1 : offset + len;
      } else if (r.status === 200 || r.status === 201) {
        return { file: await r.json(), chunks, resumes, session: !!session };
      } else {
        throw new Error(`chunk HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
    }
    throw new Error("stream ended without a final 200/201");
  } finally { closeSync(fd); }
}

let created;
try {
  created = await resumableUpload({});
  pass("P7", "resumable upload completed", `${(total / 1024).toFixed(0)} KiB in ${created.chunks} chunks; ${created.resumes}× HTTP 308 + Range resume handled`);
  created.file.webViewLink
    ? pass("P8", "webViewLink returned", created.file.webViewLink)
    : fail("P8", "no webViewLink", JSON.stringify(created.file));
} catch (e) { fail("P7", "resumable upload", String(e.message)); }

// ── P9: update-in-place keeps the id AND the link ───────────────────────────
step("P9  Re-publish → find-and-update keeps the same fileId and link  (D6)");
if (created) {
  const nameQ = `name='spike-book.pdf' and '${folderId}' in parents and trashed=false`;
  const found = await jfetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(nameQ)}&fields=files(id,webViewLink)`, { headers: authHdr(accessToken) });
  const existing = found.body.files?.[0];
  if (!existing) fail("P9", "could not find the file we just uploaded", JSON.stringify(found.body).slice(0, 200));
  else {
    const updated = await resumableUpload({ fileId: existing.id });
    const sameId = updated.file.id === created.file.id;
    const sameLink = updated.file.webViewLink === created.file.webViewLink;
    sameId && sameLink
      ? pass("P9", "update-in-place preserves id + link", `id ${created.file.id} unchanged; webViewLink unchanged → shared links stay valid`)
      : fail("P9", "update did NOT preserve identity", `sameId=${sameId} sameLink=${sameLink}`);
  }
}

// ── P10: the refresh token actually mints a new access token ────────────────
step("P10  Refresh grant works  (D4's mint-on-demand model)");
if (refreshToken) {
  const r = await jfetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: CLIENT_ID, client_secret: CLIENT_SECRET }),
  });
  r.status === 200 && r.body.access_token
    ? pass("P10", "refresh → new access token", `new token expires in ${r.body.expires_in}s (no re-consent needed)`)
    : fail("P10", "refresh failed", JSON.stringify(r.body).slice(0, 300));
}

// ── P11: revoke (used by disconnect) ────────────────────────────────────────
step("P11  Revoke endpoint  (disconnect path)");
if (process.argv.includes("--keep-token")) {
  // Revoking kills the refresh token, which would make P14 impossible — so
  // --keep-token skips it and persists the token for the later 8-day re-check.
  writeFileSync(TOKEN_FILE, JSON.stringify({ refresh_token: refreshToken, savedAt: Date.now() }), { mode: 0o600 });
  console.log(`  \x1b[33mSKIP\x1b[0m P11 revoke skipped (--keep-token)\n       refresh token saved 0600 to ${TOKEN_FILE} — this is a REAL credential.\n       Run --refresh-only in ~8 days for P14, then: rm ${TOKEN_FILE}`);
} else {
  const r = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refreshToken ?? accessToken }),
  });
  r.ok ? pass("P11", "revoke accepted", `HTTP ${r.status} — disconnect can revoke at Google, not just delete locally`)
       : fail("P11", "revoke rejected", `HTTP ${r.status}`);
}

try { unlinkSync(tmp); } catch {}

// ── Summary ─────────────────────────────────────────────────────────────────
const bad = results.filter((r) => !r.ok);
console.log(`\n\x1b[1m════ SUMMARY ════\x1b[0m`);
for (const r of results) console.log(`${r.ok ? "\x1b[32m ✓\x1b[0m" : "\x1b[31m ✗\x1b[0m"} ${r.id}  ${r.what}`);
console.log(`\n${results.length - bad.length}/${results.length} assumptions confirmed.`);
console.log(`\n\x1b[1mMANUAL follow-ups the script cannot do:\x1b[0m
  P12  Move the "${FOLDER_NAME}" folder somewhere else in Drive (drag it into any
       existing folder), then re-run:  node scripts/gdrive-spike.mjs --folder-id ${folderId ?? "<id>"}
       If the upload still lands in it, D5's "ids survive moves" assumption holds —
       this is what makes the drive.file limitation acceptable.
  P13  Confirm the consent screen wording + whether Google flags drive.file as
       Non-sensitive (screenshot from setup step 3).
  P14  Testing-mode refresh tokens are said to expire after ~7 days. NOTE: a
       normal run REVOKES the refresh token in P11, so it cannot be reused.
       To test this, do a run with --keep-token (skips the revoke and saves the
       token 0600), then in ~8 days:  node scripts/gdrive-spike.mjs --refresh-only`);
process.exit(bad.length ? 1 : 0);
