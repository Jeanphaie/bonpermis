'use strict';
/* Outils communs du service : configuration, HTTP, Stripe, e-mail, stockage, zip, images.
   Aucune dépendance npm. Les images passent par des outils système s'ils sont installés
   (pdftoppm pour les PDF, ImageMagick pour HEIC et le filigrane) ; sans eux, le service marche en mode réduit. */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tls = require('tls');
const zlib = require('zlib');
const {execFile, execFileSync} = require('child_process');

const RACINE = path.join(__dirname, '..');
const PRIX = require(path.join(RACINE, 'src', 'prix.js'));
const DATA = JSON.parse(fs.readFileSync(path.join(RACINE, 'src', 'data.json'), 'utf8'));
const PAGES = JSON.parse(fs.readFileSync(path.join(RACINE, 'src', 'pages.json'), 'utf8')).pages;
let PIECES = null; try { PIECES = JSON.parse(fs.readFileSync(path.join(RACINE, 'src', 'pieces.json'), 'utf8')); } catch { PIECES = null; }

const E = process.env;
const CONF = {
  port: +(E.PORT || 3000),
  site: (E.SITE_URL || 'https://bonpermis.fr').replace(/\/$/, ''),
  stripeCle: E.STRIPE_SECRET_KEY || '',
  stripeWebhook: E.STRIPE_WEBHOOK_SECRET || '',
  stripeApi: (E.STRIPE_API || 'https://api.stripe.com').replace(/\/$/, ''),
  donnees: E.DATA_DIR || '/data',
  smtp: {hote: E.SMTP_HOST || '', port: +(E.SMTP_PORT || 465), user: E.SMTP_USER || '', pass: E.SMTP_PASS || ''},
  mailDe: E.MAIL_FROM || 'contact@bonpermis.fr',
  mailA: E.MAIL_TO || 'contact@bonpermis.fr',
  admins: (E.ADMIN_EMAILS || 'contact@bonpermis.fr,jpk@lk-invest.fr').toLowerCase().split(',').map(s => s.trim()).filter(Boolean),
  acompte: 0.3
};
// Clé de signature des liens et des cookies. Dérivée du secret du webhook (jamais dans le dépôt).
const SECRET = crypto.createHash('sha256').update('bonpermis:' + (E.LIENS_SECRET || CONF.stripeWebhook || 'dev-local')).digest();
const signer = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const egal = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const journal = (...m) => console.log(new Date().toISOString(), ...m);
const euro = n => (Math.round(n * 100) / 100).toLocaleString('fr-FR', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}) + ' €';

// ---------- HTTP ----------
function lireCorps(req, max = 20000) {
  return new Promise((ok, ko) => {
    const morceaux = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { ko(new Error('trop gros')); req.destroy(); } else morceaux.push(c); });
    req.on('end', () => ok(Buffer.concat(morceaux)));
    req.on('error', ko);
  });
}
async function lireJson(req, max) { try { return JSON.parse(await lireCorps(req, max)); } catch { return null; } }
function repondre(res, code, obj, entetes = {}) {
  const corps = JSON.stringify(obj);
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(corps), ...entetes});
  res.end(corps);
}
function envoyerFichier(res, fichier, type, nomTelechargement) {
  let st; try { st = fs.statSync(fichier); } catch { return repondre(res, 404, {erreur: 'Fichier introuvable.'}); }
  const h = {'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff'};
  h['Content-Disposition'] = (nomTelechargement ? 'attachment' : 'inline') + `; filename="${(nomTelechargement || path.basename(fichier)).replace(/[^\w.-]/g, '_')}"`;
  res.writeHead(200, h);
  fs.createReadStream(fichier).pipe(res);
}
const TYPES = {jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf'};
const ip = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

// Limites anti-abus : n demandes par tranche de 10 minutes, par clé (adresse IP, e-mail…).
const compteurs = new Map();
function trop(cle, max) {
  const t = Date.now(), c = compteurs.get(cle) || {n: 0, depuis: t};
  if (t - c.depuis > 600000) { c.n = 0; c.depuis = t; }
  c.n++; compteurs.set(cle, c);
  if (compteurs.size > 20000) compteurs.clear();
  return c.n > max;
}
const tropDeDemandes = req => trop('ip:' + ip(req), +E.LIMITE_POST || 20);

// ---------- cookies ----------
function lireCookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}
const secure = () => CONF.site.startsWith('https:') ? '; Secure' : '';
const cookie = (nom, val, maxAge) => `${nom}=${encodeURIComponent(val)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure()}`;

// ---------- Stripe ----------
function encoder(obj, prefixe, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const cle = prefixe ? `${prefixe}[${k}]` : k;
    if (typeof v === 'object') encoder(v, cle, out);
    else out.push(encodeURIComponent(cle) + '=' + encodeURIComponent(String(v)));
  }
  return out.join('&');
}
async function stripe(methode, chemin, params) {
  if (!CONF.stripeCle) throw new Error('Clé Stripe absente');
  const r = await fetch(CONF.stripeApi + chemin, {
    method: methode,
    headers: {'Authorization': 'Bearer ' + CONF.stripeCle, 'Content-Type': 'application/x-www-form-urlencoded'},
    body: params ? encoder(params) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error((j.error && j.error.message) || ('Stripe ' + r.status)); e.stripe = j.error; throw e; }
  return j;
}
function signatureValide(brut, entete, secret) {
  if (!entete || !secret) return false;
  const parts = Object.fromEntries(entete.split(',').map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }).filter(([k]) => k));
  const sigs = entete.split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  const t = +parts.t;
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return false;
  const attendu = crypto.createHmac('sha256', secret).update(t + '.' + brut).digest('hex');
  return sigs.some(s => s.length === attendu.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(attendu)));
}
// Référence courte, lisible au téléphone : BP- + 6 caractères sans 0/O/1/I.
function reference(sessionId) {
  const A = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', h = crypto.createHash('sha256').update(sessionId).digest();
  let s = ''; for (let i = 0; i < 6; i++) s += A[h[i] % A.length];
  return 'BP-' + s;
}

// ---------- e-mail (SMTP sur TLS, port 465) ----------
function envoyerMail(a, sujet, texte, repondreA) {
  const {hote, port, user, pass} = CONF.smtp;
  if (!hote || !user || !pass) { journal('mail non envoyé (SMTP non configuré) :', sujet); noterMail(a, sujet, false, 'SMTP non configuré', 0); return Promise.resolve(false); }
  const debut = Date.now(); let derniere = '';
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const message = [
    `From: Le Bon Permis <${CONF.mailDe}>`, `To: <${a}>`, repondreA ? `Reply-To: <${repondreA}>` : null,
    `Subject: =?UTF-8?B?${b64(sujet)}?=`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@bonpermis.fr>`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '',
    b64(texte).replace(/.{76}/g, '$&\r\n')
  ].filter(l => l !== null).join('\r\n');
  return new Promise((ok) => {
    const s = tls.connect({host: hote, port, servername: hote}, () => {});
    let tampon = '', etape = 0;
    const etapes = [
      [220, () => `EHLO bonpermis.fr`], [250, () => 'AUTH LOGIN'], [334, () => b64(user)], [334, () => b64(pass)],
      [235, () => `MAIL FROM:<${CONF.mailDe}>`], [250, () => `RCPT TO:<${a}>`], [250, () => 'DATA'],
      [354, () => message + '\r\n.'], [250, () => 'QUIT']
    ];
    let fini = false;
    const fin = (r, why) => {
      if (fini) return; fini = true;
      if (!r) journal('échec SMTP :', why);
      noterMail(a, sujet, r, r ? derniere : why, Date.now() - debut, etape);
      s.destroy(); ok(r);
    };
    s.setTimeout(20000, () => fin(false, 'délai dépassé'));
    s.on('error', e => fin(false, e.message));
    s.on('data', d => {
      tampon += d.toString();
      const lignes = tampon.split('\r\n'); tampon = lignes.pop();
      for (const l of lignes) {
        if (/^\d{3}-/.test(l)) continue;
        derniere = l.slice(0, 300);
        const code = +l.slice(0, 3), [attendu, suite] = etapes[etape] || [221];
        if (etape >= etapes.length) return fin(true);
        if (code !== attendu) return fin(false, l);
        etape++; s.write(suite() + '\r\n');
        if (etape === etapes.length) return fin(true);
      }
    });
  });
}
const signature = `\n\nL'équipe Le Bon Permis\n${CONF.site}\n`;

// Journal des e-mails : chaque envoi, accepté ou refusé, avec la dernière réponse du serveur SMTP.
// Visible dans l'espace équipe (/admin/#mails). Les codes à 6 chiffres sont masqués. Fichier limité à ~2 Mo.
const ETAPES_SMTP = ['connexion', 'EHLO', 'AUTH', 'identifiant', 'mot de passe', 'expéditeur', 'destinataire', 'DATA', 'envoi du message', 'QUIT'];
function noterMail(a, sujet, ok, reponse, ms, etape) {
  try {
    const f = path.join(CONF.donnees, 'journal', 'mails.jsonl');
    fs.mkdirSync(path.dirname(f), {recursive: true});
    try { if (fs.statSync(f).size > 2e6) fs.renameSync(f, f + '.1'); } catch {}
    const ligne = {date: new Date().toISOString(), a, sujet: String(sujet).replace(/\b\d{6}\b/g, '••••••'), ok: !!ok,
      etape: ok ? 'remis au serveur' : (ETAPES_SMTP[etape] || '?'), reponse: String(reponse || '').replace(/\b\d{6}\b/g, '••••••'), ms};
    fs.appendFileSync(f, JSON.stringify(ligne) + '\n');
  } catch (e) { journal('journal des mails impossible :', e.message); }
}
function lireJournalMails(n = 200) {
  const f = path.join(CONF.donnees, 'journal', 'mails.jsonl');
  let t = ''; try { t = fs.readFileSync(f, 'utf8'); } catch { return []; }
  return t.trim().split('\n').filter(Boolean).slice(-n).reverse().map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

// ---------- stockage JSON ----------
const chemin = (...p) => path.join(CONF.donnees, ...p);
function lire(...p) { try { return JSON.parse(fs.readFileSync(chemin(...p), 'utf8')); } catch { return null; } }
function ecrire(obj, ...p) {
  const f = chemin(...p); fs.mkdirSync(path.dirname(f), {recursive: true});
  const tmp = f + '.' + process.pid + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 2)); fs.renameSync(tmp, f);
}
function creer(obj, ...p) { // n'écrit que si le fichier n'existe pas encore
  const f = chemin(...p); fs.mkdirSync(path.dirname(f), {recursive: true});
  try { fs.writeFileSync(f, JSON.stringify(obj, null, 2), {flag: 'wx'}); return true; } catch { return false; }
}
const liste = (...p) => { try { return fs.readdirSync(chemin(...p)); } catch { return []; } };

// ---------- validation ----------
const MAIL_RE = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,190}\.[a-z]{2,}$/i;
const texte = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';
const texteLong = (v, max = 5000) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '';
const nomPropre = n => (String(n || 'fichier').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+/, '').slice(0, 80) || 'fichier');
const id = (n = 9) => crypto.randomBytes(n).toString('base64url').replace(/[-_]/g, 'x');

function typeFichier(t) {
  if (t[0] === 0xFF && t[1] === 0xD8 && t[2] === 0xFF) return 'jpg';
  if (t.slice(0, 4).toString('hex') === '89504e47') return 'png';
  if (t.slice(0, 4).toString() === '%PDF') return 'pdf';
  if (t.slice(0, 4).toString() === 'RIFF' && t.slice(8, 12).toString() === 'WEBP') return 'webp';
  if (t.slice(4, 8).toString() === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis)/.test(t.slice(8, 12).toString())) return 'heic';
  return null;
}

// Réception d'un fichier envoyé en flux (corps brut). Vérifie la taille et le type réel.
function recevoirFichier(req, dossier, base, max, typesOk) {
  return new Promise(ok => {
    fs.mkdirSync(dossier, {recursive: true});
    const tmp = path.join(dossier, '.' + base + '.part');
    const out = fs.createWriteStream(tmp, {flags: 'w'});
    let n = 0, tete = Buffer.alloc(0), fini = false;
    const echec = (code, erreur) => { if (fini) return; fini = true; out.destroy(); fs.rm(tmp, {force: true}, () => {}); req.resume(); ok({code, erreur}); };
    if ((+req.headers['content-length'] || 0) > max) return echec(413, `Fichier trop lourd (${Math.round(max / 1048576)} Mo maximum).`);
    req.on('data', c => {
      if (fini) return;
      n += c.length; if (tete.length < 16) tete = Buffer.concat([tete, c]).slice(0, 16);
      if (n > max) return echec(413, `Fichier trop lourd (${Math.round(max / 1048576)} Mo maximum).`);
      out.write(c);
    });
    req.on('error', () => echec(400, 'Envoi interrompu.'));
    req.on('aborted', () => echec(400, 'Envoi interrompu.'));
    req.on('end', () => {
      if (fini) return;
      const type = typeFichier(tete);
      if (!type || !typesOk.includes(type)) return echec(415, typesOk.length === 1 && typesOk[0] === 'pdf' ? 'Seuls les PDF sont acceptés.' : 'Format non accepté : photos (JPG, PNG, HEIC, WebP) ou PDF.');
      out.end(() => {
        if (fini) return; fini = true;
        const final = path.join(dossier, base + '.' + type);
        fs.renameSync(tmp, final);
        ok({fichier: final, type, taille: n});
      });
    });
  });
}

// ---------- zip (sans compression : les photos et PDF le sont déjà) ----------
function zip(entrees) {
  const parts = [], central = []; let off = 0;
  for (const x of entrees) {
    const nom = Buffer.from(x.nom, 'utf8'), crc = zlib.crc32(x.data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(x.data.length, 18); h.writeUInt32LE(x.data.length, 22); h.writeUInt16LE(nom.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(x.data.length, 20); c.writeUInt32LE(x.data.length, 24); c.writeUInt16LE(nom.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nom, x.data); central.push(c, nom); off += 30 + nom.length + x.data.length;
  }
  const cd = Buffer.concat(central), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(entrees.length, 8); fin.writeUInt16LE(entrees.length, 10); fin.writeUInt32LE(cd.length, 12); fin.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, fin]);
}
function envoyerZip(res, nom, entrees) {
  const z = zip(entrees);
  res.writeHead(200, {'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${nom}"`, 'Content-Length': z.length, 'Cache-Control': 'no-store'});
  res.end(z);
}

// ---------- images ----------
const existe = (cmd, args) => { try { execFileSync(cmd, args, {stdio: 'ignore', timeout: 5000}); return true; } catch { return false; } };
const OUTILS = {
  magick: existe('magick', ['-version']) ? 'magick' : existe('convert', ['-version']) ? 'convert' : null,
  pdftoppm: existe('pdftoppm', ['-v']) ? 'pdftoppm' : null,
  police: ['/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf'].find(f => fs.existsSync(f)) || null
};
const lancer = (cmd, args, delai = 120000) => new Promise(ok => execFile(cmd, args, {timeout: delai}, e => ok(!e)));

// Photo convertie en JPEG léger pour l'affichage (indispensable pour les HEIC d'iPhone) + miniature.
async function preparerVue(src, vue, mini) {
  if (!OUTILS.magick) return false;
  fs.mkdirSync(path.dirname(vue), {recursive: true});
  const a = await lancer(OUTILS.magick, [src + '[0]', '-auto-orient', '-resize', '2000x2000>', '-quality', '82', '-strip', vue]);
  const b = await lancer(OUTILS.magick, [src + '[0]', '-auto-orient', '-thumbnail', '360x360>', '-quality', '75', '-strip', mini]);
  return a && b;
}

// Aperçu d'un PDF livré : chaque page en image, avec un filigrane « APERÇU ».
async function apercuPdf(pdf, dossier, base) {
  if (!OUTILS.pdftoppm) return {pages: 0, erreur: 'outils absents'};
  fs.mkdirSync(dossier, {recursive: true});
  const prefixe = path.join(dossier, base + '-brut');
  if (!await lancer(OUTILS.pdftoppm, ['-r', '150', '-jpeg', '-jpegopt', 'quality=78', '-l', '40', pdf, prefixe])) return {pages: 0, erreur: 'PDF illisible'};
  const bruts = fs.readdirSync(dossier).filter(f => f.startsWith(base + '-brut')).sort((a, b) => (+a.match(/(\d+)\.jpg$/)[1]) - (+b.match(/(\d+)\.jpg$/)[1]));
  let n = 0;
  for (const f of bruts) {
    n++;
    const src = path.join(dossier, f), dst = path.join(dossier, `${base}-${n}.jpg`);
    if (OUTILS.magick) {
      const args = [src, '-resize', '2000x2000>', '-fill', 'rgba(35,64,217,0.17)', '-gravity', 'center', '-pointsize', '120'];
      if (OUTILS.police) args.push('-font', OUTILS.police);
      for (const y of [-560, 0, 560]) args.push('-annotate', `330x330+0${y < 0 ? y : '+' + y}`, 'APERÇU  bonpermis.fr');
      args.push('-quality', '78', dst);
      const ok = await lancer(OUTILS.magick, args);
      fs.rmSync(src, {force: true});
      if (!ok) return {pages: 0, erreur: 'filigrane impossible'};
    } else {
      // Sans ImageMagick, pas de filigrane : on ne montre pas d'aperçu plutôt qu'une version propre.
      fs.rmSync(src, {force: true});
      return {pages: 0, erreur: 'filigrane impossible (ImageMagick absent)'};
    }
  }
  return {pages: n};
}

// Jours ouvrés (samedi et dimanche exclus ; jours fériés non comptés à part).
function plusJoursOuvres(d, n) {
  const x = new Date(d);
  while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) n--; }
  return x;
}

module.exports = {
  crypto, fs, path, RACINE, PRIX, DATA, PAGES, P: DATA.P, GROUPS: DATA.GROUPS, NEED: DATA.NEED, PIECES, E, CONF, SECRET, signer, egal,
  journal, noterMail, lireJournalMails, euro, lireCorps, lireJson, repondre, envoyerFichier, TYPES, ip, trop, tropDeDemandes, lireCookies, cookie,
  encoder, stripe, signatureValide, reference, envoyerMail, signature, chemin, lire, ecrire, creer, liste,
  MAIL_RE, texte, texteLong, nomPropre, id, typeFichier, recevoirFichier, zip, envoyerZip, OUTILS, preparerVue, apercuPdf, plusJoursOuvres
};
