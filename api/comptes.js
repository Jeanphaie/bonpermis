'use strict';
/* Comptes clients et accès de l'équipe.
   - Client : e-mail + mot de passe (empreinte scrypt), ou code à 6 chiffres reçu par e-mail (connexion sans mot de passe, mot de passe oublié).
     Création de compte : l'adresse est prouvée par un code avant que le compte existe. Réponses identiques que l'adresse
     soit connue ou non (pas d'énumération des clients). Mots de passe : 12 caractères minimum, refusés s'ils figurent
     dans une fuite connue (Have I Been Pwned, k-anonymat : seuls 5 caractères de l'empreinte SHA-1 sortent du serveur).
     Le compte peut exister sans commande (simulations enregistrées). Il est créé automatiquement au paiement s'il n'existe pas.
   - Équipe : e-mail autorisé (ADMIN_EMAILS) + code à 6 chiffres reçu par e-mail, valable 10 minutes.
   - Session : cookie signé (HMAC), HttpOnly, 30 jours. Rien à stocker côté serveur. */

const B = require('./base');
const E = process.env;
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
// scrypt, réglage OWASP équivalent à N=2^17 r=8 p=1 mais deux fois moins de mémoire par calcul (64 Mio) : N=2^16, r=8, p=2.
// Les paramètres sont écrits dans l'empreinte : les anciennes (N=2^14, format « scrypt$sel$clé ») restent lisibles
// et sont refaites au réglage actuel à la connexion suivante.
const S = {N: 65536, r: 8, p: 2};
const MAXMEM = 256 * 1024 * 1024;
const derive = (mdp, sel, o) => new Promise((ok, ko) => crypto.scrypt(String(mdp).normalize('NFKC'), sel, 64, {...o, maxmem: MAXMEM}, (e, k) => e ? ko(e) : ok(k)));
async function hacher(mdp) {
  const sel = crypto.randomBytes(16), k = await derive(mdp, sel, S);
  return `scrypt2$${S.N}$${S.r}$${S.p}$${sel.toString('base64')}$${k.toString('base64')}`;
}
async function verifier(mdp, h) {
  if (typeof h !== 'string') return false;
  let o, sel, attendu; const x = h.split('$');
  if (x[0] === 'scrypt2' && x.length === 6) { o = {N: +x[1], r: +x[2], p: +x[3]}; sel = x[4]; attendu = x[5]; }
  else if (x[0] === 'scrypt' && x.length === 3) { o = {N: 16384, r: 8, p: 1}; sel = x[1]; attendu = x[2]; }
  else return false;
  if (!(o.N <= 1 << 20 && o.r <= 16 && o.p <= 8)) return false; // jamais de paramètres démesurés
  const att = Buffer.from(attendu, 'base64');
  try { const k = await derive(mdp, Buffer.from(sel, 'base64'), o); return k.length === att.length && crypto.timingSafeEqual(k, att); }
  catch { return false; }
}
// Les anciennes empreintes ne normalisaient pas le texte : on retente sans normalisation pour elles.
async function verifierAncien(mdp, h) {
  if (await verifier(mdp, h)) return true;
  if (!String(h).startsWith('scrypt$')) return false;
  const [, sel, attendu] = h.split('$');
  return new Promise(ok => crypto.scrypt(String(mdp), Buffer.from(sel, 'base64'), 64, {N: 16384, r: 8, p: 1}, (e, k) => ok(!e && crypto.timingSafeEqual(k, Buffer.from(attendu, 'base64')))));
}
const aRefaire = h => !String(h).startsWith(`scrypt2$${S.N}$${S.r}$${S.p}$`);
// Empreinte factice : un e-mail inconnu prend le même temps qu'un mauvais mot de passe.
let FACTICE = null;
const factice = async () => FACTICE || (FACTICE = await hacher(crypto.randomBytes(24).toString('hex')));
if (require.main !== module) setTimeout(() => factice().catch(() => {}), 2000).unref();

const MIN = 12, MAX = 256;
// Fuites connues : API « range » de Have I Been Pwned. En cas de panne (2,5 s), on n'empêche pas l'inscription.
async function fuite(mdp) {
  if (E.HIBP === '0') return false;
  const h = crypto.createHash('sha1').update(String(mdp)).digest('hex').toUpperCase();
  try {
    const r = await fetch('https://api.pwnedpasswords.com/range/' + h.slice(0, 5), {headers: {'Add-Padding': 'true', 'User-Agent': 'bonpermis.fr'}, signal: AbortSignal.timeout(2500)});
    if (!r.ok) return false;
    const suf = h.slice(5);
    return (await r.text()).split('\n').some(l => { const [a, n] = l.trim().split(':'); return a === suf && +n > 0; });
  } catch { return false; }
}
// Renvoie le motif du refus, ou null si le mot de passe convient.
async function refusMdp(mdp, email) {
  if (typeof mdp !== 'string' || [...mdp].length < MIN) return `Choisissez un mot de passe d'au moins ${MIN} caractères.`;
  if (mdp.length > MAX) return `${MAX} caractères au maximum.`;
  const bas = mdp.toLowerCase(), local = String(email || '').split('@')[0].toLowerCase();
  if (/^(.)\1+$/.test(mdp) || /^(0123456789|1234567890|azertyuiop|qwertyuiop)/.test(bas)) return 'Ce mot de passe est trop simple.';
  if ((local.length >= 4 && bas.includes(local)) || /bonpermis/.test(bas.replace(/[\s._-]/g, ''))) return 'Le mot de passe ne doit pas reprendre votre e-mail ni le nom du site.';
  if (await fuite(mdp)) return 'Ce mot de passe figure dans des fuites de données connues : il sera essayé en premier par des pirates. Choisissez-en un autre.';
  return null;
}

// ---------- codes à 6 chiffres envoyés par e-mail ----------
// Usage « creer » (prouve l'adresse avant de créer le compte) ou « entrer » (connexion sans mot de passe).
// 15 minutes, 5 essais, un seul usage. Gardés en mémoire : un redémarrage les annule, il suffit d'en redemander un.
const CODES = new Map();
function nouveauCode(usage, email, data) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  CODES.set(usage + ':' + email, {h: signer(`code:${usage}:${email}:${code}`), exp: Date.now() + 15 * 60000, essais: 0, data});
  if (CODES.size > 5000) for (const [k, v] of CODES) if (v.exp < Date.now()) CODES.delete(k);
  return code;
}
function prendreCode(usage, email, code) {
  const k = usage + ':' + email, c = CODES.get(k);
  if (!c) return null;
  if (c.exp < Date.now() || c.essais >= 5) { CODES.delete(k); return null; }
  if (!egal(c.h, signer(`code:${usage}:${email}:${code}`))) { c.essais++; return null; }
  CODES.delete(k);
  return c;
}

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
function ouvrirSession(res, u, parCode) {
  const auj = new Date().toISOString().slice(0, 10);
  if (u.vu !== auj) { u.vu = auj; ecrireUser(u); } // dernière visite, pour supprimer les comptes inactifs
  const c = [cookie('bp_s', jeton('s', u.id, u.version, 30 * JOUR), 30 * JOUR)];
  // Entré par code e-mail depuis moins de 15 min : peut choisir un nouveau mot de passe sans l'ancien (mot de passe oublié).
  if (parCode) c.push(cookie('bp_l', jeton('r', u.id, u.version, 900), 900));
  res.setHeader('Set-Cookie', c);
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
// Étape 1 : e-mail + mot de passe. On ne crée rien : on envoie un code. La réponse est la même que l'adresse
// ait déjà un compte ou non ; dans le premier cas, l'e-mail reçu le dit à son vrai propriétaire.
async function inscription(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de tentatives. Réessayez dans quelques minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase();
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  const refus = await refusMdp(d.mdp, email);
  if (refus) return repondre(res, 400, {erreur: refus, champ: 'mdp'});
  if (trop('code:' + email, 5)) return repondre(res, 429, {erreur: 'Trop de codes demandés pour cette adresse. Réessayez dans 10 minutes.'});
  const hash = await hacher(d.mdp); // calculé dans tous les cas : même durée de réponse
  const exist = userParMail(email);
  if (exist && exist.hash) {
    envoyerMail(email, 'Vous avez déjà un compte Le Bon Permis', `Bonjour,\n\nQuelqu'un (sans doute vous) a voulu créer un compte avec cette adresse, mais vous en avez déjà un.\n\nPour vous connecter : ${CONF.site}/espace/\nMot de passe oublié ? Choisissez « Recevoir un code par e-mail » sur la même page.\n\nSi vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail : rien n'a changé sur votre compte.${signature}`);
  } else {
    const code = nouveauCode('creer', email, {hash});
    envoyerMail(email, `${code} : votre code Le Bon Permis`, `Bonjour,\n\nVotre code pour créer votre compte Le Bon Permis :\n\n${code}\n\nIl est valable 15 minutes. Si vous n'avez rien demandé, ignorez cet e-mail : aucun compte ne sera créé.${signature}`)
      .then(ok => { if (!ok && !CONF.smtp.pass) journal('code création (SMTP absent, mode local) :', email, code); });
  }
  repondre(res, 200, {ok: true, etape: 'code'});
}

// Connexion sans mot de passe, ou mot de passe oublié : code par e-mail. Même réponse que le compte existe ou non.
async function demanderCode(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase();
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  if (trop('code:' + email, 5)) return repondre(res, 429, {erreur: 'Trop de codes demandés pour cette adresse. Réessayez dans 10 minutes.'});
  const u = userParMail(email);
  if (u) {
    const code = nouveauCode('entrer', email, {});
    envoyerMail(email, `${code} : votre code de connexion Le Bon Permis`, `Bonjour,\n\nVotre code de connexion :\n\n${code}\n\nIl est valable 15 minutes. Ne le communiquez à personne : notre équipe ne vous le demandera jamais.\nSi vous n'avez rien demandé, ignorez cet e-mail.${signature}`)
      .then(ok => { if (!ok && !CONF.smtp.pass) journal('code connexion (SMTP absent, mode local) :', email, code); });
  }
  repondre(res, 200, {ok: true, etape: 'code'});
}

// Étape 2 : le code. Crée le compte (usage « creer ») ou ouvre la session (usage « entrer »).
async function verifierCodeRoute(req, res) {
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase(), code = texte(d.code, 12).replace(/\D/g, '');
  if (trop('verif-ip:' + ip(req), 30)) return repondre(res, 429, {erreur: 'Trop de tentatives. Réessayez dans 10 minutes.'});
  if (code.length !== 6) return repondre(res, 400, {erreur: 'Le code compte 6 chiffres.'});
  const usage = d.usage === 'entrer' ? 'entrer' : 'creer';
  const c = prendreCode(usage, email, code);
  if (!c) return repondre(res, 401, {erreur: 'Code incorrect ou expiré. Vérifiez le dernier e-mail reçu, ou demandez un nouveau code.'});
  let u;
  if (usage === 'creer') {
    u = creerUser(email);
    if (!u.hash) u.hash = c.data.hash; // compte créé au paiement sans mot de passe : l'adresse est prouvée, on l'accepte
    u.confirme = true; ecrireUser(u);
    journal('compte confirmé', u.id);
    envoyerMail(email, 'Bienvenue sur Le Bon Permis', `Bonjour,\n\nVotre compte est créé. Vous y retrouvez vos projets, vos documents et l'avancement de votre dossier :\n${CONF.site}/espace/${signature}`);
  } else {
    u = userParMail(email); if (!u) return repondre(res, 401, {erreur: 'Code incorrect ou expiré.'});
    if (!u.confirme) { u.confirme = true; ecrireUser(u); }
  }
  ouvrirSession(res, u, usage === 'entrer');
  repondre(res, 200, {ok: true, compte: vue(u), nouveau: usage === 'creer'});
}

async function connexion(req, res) {
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const email = texte(d.email, 254).toLowerCase(), mdp = String(d.mdp || '').slice(0, MAX);
  if (trop('ip:' + ip(req), 30) || trop('mail:' + email, 8)) return repondre(res, 429, {erreur: 'Trop de tentatives. Réessayez dans 10 minutes, ou recevez un code par e-mail.'});
  const u = userParMail(email);
  const ok = u && u.hash ? await verifierAncien(mdp, u.hash) : (await verifier(mdp, await factice()), false);
  // Message unique : on ne dit pas si l'adresse a un compte.
  if (!ok) return repondre(res, 401, {erreur: 'E-mail ou mot de passe incorrect.'});
  if (aRefaire(u.hash)) { u.hash = await hacher(mdp); ecrireUser(u); }
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
  const refus = await refusMdp(d.mdp, u.email); if (refus) return repondre(res, 400, {erreur: refus, champ: 'mdp'});
  const parLien = (lireJeton(lireCookies(req).bp_l, 'r') || {}).id === u.id;
  if (u.hash && !parLien) {
    if (trop('ancien:' + u.id, 8)) return repondre(res, 429, {erreur: 'Trop de tentatives. Réessayez dans 10 minutes.'});
    if (!await verifierAncien(String(d.ancien || '').slice(0, MAX), u.hash)) return repondre(res, 401, {erreur: 'Mot de passe actuel incorrect.'});
  }
  const avait = !!u.hash;
  u.hash = await hacher(d.mdp); u.version++; u.confirme = true; ecrireUser(u); // version++ : les autres appareils sont déconnectés
  ouvrirSession(res, u);
  res.setHeader('Set-Cookie', [...[].concat(res.getHeader('Set-Cookie')), cookie('bp_l', '', 0)]);
  repondre(res, 200, {ok: true, compte: vue(u)});
  if (avait) envoyerMail(u.email, 'Votre mot de passe a été modifié', `Bonjour,\n\nLe mot de passe de votre compte Le Bon Permis vient d'être modifié, et vos autres appareils ont été déconnectés.\n\nSi ce n'est pas vous, reprenez la main tout de suite : ${CONF.site}/espace/ puis « Recevoir un code par e-mail », et écrivez-nous en répondant à cet e-mail.${signature}`);
}

// Première fois, juste après le paiement : la page « Commande reçue » connaît l'identifiant Stripe de la session,
// que seul le client a. On l'utilise pour qu'il choisisse son mot de passe sans repasser par l'e-mail.
async function premierMdp(req, res) {
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(d.session || '')) return repondre(res, 400, {erreur: 'Référence invalide.'});
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de tentatives.'});
  const cmd = lire('commandes', B.reference(d.session) + '.json');
  const u = cmd && lireUser(cmd.uid);
  if (!u) return repondre(res, 404, {erreur: 'Commande pas encore confirmée. Réessayez dans un instant.'});
  if (u.hash) return repondre(res, 409, {erreur: 'Ce compte a déjà un mot de passe. Connectez-vous.'});
  const refus = await refusMdp(d.mdp, u.email); if (refus) return repondre(res, 400, {erreur: refus, champ: 'mdp'});
  u.hash = await hacher(d.mdp); u.confirme = true; u.version++; ecrireUser(u);
  ouvrirSession(res, u);
  repondre(res, 200, {ok: true, ref: cmd.ref});
}

// { partout: true } : invalide aussi les sessions des autres appareils (la version du compte change).
async function deconnexion(req, res) {
  const d = await lireJson(req) || {};
  const u = d.partout && sessionClient(req);
  if (u) { u.version++; ecrireUser(u); journal('déconnexion de tous les appareils', u.id); }
  res.setHeader('Set-Cookie', [cookie('bp_s', '', 0), cookie('bp_l', '', 0)]);
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
  nouveauCode, prendreCode,
  _t: {refusMdp, verifierAncien, aRefaire, hacher},
  purgerInactifs, lireUser, ecrireUser, userParMail, creerUser, sessionClient, sessionAdmin, ouvrirSession, lienConnexion, lienLong, vue,
  inscription, demanderCode, verifierCodeRoute, connexion, demanderLien, suivreLien, changerMdp, premierMdp, deconnexion, adminCode, adminConnexion, adminDeconnexion
};
