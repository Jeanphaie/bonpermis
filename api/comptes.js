'use strict';
/* Comptes clients et accès de l'équipe.
   - Client : e-mail + mot de passe (stocké en empreinte scrypt), ou lien de connexion reçu par e-mail.
     Le compte peut exister sans commande (simulations enregistrées). Il est créé automatiquement au paiement s'il n'existe pas.
   - Équipe : e-mail autorisé (ADMIN_EMAILS) + code à 6 chiffres reçu par e-mail, valable 10 minutes.
   - Session : cookie signé (HMAC), HttpOnly, 30 jours. Rien à stocker côté serveur. */

const B = require('./base');
const {crypto, CONF, lire, ecrire, creer, repondre, lireJson, texte, MAIL_RE, signer, egal, journal, envoyerMail, signature, trop, ip, cookie, lireCookies} = B;

const JOUR = 86400;
const cleMail = e => crypto.createHash('sha256').update(String(e).trim().toLowerCase()).digest('hex').slice(0, 32);

// ---------- utilisateurs ----------
const lireUser = uid => /^u[A-Za-z0-9]{8,20}$/.test(uid || '') ? B.lire('comptes', uid + '.json') : null;
const ecrireUser = u => ecrire(u, 'comptes', u.id + '.json');
function userParMail(email) {
  const x = lire('comptes', 'par-mail', cleMail(email) + '.json');
  return x ? lireUser(x.id) : null;
}
function creerUser(email) {
  email = email.trim().toLowerCase();
  const exist = userParMail(email); if (exist) return exist;
  const u = {id: 'u' + B.id(9), email, cree: new Date().toISOString(), hash: null, confirme: false, version: 1, projets: [], commandes: []};
  if (!creer({id: u.id}, 'comptes', 'par-mail', cleMail(email) + '.json')) return userParMail(email); // créé en même temps ailleurs
  ecrireUser(u);
  return u;
}

// ---------- mots de passe ----------
const hacher = mdp => new Promise((ok, ko) => {
  const sel = crypto.randomBytes(16);
  crypto.scrypt(mdp, sel, 64, {N: 16384, r: 8, p: 1}, (e, k) => e ? ko(e) : ok(`scrypt$${sel.toString('base64')}$${k.toString('base64')}`));
});
const verifier = (mdp, h) => new Promise(ok => {
  if (!h || !h.startsWith('scrypt$')) return ok(false);
  const [, sel, attendu] = h.split('$');
  crypto.scrypt(mdp, Buffer.from(sel, 'base64'), 64, {N: 16384, r: 8, p: 1}, (e, k) => ok(!e && crypto.timingSafeEqual(k, Buffer.from(attendu, 'base64'))));
});
const mdpValide = m => typeof m === 'string' && m.length >= 10 && m.length <= 200;

// ---------- sessions et liens signés ----------
function jeton(usage, uid, version, dureeS) {
  const exp = Math.floor(Date.now() / 1000) + dureeS;
  const corps = `${usage}.${uid}.${version}.${exp}`;
  return Buffer.from(corps).toString('base64url') + '.' + signer(corps);
}
function lireJeton(j, usage) {
  if (typeof j !== 'string' || j.length > 300) return null;
  const [b, sig] = j.split('.'); if (!b || !sig) return null;
  const corps = Buffer.from(b, 'base64url').toString();
  if (!egal(sig, signer(corps))) return null;
  const [u, uid, version, exp] = corps.split('.');
  if (u !== usage || +exp < Date.now() / 1000) return null;
  const user = lireUser(uid);
  if (!user || String(user.version) !== version) return null;
  return user;
}
function ouvrirSession(res, u) {
  const auj = new Date().toISOString().slice(0, 10);
  if (u.vu !== auj) { u.vu = auj; ecrireUser(u); } // dernière visite, pour supprimer les comptes inactifs
  res.setHeader('Set-Cookie', cookie('bp_s', jeton('s', u.id, u.version, 30 * JOUR), 30 * JOUR));
}
// Comptes sans commande et sans visite depuis 2 ans : supprimés, avec leurs simulations (voir la page confidentialité).
function purgerInactifs() {
  const limite = new Date(Date.now() - 730 * JOUR * 1000).toISOString();
  let n = 0;
  for (const f of B.liste('comptes')) {
    if (!/^u\w+\.json$/.test(f)) continue;
    const u = lire('comptes', f); if (!u || u.commandes.length) continue;
    if ((u.vu || u.cree) > limite) continue;
    for (const pid of u.projets) B.fs.rmSync(B.chemin('projets', pid + '.json'), {force: true});
    B.fs.rmSync(B.chemin('comptes', 'par-mail', cleMail(u.email) + '.json'), {force: true});
    B.fs.rmSync(B.chemin('comptes', f), {force: true}); n++;
  }
  if (n) journal('comptes inactifs supprimés :', n);
}
const sessionClient = req => lireJeton(lireCookies(req).bp_s, 's');

// Équipe : jeton distinct, avec l'e-mail autorisé
function sessionAdmin(req) {
  const j = lireCookies(req).bp_a; if (!j) return null;
  const [b, sig] = j.split('.'); if (!b || !sig) return null;
  const corps = Buffer.from(b, 'base64url').toString();
  if (!egal(sig, signer(corps))) return null;
  const [u, email, exp] = corps.split('|');
  return u === 'a' && +exp > Date.now() / 1000 && CONF.admins.includes(email) ? email : null;
}
const codesAdmin = new Map(); // email -> {code (empreinte), exp, essais}

const lienConnexion = (u, suite = '/espace/') => `${CONF.site}/api/compte/lien?j=${jeton('l', u.id, u.version, 30 * 60)}&suite=${encodeURIComponent(suite)}`;
const lienLong = (u, suite) => `${CONF.site}/api/compte/lien?j=${jeton('l', u.id, u.version, 30 * JOUR)}&suite=${encodeURIComponent(suite)}`;
const vue = u => ({email: u.email, motDePasse: !!u.hash, confirme: !!u.confirme});

// ---------- routes client ----------
async function inscription(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de tentatives. Réessayez dans quelques minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase();
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  if (!mdpValide(d.mdp)) return repondre(res, 400, {erreur: 'Choisissez un mot de passe d\'au moins 10 caractères.'});
  const exist = userParMail(email);
  if (exist && exist.hash) return repondre(res, 409, {erreur: 'Un compte existe déjà avec cet e-mail. Connectez-vous, ou recevez un lien de connexion.'});
  if (exist && !exist.hash) {
    // Compte créé au paiement, sans mot de passe : on ne laisse pas n'importe qui en fixer un. Lien par e-mail.
    await envoyerMail(email, 'Votre accès Le Bon Permis', `Bonjour,\n\nUn compte existe déjà pour cette adresse (créé lors de votre commande). Pour y accéder et choisir votre mot de passe :\n${lienConnexion(exist, '/espace/?mdp=1')}\n\nCe lien est valable 30 minutes.${signature}`);
    return repondre(res, 409, {erreur: 'Un compte existe déjà avec cet e-mail : nous venons de vous envoyer un lien pour y accéder.'});
  }
  const u = creerUser(email);
  u.hash = await hacher(d.mdp); ecrireUser(u);
  journal('compte créé', u.id);
  ouvrirSession(res, u);
  repondre(res, 200, {ok: true, compte: vue(u)});
  envoyerMail(email, 'Bienvenue sur Le Bon Permis', `Bonjour,\n\nVotre compte est créé. Confirmez votre adresse e-mail en ouvrant ce lien :\n${lienLong(u, '/espace/?confirme=1')}\n\nVous retrouvez vos projets sur ${CONF.site}/espace/${signature}`);
}

async function connexion(req, res) {
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase();
  if (trop('ip:' + ip(req), 30) || trop('mail:' + email, 8)) return repondre(res, 429, {erreur: 'Trop de tentatives. Réessayez dans 10 minutes, ou recevez un lien de connexion.'});
  const u = userParMail(email);
  const ok = u && await verifier(String(d.mdp || ''), u.hash);
  if (!ok) return repondre(res, 401, {erreur: u && !u.hash ? 'Ce compte n\'a pas encore de mot de passe : recevez un lien de connexion par e-mail.' : 'E-mail ou mot de passe incorrect.'});
  ouvrirSession(res, u);
  repondre(res, 200, {ok: true, compte: vue(u)});
}

async function demanderLien(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase();
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  const u = userParMail(email);
  if (u && !trop('lien:' + email, 5)) await envoyerMail(email, 'Votre lien de connexion Le Bon Permis', `Bonjour,\n\nPour ouvrir votre espace :\n${lienConnexion(u, u.hash ? '/espace/' : '/espace/?mdp=1')}\n\nCe lien est valable 30 minutes. Si vous n'avez rien demandé, ignorez cet e-mail.${signature}`);
  // Même réponse que le compte existe ou non : on ne révèle pas qui est client.
  repondre(res, 200, {ok: true});
}

function suivreLien(req, res, url) {
  const u = lireJeton(url.searchParams.get('j'), 'l');
  let suite = url.searchParams.get('suite') || '/espace/';
  if (!/^\/(espace|commande)\/[A-Za-z0-9/?=&._-]*$/.test(suite)) suite = '/espace/';
  if (!u) { res.writeHead(302, {Location: '/espace/?lien=expire'}); return res.end(); }
  if (!u.confirme) { u.confirme = true; ecrireUser(u); }
  // Session + marque « connecté par lien depuis moins de 15 min » : permet de choisir un nouveau mot de passe sans l'ancien.
  res.setHeader('Set-Cookie', [cookie('bp_s', jeton('s', u.id, u.version, 30 * JOUR), 30 * JOUR), cookie('bp_l', jeton('r', u.id, u.version, 900), 900)]);
  res.writeHead(302, {Location: suite, 'Cache-Control': 'no-store'}); res.end();
}

async function changerMdp(req, res) {
  const u = sessionClient(req); if (!u) return repondre(res, 401, {erreur: 'Connectez-vous.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  if (!mdpValide(d.mdp)) return repondre(res, 400, {erreur: 'Choisissez un mot de passe d\'au moins 10 caractères.'});
  const parLien = (lireJeton(lireCookies(req).bp_l, 'r') || {}).id === u.id;
  if (u.hash && !parLien && !await verifier(String(d.ancien || ''), u.hash)) return repondre(res, 401, {erreur: 'Mot de passe actuel incorrect.'});
  u.hash = await hacher(d.mdp); u.version++; u.confirme = true; ecrireUser(u);
  ouvrirSession(res, u);
  repondre(res, 200, {ok: true, compte: vue(u)});
}

// Première fois, juste après le paiement : la page « Commande reçue » connaît l'identifiant Stripe de la session,
// que seul le client a. On l'utilise pour qu'il choisisse son mot de passe sans repasser par l'e-mail.
async function premierMdp(req, res) {
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(d.session || '')) return repondre(res, 400, {erreur: 'Référence invalide.'});
  if (!mdpValide(d.mdp)) return repondre(res, 400, {erreur: 'Choisissez un mot de passe d\'au moins 10 caractères.'});
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de tentatives.'});
  const cmd = lire('commandes', B.reference(d.session) + '.json');
  const u = cmd && lireUser(cmd.uid);
  if (!u) return repondre(res, 404, {erreur: 'Commande pas encore confirmée. Réessayez dans un instant.'});
  if (u.hash) return repondre(res, 409, {erreur: 'Ce compte a déjà un mot de passe. Connectez-vous.'});
  u.hash = await hacher(d.mdp); u.confirme = true; u.version++; ecrireUser(u);
  ouvrirSession(res, u);
  repondre(res, 200, {ok: true, ref: cmd.ref});
}

function deconnexion(req, res) {
  res.setHeader('Set-Cookie', cookie('bp_s', '', 0));
  repondre(res, 200, {ok: true});
}

// ---------- équipe ----------
async function adminCode(req, res) {
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase();
  if (trop('admin-ip:' + ip(req), 10)) return repondre(res, 429, {erreur: 'Trop de demandes.'});
  if (CONF.admins.includes(email)) {
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    codesAdmin.set(email, {h: signer('code:' + email + ':' + code), exp: Date.now() + 600000, essais: 0});
    const ok = await envoyerMail(email, `Code de connexion : ${code}`, `Votre code pour l'espace équipe Le Bon Permis : ${code}\n\nValable 10 minutes. Si vous n'avez rien demandé, ignorez cet e-mail.${signature}`);
    if (!ok && !CONF.smtp.pass) journal('code équipe (SMTP absent, mode local) :', email, code);
  }
  repondre(res, 200, {ok: true});
}
async function adminConnexion(req, res) {
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase(), code = texte(d.code, 10).replace(/\s/g, '');
  const c = codesAdmin.get(email);
  if (!c || c.exp < Date.now() || ++c.essais > 5) { codesAdmin.delete(email); return repondre(res, 401, {erreur: 'Code expiré. Demandez-en un nouveau.'}); }
  if (!egal(c.h, signer('code:' + email + ':' + code))) return repondre(res, 401, {erreur: 'Code incorrect.'});
  codesAdmin.delete(email);
  const exp = Math.floor(Date.now() / 1000) + 30 * JOUR, corps = `a|${email}|${exp}`;
  res.setHeader('Set-Cookie', cookie('bp_a', Buffer.from(corps).toString('base64url') + '.' + signer(corps), 30 * JOUR));
  journal('connexion équipe', email);
  repondre(res, 200, {ok: true, email});
}
function adminDeconnexion(req, res) {
  res.setHeader('Set-Cookie', cookie('bp_a', '', 0));
  repondre(res, 200, {ok: true});
}

module.exports = {
  purgerInactifs, lireUser, ecrireUser, userParMail, creerUser, sessionClient, sessionAdmin, ouvrirSession, lienConnexion, lienLong, vue,
  inscription, connexion, demanderLien, suivreLien, changerMdp, premierMdp, deconnexion, adminCode, adminConnexion, adminDeconnexion
};
