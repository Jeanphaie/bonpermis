'use strict';
/* Vie d'une commande, de la simulation à la livraison.
   simulation (compte) -> acompte 30 % payé -> elements (le client envoie pièces et textes) -> verification
   -> preparation (l'équipe dessine, échéance calculée) -> apercu (plans en filigrane) <-> corrections
   -> solde payé -> livre (téléchargement des PDF). */

const B = require('./base');
const C = require('./comptes');
const PROMOS = require('./promos');
const {fs, path, CONF, P, NEED, PIECES, PAGES, PRIX, lire, ecrire, creer, repondre, lireJson, texte, texteLong, MAIL_RE, journal, euro, envoyerMail, signature, stripe, reference, envoyerFichier, TYPES} = B;

const CONTROLES = require('../src/controles.js');
const REF_RE = /^BP-[2-9A-HJ-NP-Z]{6}$/;
const LIM = {fichier: 25 * 1048576, nb: 60, total: 500 * 1048576, livrable: 60 * 1048576};
const STATUTS = {
  brouillon: 'À valider : acompte à régler',
  elements: 'Vos éléments', verification: 'Vérification par l\'équipe', preparation: 'Plans en préparation',
  apercu: 'Aperçu à relire', corrections: 'Corrections en cours', livre: 'Dossier livré'
};
const dDir = ref => B.chemin('dossiers', ref);

// ---------- pièces demandées ----------
// Liste propre à chaque projet (src/pieces.json) : description, pièces du projet, pièces communes,
// pièces liées à la situation (secteur protégé, copropriété) et aux travaux déjà faits, puis « Autres documents ».
// ctx = {regul, reponses} (réponses du simulateur, en JSON). Sans fichier ou projet inconnu : liste générique.
// Option « Dépôt du dossier à votre place » : il nous faut l'accord écrit du propriétaire (article R. 423-1 du code de l'urbanisme : dépôt par le propriétaire ou son mandataire).
const aDepot = options => String(options || '').split(',').includes('depot');
const MANDAT = {id: 'cerfa-mandat', nom: 'Votre accord pour que nous déposions le dossier', type: 'texte', exemple: 'Exemple : Bon pour accord, Jeanne Martin',
  aide: 'Vous avez choisi que nous déposions le dossier à votre place. Pour nous y autoriser, écrivez « Bon pour accord » suivi de votre prénom et de votre nom. Cela vaut mandat pour déposer ce dossier, et seulement celui-ci, auprès de votre mairie.'};
function piecesInitiales(kind, p, ctx) {
  const nd = NEED[p] || NEED.extension, c = ctx || {};
  const autre = {id: 'autre', nom: 'Autres documents', type: 'fichier', facultatif: true, aide: 'Tout ce qui peut nous aider : croquis, devis, inspiration…'};
  const liste = PIECES && PIECES.projets[p];
  if (liste) {
    let a = {}; try { a = JSON.parse(c.reponses || '{}'); } catch {}
    const copie = l => (l || []).map(x => Object.assign({}, x));
    const commun = !PIECES.sansCommun.includes(p), cm = PIECES.commun.debut ? PIECES.commun : {debut: [], fin: PIECES.commun};
    const out = [{id: 'projet', nom: kind === 'svc' ? 'Votre demande' : 'Le projet en quelques mots', type: 'texte',
      aide: kind === 'svc' ? nd[0] : 'Deux ou trois phrases suffisent : ce que vous faites, où sur le terrain ou sur la maison, à peu près quelle taille.'}];
    if (commun) out.push(...copie(cm.debut));
    if (PIECES.modes && PIECES.modes[p]) out.push({id: 'plan', nom: 'Emplacement sur le plan', type: 'plan', mode: PIECES.modes[p], facultatif: true,
      aide: 'Placez votre projet sur le plan de votre terrain. Si vous n\'y arrivez pas, décrivez-le simplement dans « Le projet en quelques mots ».'});
    out.push(...copie(liste));
    if (c.regul === true || c.regul === 'true') out.push(...copie(PIECES.regul));
    // La photo de l'endroit des travaux ne sert que si le projet n'a pas déjà sa propre photo (façade, toit, rue).
    if (commun) out.push(...copie(cm.fin).filter(x => x.id !== 'endroit' || !liste.some(y => y.type === 'photo')));
    if (c.regul === true || c.regul === 'true') for (const x of out) if (x.id === 'endroit') x.aide = "À quelques mètres : l'endroit exact où ont été faits les travaux.";
    if (a.abf === 'oui') out.push(...copie(PIECES.situations.secteur_protege));
    if (a.copro === 'oui') out.push(...copie(PIECES.situations.copropriete));
    out.push(...copie(PIECES.formulaire).filter(x => x.id !== 'cerfa-residence' || !['cu', 'daact'].includes(p)));
    if (aDepot(c.options)) out.push(Object.assign({}, MANDAT));
    const vus = new Set();
    return out.filter(x => !vus.has(x.id) && vus.add(x.id)).concat(autre);
  }
  if (kind === 'svc') return [
    {id: 'projet', nom: 'Votre demande', type: 'texte', aide: nd[0]},
    {id: 'documents', nom: 'Vos documents', type: 'fichier', aide: nd[2] || 'Les documents dont vous disposez (arrêté, plans déposés…)'},
    autre
  ];
  return [
    {id: 'projet', nom: 'Le projet', type: 'texte', aide: nd[0]},
    {id: 'mesures', nom: 'Les mesures', type: 'texte', aide: nd[1]},
    {id: 'facade', nom: 'La partie qui va changer', type: 'photo', aide: 'De face, en entier, en plein jour.'},
    {id: 'rue', nom: 'La maison vue de la rue', type: 'photo', aide: 'Depuis le trottoir, toute la façade visible.'},
    {id: 'loin', nom: 'Le terrain vu de loin', type: 'photo', aide: 'Reculez au maximum : la maison et les limites du terrain.'},
    {id: 'abords', nom: 'Les abords proches', type: 'photo', aide: 'Jardin, clôture, maisons voisines.'},
    {id: 'plans', nom: 'Plans existants', type: 'fichier', facultatif: true, aide: 'Si vous en avez : plans de la maison, ancien permis.'},
    autre
  ];
}
// Pièces à fournir, pour les e-mails : obligatoires d'abord, puis « si vous l'avez ».
function listePieces(cmd) {
  const l = cmd.pieces.filter(p => p.id !== 'autre');
  return l.filter(p => !p.facultatif).map(p => '- ' + p.nom).join('\n') + (l.some(p => p.facultatif) ? '\nSi vous les avez :\n' + l.filter(p => p.facultatif).map(p => '- ' + p.nom).join('\n') : '');
}
// Une pièce « sauf » n'est plus exigée dès que le client a envoyé un fichier pour la pièce citée (ses plans, la fiche du modèle).
const couverte = (piece, cmd) => !!piece.sauf && (piece.sauf === 'plan' ? cmd.pieces.some(x => x.type === 'plan' && x.plan) : cmd.fichiers.some(f => f.piece === piece.sauf));
const facultative = (piece, cmd) => !!piece.facultatif || couverte(piece, cmd);
function etatPiece(piece, cmd) {
  if (piece.statut === 'valide' || piece.statut === 'a_refaire') return piece.statut;
  const plein = piece.type === 'texte' ? !!(piece.texte || '').trim() : piece.type === 'plan' ? !!piece.plan : cmd.fichiers.some(f => f.piece === piece.id);
  return plein ? 'a_verifier' : 'manquant';
}
const recues = cmd => { const ob = cmd.pieces.filter(p => !facultative(p, cmd)); return {n: ob.filter(p => etatPiece(p, cmd) !== 'manquant').length, sur: ob.length}; };

// Les commandes de la première version (payées en une fois, fichiers sans pièce) sont reprises telles quelles.
function norm(cmd) {
  if (!cmd || cmd.v === 2) return cmd;
  const meta = cmd;
  cmd.v = 2;
  cmd.total = +meta.total || cmd.montant;
  cmd.acompte = cmd.acompte != null ? +cmd.acompte : cmd.total;
  cmd.solde = Math.round((cmd.total - cmd.acompte) * 100) / 100;
  cmd.paiements = cmd.paiements || {acompte: {montant: cmd.montant, date: cmd.date, session: cmd.session}};
  // (pas pour un dossier offert par code promo : son solde nul se « règle » quand le client valide ses plans)
  if (cmd.solde <= 0 && !cmd.paiements.solde && !(cmd.paiements.acompte && cmd.paiements.acompte.gratuit)) cmd.paiements.solde = {montant: 0, date: cmd.date, ancien: true};
  cmd.kind = cmd.kind || 'dp';
  cmd.pieces = cmd.pieces || piecesInitiales(cmd.kind, cmd.projet, {regul: cmd.regul, reponses: cmd.reponses, options: cmd.options});
  if (aDepot(cmd.options) && cmd.pieces.some(x => /^cerfa-/.test(x.id)) && !cmd.pieces.some(x => x.id === 'cerfa-mandat')) { const i = cmd.pieces.findIndex(x => x.id === 'autre'); cmd.pieces.splice(i < 0 ? cmd.pieces.length : i, 0, Object.assign({}, MANDAT)); }
  cmd.fichiers = cmd.fichiers || []; cmd.messages = cmd.messages || []; cmd.livrables = cmd.livrables || []; cmd.historique = cmd.historique || [];
  const st = lireOld(cmd.ref);
  cmd.statut = cmd.statut || (st.termine ? 'verification' : 'elements');
  if (st.infos) { const pj = cmd.pieces.find(p => p.id === 'projet'), me = cmd.pieces.find(p => p.id === 'mesures');
    if (pj && st.infos.projet) pj.texte = st.infos.projet; if (me && st.infos.mesures) me.texte = st.infos.mesures;
    if (st.infos.remarques) cmd.messages.push({de: 'client', texte: st.infos.remarques, date: st.infos.maj}); }
  for (const f of st.fichiers) cmd.fichiers.push({id: f.replace(/\.\w+$/, ''), nom: f.replace(/^\d+-[0-9a-f]{4}-/, ''), type: f.split('.').pop(), taille: fs.statSync(path.join(dDir(cmd.ref), 'fichiers', f)).size, piece: 'autre', date: cmd.date, par: 'client'});
  if (!cmd.uid && cmd.email) { const u = C.userParMail(cmd.email) || C.creerUser(cmd.email); cmd.uid = u.id; if (!u.commandes.includes(cmd.ref)) { u.commandes.push(cmd.ref); C.ecrireUser(u); } }
  sauver(cmd);
  return cmd;
}
function lireOld(ref) {
  const d = dDir(ref); const o = {fichiers: []};
  try { o.infos = JSON.parse(fs.readFileSync(path.join(d, 'infos.json'), 'utf8')); } catch {}
  try { o.termine = !!JSON.parse(fs.readFileSync(path.join(d, 'statut.json'), 'utf8')).termine; } catch {}
  try { o.fichiers = fs.readdirSync(path.join(d, 'fichiers')).filter(f => !f.startsWith('.')); } catch {}
  return o;
}
const lireCmd = ref => REF_RE.test(ref || '') ? norm(lire('commandes', ref + '.json')) : null;
const sauver = cmd => ecrire(cmd, 'commandes', cmd.ref + '.json');
const histo = (cmd, t) => cmd.historique.unshift({date: new Date().toISOString(), texte: t});

// Délai : 5 jours ouvrés pour un permis, 24 h avec l'option express, 48 h sinon.
const delaiJours = cmd => cmd.kind === 'pc' ? 5 : (String(cmd.options || '').includes('express') ? 1 : 2);

// ---------- vues ----------
function fichierPublic(f) { return {id: f.id, nom: f.nom, type: f.type, taille: f.taille, piece: f.piece, date: f.date, par: f.par, vue: !!f.vue}; }
function vueCmd(cmd, pourEquipe) {
  const r = recues(cmd);
  const o = {
    ref: cmd.ref, nom: cmd.nom, adresse: cmd.adresse, statut: cmd.statut, statutTexte: STATUTS[cmd.statut], date: cmd.date,
    echeance: cmd.echeance || null, delai: delaiJours(cmd), options: cmd.options, kind: cmd.kind, lieu: cmd.lieu || null, projet: cmd.projet,
    total: cmd.total, acompte: cmd.acompte, solde: cmd.solde, paiements: {acompte: cmd.paiements.acompte ? {montant: cmd.paiements.acompte.montant, date: cmd.paiements.acompte.date} : null, solde: cmd.paiements.solde ? {montant: cmd.paiements.solde.montant, date: cmd.paiements.solde.date} : null},
    pieces: cmd.pieces.map(p => ({id: p.id, nom: p.nom, aide: p.aide, exemple: p.exemple || '', type: p.type, facultatif: facultative(p, cmd), couverte: couverte(p, cmd) && etatPiece(p, cmd) === 'manquant', texte: p.texte || '', etat: etatPiece(p, cmd), motif: p.motif || '', plusTard: !!p.plusTard && etatPiece(p, cmd) === 'manquant', ...(p.type === 'plan' ? {mode: p.mode, plan: p.plan || null} : {})})),
    fichiers: cmd.fichiers.map(fichierPublic), messages: cmd.messages, recues: r,
    livrables: cmd.livrables.map(l => (!pourEquipe && reservee(cmd, l) ? {id: l.id, code: l.code, nom: l.nom, pages: 0, reservee: true, date: l.date} : {id: l.id, code: l.code, nom: l.nom, pages: l.pages, taille: l.taille, date: l.date})),
    depot: aDepot(cmd.options) ? {fait: cmd.depot || null} : null,
    telechargeable: !!cmd.paiements.solde, confirme: cmd.confirme || null, demandes: NEED[cmd.projet] || NEED.extension,
    lignes: cmd.lignes || null, promo: cmd.promo || null
  };
  if (pourEquipe) { try { o.relances = require('./relances').resume(cmd); } catch (e) { o.relances = null; } }
  if (pourEquipe) Object.assign(o, {archive: !!cmd.archive, email: cmd.email, client: nomClient(cmd), reponses: cmd.reponses, reponsesLisibles: lisibles(cmd), projet: cmd.projet, regul: cmd.regul, historique: cmd.historique, lignes: cmd.lignes || null, session: cmd.session, analyse: cmd.analyse || null, aFaire: aFaire(cmd), liensStripe: [cmd.paiements.acompte && cmd.paiements.acompte.pi, cmd.paiements.solde && cmd.paiements.solde.pi].filter(Boolean)});
  return o;
}
// Réponses au simulateur avec les intitulés des questions, pour l'équipe
function lisibles(cmd) {
  let a = {}; try { a = JSON.parse(cmd.reponses || '{}'); } catch {}
  let qs = []; try { qs = P[cmd.projet] ? PRIX.flow(P, cmd.projet) : []; } catch {}
  return Object.entries(a).map(([k, v]) => { const q = qs.find(x => x.id === k); const c = q && q.c.find(x => x[0] === v); return [q ? q.t : k, c ? c[1] : v]; });
}
// Nom affiché à l'équipe : celui de Stripe, sinon celui donné pour le formulaire de la mairie, sinon l'e-mail.
function nomClient(cmd) {
  if (cmd.nom_client) return cmd.nom_client;
  const p = (cmd.pieces || []).find(x => x.id === 'cerfa-nom'), t = p && p.texte ? String(p.texte).split('\n')[0].trim().slice(0, 60) : '';
  return t || '';
}
function resume(cmd) {
  const r = recues(cmd), commune = (cmd.adresse || '').split(',').pop().trim();
  const retard = ['verification', 'preparation'].includes(cmd.statut) && cmd.echeance && new Date(cmd.echeance) < new Date();
  return {ref: cmd.ref, nom: cmd.nom, client: nomClient(cmd) || cmd.email, email: cmd.email, commune, statut: cmd.statut, recues: r,
    echeance: cmd.echeance || null, retard: !!retard, total: cmd.total, solde: cmd.solde, paiement: cmd.paiements.solde ? 'solde' : cmd.paiements.acompte ? (cmd.paiements.acompte.gratuit ? 'offert' : 'acompte') : 'aucun',
    aFaire: aFaire(cmd), aRelire: !!(cmd.analyse && !cmd.analyse.appliquee),
    archive: !!cmd.archive, relances: (cmd.relances && cmd.relances.n) || 0, relanceStop: !!(cmd.relances && cmd.relances.stop), date: cmd.date, dernierMessage: cmd.messages.length ? cmd.messages[cmd.messages.length - 1] : null,
    aVerifier: cmd.pieces.filter(p => etatPiece(p, cmd) === 'a_verifier').length, plusTard: cmd.pieces.filter(p => p.plusTard && etatPiece(p, cmd) === 'manquant').length};
}

// ---------- paiement de l'acompte ----------
function analyser(d) {
  if (!d || typeof d !== 'object') return {erreur: 'Demande illisible.'};
  const p = d.p;
  if (!P[p]) return {erreur: 'Projet inconnu.'};
  const regul = d.regul === true;
  if (regul && !PRIX.regulPossible(P, B.GROUPS, p)) return {erreur: 'Ce projet ne peut pas être déclaré après coup.'};
  const a = PRIX.reponsesValides(P, p, d.a);
  if (!a) return {erreur: 'Réponses incomplètes. Reprenez le simulateur depuis le début.'};
  const v = PRIX.verdict(P, p, a, regul);
  if (!['dp', 'pc', 'pd', 'svc'].includes(v.kind)) return {erreur: 'Ce projet ne se commande pas en ligne : demandez à être rappelé.'};
  const opt = PRIX.optionsValides(P, p, v, d.opt);
  const lignes = PRIX.lignes(P, p, v, opt), total = PRIX.total(lignes);
  return {p, regul, a, v, opt, lignes, total, nom: (regul ? 'Travaux déjà faits · ' : '') + P[p].n};
}
// Point choisi dans les suggestions d'adresse (lon, lat) : sert au plan du projet et à la fiche terrain de l'équipe.
function lieuValide(l) {
  const lon = l && +l.lon, lat = l && +l.lat;
  return Number.isFinite(lon) && Number.isFinite(lat) && lon > -180 && lon < 180 && lat > -90 && lat < 90 ? lon.toFixed(6) + ',' + lat.toFixed(6) : '';
}
const lireLieu = s => { const m = /^(-?\d+\.\d+),(-?\d+\.\d+)$/.exec(s || ''); return m ? {lon: +m[1], lat: +m[2]} : null; };
const centimes = n => Math.round(n * 100);
// Acompte : 30 %, mais jamais moins de 0,50 € (minimum Stripe) ni plus que le prix ; le solde garde lui aussi 0,50 € minimum.
function partAcompte(total) {
  let a = Math.round(centimes(total) * CONF.acompte) / 100;
  a = Math.min(total, Math.max(0.5, a));
  const reste = Math.round((total - a) * 100) / 100;
  if (reste > 0 && reste < 0.5) a = Math.round((total - 0.5) * 100) / 100;
  return a;
}
// Code promo : ajoute une ligne négative et recalcule le total. Renvoie une erreur si le code n'est pas valable.
function avecPromo(x, code, gratuitPermis) {
  if (!code) return x;
  const r = PROMOS.appliquer(code, x.total, gratuitPermis);
  if (!r) return x;
  if (r.erreur) return {erreur: r.erreur};
  return {...x, total: r.total, promo: r.code, lignes: [...x.lignes, {label: r.libelle, prix: -r.remise}]};
}

async function ouvrirPaiementAcompte(x, email, adresse, uid, pid, lieu, ref) {
  const acompte = partAcompte(x.total);
  const page = PAGES[x.p] ? `${CONF.site}/${PAGES[x.p].slug}/` : `${CONF.site}/`;
  const meta = {
    type: 'acompte', projet: x.p, kind: x.v.kind, nom: x.nom.slice(0, 200), regul: String(x.regul), adresse: adresse.slice(0, 480),
    reponses: JSON.stringify(x.a).slice(0, 480), options: Object.keys(x.opt).filter(k => x.opt[k]).join(',') || 'aucune',
    total: String(x.total), acompte: String(acompte), lignes: JSON.stringify(x.lignes.map(l => [l.label.slice(0, 60), l.prix])).slice(0, 490),
    uid: uid || '', pid: pid || '', lieu: lieu || '', promo: x.promo || '', ref: ref || ''
  };
  const params = {
    mode: 'payment', locale: 'fr', customer_email: email,
    success_url: `${CONF.site}/commande/merci/?ref={CHECKOUT_SESSION_ID}`,
    cancel_url: ref ? `${CONF.site}/espace/dossier/?ref=${ref}` : pid ? `${CONF.site}/espace/` : `${page}#${x.p}`,
    line_items: [{quantity: 1, price_data: {currency: 'eur', unit_amount: centimes(acompte), product_data: {
      name: `Acompte 30 % : ${x.nom}`.slice(0, 250),
      description: `Prix total ${euro(x.total)} TTC (${x.lignes.map(l => l.label).join(', ')}). Solde de ${euro(x.total - acompte)} à régler quand le dossier est prêt (aperçu en basse qualité avant, plans nets après).`.slice(0, 500)}}}],
    metadata: meta,
    payment_intent_data: {description: `Acompte ${x.nom}, ${adresse}`.slice(0, 1000), metadata: meta},
    consent_collection: {terms_of_service: 'required'},
    custom_text: {terms_of_service_acceptance: {message: `J'accepte les [conditions générales de vente](${CONF.site}/cgv/) et je demande que mon dossier soit commencé avant la fin du délai de rétractation de 14 jours.`}}
  };
  const s = await stripe('POST', '/v1/checkout/sessions', params);
  journal('paiement ouvert', reference(s.id), x.p, `acompte ${acompte} € sur ${x.total} €`);
  return s;
}

// POST /api/commande : depuis le simulateur du site (avec ou sans compte)
async function commande(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  let x = analyser(d); if (x.erreur) return repondre(res, 400, x);
  x = avecPromo(x, d.promo); if (x.erreur) return repondre(res, 400, {erreur: x.erreur, champ: 'promo'});
  const u = C.sessionClient(req);
  const email = u ? u.email : texte(d.email, 254), adresse = texte(d.adresse, 300);
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  if (adresse.length < 5) return repondre(res, 400, {erreur: 'Indiquez l\'adresse des travaux.'});
  try { const s = await ouvrirPaiementAcompte(x, email, adresse, u && u.id, null, lieuValide(d.lieu)); repondre(res, 200, {url: s.url}); }
  catch (e) { journal('erreur Stripe :', e.message); repondre(res, 502, {erreur: 'Le paiement n\'a pas pu s\'ouvrir.'}); }
}

// POST /api/promo : vérifie un code pour la simulation en cours (prix recalculé ici, jamais celui de la page).
async function verifierPromo(req, res) {
  if (B.trop('promo:' + B.ip(req), 20)) return repondre(res, 429, {erreur: 'Trop d\'essais. Réessayez dans 10 minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  let x;
  if (d.ref) { // dossier créé avant paiement
    const u = C.sessionClient(req), cmd = lireCmd(d.ref);
    if (!u || !cmd || cmd.uid !== u.id) return repondre(res, 404, {erreur: 'Dossier introuvable.'});
    x = {total: cmd.total, lignes: cmd.lignes, gratuitPermis: true};
  } else if (d.projet) { // simulation enregistrée (espace client)
    const u = C.sessionClient(req), s = lireProjet(d.projet);
    if (!u || !s || s.uid !== u.id) return repondre(res, 404, {erreur: 'Projet introuvable.'});
    x = {total: s.total, lignes: s.lignes};
  } else { x = analyser(d); if (x.erreur) return repondre(res, 400, x); }
  const r = PROMOS.appliquer(d.code, x.total, !!x.gratuitPermis);
  if (!r) return repondre(res, 400, {erreur: 'Indiquez un code.'});
  if (r.erreur) return repondre(res, 400, r);
  repondre(res, 200, {code: r.code, remise: r.remise, total: r.total, acompte: partAcompte(r.total), solde: Math.round((r.total - partAcompte(r.total)) * 100) / 100});
}

// ---------- simulations enregistrées ----------
const lireProjet = pid => /^s[A-Za-z0-9]{8,20}$/.test(pid || '') ? lire('projets', pid + '.json') : null;
function vueProjet(s) { return {id: s.id, nom: s.nom, adresse: s.adresse, date: s.date, kind: s.kind, total: s.total, acompte: partAcompte(s.total), lignes: s.lignes, statut: s.statut, ref: s.ref || null, p: s.p, a: s.a, opt: s.opt, regul: s.regul}; }

async function enregistrerProjet(req, res) {
  const u = C.sessionClient(req); if (!u) return repondre(res, 401, {erreur: 'Connectez-vous pour enregistrer.'});
  const d = await lireJson(req); const x = analyser(d); if (x.erreur) return repondre(res, 400, x);
  if (u.projets.length >= 30) return repondre(res, 400, {erreur: 'Vous avez déjà 30 projets enregistrés. Supprimez-en un.'});
  const s = {id: 's' + B.id(9), uid: u.id, date: new Date().toISOString(), p: x.p, a: x.a, opt: x.opt, regul: x.regul, kind: x.v.kind, nom: x.nom,
    adresse: texte(d.adresse, 300), lignes: x.lignes.map(l => ({label: l.label, prix: l.prix})), total: x.total, statut: 'simulation'};
  ecrire(s, 'projets', s.id + '.json');
  u.projets.unshift(s.id); C.ecrireUser(u);
  repondre(res, 200, {ok: true, projet: vueProjet(s)});
}
async function supprimerProjet(req, res, url) {
  const u = C.sessionClient(req); if (!u) return repondre(res, 401, {erreur: 'Connectez-vous.'});
  const s = lireProjet(url.searchParams.get('id'));
  if (!s || s.uid !== u.id || s.statut !== 'simulation') return repondre(res, 404, {erreur: 'Projet introuvable.'});
  fs.rmSync(B.chemin('projets', s.id + '.json'), {force: true});
  u.projets = u.projets.filter(x => x !== s.id); C.ecrireUser(u);
  repondre(res, 200, {ok: true});
}
async function commanderProjet(req, res, url) {
  const u = C.sessionClient(req); if (!u) return repondre(res, 401, {erreur: 'Connectez-vous.'});
  const s = lireProjet(url.searchParams.get('id'));
  if (!s || s.uid !== u.id) return repondre(res, 404, {erreur: 'Projet introuvable.'});
  if (s.statut !== 'simulation') return repondre(res, 409, {erreur: 'Ce projet est déjà commandé.'});
  const d = await lireJson(req) || {};
  const adresse = texte(d.adresse, 300) || s.adresse;
  if (adresse.length < 5) return repondre(res, 400, {erreur: 'Indiquez l\'adresse des travaux.'});
  // Prix figé : celui de la simulation enregistrée, même si la grille a changé depuis.
  // Le dossier est créé tout de suite, au prix figé de la simulation ; l'acompte se règle depuis le dossier.
  const cmd = nouveauDossier({p: s.p, regul: s.regul, a: s.a, v: {kind: s.kind}, opt: s.opt, lignes: s.lignes, total: s.total, nom: s.nom}, u, adresse, lieuValide(d.lieu));
  s.statut = 'commande'; s.ref = cmd.ref; ecrire(s, 'projets', s.id + '.json');
  repondre(res, 200, {url: `/espace/dossier/?ref=${cmd.ref}&nouveau=1`});
  mailsDossierCree(cmd).catch(e => journal('mails dossier', e.message));
}

// GET /api/espace : le compte, ses simulations et ses commandes
function espace(req, res) {
  const u = C.sessionClient(req); if (!u) return repondre(res, 401, {erreur: 'Non connecté.'});
  const projets = u.projets.map(lireProjet).filter(s => s && s.statut === 'simulation').map(vueProjet);
  const commandes = u.commandes.map(lireCmd).filter(Boolean).map(c => ({...resume(c), statutTexte: STATUTS[c.statut], acompte: c.acompte}));
  repondre(res, 200, {compte: C.vue(u), projets, commandes});
}

// ---------- webhook Stripe ----------
async function paiementRecu(s) {
  const m = s.metadata || {};
  const email = ((s.customer_details && s.customer_details.email) || s.customer_email || '').toLowerCase();
  const nomClient = (s.customer_details && s.customer_details.name) || '';
  if (m.type === 'solde') return soldeRecu(s, m);
  if (m.ref && REF_RE.test(m.ref)) return acompteDossier(s, m, email, nomClient);
  const ref = reference(s.id);
  let u = (m.uid && C.lireUser(m.uid)) || C.userParMail(email) || (email && C.creerUser(email));
  const acompte = m.acompte ? +m.acompte : s.amount_total / 100, total = +m.total || acompte;
  let lignes = null; try { lignes = JSON.parse(m.lignes || 'null'); } catch {}
  const cmd = {
    v: 2, ref, session: s.id, date: new Date().toISOString(), email, nom_client: nomClient, uid: u ? u.id : null,
    projet: m.projet, kind: m.kind || 'dp', nom: m.nom, regul: m.regul, adresse: m.adresse, lieu: lireLieu(m.lieu), reponses: m.reponses, options: m.options, lignes,
    total, acompte, solde: Math.round((total - acompte) * 100) / 100,
    paiements: {acompte: {montant: s.amount_total / 100, date: new Date().toISOString(), session: s.id, pi: s.payment_intent || null}},
    statut: 'elements', pieces: piecesInitiales(m.kind || 'dp', m.projet, {regul: m.regul, reponses: m.reponses, options: m.options}), fichiers: [], messages: [], livrables: [],
    historique: [{date: new Date().toISOString(), texte: `Acompte reçu : ${euro(s.amount_total / 100)}`}]
  };
  if (!m.type) { // commande de la première version : payée en une fois
    cmd.acompte = cmd.total = s.amount_total / 100; cmd.solde = 0; cmd.paiements.solde = {montant: 0, date: cmd.date, ancien: true};
  }
  if (!creer(cmd, 'commandes', ref + '.json')) return; // déjà reçu (Stripe peut renvoyer l'événement)
  if (u && !u.commandes.includes(ref)) { u.commandes.unshift(ref); C.ecrireUser(u); }
  const sim = m.pid && lireProjet(m.pid); if (sim) { sim.statut = 'commande'; sim.ref = ref; ecrire(sim, 'projets', sim.id + '.json'); }
  journal('acompte payé', ref, m.projet, cmd.paiements.acompte.montant + ' €');
  if (m.promo) { cmd.promo = m.promo; sauver(cmd); PROMOS.compterUtilisation(m.promo); }
  await envoyerMail(CONF.mailA, `Nouvelle commande ${ref} : ${m.nom} (acompte ${euro(cmd.paiements.acompte.montant)})`,
    `Commande ${ref}, acompte payé.\n\nProjet : ${m.nom}\nAdresse des travaux : ${m.adresse}\nClient : ${nomClient} <${email}>\nPrix total : ${euro(total)} TTC, acompte ${euro(acompte)}, solde ${euro(cmd.solde)}\nOptions : ${m.options}\nRéponses : ${m.reponses}\n\nBackoffice : ${CONF.site}/admin/#${ref}\nStripe : https://dashboard.stripe.com/payments/${s.payment_intent || ''}\n`, email);
  if (email && u) await envoyerMail(email, `Votre commande ${ref} : la suite`,
    `Bonjour${nomClient ? ' ' + nomClient : ''},\n\nMerci, votre acompte de ${euro(cmd.paiements.acompte.montant)} est bien reçu.\nRéférence : ${ref}\nProjet : ${m.nom}\nAdresse des travaux : ${m.adresse}\nPrix total : ${euro(total)}. Le solde de ${euro(cmd.solde)} se règle quand vous aurez relu et validé vos plans.\n\nPour lancer votre dossier, envoyez-nous vos photos et vos mesures dans votre espace, depuis votre téléphone :\n${C.lienLong(u, '/espace/dossier/?ref=' + ref)}\n\nCe qu'il nous faut :\n${listePieces(cmd)}\n\nLe délai de préparation commence quand toutes les pièces sont reçues. Une question ? Répondez à cet e-mail.${signature}`, CONF.mailA);
}

// ---------- dossier créé avant paiement (statut « brouillon ») ----------
const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
function nouveauDossier(x, u, adresse, lieu) {
  const date = new Date().toISOString(), lignes = x.lignes.map(l => Array.isArray(l) ? l : [l.label, l.prix]);
  const reponses = typeof x.a === 'string' ? x.a : JSON.stringify(x.a || {});
  const cmd = {
    v: 2, ref: '', date, email: u.email, nom_client: '', uid: u.id, projet: x.p, kind: (x.v && x.v.kind) || 'dp', nom: x.nom, regul: String(!!(x.regul === true || x.regul === 'true')),
    adresse, lieu: lireLieu(lieu), reponses, options: Object.keys(x.opt || {}).filter(k => x.opt[k]).join(',') || 'aucune', lignes,
    total: x.total, acompte: partAcompte(x.total), solde: Math.round((x.total - partAcompte(x.total)) * 100) / 100,
    paiements: {}, statut: 'brouillon', pieces: piecesInitiales((x.v && x.v.kind) || 'dp', x.p, {regul: x.regul, reponses, options: Object.keys(x.opt || {}).filter(k => x.opt[k]).join(',')}),
    fichiers: [], messages: [], livrables: [], historique: [{date, texte: 'Dossier créé par le client (acompte à régler)'}]
  };
  for (let k = 0; k < 20; k++) {
    let r = 'BP-'; for (let i = 0; i < 6; i++) r += ALPHA[require('crypto').randomInt(ALPHA.length)];
    cmd.ref = r;
    if (!lire('commandes', r + '.json') && creer(cmd, 'commandes', r + '.json')) break;
  }
  if (!u.commandes.includes(cmd.ref)) { u.commandes.unshift(cmd.ref); C.ecrireUser(u); }
  journal('dossier créé (non payé)', cmd.ref, x.p);
  return cmd;
}
async function mailsDossierCree(cmd) {
  await envoyerMail(cmd.email, `Votre dossier ${cmd.ref} est créé`, `Bonjour,\n\nVotre dossier « ${cmd.nom} » (${cmd.adresse}) est créé dans votre espace.\nVous pouvez déjà envoyer vos photos et vos mesures. Quand vous êtes prêt, validez-le en réglant l'acompte de ${euro(cmd.acompte)} : c'est à ce moment que nous commençons.\n\nVotre dossier : ${CONF.site}/espace/dossier/?ref=${cmd.ref}\n\nCe qu'il nous faut :\n${listePieces(cmd)}${signature}`, CONF.mailA);
  await envoyerMail(CONF.mailA, `Dossier créé ${cmd.ref} (non payé) : ${cmd.nom}`, `Nouveau dossier, acompte pas encore réglé.\n\nProjet : ${cmd.nom}\nAdresse : ${cmd.adresse}\nClient : ${cmd.email}\nPrix : ${euro(cmd.total)}\n\n${CONF.site}/admin/#${cmd.ref}\n`, cmd.email);
}

// POST /api/dossier/creer : depuis le simulateur. Sans session : 1er appel = code envoyé à l'e-mail, 2e appel avec le code.
async function creerDossier(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const x = analyser(d); if (x.erreur) return repondre(res, 400, x);
  const adresse = texte(d.adresse, 300);
  if (adresse.length < 5) return repondre(res, 400, {erreur: 'Indiquez l\'adresse des travaux.', champ: 'adr'});
  let u = C.sessionClient(req);
  if (!u) {
    const email = texte(d.email, 254).toLowerCase(), code = texte(d.code, 12).replace(/\D/g, '');
    if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.', champ: 'mail'});
    if (!code) {
      if (B.trop('code:' + email, 5)) return repondre(res, 429, {erreur: 'Trop de codes demandés pour cette adresse. Réessayez dans 10 minutes.'});
      const c = C.nouveauCode('dossier', email, {});
      envoyerMail(email, `${c} : votre code Le Bon Permis`, `Bonjour,\n\nVotre code pour créer votre dossier Le Bon Permis :\n\n${c}\n\nIl est valable 15 minutes. Si vous n'avez rien demandé, ignorez cet e-mail.${signature}`)
        .then(ok => { if (!ok && !CONF.smtp.pass) journal('code dossier (SMTP absent, mode local) :', email, c); });
      return repondre(res, 200, {etape: 'code'});
    }
    if (B.trop('verif-ip:' + B.ip(req), 30)) return repondre(res, 429, {erreur: 'Trop de tentatives. Réessayez dans 10 minutes.'});
    if (!C.prendreCode('dossier', email, code)) return repondre(res, 401, {erreur: 'Code incorrect ou expiré. Vérifiez le dernier e-mail reçu.', champ: 'code'});
    u = C.userParMail(email) || C.creerUser(email);
    if (!u.confirme) { u.confirme = true; C.ecrireUser(u); }
    C.ouvrirSession(res, u, true);
  }
  const cmd = nouveauDossier(x, u, adresse, lieuValide(d.lieu));
  repondre(res, 200, {ref: cmd.ref, url: `/espace/dossier/?ref=${cmd.ref}&nouveau=1`});
  mailsDossierCree(cmd).catch(e => journal('mails dossier', e.message));
}

// POST /api/espace/dossier/payer?ref= : valider le dossier en payant l'acompte (code promo possible).
async function payerDossier(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (cmd.statut !== 'brouillon' || cmd.paiements.acompte) return repondre(res, 409, {erreur: 'L\'acompte de ce dossier est déjà réglé.'});
  const d = await lireJson(req) || {};
  let a = {}; try { a = JSON.parse(cmd.reponses || '{}'); } catch {}
  const opt = {}; String(cmd.options || '').split(',').filter(k => k && k !== 'aucune').forEach(k => { opt[k] = true; });
  let x = {p: cmd.projet, regul: cmd.regul === 'true', a, v: {kind: cmd.kind}, opt, lignes: (cmd.lignes || [[cmd.nom, cmd.total]]).map(([label, prix]) => ({label, prix})), total: cmd.total, nom: cmd.nom};
  x = avecPromo(x, d.promo, true); if (x.erreur) return repondre(res, 400, {erreur: x.erreur, champ: 'promo'});
  // Code promo à 100 % : rien à payer, le dossier est validé tout de suite, sans passer par Stripe.
  if (x.promo && x.total === 0) {
    let mails = null;
    try { mails = validerGratuit(cmd, x); } catch (e) { journal('validation gratuite', cmd.ref, e.message); }
    repondre(res, 200, {url: `/espace/dossier/?ref=${cmd.ref}&valide=1`, gratuit: true});
    if (mails) await mails.catch(e => journal('mails validation gratuite', cmd.ref, e.message));
    return;
  }
  const lieu = cmd.lieu ? `${(+cmd.lieu.lon).toFixed(6)},${(+cmd.lieu.lat).toFixed(6)}` : '';
  try { const s = await ouvrirPaiementAcompte(x, cmd.email, cmd.adresse, cmd.uid, null, lieu, cmd.ref); repondre(res, 200, {url: s.url}); }
  catch (e) { journal('erreur Stripe :', e.message); repondre(res, 502, {erreur: 'Le paiement n\'a pas pu s\'ouvrir. Réessayez dans un instant.'}); }
}

// L'échéance (48 h ou 5 jours ouvrés) démarre dès que le dossier est payé et que le client a tout envoyé,
// sans attendre que l'équipe clique sur « lancer les plans ». Une pièce redemandée la suspend (voir equipeDemander).
function demarrerEcheance(cmd) {
  if (cmd.echeance) return;
  const e = B.a19hParis(B.plusJoursOuvres(new Date(), delaiJours(cmd))); cmd.echeance = e.toISOString();
  histo(cmd, 'Échéance démarrée : ' + e.toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris'}));
}

// Dossier offert par un code promo à 100 % : validé sans paiement (acompte et solde à 0 €).
async function validerGratuit(cmd, x) {
  if (cmd.paiements.acompte) return;
  cmd.lignes = x.lignes.map(l => [String(l.label).slice(0, 60), l.prix]);
  cmd.total = 0; cmd.acompte = 0; cmd.solde = 0; cmd.promo = x.promo;
  cmd.paiements.acompte = {montant: 0, date: new Date().toISOString(), session: null, pi: null, gratuit: true};
  const r = recues(cmd);
  cmd.statut = r.n >= r.sur ? 'verification' : 'elements';
  histo(cmd, `Dossier validé sans paiement : code promo ${x.promo} (100 %)${cmd.statut === 'verification' ? ', toutes les pièces sont déjà là' : ''}`);
  if (cmd.statut === 'verification') demarrerEcheance(cmd);
  sauver(cmd);
  PROMOS.compterUtilisation(x.promo);
  journal('dossier validé gratuitement', cmd.ref, cmd.projet, x.promo);
  await envoyerMail(CONF.mailA, `Dossier validé ${cmd.ref} : ${cmd.nom} (gratuit, code ${x.promo})`,
    `Dossier validé sans paiement, avec le code promo ${x.promo}.\n\nProjet : ${cmd.nom}\nAdresse : ${cmd.adresse}\nClient : ${cmd.email}\nPièces reçues : ${r.n} sur ${r.sur}\n\n${CONF.site}/admin/#${cmd.ref}\n`, cmd.email);
  await envoyerMail(cmd.email, `Dossier ${cmd.ref} validé`,
    `Bonjour,\n\nVotre dossier « ${cmd.nom} » est validé. Avec votre code ${x.promo}, vous n'avez rien à payer.\n\n${r.n >= r.sur ? 'Toutes vos pièces sont là : nous les vérifions.' : 'Il nous manque encore des pièces : envoyez-les depuis votre espace.'}\n${CONF.site}/espace/dossier/?ref=${cmd.ref}\n${B.signature}`);
}

// Webhook : acompte réglé pour un dossier déjà créé.
async function acompteDossier(s, m, email, nomClient) {
  const cmd = lireCmd(m.ref); if (!cmd || cmd.paiements.acompte) return;
  let lignes = null; try { lignes = JSON.parse(m.lignes || 'null'); } catch {}
  cmd.session = s.id; cmd.nom_client = nomClient || cmd.nom_client;
  if (lignes) cmd.lignes = lignes;
  cmd.total = +m.total || cmd.total; cmd.acompte = +m.acompte || s.amount_total / 100; cmd.solde = Math.round((cmd.total - cmd.acompte) * 100) / 100;
  cmd.paiements.acompte = {montant: s.amount_total / 100, date: new Date().toISOString(), session: s.id, pi: s.payment_intent || null};
  const r = recues(cmd);
  cmd.statut = r.n >= r.sur ? 'verification' : 'elements';
  histo(cmd, `Acompte reçu : ${euro(s.amount_total / 100)}, dossier validé${cmd.statut === 'verification' ? ' (toutes les pièces sont déjà là)' : ''}`);
  if (cmd.statut === 'verification') demarrerEcheance(cmd);
  if (m.promo) cmd.promo = m.promo;
  sauver(cmd);
  if (m.promo) PROMOS.compterUtilisation(m.promo);
  journal('acompte payé', cmd.ref, cmd.projet, cmd.paiements.acompte.montant + ' €');
  await envoyerMail(CONF.mailA, `Dossier validé ${cmd.ref} : ${cmd.nom} (acompte ${euro(cmd.paiements.acompte.montant)})`,
    `Acompte payé, dossier validé.\n\nProjet : ${cmd.nom}\nAdresse : ${cmd.adresse}\nClient : ${nomClient} <${cmd.email}>\nPrix total : ${euro(cmd.total)}, acompte ${euro(cmd.acompte)}, solde ${euro(cmd.solde)}\nPièces reçues : ${r.n} sur ${r.sur}\n\n${CONF.site}/admin/#${cmd.ref}\nStripe : https://dashboard.stripe.com/payments/${s.payment_intent || ''}\n`, cmd.email);
  await envoyerMail(cmd.email, `Dossier ${cmd.ref} validé : merci`,
    `Bonjour${nomClient ? ' ' + nomClient : ''},\n\nMerci, votre acompte de ${euro(cmd.paiements.acompte.montant)} est bien reçu : votre dossier « ${cmd.nom} » est validé.\nLe solde de ${euro(cmd.solde)} se règle quand vous aurez relu et validé vos plans.\n\n${r.n >= r.sur ? 'Toutes vos pièces sont là : nous les vérifions sous 24 h ouvrées.' : `Il nous manque encore ${r.sur - r.n} pièce${r.sur - r.n > 1 ? 's' : ''}. Le délai de préparation commence quand tout est reçu.`}\n\nVotre dossier : ${CONF.site}/espace/dossier/?ref=${cmd.ref}${signature}`, CONF.mailA);
}

async function soldeRecu(s, m) {
  const cmd = lireCmd(m.ref); if (!cmd || cmd.paiements.solde) return;
  cmd.paiements.solde = {montant: s.amount_total / 100, date: new Date().toISOString(), session: s.id, pi: s.payment_intent || null};
  const offert = !(s.amount_total > 0);
  cmd.statut = 'livre'; histo(cmd, offert ? 'Dossier livré (offert, rien à régler).' : `Solde reçu : ${euro(s.amount_total / 100)}. Dossier livré.`);
  sauver(cmd);
  journal('solde payé', cmd.ref, s.amount_total / 100 + ' €');
  const u = C.lireUser(cmd.uid);
  await envoyerMail(CONF.mailA, `${offert ? 'Dossier livré' : 'Solde payé'} ${cmd.ref} : ${cmd.nom}`, `${offert ? 'Le client a validé ses plans (dossier offert, pas de solde)' : 'Le client a réglé le solde (' + euro(s.amount_total / 100) + ')'}. Il peut télécharger son dossier.\n\n${CONF.site}/admin/#${cmd.ref}\n`, cmd.email);
  if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : prêt à télécharger`, `Bonjour,\n\n${offert ? 'Merci, vos plans sont validés' : 'Merci, le solde est bien reçu'}. Votre dossier complet est prêt à télécharger, en pleine qualité. Relisez-le : si quelque chose ne va pas, demandez une correction depuis la même page, c'est compris. Il est sans filigrane :\n${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}\n\n${String(cmd.options).includes('depot') ? 'Vous avez choisi le dépôt et le suivi : nous déposons le dossier pour vous, nous vous envoyons le numéro d\'enregistrement et nous répondons à la mairie si elle demande une pièce, jusqu\'à sa réponse.' : 'Il ne vous reste qu\'à signer le formulaire et à le déposer en mairie, ou en ligne si votre commune le permet.'}${signature}`, CONF.mailA);
}

// GET /api/commande?ref=cs_... : page « Commande reçue »
async function etatCommande(req, res, url) {
  const sid = url.searchParams.get('ref') || '';
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) return repondre(res, 400, {erreur: 'Référence invalide.'});
  try {
    const s = await stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(sid));
    const m = s.metadata || {}, ref = REF_RE.test(m.ref || '') ? m.ref : reference(s.id), cmd = lireCmd(ref), u = cmd && C.lireUser(cmd.uid);
    const mail = (s.customer_details && s.customer_details.email) || s.customer_email || '';
    repondre(res, 200, {
      ref, paye: s.payment_status === 'paid', montant: (s.amount_total || 0) / 100,
      total: +m.total || (s.amount_total || 0) / 100, solde: m.acompte ? Math.round((+m.total - +m.acompte) * 100) / 100 : 0,
      projet: m.nom || (P[m.projet] ? P[m.projet].n : ''), adresse: m.adresse || '',
      email: mail.replace(/^(.).*(@.*)$/, '$1•••$2'), demandes: NEED[m.projet] || NEED.extension,
      enregistree: !!(cmd && cmd.paiements.acompte), compte: u ? {motDePasse: !!u.hash} : null, kind: m.kind || 'dp', delai: cmd ? delaiJours(cmd) : (m.kind === 'pc' ? 5 : 2),
      nbPieces: cmd ? cmd.pieces.filter(p => !p.facultatif).length : null, nbPhotos: cmd ? cmd.pieces.filter(p => !p.facultatif && p.type === 'photo').length : null, connecte: !!(u && (C.sessionClient(req) || {}).id === u.id),
      espace: `/espace/dossier/?ref=${ref}`
    });
  } catch (e) { repondre(res, 404, {erreur: 'Commande introuvable.'}); }
}

// ---------- accès à un dossier ----------
function cmdClient(req, res, url) {
  const u = C.sessionClient(req); if (!u) { repondre(res, 401, {erreur: 'Connectez-vous.'}); return null; }
  const cmd = lireCmd(url.searchParams.get('ref'));
  if (!cmd || cmd.uid !== u.id) { repondre(res, 404, {erreur: 'Dossier introuvable.'}); return null; }
  return cmd;
}
function cmdEquipe(req, res, url) {
  if (!C.sessionAdmin(req)) { repondre(res, 401, {erreur: 'Connexion équipe requise.'}); return null; }
  const cmd = lireCmd(url.searchParams.get('ref'));
  if (!cmd) { repondre(res, 404, {erreur: 'Dossier introuvable.'}); return null; }
  return cmd;
}
const modifiable = cmd => cmd.statut !== 'livre';

// ---------- actions du client ----------
async function clientTexte(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  const d = await lireJson(req, 30000); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const p = cmd.pieces.find(x => x.id === d.piece && x.type === 'texte'); if (!p) return repondre(res, 400, {erreur: 'Pièce inconnue.'});
  if (!modifiable(cmd)) return repondre(res, 409, {erreur: 'Dossier livré : écrivez-nous un message.'});
  p.texte = texteLong(d.texte); if (p.statut === 'a_refaire') { p.statut = null; p.motif = ''; }
  sauver(cmd); repondre(res, 200, {ok: true});
}
// « Je ne l'ai pas » : la pièce reste attendue mais ne bloque rien ; l'équipe la voit « On en reparle ».
async function clientPlusTard(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  const d = await lireJson(req, 2000); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const p = cmd.pieces.find(x => x.id === d.piece); if (!p) return repondre(res, 400, {erreur: 'Pièce inconnue.'});
  if (!modifiable(cmd)) return repondre(res, 409, {erreur: 'Dossier livré : écrivez-nous un message.'});
  p.plusTard = d.oui !== false;
  sauver(cmd); repondre(res, 200, vueCmd(cmd));
}
// Plan du projet (src/plan.js) : formes en longitude / latitude, mesures et résumé lisible.
const MODES_PLAN = ['rect', 'rects', 'accole', 'polygone', 'limites', 'point', 'facades', 'toit', 'batiment', 'parcelle'];
async function clientPlan(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  const d = await lireJson(req, 60000); if (!d || !d.plan || typeof d.plan !== 'object') return repondre(res, 400, {erreur: 'Plan illisible.'});
  const p = cmd.pieces.find(x => x.type === 'plan'); if (!p) return repondre(res, 400, {erreur: 'Pas de plan pour ce projet.'});
  if (!modifiable(cmd) || p.statut === 'valide') return repondre(res, 409, {erreur: 'Plan déjà validé : écrivez-nous pour le changer.'});
  const pl = d.plan, num = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e7) / 1e7 : null);
  const propre = v => Array.isArray(v) ? v.slice(0, 400).map(propre) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).slice(0, 40).filter(([k]) => /^[a-zA-Z]{1,20}$/.test(k)).map(([k, x]) => [k, propre(x)])) : typeof v === 'number' ? num(v) : typeof v === 'string' ? v.slice(0, 300) : typeof v === 'boolean' ? v : null;
  const plan = {v: 1, mode: MODES_PLAN.includes(pl.mode) ? pl.mode : p.mode, date: new Date().toISOString()};
  for (const k of ['formes', 'cotes', 'facades', 'bats', 'existants']) plan[k] = Array.isArray(pl[k]) ? propre(pl[k]) : [];
  plan.mesures = propre(pl.mesures && typeof pl.mesures === 'object' ? pl.mesures : {});
  plan.couche = pl.couche === 'ortho' ? 'ortho' : 'cadastre'; plan.marge = num(+pl.marge) || 12;
  if (pl.lieu && Number.isFinite(+pl.lieu.lon) && Number.isFinite(+pl.lieu.lat)) plan.lieu = {lon: num(+pl.lieu.lon), lat: num(+pl.lieu.lat)};
  if (JSON.stringify(plan).length > 50000) return repondre(res, 400, {erreur: 'Plan trop détaillé.'});
  p.plan = plan; p.texte = texteLong(d.resume || '').slice(0, 2000);
  if (!cmd.lieu && plan.lieu) cmd.lieu = plan.lieu;
  if (p.statut === 'a_refaire') { p.statut = null; p.motif = ''; }
  histo(cmd, 'Plan du projet enregistré par le client'); sauver(cmd);
  repondre(res, 200, vueCmd(cmd));
}
async function televerser(req, res, cmd, piece, par) {
  if (!modifiable(cmd) && par === 'client') { req.resume(); return repondre(res, 409, {erreur: 'Dossier livré : pour ajouter un document, écrivez-nous.'}); }
  const p = cmd.pieces.find(x => x.id === piece && x.type !== 'texte') || cmd.pieces.find(x => x.id === 'autre');
  if (!p) { req.resume(); return repondre(res, 400, {erreur: 'Pièce inconnue.'}); }
  const total = cmd.fichiers.reduce((s, f) => s + f.taille, 0);
  if (cmd.fichiers.length >= LIM.nb) { req.resume(); return repondre(res, 413, {erreur: `Maximum ${LIM.nb} fichiers. Écrivez-nous si vous avez besoin de plus.`}); }
  if (total + (+req.headers['content-length'] || 0) > LIM.total) { req.resume(); return repondre(res, 413, {erreur: 'Dossier complet : 500 Mo maximum.'}); }
  const fid = 'f' + B.id(7), nom = B.nomPropre(decodeURIComponent(req.headers['x-nom-fichier'] || 'fichier'));
  const r = await B.recevoirFichier(req, path.join(dDir(cmd.ref), 'fichiers'), fid, LIM.fichier, ['jpg', 'png', 'webp', 'heic', 'pdf']);
  if (r.erreur) return repondre(res, r.code, {erreur: r.erreur});
  const f = {id: fid, nom: nom.replace(/\.[A-Za-z0-9]{1,5}$/, '') + '.' + r.type, type: r.type, taille: r.taille, piece: p.id, date: new Date().toISOString(), par};
  // Version légère pour la liseuse (HEIC -> JPEG) et miniature.
  if (r.type !== 'pdf') f.vue = await B.preparerVue(r.fichier, path.join(dDir(cmd.ref), 'vues', fid + '.jpg'), path.join(dDir(cmd.ref), 'vues', fid + '-mini.jpg'));
  const frais = lireCmd(cmd.ref); // relire : d'autres envois ont pu arriver pendant celui-ci
  frais.fichiers.push(f);
  const fp = frais.pieces.find(x => x.id === p.id); if (fp.statut === 'a_refaire' && par === 'client') { fp.statut = null; fp.motif = ''; }
  sauver(frais);
  journal('fichier reçu', cmd.ref, p.id, r.type, r.taille);
  repondre(res, 200, {ok: true, fichier: fichierPublic(f)});
}
function clientFichier(req, res, url) {
  const u = C.sessionClient(req); const cmd = u && lireCmd(url.searchParams.get('ref'));
  if (!cmd || cmd.uid !== u.id) { req.resume(); return repondre(res, 404, {erreur: 'Dossier introuvable.'}); }
  return televerser(req, res, cmd, url.searchParams.get('piece'), 'client');
}
function clientSupprimerFichier(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  const f = cmd.fichiers.find(x => x.id === url.searchParams.get('id'));
  if (!f || f.par !== 'client') return repondre(res, 404, {erreur: 'Fichier introuvable.'});
  const p = cmd.pieces.find(x => x.id === f.piece);
  if (!modifiable(cmd) || (p && p.statut === 'valide')) return repondre(res, 409, {erreur: 'Cette pièce est déjà validée. Écrivez-nous pour la changer.'});
  cmd.fichiers = cmd.fichiers.filter(x => x !== f); sauver(cmd);
  for (const x of [path.join('fichiers', f.id + '.' + f.type), path.join('vues', f.id + '.jpg'), path.join('vues', f.id + '-mini.jpg')]) fs.rmSync(path.join(dDir(cmd.ref), x), {force: true});
  repondre(res, 200, {ok: true});
}
async function message(req, res, cmd, de) {
  const d = await lireJson(req, 30000); const t = d && texteLong(d.texte, 3000);
  if (!t) return repondre(res, 400, {erreur: 'Message vide.'});
  cmd.messages.push({de, texte: t, date: new Date().toISOString(), type: d.correction ? 'correction' : undefined});
  if (de === 'client' && d.correction && ['apercu', 'livre'].includes(cmd.statut)) { histo(cmd, cmd.statut === 'livre' ? 'Corrections demandées par le client, après le solde' : 'Corrections demandées par le client'); cmd.statut = 'corrections'; delete cmd.confirme; }
  sauver(cmd); repondre(res, 200, {ok: true, messages: cmd.messages});
  const u = C.lireUser(cmd.uid);
  if (de === 'client') await envoyerMail(CONF.mailA, `${d.correction ? 'Corrections demandées' : 'Message'} ${cmd.ref} : ${cmd.nom}`, `${cmd.email} a écrit :\n\n${t}\n\n${CONF.site}/admin/#${cmd.ref}\n`, cmd.email);
  else if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : nouveau message`, `Bonjour,\n\nNous vous avons écrit au sujet de votre dossier ${cmd.ref} :\n\n${t}\n\nRépondre et suivre votre dossier : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
}
async function clientMessage(req, res, url) { const cmd = cmdClient(req, res, url); if (cmd) return message(req, res, cmd, 'client'); }
async function clientTerminer(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (cmd.statut !== 'elements') return repondre(res, 200, {ok: true});
  if (!cmd.fichiers.length && !cmd.pieces.some(p => p.type === 'texte' && (p.texte || '').trim())) return repondre(res, 400, {erreur: 'Ajoutez au moins une photo ou une description avant de valider.'});
  cmd.statut = 'verification'; histo(cmd, 'Le client a envoyé ses éléments'); demarrerEcheance(cmd); sauver(cmd);
  repondre(res, 200, {ok: true});
  const r = recues(cmd);
  const manque = cmd.pieces.filter(p => !facultative(p, cmd) && etatPiece(p, cmd) === 'manquant').map(p => '- ' + p.nom);
  await envoyerMail(CONF.mailA, `À vérifier ${cmd.ref} : ${cmd.nom}`, `Le client a envoyé ses éléments (${r.n} pièces sur ${r.sur}, ${cmd.fichiers.length} fichiers).${manque.length ? `\n\nIl manque encore :\n${manque.join('\n')}\nÀ lui réclamer depuis le dossier (« à refaire ») seulement si c'est indispensable.` : ''}\n\n${CONF.site}/admin/#${cmd.ref}\n`, cmd.email);
}
async function clientValider(req, res, url) { // le client valide l'aperçu : paiement du solde
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (cmd.paiements.solde) return repondre(res, 409, {erreur: 'Le solde est déjà réglé.'});
  if (cmd.statut !== 'apercu') return repondre(res, 409, {erreur: 'Vos plans ne sont pas encore prêts à valider.'});
  // Dossier offert (code promo à 100 %) : pas de solde, le dossier est livré dès que le client valide ses plans.
  if (!(cmd.solde > 0)) {
    histo(cmd, 'Plans validés par le client'); sauver(cmd);
    try { await soldeRecu({amount_total: 0, id: null, payment_intent: null}, {ref: cmd.ref}); } catch (e) { journal('livraison gratuite', cmd.ref, e.message); }
    return repondre(res, 200, {url: `/espace/dossier/?ref=${cmd.ref}&paye=1`});
  }
  try {
    const s = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'payment', locale: 'fr', customer_email: cmd.email,
      success_url: `${CONF.site}/espace/dossier/?ref=${cmd.ref}&paye=1`, cancel_url: `${CONF.site}/espace/dossier/?ref=${cmd.ref}`,
      line_items: [{quantity: 1, price_data: {currency: 'eur', unit_amount: centimes(cmd.solde), product_data: {name: `Solde : ${cmd.nom}`.slice(0, 250), description: `Dossier ${cmd.ref}. Prix total ${euro(cmd.total)}, acompte de ${euro(cmd.acompte)} déjà réglé.`}}}],
      metadata: {type: 'solde', ref: cmd.ref}, payment_intent_data: {description: `Solde ${cmd.ref} ${cmd.nom}`.slice(0, 1000), metadata: {type: 'solde', ref: cmd.ref}}
    });
    histo(cmd, 'Plans validés par le client, paiement du solde ouvert'); sauver(cmd);
    repondre(res, 200, {url: s.url});
  } catch (e) { journal('erreur Stripe :', e.message); repondre(res, 502, {erreur: 'Le paiement n\'a pas pu s\'ouvrir.'}); }
}
function clientDossier(req, res, url) { const cmd = cmdClient(req, res, url); if (cmd) repondre(res, 200, vueCmd(cmd, false)); }

// Affichage des fichiers (client propriétaire ou équipe)
function voirFichier(res, cmd, fid, taille) {
  const f = cmd.fichiers.find(x => x.id === fid); if (!f) return repondre(res, 404, {erreur: 'Fichier introuvable.'});
  const d = dDir(cmd.ref);
  if (taille !== 'original' && f.vue) return envoyerFichier(res, path.join(d, 'vues', f.id + (taille === 'mini' ? '-mini' : '') + '.jpg'), 'image/jpeg');
  return envoyerFichier(res, path.join(d, 'fichiers', f.id + '.' + f.type), TYPES[f.type], taille === 'original' ? f.nom : null);
}
// Pièces de texte (formulaire, notice) : faciles à recopier, donc jamais montrées au client avant la livraison.
const RESERVEES = ['CERFA', 'NOTICE'];
const reservee = (cmd, l) => RESERVEES.includes(l.code) && !(cmd.paiements && cmd.paiements.solde);
function voirApercu(res, cmd, lid, n, client) {
  const l = cmd.livrables.find(x => x.id === lid);
  if (l && client && reservee(cmd, l)) return repondre(res, 403, {erreur: 'Cette pièce est remise avec le dossier complet.'});
  if (l && !client && n >= 1 && n <= l.pages) { const net = path.join(dDir(cmd.ref), 'apercu', `${l.id}-e${n}.jpg`); if (fs.existsSync(net)) return envoyerFichier(res, net, 'image/jpeg'); } if (!l || !(n >= 1 && n <= l.pages)) return repondre(res, 404, {erreur: 'Page introuvable.'});
  return envoyerFichier(res, path.join(dDir(cmd.ref), 'apercu', `${l.id}-${n}.jpg`), 'image/jpeg');
}
function clientVoir(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (url.searchParams.get('l')) return voirApercu(res, cmd, url.searchParams.get('l'), +url.searchParams.get('n'), true);
  return voirFichier(res, cmd, url.searchParams.get('id'), url.searchParams.get('taille'));
}
function livrablesZip(res, cmd) {
  B.envoyerZip(res, `${cmd.ref}-dossier.zip`, cmd.livrables.map((l, i) => ({nom: `${String(i + 1).padStart(2, '0')}-${B.nomPropre(l.code + '-' + l.nom)}.pdf`, data: fs.readFileSync(path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'))})));
}
// POST /api/espace/dossier/confirmer?ref= : après le solde, le client a relu ses plans et dit que tout est bon.
function clientConfirmer(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (cmd.statut !== 'livre') return repondre(res, 409, {erreur: 'Votre dossier n\'est pas encore livré.'});
  if (!cmd.confirme) { cmd.confirme = new Date().toISOString(); histo(cmd, 'Le client a relu son dossier : tout est bon'); sauver(cmd); }
  repondre(res, 200, vueCmd(cmd, false));
}
function clientTelecharger(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (!cmd.paiements.solde) return repondre(res, 402, {erreur: 'Le téléchargement s\'ouvre après le paiement du solde.'});
  const lid = url.searchParams.get('id');
  if (!lid) return livrablesZip(res, cmd);
  const l = cmd.livrables.find(x => x.id === lid); if (!l) return repondre(res, 404, {erreur: 'Document introuvable.'});
  return envoyerFichier(res, path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'), 'application/pdf', `${cmd.ref}-${B.nomPropre(l.code + '-' + l.nom)}.pdf`);
}

// ---------- équipe ----------
function equipeListe(req, res) {
  if (!C.sessionAdmin(req)) return repondre(res, 401, {erreur: 'Connexion équipe requise.'});
  const cmds = B.liste('commandes').filter(f => /^BP-\w{6}\.json$/.test(f)).map(f => lireCmd(f.slice(0, -5))).filter(Boolean)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const tous = cmds.map(resume), L = tous.filter(x => !x.archive && x.statut !== 'brouillon'), mois = new Date().toISOString().slice(0, 7);
  const rappels = B.liste('rappels').filter(f => f.endsWith('.json')).length;
  repondre(res, 200, {dossiers: tous, rappels, mailsEchec: B.mailsEnEchec(), relancesAuto: !!(B.lire('reglages.json') || {}).relancesAuto, compteurs: {
    actifs: L.length, nonPayes: tous.filter(x => !x.archive && x.statut === 'brouillon').length, archives: tous.filter(x => x.archive).length,
    attente: L.filter(x => x.statut === 'elements').length, verifier: L.filter(x => ['verification', 'corrections'].includes(x.statut)).length,
    preparation: L.filter(x => x.statut === 'preparation').length, retard: L.filter(x => x.retard).length,
    livres: cmds.filter(c => !c.archive && c.statut === 'livre' && (c.paiements.solde.date || '').startsWith(mois)).length}});
}
function equipeDossier(req, res, url) { const cmd = cmdEquipe(req, res, url); if (cmd) repondre(res, 200, {...vueCmd(cmd, true), outils: {images: !!B.OUTILS.magick, pdf: !!B.OUTILS.pdftoppm}}); }
function equipeVoir(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (url.searchParams.get('l')) return voirApercu(res, cmd, url.searchParams.get('l'), +url.searchParams.get('n'));
  if (url.searchParams.get('livrable')) { const l = cmd.livrables.find(x => x.id === url.searchParams.get('livrable')); if (!l) return repondre(res, 404, {}); return envoyerFichier(res, path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'), 'application/pdf'); }
  return voirFichier(res, cmd, url.searchParams.get('id'), url.searchParams.get('taille'));
}
// Une pièce demandée ou à refaire remet le dossier en attente du client. Si les plans étaient lancés,
// l'échéance est suspendue : elle repart quand l'équipe relance, une fois la pièce reçue.
function attendreClient(cmd) {
  if (['verification', 'preparation'].includes(cmd.statut) && cmd.echeance) { cmd.echeance = null; histo(cmd, 'Délai suspendu : pièce demandée au client'); }
  if (['verification', 'preparation'].includes(cmd.statut)) cmd.statut = 'elements';
}
async function equipePiece(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  if (d.ajouter) {
    const nom = texte(d.nom, 80); if (!nom) return repondre(res, 400, {erreur: 'Donnez un nom à la pièce.'});
    const p = {id: 'p' + B.id(4), nom, aide: texte(d.aide, 300), type: d.type === 'texte' ? 'texte' : 'fichier', ajoutee: true};
    cmd.pieces.splice(cmd.pieces.findIndex(x => x.id === 'autre'), 0, p); histo(cmd, `Pièce demandée : ${nom}${p.type === 'texte' ? ' (réponse écrite)' : ''}`);
    attendreClient(cmd);
    sauver(cmd);
    repondre(res, 200, vueCmd(cmd, true));
    const u = C.lireUser(cmd.uid);
    // prevenir: false : plusieurs demandes d'affilée, puis un seul message au client.
    if (u && d.prevenir !== false) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : un document de plus`, `Bonjour,\n\nPour votre dossier, il nous faut aussi : ${nom}${p.aide ? ' (' + p.aide + ')' : ''}.\n\nL'ajouter depuis votre espace : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
    return;
  }
  const p = cmd.pieces.find(x => x.id === d.piece); if (!p) return repondre(res, 400, {erreur: 'Pièce inconnue.'});
  if (d.supprimer) {
    if (!p.ajoutee || cmd.fichiers.some(f => f.piece === p.id)) return repondre(res, 409, {erreur: 'On ne supprime qu\'une pièce ajoutée et vide.'});
    cmd.pieces = cmd.pieces.filter(x => x !== p); sauver(cmd); return repondre(res, 200, vueCmd(cmd, true));
  }
  if (typeof d.facultatif === 'boolean') { p.facultatif = d.facultatif; sauver(cmd); return repondre(res, 200, vueCmd(cmd, true)); }
  if (!['valide', 'a_refaire', 'attente'].includes(d.statut)) return repondre(res, 400, {erreur: 'Statut inconnu.'});
  p.statut = d.statut === 'attente' ? null : d.statut; p.motif = d.statut === 'a_refaire' ? texte(d.motif, 400) : '';
  if (d.statut === 'a_refaire' && !p.motif) return repondre(res, 400, {erreur: 'Indiquez ce qu\'il faut refaire : le client le lira.'});
  histo(cmd, `${p.nom} : ${d.statut === 'valide' ? 'validé' : d.statut === 'a_refaire' ? 'à refaire' : 'remis en attente'}`);
  if (d.statut === 'a_refaire') attendreClient(cmd);
  sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid);
  if (d.statut === 'a_refaire' && u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : une pièce à refaire`, `Bonjour,\n\n« ${p.nom} » : ${p.motif}\n\nL'envoyer de nouveau depuis votre espace : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
}
// Changement de type de dossier ou de prix (ex. une déclaration qui devient un permis après les mesures du client).
// Possible tant que le solde n'est pas payé. Le solde est recalculé : prix total moins l'acompte déjà payé.
const KINDS = {dp: 'Déclaration préalable', pc: 'Permis de construire', pd: 'Permis de démolir', svc: 'Service'};
// Renvoie {erreur} ou {texte} (phrase pour le client). Ne sauve pas et n'envoie rien.
function changerCommande(cmd, kindVoulu, totalVoulu, motifBrut) {
  if (cmd.paiements.solde) return {erreur: 'Le solde est déjà payé : la commande ne change plus.'};
  const kind = KINDS[kindVoulu] ? kindVoulu : cmd.kind, total = Math.round(+totalVoulu * 100) / 100, motif = texte(motifBrut, 300);
  const paye = cmd.paiements.acompte ? cmd.paiements.acompte.montant : 0;
  if (!Number.isFinite(total) || total < paye || total > 20000) return {erreur: `Prix invalide : au moins ${euro(paye)} (acompte déjà payé).`};
  if (!motif) return {erreur: 'Indiquez la raison : le client la lira.'};
  if (kind === cmd.kind && total === cmd.total) return {erreur: 'Rien ne change.'};
  const avant = {kind: cmd.kind, total: cmd.total}, ecart = Math.round((total - cmd.total) * 100) / 100;
  cmd.kind = kind; cmd.total = total; cmd.solde = Math.round((total - paye) * 100) / 100;
  if (ecart) cmd.lignes = [...(cmd.lignes || [[cmd.nom, avant.total]]), [`Ajustement : ${motif}`, ecart]];
  // Le délai suit le type de dossier ; une échéance déjà lancée est recalculée depuis aujourd'hui.
  if (cmd.echeance && avant.kind !== kind) { const e = B.a19hParis(B.plusJoursOuvres(new Date(), delaiJours(cmd))); cmd.echeance = e.toISOString(); }
  histo(cmd, `Commande modifiée : ${KINDS[avant.kind] || avant.kind} ${euro(avant.total)} -> ${KINDS[kind]} ${euro(total)} (${motif})`);
  return {texte: `${avant.kind !== kind ? `Votre projet relève d'un${kind === 'pc' || kind === 'pd' ? '' : 'e'} ${KINDS[kind].toLowerCase()}. ` : ''}${motif}\nNouveau prix : ${euro(total)}. Déjà réglé : ${euro(paye)}. Reste à régler après l'aperçu des plans : ${euro(cmd.solde)}.`};
}
async function equipeCommande(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const d = await lireJson(req, 5000) || {};
  const r = changerCommande(cmd, d.kind, d.total, d.motif); if (r.erreur) return repondre(res, r.erreur.startsWith('Le solde') ? 409 : 400, r);
  if (d.prevenir !== false) cmd.messages.push({de: 'equipe', texte: r.texte, date: new Date().toISOString()});
  sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid);
  if (u && d.prevenir !== false) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : votre commande change`, `Bonjour,\n\n${r.texte}\n\nUne question ? Répondez depuis votre dossier : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
}

// ---------- analyse du dossier (faite par Claude depuis l'app, relue par l'équipe) ----------
// Circuit : l'équipe dit « nouveau dossier » à Claude -> GET /api/admin/brief (tout le dossier en un appel)
// -> Claude analyse et enregistre (POST /api/admin/analyse) -> l'équipe relit dans l'admin et clique
// « Appliquer » (POST /api/admin/appliquer) : pièces demandées, pièces à refaire, commande corrigée, UN message au client.
const dernierClient = cmd => [...cmd.fichiers.filter(f => f.par === 'client').map(f => f.date), ...cmd.messages.filter(m => m.de === 'client').map(m => m.date),
  ...cmd.historique.filter(h => /client/i.test(h.texte) && !/demandée au client/i.test(h.texte)).map(h => h.date)].filter(Boolean).sort().pop() || cmd.date;
// Pourquoi un dossier attend Claude (null : rien à faire).
function aFaire(cmd) {
  if (!cmd.paiements.acompte || cmd.statut === 'livre' || cmd.statut === 'brouillon') return null;
  const an = cmd.analyse;
  if (cmd.statut === 'corrections') return 'Corrections demandées par le client';
  if (!an) return cmd.statut === 'elements' ? null : 'Nouveau dossier à analyser';
  if (!an.appliquee) return null; // analyse faite, l'équipe doit la relire
  if (dernierClient(cmd) > an.date && cmd.statut !== 'elements') return 'Le client a répondu : analyse à reprendre';
  if (cmd.statut === 'preparation' && !cmd.livrables.length) return 'Plans à produire';
  return null;
}
function fichePlu(t) {
  if (!t || !t.zone || !t.zone.document) return null;
  const part = 'DU_' + String(t.zone.document).split('_')[0].replace(/\W/g, ''), zone = String(t.zone.libelle || '').replace(/[^\w.-]/g, '');
  try { return JSON.parse(fs.readFileSync(path.join(B.RACINE, 'src', 'plu', part, zone + '.json'), 'utf8')); } catch { return null; }
}
async function equipeBrief(req, res, url) {
  if (!C.sessionAdmin(req)) return repondre(res, 401, {erreur: 'Connexion équipe requise.'});
  const ref = url.searchParams.get('ref');
  if (!ref) {
    const L = B.liste('commandes').filter(f => /^BP-\w{6}\.json$/.test(f)).map(f => lireCmd(f.slice(0, -5))).filter(Boolean)
      .map(c => ({ref: c.ref, nom: c.nom, client: c.nom_client || c.email, adresse: c.adresse, statut: c.statut, echeance: c.echeance || null, raison: aFaire(c), aRelire: !!(c.analyse && !c.analyse.appliquee)}));
    return repondre(res, 200, {aFaire: L.filter(x => x.raison), aRelireParEquipe: L.filter(x => x.aRelire).map(x => x.ref)});
  }
  const cmd = lireCmd(ref); if (!cmd) return repondre(res, 404, {erreur: 'Dossier introuvable.'});
  const d = vueCmd(cmd, true);
  let t = null; if (cmd.lieu) { try { t = await require('./terrain').lireTerrain(+cmd.lieu.lon, +cmd.lieu.lat); } catch (e) { journal('brief terrain', e.message); } }
  const fiche = fichePlu(t);
  let reglement = null;
  if (t && t.zone && t.zone.reglement && fiche && fiche.document) reglement = `/api/terrain/reglement?doc=${fiche.document.gpu_doc_id}&part=${fiche.document.partition}&fic=${encodeURIComponent(fiche.document.fichier)}&de=1&a=40`;
  repondre(res, 200, {
    raison: aFaire(cmd), dossier: d, terrain: t, fichePlu: fiche, reglement,
    controles: CONTROLES(d, t, t ? fiche : undefined),
    fichiers: cmd.fichiers.map(f => ({...fichierPublic(f), voir: `/api/admin/voir?ref=${cmd.ref}&id=${f.id}`})),
    analyse: cmd.analyse || null, dernierClient: dernierClient(cmd),
    modeEmploi: 'Enregistrer l\'analyse : POST /api/admin/analyse?ref= {dossier:{kind,total,motif}, resume, points:[{niveau:bloquant|attention|ok, texte, source}], demandes:[{nom, aide, type:texte|fichier}], refaire:[{piece, motif}], message}. Rien ne part au client : l\'équipe relit et applique.'
  });
}
const NIVEAUX = ['bloquant', 'attention', 'ok'];
async function equipeAnalyse(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const d = await lireJson(req, 40000); if (!d || typeof d !== 'object') return repondre(res, 400, {erreur: 'Analyse illisible.'});
  const liste = (x, n) => (Array.isArray(x) ? x : []).slice(0, n);
  const an = {
    date: new Date().toISOString(), par: texte(d.par, 40) || 'Claude', resume: texteLong(d.resume, 1500),
    dossier: d.dossier && KINDS[d.dossier.kind] ? {kind: d.dossier.kind, total: Number.isFinite(+d.dossier.total) && +d.dossier.total > 0 ? Math.round(+d.dossier.total * 100) / 100 : null, motif: texte(d.dossier.motif, 300)} : null,
    points: liste(d.points, 30).map(p => ({niveau: NIVEAUX.includes(p && p.niveau) ? p.niveau : 'attention', texte: texteLong(p && p.texte, 600), source: texte(p && p.source, 200)})).filter(p => p.texte),
    demandes: liste(d.demandes, 12).map(p => ({nom: texte(p && p.nom, 80), aide: texte(p && p.aide, 300), type: p && p.type === 'fichier' ? 'fichier' : 'texte'})).filter(p => p.nom),
    refaire: liste(d.refaire, 12).map(p => ({piece: texte(p && p.piece, 60), motif: texte(p && p.motif, 400)})).filter(p => p.motif && cmd.pieces.some(x => x.id === p.piece)),
    message: texteLong(d.message, 3000), appliquee: null
  };
  if (!an.resume && !an.points.length) return repondre(res, 400, {erreur: 'Analyse vide.'});
  cmd.analyse = an; histo(cmd, `Analyse enregistrée par ${an.par} : ${an.points.filter(p => p.niveau === 'bloquant').length} point(s) bloquant(s), ${an.demandes.length + an.refaire.length} demande(s) au client`);
  sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
}
// L'équipe a relu : on applique tout d'un coup et le client reçoit un seul message.
async function equipeAppliquer(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const an = cmd.analyse; if (!an) return repondre(res, 409, {erreur: 'Pas d\'analyse sur ce dossier.'});
  if (an.appliquee) return repondre(res, 409, {erreur: 'Analyse déjà appliquée.'});
  const d = await lireJson(req, 10000) || {}, msg = d.message != null ? texteLong(d.message, 3000) : an.message;
  let phrase = '';
  if (d.commande !== false && an.dossier && (an.dossier.kind !== cmd.kind || (an.dossier.total && an.dossier.total !== cmd.total))) {
    const r = changerCommande(cmd, an.dossier.kind, an.dossier.total || cmd.total, an.dossier.motif || 'Après vérification de votre projet.'); if (r.erreur) return repondre(res, 400, r);
    phrase = r.texte;
  }
  for (const q of an.demandes) {
    if (cmd.pieces.some(x => x.nom === q.nom)) continue;
    cmd.pieces.splice(cmd.pieces.findIndex(x => x.id === 'autre'), 0, {id: 'p' + B.id(4), nom: q.nom, aide: q.aide, type: q.type, ajoutee: true});
  }
  for (const r of an.refaire) { const p = cmd.pieces.find(x => x.id === r.piece); if (p) { p.statut = 'a_refaire'; p.motif = r.motif; } }
  const attend = an.demandes.length + an.refaire.length > 0;
  if (attend) attendreClient(cmd);
  const txt = [msg, phrase].filter(Boolean).join('\n\n');
  if (txt) cmd.messages.push({de: 'equipe', texte: txt, date: new Date().toISOString()});
  an.appliquee = new Date().toISOString();
  histo(cmd, `Analyse appliquée${attend ? ` : ${an.demandes.length + an.refaire.length} demande(s) au client` : ''}${txt ? ', message envoyé' : ''}`);
  sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid);
  if (u && txt) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : ${attend ? 'il nous manque quelques éléments' : 'nouveau message'}`, `Bonjour,\n\n${txt}\n\n${attend ? 'Répondre' : 'Suivre votre dossier'} depuis votre espace : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
}
async function equipeClasser(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const d = await lireJson(req); const f = d && cmd.fichiers.find(x => x.id === d.fichier), p = d && cmd.pieces.find(x => x.id === d.piece && x.type !== 'texte');
  if (!f || !p) return repondre(res, 400, {erreur: 'Fichier ou pièce inconnus.'});
  f.piece = p.id; sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
}
function equipeFichier(req, res, url) {
  if (!C.sessionAdmin(req)) { req.resume(); return repondre(res, 401, {erreur: 'Connexion équipe requise.'}); }
  const cmd = lireCmd(url.searchParams.get('ref')); if (!cmd) { req.resume(); return repondre(res, 404, {}); }
  return televerser(req, res, cmd, url.searchParams.get('piece'), 'equipe');
}
// POST /api/admin/archiver?ref= {archive: true|false} : sort un dossier de la liste (tests, abandons) sans rien supprimer.
async function equipeArchiver(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const d = await lireJson(req) || {};
  cmd.archive = !!d.archive; histo(cmd, cmd.archive ? 'Dossier archivé par l\'équipe' : 'Dossier sorti des archives'); sauver(cmd);
  repondre(res, 200, vueCmd(cmd, true));
}
async function equipeMessage(req, res, url) { const cmd = cmdEquipe(req, res, url); if (cmd) return message(req, res, cmd, 'equipe'); }
async function equipeLancer(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (!['elements', 'verification'].includes(cmd.statut)) return repondre(res, 409, {erreur: 'Le dossier est déjà lancé.'});
  // L'échéance déjà démarrée à la réception des pièces est gardée : c'est celle promise au client.
  let ech = cmd.echeance ? new Date(cmd.echeance) : null;
  if (!ech || ech < new Date()) { ech = B.a19hParis(B.plusJoursOuvres(new Date(), delaiJours(cmd))); }
  cmd.statut = 'preparation'; cmd.echeance = ech.toISOString();
  for (const p of cmd.pieces) if (etatPiece(p, cmd) === 'a_verifier') p.statut = 'valide';
  histo(cmd, 'Pièces complètes : plans en préparation'); sauver(cmd);
  repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid);
  if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : c'est parti`, `Bonjour,\n\nNous avons tout ce qu'il faut. Vos plans sont en préparation : vous serez prévenu dès que le dossier est prêt, au plus tard le ${ech.toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris'})}.\n\nSuivre votre dossier : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
}
// Dépôt fait par l'équipe (option « depot ») : on note la date, le numéro d'enregistrement et le guichet, et on prévient le client.
async function equipeDepot(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (!aDepot(cmd.options)) return repondre(res, 409, {erreur: 'Ce client n\'a pas pris l\'option dépôt.'});
  const d = await lireJson(req, 5000) || {}, numero = texte(d.numero, 60), guichet = texte(d.guichet, 200);
  if (!numero) return repondre(res, 400, {erreur: 'Indiquez le numéro d\'enregistrement donné par la mairie.'});
  cmd.depot = {date: new Date().toISOString(), numero, guichet};
  histo(cmd, 'Dossier déposé en mairie, numéro ' + numero); sauver(cmd);
  repondre(res, 200, vueCmd(cmd, true));
  const delai = cmd.kind === 'pc' ? 'deux mois' : 'un mois';
  await envoyerMail(cmd.email, `Dossier ${cmd.ref} : déposé en mairie`, `Bonjour,\n\nVotre dossier « ${cmd.nom} » est déposé auprès de votre mairie.\nNuméro d'enregistrement : ${numero}\n\nLa mairie a en général ${delai} pour répondre. Ce délai est plus long dans un secteur protégé, et elle peut demander une pièce de plus pendant le premier mois : dans ce cas, nous nous en occupons et nous vous prévenons.\n\nSi vous recevez un courrier ou un e-mail de la mairie, transférez-le-nous : nous vous dirons quoi faire.\n\nSuivre votre dossier : ${CONF.site}/espace/dossier/?ref=${cmd.ref}${signature}`, CONF.mailA);
}
async function equipeLivrable(req, res, url) {
  if (!C.sessionAdmin(req)) { req.resume(); return repondre(res, 401, {erreur: 'Connexion équipe requise.'}); }
  const cmd = lireCmd(url.searchParams.get('ref')); if (!cmd) { req.resume(); return repondre(res, 404, {}); }
  const lid = 'l' + B.id(6), code = texte(url.searchParams.get('code'), 12).toUpperCase() || 'PIECE', nom = texte(decodeURIComponent(url.searchParams.get('nom') || ''), 80) || code;
  const r = await B.recevoirFichier(req, path.join(dDir(cmd.ref), 'livrables'), lid, LIM.livrable, ['pdf']);
  if (r.erreur) return repondre(res, r.code, {erreur: r.erreur});
  const a = await B.apercuPdf(r.fichier, path.join(dDir(cmd.ref), 'apercu'), lid);
  const frais = lireCmd(cmd.ref);
  frais.livrables.push({id: lid, code, nom, pages: a.pages, taille: r.taille, date: new Date().toISOString()});
  frais.livrables.sort((x, y) => x.code.localeCompare(y.code, 'fr', {numeric: true}));
  sauver(frais);
  repondre(res, 200, {...vueCmd(frais, true), avertissement: a.erreur ? `Aperçu non généré (${a.erreur}). Le client verra la liste des pièces sans image.` : null});
}
// Fabrication des pièces sur le serveur (gen/run.py). Claude envoie ses décisions (projet, notice, Cerfa : du texte),
// le serveur dessine avec les photos du client qu'il a déjà, puis range les PDF dans « Pièces à livrer ».
// Les pièces fabriquées remplacent les précédentes pièces fabriquées ; un PDF déposé à la main n'est jamais touché.
const GEN = path.join(B.RACINE, 'gen');
const lancerPython = (args, ms) => new Promise(ok => require('child_process').execFile('python3', args, {timeout: ms, maxBuffer: 4e6}, (e, so, se) => ok({e, so: String(so || ''), se: String(se || '')})));
async function equipeGenerer(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (cmd.statut === 'livre') return repondre(res, 409, {erreur: 'Dossier déjà livré.'});
  const d = await lireJson(req, 200000); if (!d || !d.projet || !d.notice || !d.cerfa) return repondre(res, 400, {erreur: 'Il faut projet, notice et cerfa.'});
  const t0 = await lancerPython(['-c', 'import matplotlib, shapely, reportlab, pypdf, PIL'], 30000);
  if (t0.e) return repondre(res, 503, {erreur: 'Le générateur de planches n\'est pas installé sur le serveur (image à reconstruire).', detail: t0.se.slice(-400)});
  const job = path.join(dDir(cmd.ref), 'gen'); fs.mkdirSync(path.join(job, 'images'), {recursive: true}); fs.rmSync(path.join(job, 'sortie'), {recursive: true, force: true});
  for (const [nom, fid] of Object.entries(d.photos || {})) {
    const f = cmd.fichiers.find(x => x.id === fid), cible = path.join(job, 'images', path.basename(String(nom)));
    if (!f || !/^[\w.-]+\.(jpe?g|png)$/i.test(path.basename(String(nom)))) return repondre(res, 400, {erreur: `Photo inconnue : ${nom}`});
    // Photo HEIC : on prend la vue JPEG préparée par le serveur.
    fs.copyFileSync(['jpg', 'jpeg', 'png'].includes(f.type) ? path.join(dDir(cmd.ref), 'fichiers', f.id + '.' + f.type) : path.join(dDir(cmd.ref), 'vues', f.id + '.jpg'), cible);
  }
  if (!cmd.lieu) return repondre(res, 400, {erreur: 'Dossier sans point sur la carte : pas de fiche terrain.'});
  const t = await require('./terrain').lireTerrain(+cmd.lieu.lon, +cmd.lieu.lat);
  if (!t || !t.parcelle) return repondre(res, 502, {erreur: 'Fiche terrain indisponible (cadastre).'});
  for (const [nom, v] of [['terrain.json', t], ['projet.json', d.projet], ['notice.json', d.notice], ['cerfa.json', d.cerfa]]) fs.writeFileSync(path.join(job, nom), JSON.stringify(v));
  const r = await lancerPython([path.join(GEN, 'run.py'), job], 240000);
  let sortie = null; try { sortie = JSON.parse(r.so.trim().split('\n').pop()); } catch {}
  if (r.e || !sortie || !sortie.pieces.length) { journal('generer', cmd.ref, r.se.slice(-600)); return repondre(res, 500, {erreur: 'La fabrication des planches a échoué.', detail: (r.se || r.so).slice(-1200)}); }
  const frais = lireCmd(cmd.ref);
  for (const l of frais.livrables.filter(x => x.auto)) {
    fs.rmSync(path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'), {force: true});
    for (let n = 1; n <= l.pages; n++) for (const s of ['', 'e']) fs.rmSync(path.join(dDir(cmd.ref), 'apercu', `${l.id}-${s}${n}.jpg`), {force: true});
  }
  frais.livrables = frais.livrables.filter(x => !x.auto);
  fs.mkdirSync(path.join(dDir(cmd.ref), 'livrables'), {recursive: true});
  for (const p of sortie.pieces) {
    const lid = 'l' + B.id(6), dest = path.join(dDir(cmd.ref), 'livrables', lid + '.pdf');
    fs.copyFileSync(p.fichier, dest);
    const a = await B.apercuPdf(dest, path.join(dDir(cmd.ref), 'apercu'), lid);
    frais.livrables.push({id: lid, code: p.code, nom: p.nom, pages: a.pages, taille: fs.statSync(dest).size, date: new Date().toISOString(), auto: true});
  }
  frais.livrables.sort((x, y) => x.code.localeCompare(y.code, 'fr', {numeric: true}));
  histo(frais, `Pièces fabriquées : ${sortie.pieces.map(p => p.code).join(', ')}`);
  sauver(frais); repondre(res, 200, {...vueCmd(frais, true), chiffres: sortie.chiffres});
}
async function equipeSupprimerLivrable(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (cmd.paiements.solde && cmd.statut === 'livre') return repondre(res, 409, {erreur: 'Dossier déjà livré.'});
  const l = cmd.livrables.find(x => x.id === url.searchParams.get('id')); if (!l) return repondre(res, 404, {});
  cmd.livrables = cmd.livrables.filter(x => x !== l); sauver(cmd);
  fs.rmSync(path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'), {force: true});
  for (let n = 1; n <= l.pages; n++) for (const s of ['', 'e']) fs.rmSync(path.join(dDir(cmd.ref), 'apercu', `${l.id}-${s}${n}.jpg`), {force: true});
  repondre(res, 200, vueCmd(cmd, true));
}
async function equipeEnvoyerApercu(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (!cmd.livrables.length) return repondre(res, 400, {erreur: 'Déposez d\'abord les PDF du dossier.'});
  if (cmd.statut === 'livre') return repondre(res, 409, {erreur: 'Dossier déjà livré.'});
  const d = await lireJson(req) || {};
  // Solde déjà réglé (corrections demandées après la livraison) : la version corrigée est remise tout de suite.
  const regle = !!cmd.paiements.solde;
  cmd.statut = regle ? 'livre' : 'apercu'; histo(cmd, regle ? 'Version corrigée remise au client' : 'Dossier prêt : aperçu envoyé au client');
  if (texteLong(d.texte, 3000)) cmd.messages.push({de: 'equipe', texte: texteLong(d.texte, 3000), date: new Date().toISOString()});
  sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid), lien = u ? C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref) : '';
  if (u && regle) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : la version corrigée est prête`, `Bonjour,\n\nVos corrections sont faites. Le dossier à jour est à télécharger dans votre espace :\n${lien}\n\nRelisez-le, et dites-nous si tout est bon.${signature}`, CONF.mailA);
  else if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : votre dossier est prêt`, `Bonjour,\n\nVotre dossier est prêt. Un aperçu de chaque plan vous attend dans votre espace :\n${lien}\n\nCet aperçu est volontairement en basse qualité, avec un filigrane : il montre que le dossier est fait, les cotes ne s'y lisent pas.\n${cmd.solde > 0 ? `Réglez le solde de ${euro(cmd.solde)} pour recevoir tous vos plans en pleine qualité, avec le formulaire rempli.` : 'Validez-le pour recevoir tous vos plans en pleine qualité, avec le formulaire rempli.'}\nVous les relisez ensuite tranquillement : si quelque chose ne va pas, on corrige, c'est compris dans le prix.${signature}`, CONF.mailA);
}
function equipeZip(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const d = dDir(cmd.ref), txt = cmd.pieces.filter(p => p.type === 'texte' || p.type === 'plan').map(p => `${p.nom} :\n${p.texte || '(rien)'}\n`).join('\n');
  const fiche = Buffer.from(`Dossier ${cmd.ref}\nProjet : ${cmd.nom}\nAdresse des travaux : ${cmd.adresse}\nClient : ${cmd.nom_client || ''} <${cmd.email}>\nPrix : ${euro(cmd.total)} (acompte ${euro(cmd.acompte)})\nOptions : ${cmd.options}\nRéponses : ${cmd.reponses}\n\n${txt}\nMessages :\n${cmd.messages.map(m => `[${m.date.slice(0, 16)}] ${m.de} : ${m.texte}`).join('\n')}\n`, 'utf8');
  const ent = [{nom: cmd.ref + '-fiche.txt', data: fiche}];
  for (const f of cmd.fichiers) { try { ent.push({nom: `${f.piece}/${f.id.slice(1, 5)}-${f.nom}`, data: fs.readFileSync(path.join(d, 'fichiers', f.id + '.' + f.type))}); } catch {} }
  B.envoyerZip(res, cmd.ref + '.zip', ent);
}

module.exports = {
  verifierPromo, creerDossier, payerDossier,
  REF_RE, lireCmd, sauver, vueCmd, commande, etatCommande, paiementRecu, enregistrerProjet, supprimerProjet, commanderProjet, espace,
  clientDossier, clientTexte, clientPlusTard, clientPlan, clientFichier, clientSupprimerFichier, clientMessage, clientConfirmer, clientTerminer, clientValider, clientVoir, clientTelecharger,
  equipeListe, equipeArchiver, equipeDossier, equipeVoir, equipePiece, equipeCommande, equipeBrief, equipeAnalyse, equipeAppliquer, equipeGenerer, equipeClasser, equipeFichier, equipeMessage, equipeLancer, equipeDepot, equipeLivrable,
  equipeSupprimerLivrable, equipeEnvoyerApercu, equipeZip, analyser, partAcompte, piecesInitiales, listePieces
};
