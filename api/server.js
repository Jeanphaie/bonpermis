'use strict';
/* Le Bon Permis : service de paiement.
   - POST /api/commande       recalcule le prix à partir des réponses du simulateur et ouvre une page de paiement Stripe Checkout
   - GET  /api/commande?ref=  état d'une commande, pour la page « Commande reçue »
   - POST /api/stripe-webhook confirmation signée de Stripe : enregistre la commande et envoie les e-mails
   - POST /api/rappel         demande de rappel téléphonique
   - GET  /api/sante          état du service (sans aucun secret)
   Aucune dépendance : Node 20+ (fetch, crypto, tls). Les secrets viennent des variables d'environnement, jamais du dépôt. */

const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const tls = require('tls');

const RACINE = path.join(__dirname, '..');
const PRIX = require(path.join(RACINE, 'src', 'prix.js'));
const DATA = JSON.parse(fs.readFileSync(path.join(RACINE, 'src', 'data.json'), 'utf8'));
const PAGES = JSON.parse(fs.readFileSync(path.join(RACINE, 'src', 'pages.json'), 'utf8')).pages;
const {P, GROUPS, NEED} = DATA;

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
  mailA: E.MAIL_TO || 'contact@bonpermis.fr'
};

const journal = (...m) => console.log(new Date().toISOString(), ...m);
const euro = n => n.toLocaleString('fr-FR') + ' €';

// ---------- utilitaires HTTP ----------
function lireCorps(req, max = 20000) {
  return new Promise((ok, ko) => {
    const morceaux = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { ko(new Error('trop gros')); req.destroy(); } else morceaux.push(c); });
    req.on('end', () => ok(Buffer.concat(morceaux)));
    req.on('error', ko);
  });
}
function repondre(res, code, obj) {
  const corps = JSON.stringify(obj);
  res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(corps)});
  res.end(corps);
}

// Limite simple par adresse IP : 20 demandes POST par tranche de 10 minutes.
const compteurs = new Map();
function tropDeDemandes(req) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const t = Date.now(), c = compteurs.get(ip) || {n: 0, depuis: t};
  if (t - c.depuis > 600000) { c.n = 0; c.depuis = t; }
  c.n++; compteurs.set(ip, c);
  if (compteurs.size > 5000) compteurs.clear();
  return c.n > (+E.LIMITE_POST || 20);
}

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
  if (!hote || !user || !pass) { journal('mail non envoyé (SMTP non configuré) :', sujet); return Promise.resolve(false); }
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
    const fin = (r, why) => { if (!r) journal('échec SMTP :', why); s.destroy(); ok(r); };
    s.setTimeout(20000, () => fin(false, 'délai dépassé'));
    s.on('error', e => fin(false, e.message));
    s.on('data', d => {
      tampon += d.toString();
      const lignes = tampon.split('\r\n'); tampon = lignes.pop();
      for (const l of lignes) {
        if (/^\d{3}-/.test(l)) continue;          // réponse sur plusieurs lignes : attendre la dernière
        const code = +l.slice(0, 3), [attendu, suite] = etapes[etape] || [221];
        if (etape >= etapes.length) return fin(true);
        if (code !== attendu) return fin(false, l);
        etape++; s.write(suite() + '\r\n');
        if (etape === etapes.length) return fin(true);
      }
    });
  });
}

// ---------- stockage ----------
function enregistrer(dossier, nom, obj) {
  const d = path.join(CONF.donnees, dossier);
  fs.mkdirSync(d, {recursive: true});
  const f = path.join(d, nom + '.json');
  if (fs.existsSync(f)) return false;
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  return true;
}

// ---------- validation des demandes ----------
const MAIL_RE = /^[^\s@<>()",;]{1,64}@[^\s@<>()",;]{1,190}\.[a-z]{2,}$/i;
const texte = (v, max) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max) : '';

function analyser(d) {
  if (!d || typeof d !== 'object') return {erreur: 'Demande illisible.'};
  const p = d.p;
  if (!P[p]) return {erreur: 'Projet inconnu.'};
  const regul = d.regul === true;
  if (regul && !PRIX.regulPossible(P, GROUPS, p)) return {erreur: 'Ce projet ne peut pas être déclaré après coup.'};
  const a = PRIX.reponsesValides(P, p, d.a);
  if (!a) return {erreur: 'Réponses incomplètes. Reprenez le simulateur depuis le début.'};
  const v = PRIX.verdict(P, p, a, regul);
  return {p, regul, a, v};
}

// ---------- routes ----------
async function commande(req, res) {
  if (tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  let d; try { d = JSON.parse(await lireCorps(req)); } catch { return repondre(res, 400, {erreur: 'Demande illisible.'}); }
  const x = analyser(d); if (x.erreur) return repondre(res, 400, x);
  if (!['dp', 'pc', 'pd', 'svc'].includes(x.v.kind)) return repondre(res, 400, {erreur: 'Ce projet ne se commande pas en ligne : demandez à être rappelé.'});
  const email = texte(d.email, 254), adresse = texte(d.adresse, 300);
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  if (adresse.length < 5) return repondre(res, 400, {erreur: 'Indiquez l\'adresse des travaux.'});
  const opt = PRIX.optionsValides(P, x.p, x.v, d.opt);
  const lignes = PRIX.lignes(P, x.p, x.v, opt), total = PRIX.total(lignes);
  const nom = (x.regul ? 'Travaux déjà faits · ' : '') + P[x.p].n;
  const page = PAGES[x.p] ? `${CONF.site}/${PAGES[x.p].slug}/` : `${CONF.site}/`;
  const meta = {
    projet: x.p, nom: nom.slice(0, 200), regul: String(x.regul), adresse: adresse.slice(0, 480),
    reponses: JSON.stringify(x.a).slice(0, 480),
    options: Object.keys(opt).filter(k => opt[k]).join(',') || 'aucune', total: String(total)
  };
  const params = {
    mode: 'payment', locale: 'fr', customer_email: email,
    success_url: `${CONF.site}/commande/merci/?ref={CHECKOUT_SESSION_ID}`,
    cancel_url: `${page}#${x.p}`,
    line_items: lignes.map(l => ({quantity: 1, price_data: {currency: 'eur', unit_amount: Math.round(l.prix * 100), product_data: {name: l.label}}})),
    metadata: meta,
    payment_intent_data: {description: `${nom}, ${adresse}`.slice(0, 1000), metadata: meta},
    consent_collection: {terms_of_service: 'required'},
    custom_text: {terms_of_service_acceptance: {message: `J'accepte les [conditions générales de vente](${CONF.site}/cgv/) et je demande que mon dossier soit commencé avant la fin du délai de rétractation de 14 jours.`}}
  };
  try {
    const s = await stripe('POST', '/v1/checkout/sessions', params);
    journal('paiement ouvert', reference(s.id), x.p, total + ' €');
    repondre(res, 200, {url: s.url});
  } catch (e) {
    journal('erreur Stripe :', e.message);
    repondre(res, 502, {erreur: 'Le paiement n\'a pas pu s\'ouvrir.'});
  }
}

async function etatCommande(req, res, url) {
  const id = url.searchParams.get('ref') || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(id)) return repondre(res, 400, {erreur: 'Référence invalide.'});
  try {
    const s = await stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(id));
    const m = s.metadata || {}, p = m.projet;
    const mail = (s.customer_details && s.customer_details.email) || s.customer_email || '';
    repondre(res, 200, {
      ref: reference(s.id), paye: s.payment_status === 'paid', montant: (s.amount_total || 0) / 100,
      projet: m.nom || (P[p] ? P[p].n : ''), adresse: m.adresse || '',
      email: mail.replace(/^(.).*(@.*)$/, '$1•••$2'),
      demandes: (P[p] && NEED[p]) || NEED.extension
    });
  } catch (e) {
    repondre(res, 404, {erreur: 'Commande introuvable.'});
  }
}

async function webhook(req, res) {
  let brut; try { brut = (await lireCorps(req, 200000)).toString('utf8'); } catch { return repondre(res, 400, {}); }
  if (!signatureValide(brut, req.headers['stripe-signature'], CONF.stripeWebhook)) { journal('webhook refusé : signature invalide'); return repondre(res, 400, {erreur: 'signature'}); }
  let ev; try { ev = JSON.parse(brut); } catch { return repondre(res, 400, {}); }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) return repondre(res, 200, {recu: true});
  const s = ev.data.object;
  if (s.payment_status !== 'paid') return repondre(res, 200, {recu: true});
  const ref = reference(s.id), m = s.metadata || {};
  const email = (s.customer_details && s.customer_details.email) || s.customer_email || '';
  const nom = (s.customer_details && s.customer_details.name) || '';
  const cmd = {ref, session: s.id, date: new Date().toISOString(), montant: s.amount_total / 100, email, nom, ...m};
  const nouvelle = enregistrer('commandes', ref, cmd);
  repondre(res, 200, {recu: true});
  if (!nouvelle) return;
  journal('commande payée', ref, m.projet, cmd.montant + ' €');
  const need = (P[m.projet] && NEED[m.projet]) || NEED.extension;
  await envoyerMail(CONF.mailA, `Nouvelle commande ${ref} : ${m.nom} (${euro(cmd.montant)})`,
    `Commande ${ref} payée.\n\nProjet : ${m.nom}\nAdresse des travaux : ${m.adresse}\nClient : ${nom} <${email}>\nMontant : ${euro(cmd.montant)} TTC\nOptions : ${m.options}\nRéponses : ${m.reponses}\n\nStripe : https://dashboard.stripe.com/payments/${s.payment_intent || ''}\n`, email);
  if (email) await envoyerMail(email, `Votre commande ${ref} : la suite`,
    `Bonjour${nom ? ' ' + nom : ''},\n\nMerci, votre paiement de ${euro(cmd.montant)} est bien reçu.\nRéférence de votre dossier : ${ref}\nProjet : ${m.nom}\nAdresse des travaux : ${m.adresse}\n\nPour lancer votre dossier, répondez simplement à cet e-mail avec :\n- Le projet : ${need[0]}\n- Les mesures : ${need[1]}\n- Les photos : ${need[2]}\n\nLe délai de préparation commence à la réception de ces éléments. Une question ? Répondez à cet e-mail.\n\nL'équipe Le Bon Permis\n${CONF.site}\n`, CONF.mailA);
}

async function rappel(req, res) {
  if (tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  let d; try { d = JSON.parse(await lireCorps(req)); } catch { return repondre(res, 400, {erreur: 'Demande illisible.'}); }
  const tel = texte(d.tel, 40), adresse = texte(d.adresse, 300);
  if ((tel.match(/\d/g) || []).length < 9) return repondre(res, 400, {erreur: 'Numéro de téléphone invalide.'});
  const projet = P[d.p] ? P[d.p].n : '';
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  enregistrer('rappels', id, {date: new Date().toISOString(), tel, adresse, projet, motif: texte(d.motif, 40), reponses: d.a && typeof d.a === 'object' ? d.a : {}});
  journal('demande de rappel', projet);
  await envoyerMail(CONF.mailA, `À rappeler : ${projet || 'projet'} (${tel})`,
    `Demande de rappel depuis le site.\n\nTéléphone : ${tel}\nProjet : ${projet}\nMotif : ${texte(d.motif, 40)}\nAdresse des travaux : ${adresse}\nRéponses : ${JSON.stringify(d.a || {})}\n`);
  repondre(res, 200, {ok: true});
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (req.method === 'POST' && url.pathname === '/api/commande') return await commande(req, res);
    if (req.method === 'GET' && url.pathname === '/api/commande') return await etatCommande(req, res, url);
    if (req.method === 'POST' && url.pathname === '/api/stripe-webhook') return await webhook(req, res);
    if (req.method === 'POST' && url.pathname === '/api/rappel') return await rappel(req, res);
    if (req.method === 'GET' && url.pathname === '/api/sante') return repondre(res, 200, {ok: true, stripe: !!CONF.stripeCle, mode: CONF.stripeCle.includes('_live_') ? 'reel' : 'test', webhook: !!CONF.stripeWebhook, mail: !!(CONF.smtp.hote && CONF.smtp.pass)});
    repondre(res, 404, {erreur: 'Introuvable.'});
  } catch (e) {
    journal('erreur', e.stack || e.message);
    if (!res.headersSent) repondre(res, 500, {erreur: 'Erreur du service.'});
  }
});

if (require.main === module) serveur.listen(CONF.port, () => journal(`service de paiement sur le port ${CONF.port}`, CONF.stripeCle ? '' : '(clé Stripe absente)'));
module.exports = {serveur, signatureValide, reference, encoder, analyser};
