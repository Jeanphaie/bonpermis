'use strict';
/* Le Bon Permis : service en ligne (paiements, comptes, dossiers, espace équipe).
   Routes principales :
   - simulateur      POST /api/commande (acompte 30 %), POST /api/rappel, GET /api/commande?ref=cs_... (page « Commande reçue »)
   - Stripe          POST /api/stripe-webhook (acompte ou solde, signature vérifiée)
   - comptes         POST /api/compte/{inscription,code,verifier,connexion,lien,mot-de-passe,premier-mot-de-passe,deconnexion}, GET /api/compte/lien
   - espace client   GET /api/espace, POST/DELETE /api/projets, POST /api/projets/commander, /api/espace/dossier/...
   - équipe          POST /api/admin/{code,connexion,deconnexion}, /api/admin/dossiers, /api/admin/dossier/...
   - terrain         GET /api/terrain/adresses?q=, GET /api/terrain?lon=&lat= (parcelle, bâtiments, PLU, secteur protégé)
   - GET /api/sante  état du service (sans aucun secret)
   Aucune dépendance npm. Les secrets viennent des variables d'environnement, jamais du dépôt. */

const http = require('http');
const B = require('./base');
const C = require('./comptes');
const D = require('./dossiers');
const PR = require('./promos');
const T = require('./terrain');
const {crypto, CONF, P, repondre, lireCorps, lireJson, texte, journal, envoyerMail, signatureValide} = B;

// ---------- demande de rappel ----------
async function rappel(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const tel = texte(d.tel, 40), adresse = texte(d.adresse, 300);
  if ((tel.match(/\d/g) || []).length < 9) return repondre(res, 400, {erreur: 'Numéro de téléphone invalide.'});
  const projet = P[d.p] ? P[d.p].n : '';
  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  B.creer({date: new Date().toISOString(), tel, adresse, projet, motif: texte(d.motif, 40), reponses: d.a && typeof d.a === 'object' ? d.a : {}}, 'rappels', id + '.json');
  journal('demande de rappel', projet);
  await envoyerMail(CONF.mailA, `À rappeler : ${projet || 'projet'} (${tel})`,
    `Demande de rappel depuis le site.\n\nTéléphone : ${tel}\nProjet : ${projet}\nMotif : ${texte(d.motif, 40)}\nAdresse des travaux : ${adresse}\nRéponses : ${JSON.stringify(d.a || {})}\n`);
  repondre(res, 200, {ok: true});
}

// ---------- webhook Stripe ----------
async function webhook(req, res) {
  let brut; try { brut = (await lireCorps(req, 200000)).toString('utf8'); } catch { return repondre(res, 400, {}); }
  if (!signatureValide(brut, req.headers['stripe-signature'], CONF.stripeWebhook)) { journal('webhook refusé : signature invalide'); return repondre(res, 400, {erreur: 'signature'}); }
  let ev; try { ev = JSON.parse(brut); } catch { return repondre(res, 400, {}); }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(ev.type)) return repondre(res, 200, {recu: true});
  const s = ev.data.object;
  if (s.payment_status !== 'paid') return repondre(res, 200, {recu: true});
  try { await D.paiementRecu(s); } catch (e) { journal('erreur webhook', e.stack || e.message); return repondre(res, 500, {}); } // Stripe réessaiera
  repondre(res, 200, {recu: true});
}

// ---------- anciens liens « dossier » (première version) ----------
const ANCIEN = crypto.createHash('sha256').update('liens-bonpermis:' + (B.E.LIENS_SECRET || CONF.stripeWebhook || 'dev')).digest();
function ancienLien(req, res, url) {
  const ref = url.searchParams.get('d') || '', t = url.searchParams.get('t') || '';
  const attendu = crypto.createHmac('sha256', ANCIEN).update('client:' + ref).digest('base64url').slice(0, 24);
  const cmd = D.REF_RE.test(ref) && B.egal(t, attendu) && D.lireCmd(ref);
  const u = cmd && C.lireUser(cmd.uid);
  if (!u) { res.writeHead(302, {Location: '/espace/'}); return res.end(); }
  C.ouvrirSession(res, u);
  res.writeHead(302, {Location: '/espace/dossier/?ref=' + ref}); res.end();
}

// Les demandes qui modifient quelque chose doivent venir du site lui-même.
// Origin quand le navigateur l'envoie, et Sec-Fetch-Site (tous les navigateurs récents) : refuse les envois depuis un autre site.
function origineOk(req) {
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return false;
  const o = req.headers.origin; if (!o) return true;
  return o === CONF.site;
}

// Résultat du dernier envoi d'e-mail, sans adresse ni code : diagnostic possible même quand plus aucun e-mail n'arrive.
function dernierMail() {
  const m = B.lireJournalMails(1)[0]; if (!m) return null;
  const masque = t => String(t || '').replace(/[^\s<>@]+@[^\s<>]+/g, '[adresse]').replace(/\b\d{6}\b/g, '••••••');
  return {date: m.date, ok: m.ok, etape: m.etape, reponse: masque(m.reponse), ms: m.ms};
}

const ROUTES = {
  'POST /api/commande': D.commande,
  'GET /api/commande': D.etatCommande,
  'POST /api/stripe-webhook': webhook,
  'POST /api/rappel': rappel,
  'POST /api/promo': D.verifierPromo,
  'GET /api/admin/promos': PR.liste,
  'POST /api/admin/promos': PR.enregistrer,
  'POST /api/admin/promos/actif': PR.basculer,
  // terrain (données IGN) : simulateur et plan du projet
  'GET /api/terrain/adresses': T.adresses,
  'GET /api/terrain': T.terrain,
  'GET /api/terrain/tuile': T.tuile,
  // comptes
  'POST /api/compte/inscription': C.inscription,
  'POST /api/compte/connexion': C.connexion,
  'POST /api/compte/code': C.demanderCode,
  'POST /api/compte/verifier': C.verifierCodeRoute,
  'POST /api/compte/lien': C.demanderLien,
  'GET /api/compte/lien': C.suivreLien,
  'POST /api/compte/mot-de-passe': C.changerMdp,
  'POST /api/compte/premier-mot-de-passe': C.premierMdp,
  'POST /api/compte/deconnexion': C.deconnexion,
  'GET /api/compte/acces': ancienLien,
  // espace client
  'GET /api/espace': D.espace,
  'POST /api/projets': D.enregistrerProjet,
  'DELETE /api/projets': D.supprimerProjet,
  'POST /api/projets/commander': D.commanderProjet,
  'GET /api/espace/dossier': D.clientDossier,
  'POST /api/espace/dossier/texte': D.clientTexte,
  'POST /api/espace/dossier/plan': D.clientPlan,
  'POST /api/espace/dossier/fichier': D.clientFichier,
  'DELETE /api/espace/dossier/fichier': D.clientSupprimerFichier,
  'POST /api/espace/dossier/message': D.clientMessage,
  'POST /api/espace/dossier/terminer': D.clientTerminer,
  'POST /api/espace/dossier/valider': D.clientValider,
  'GET /api/espace/voir': D.clientVoir,
  'GET /api/espace/telecharger': D.clientTelecharger,
  // équipe
  'POST /api/admin/code': C.adminCode,
  'POST /api/admin/connexion': C.adminConnexion,
  'POST /api/admin/deconnexion': C.adminDeconnexion,
  'GET /api/admin/moi': (req, res) => { const e = C.sessionAdmin(req); repondre(res, e ? 200 : 401, e ? {email: e} : {erreur: 'Non connecté.'}); },
  'GET /api/admin/dossiers': D.equipeListe,
  'GET /api/admin/dossier': D.equipeDossier,
  'GET /api/admin/voir': D.equipeVoir,
  'POST /api/admin/piece': D.equipePiece,
  'POST /api/admin/classer': D.equipeClasser,
  'POST /api/admin/fichier': D.equipeFichier,
  'POST /api/admin/message': D.equipeMessage,
  'POST /api/admin/lancer': D.equipeLancer,
  'POST /api/admin/livrable': D.equipeLivrable,
  'DELETE /api/admin/livrable': D.equipeSupprimerLivrable,
  'POST /api/admin/apercu': D.equipeEnvoyerApercu,
  'GET /api/admin/dossier.zip': D.equipeZip,
  // journal des e-mails et envoi de test (équipe)
  'GET /api/admin/mails': (req, res) => C.sessionAdmin(req) ? repondre(res, 200, {mails: B.lireJournalMails(200), smtp: {hote: CONF.smtp.hote, port: CONF.smtp.port, expediteur: CONF.mailDe}}) : repondre(res, 401, {erreur: 'Connexion équipe requise.'}),
  'POST /api/admin/mail-test': async (req, res) => {
    const qui = C.sessionAdmin(req); if (!qui) return repondre(res, 401, {erreur: 'Connexion équipe requise.'});
    const d = await lireJson(req) || {}; const a = texte(d.a, 254).toLowerCase();
    if (!B.MAIL_RE.test(a)) return repondre(res, 400, {erreur: 'Adresse invalide.'});
    if (B.trop('mail-test', 20)) return repondre(res, 429, {erreur: 'Trop d\'essais, attendez 10 minutes.'});
    const ok = await envoyerMail(a, 'Test d\'envoi Le Bon Permis', `Ceci est un e-mail de test envoyé depuis l'espace équipe par ${qui}, le ${new Date().toLocaleString('fr-FR', {timeZone: 'Europe/Paris'})}.\n\nS'il est arrivé, l'envoi vers cette adresse fonctionne.${B.signature}`);
    repondre(res, 200, {ok, dernier: B.lireJournalMails(1)[0] || null});
  },
  'GET /api/sante': (req, res) => repondre(res, 200, {ok: true, stripe: !!CONF.stripeCle, mode: CONF.stripeCle.includes('_live_') ? 'reel' : 'test', webhook: !!CONF.stripeWebhook, mail: !!(CONF.smtp.hote && CONF.smtp.pass), images: !!B.OUTILS.magick, pdf: !!B.OUTILS.pdftoppm, dernierMail: dernierMail()})
};

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const route = ROUTES[req.method + ' ' + url.pathname];
  try {
    if (!route) { req.resume(); return repondre(res, 404, {erreur: 'Introuvable.'}); }
    if (req.method !== 'GET' && url.pathname !== '/api/stripe-webhook' && !origineOk(req)) { req.resume(); return repondre(res, 403, {erreur: 'Origine refusée.'}); }
    return await route(req, res, url);
  } catch (e) {
    journal('erreur', e.stack || e.message);
    if (!res.headersSent) repondre(res, 500, {erreur: 'Erreur du service.'});
  }
});
// Envois de photos et de PDF depuis un téléphone : on laisse 15 minutes par requête.
serveur.requestTimeout = 15 * 60 * 1000;

if (require.main === module) { setTimeout(C.purgerInactifs, 60000); setInterval(C.purgerInactifs, 86400000).unref(); }
if (require.main === module) serveur.listen(CONF.port, () => journal(`service Le Bon Permis sur le port ${CONF.port}`, CONF.stripeCle ? '' : '(clé Stripe absente)', `images:${!!B.OUTILS.magick} pdf:${!!B.OUTILS.pdftoppm}`));
module.exports = {serveur, signatureValide, reference: B.reference, encoder: B.encoder, analyser: D.analyser};
