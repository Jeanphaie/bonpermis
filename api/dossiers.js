'use strict';
/* Vie d'une commande, de la simulation à la livraison.
   simulation (compte) -> acompte 30 % payé -> elements (le client envoie pièces et textes) -> verification
   -> preparation (l'équipe dessine, échéance calculée) -> apercu (plans en filigrane) <-> corrections
   -> solde payé -> livre (téléchargement des PDF). */

const B = require('./base');
const C = require('./comptes');
const PROMOS = require('./promos');
const {fs, path, CONF, P, NEED, PIECES, PAGES, PRIX, lire, ecrire, creer, repondre, lireJson, texte, texteLong, MAIL_RE, journal, euro, envoyerMail, signature, stripe, reference, envoyerFichier, TYPES} = B;

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
function piecesInitiales(kind, p, ctx) {
  const nd = NEED[p] || NEED.extension, c = ctx || {};
  const autre = {id: 'autre', nom: 'Autres documents', type: 'fichier', facultatif: true, aide: 'Tout ce qui peut nous aider : croquis, devis, inspiration…'};
  const liste = PIECES && PIECES.projets[p];
  if (liste) {
    let a = {}; try { a = JSON.parse(c.reponses || '{}'); } catch {}
    const copie = l => (l || []).map(x => Object.assign({}, x));
    const commun = !PIECES.sansCommun.includes(p), cm = PIECES.commun.debut ? PIECES.commun : {debut: [], fin: PIECES.commun};
    const out = [{id: 'projet', nom: kind === 'svc' ? 'Votre demande' : 'Le projet en quelques mots', type: 'texte', aide: nd[0]}];
    if (commun) out.push(...copie(cm.debut));
    if (PIECES.modes && PIECES.modes[p]) out.push({id: 'plan', nom: 'Emplacement sur le plan', type: 'plan', mode: PIECES.modes[p], facultatif: true,
      aide: 'Placez votre projet sur le plan de votre terrain. Si vous n\'y arrivez pas, décrivez-le simplement dans « Le projet en quelques mots ».'});
    out.push(...copie(liste));
    if (c.regul === true || c.regul === 'true') out.push(...copie(PIECES.regul));
    if (commun) out.push(...copie(cm.fin));
    if (a.abf === 'oui') out.push(...copie(PIECES.situations.secteur_protege));
    if (a.copro === 'oui') out.push(...copie(PIECES.situations.copropriete));
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
const couverte = (piece, cmd) => !!piece.sauf && cmd.fichiers.some(f => f.piece === piece.sauf);
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
  if (cmd.solde <= 0 && !cmd.paiements.solde) cmd.paiements.solde = {montant: 0, date: cmd.date, ancien: true};
  cmd.kind = cmd.kind || 'dp';
  cmd.pieces = cmd.pieces || piecesInitiales(cmd.kind, cmd.projet, {regul: cmd.regul, reponses: cmd.reponses});
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
    pieces: cmd.pieces.map(p => ({id: p.id, nom: p.nom, aide: p.aide, exemple: p.exemple || '', type: p.type, facultatif: facultative(p, cmd), couverte: couverte(p, cmd) && etatPiece(p, cmd) === 'manquant', texte: p.texte || '', etat: etatPiece(p, cmd), motif: p.motif || '', ...(p.type === 'plan' ? {mode: p.mode, plan: p.plan || null} : {})})),
    fichiers: cmd.fichiers.map(fichierPublic), messages: cmd.messages, recues: r,
    livrables: cmd.livrables.map(l => ({id: l.id, code: l.code, nom: l.nom, pages: l.pages, taille: l.taille, date: l.date})),
    telechargeable: !!cmd.paiements.solde, demandes: NEED[cmd.projet] || NEED.extension,
    lignes: cmd.lignes || null, promo: cmd.promo || null
  };
  if (pourEquipe) Object.assign(o, {email: cmd.email, client: cmd.nom_client || '', reponses: cmd.reponses, reponsesLisibles: lisibles(cmd), projet: cmd.projet, regul: cmd.regul, historique: cmd.historique, lignes: cmd.lignes || null, session: cmd.session, liensStripe: [cmd.paiements.acompte && cmd.paiements.acompte.pi, cmd.paiements.solde && cmd.paiements.solde.pi].filter(Boolean)});
  return o;
}
// Réponses au simulateur avec les intitulés des questions, pour l'équipe
function lisibles(cmd) {
  let a = {}; try { a = JSON.parse(cmd.reponses || '{}'); } catch {}
  let qs = []; try { qs = P[cmd.projet] ? PRIX.flow(P, cmd.projet) : []; } catch {}
  return Object.entries(a).map(([k, v]) => { const q = qs.find(x => x.id === k); const c = q && q.c.find(x => x[0] === v); return [q ? q.t : k, c ? c[1] : v]; });
}
function resume(cmd) {
  const r = recues(cmd), commune = (cmd.adresse || '').split(',').pop().trim();
  const retard = cmd.statut === 'preparation' && cmd.echeance && new Date(cmd.echeance) < new Date();
  return {ref: cmd.ref, nom: cmd.nom, client: cmd.nom_client || cmd.email, email: cmd.email, commune, statut: cmd.statut, recues: r,
    echeance: cmd.echeance || null, retard: !!retard, total: cmd.total, solde: cmd.solde, paiement: cmd.paiements.solde ? 'solde' : 'acompte',
    date: cmd.date, dernierMessage: cmd.messages.length ? cmd.messages[cmd.messages.length - 1] : null,
    aVerifier: cmd.pieces.filter(p => etatPiece(p, cmd) === 'a_verifier').length};
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
function avecPromo(x, code) {
  if (!code) return x;
  const r = PROMOS.appliquer(code, x.total);
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
      description: `Prix total ${euro(x.total)} TTC (${x.lignes.map(l => l.label).join(', ')}). Solde de ${euro(x.total - acompte)} à régler après l'aperçu des plans.`.slice(0, 500)}}}],
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
    x = {total: cmd.total, lignes: cmd.lignes};
  } else if (d.projet) { // simulation enregistrée (espace client)
    const u = C.sessionClient(req), s = lireProjet(d.projet);
    if (!u || !s || s.uid !== u.id) return repondre(res, 404, {erreur: 'Projet introuvable.'});
    x = {total: s.total, lignes: s.lignes};
  } else { x = analyser(d); if (x.erreur) return repondre(res, 400, x); }
  const r = PROMOS.appliquer(d.code, x.total);
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
    statut: 'elements', pieces: piecesInitiales(m.kind || 'dp', m.projet, {regul: m.regul, reponses: m.reponses}), fichiers: [], messages: [], livrables: [],
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
    paiements: {}, statut: 'brouillon', pieces: piecesInitiales((x.v && x.v.kind) || 'dp', x.p, {regul: x.regul, reponses}),
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
  x = avecPromo(x, d.promo); if (x.erreur) return repondre(res, 400, {erreur: x.erreur, champ: 'promo'});
  const lieu = cmd.lieu ? `${(+cmd.lieu.lon).toFixed(6)},${(+cmd.lieu.lat).toFixed(6)}` : '';
  try { const s = await ouvrirPaiementAcompte(x, cmd.email, cmd.adresse, cmd.uid, null, lieu, cmd.ref); repondre(res, 200, {url: s.url}); }
  catch (e) { journal('erreur Stripe :', e.message); repondre(res, 502, {erreur: 'Le paiement n\'a pas pu s\'ouvrir. Réessayez dans un instant.'}); }
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
  cmd.statut = 'livre'; histo(cmd, `Solde reçu : ${euro(s.amount_total / 100)}. Dossier livré.`);
  sauver(cmd);
  journal('solde payé', cmd.ref, s.amount_total / 100 + ' €');
  const u = C.lireUser(cmd.uid);
  await envoyerMail(CONF.mailA, `Solde payé ${cmd.ref} : ${cmd.nom}`, `Le client a réglé le solde (${euro(s.amount_total / 100)}). Il peut télécharger son dossier.\n\n${CONF.site}/admin/#${cmd.ref}\n`, cmd.email);
  if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : prêt à télécharger`, `Bonjour,\n\nMerci, le solde est bien reçu. Votre dossier complet est prêt à télécharger, sans filigrane :\n${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}\n\n${String(cmd.options).includes('depot') ? 'Vous avez choisi le dépôt en mairie : nous le déposons pour vous et vous tenons au courant.' : 'Il ne vous reste qu\'à signer le formulaire et à le déposer en mairie, ou en ligne si votre commune le permet.'}${signature}`, CONF.mailA);
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
  plan.couche = pl.couche === 'plan' ? 'plan' : 'ortho'; plan.marge = num(+pl.marge) || 12;
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
  if (de === 'client' && d.correction && cmd.statut === 'apercu') { cmd.statut = 'corrections'; histo(cmd, 'Corrections demandées par le client'); }
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
  cmd.statut = 'verification'; histo(cmd, 'Le client a envoyé ses éléments'); sauver(cmd);
  repondre(res, 200, {ok: true});
  const r = recues(cmd);
  await envoyerMail(CONF.mailA, `À vérifier ${cmd.ref} : ${cmd.nom}`, `Le client a envoyé ses éléments (${r.n} pièces sur ${r.sur}, ${cmd.fichiers.length} fichiers).\n\n${CONF.site}/admin/#${cmd.ref}\n`, cmd.email);
}
async function clientValider(req, res, url) { // le client valide l'aperçu : paiement du solde
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (cmd.paiements.solde) return repondre(res, 409, {erreur: 'Le solde est déjà réglé.'});
  if (cmd.statut !== 'apercu') return repondre(res, 409, {erreur: 'Vos plans ne sont pas encore prêts à valider.'});
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
function voirApercu(res, cmd, lid, n) {
  const l = cmd.livrables.find(x => x.id === lid); if (!l || !(n >= 1 && n <= l.pages)) return repondre(res, 404, {erreur: 'Page introuvable.'});
  return envoyerFichier(res, path.join(dDir(cmd.ref), 'apercu', `${l.id}-${n}.jpg`), 'image/jpeg');
}
function clientVoir(req, res, url) {
  const cmd = cmdClient(req, res, url); if (!cmd) return;
  if (url.searchParams.get('l')) return voirApercu(res, cmd, url.searchParams.get('l'), +url.searchParams.get('n'));
  return voirFichier(res, cmd, url.searchParams.get('id'), url.searchParams.get('taille'));
}
function livrablesZip(res, cmd) {
  B.envoyerZip(res, `${cmd.ref}-dossier.zip`, cmd.livrables.map((l, i) => ({nom: `${String(i + 1).padStart(2, '0')}-${B.nomPropre(l.code + '-' + l.nom)}.pdf`, data: fs.readFileSync(path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'))})));
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
  const L = cmds.map(resume), mois = new Date().toISOString().slice(0, 7);
  const rappels = B.liste('rappels').filter(f => f.endsWith('.json')).length;
  repondre(res, 200, {dossiers: L, rappels, compteurs: {
    attente: L.filter(x => x.statut === 'elements').length, verifier: L.filter(x => ['verification', 'corrections'].includes(x.statut)).length,
    preparation: L.filter(x => x.statut === 'preparation').length, retard: L.filter(x => x.retard).length,
    livres: cmds.filter(c => c.statut === 'livre' && (c.paiements.solde.date || '').startsWith(mois)).length}});
}
function equipeDossier(req, res, url) { const cmd = cmdEquipe(req, res, url); if (cmd) repondre(res, 200, {...vueCmd(cmd, true), outils: {images: !!B.OUTILS.magick, pdf: !!B.OUTILS.pdftoppm}}); }
function equipeVoir(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (url.searchParams.get('l')) return voirApercu(res, cmd, url.searchParams.get('l'), +url.searchParams.get('n'));
  if (url.searchParams.get('livrable')) { const l = cmd.livrables.find(x => x.id === url.searchParams.get('livrable')); if (!l) return repondre(res, 404, {}); return envoyerFichier(res, path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'), 'application/pdf'); }
  return voirFichier(res, cmd, url.searchParams.get('id'), url.searchParams.get('taille'));
}
async function equipePiece(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  const d = await lireJson(req); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  if (d.ajouter) {
    const nom = texte(d.nom, 80); if (!nom) return repondre(res, 400, {erreur: 'Donnez un nom à la pièce.'});
    const p = {id: 'p' + B.id(4), nom, aide: texte(d.aide, 300), type: d.type === 'texte' ? 'texte' : 'fichier', ajoutee: true};
    cmd.pieces.splice(cmd.pieces.findIndex(x => x.id === 'autre'), 0, p); histo(cmd, `Pièce demandée : ${nom}`); sauver(cmd);
    repondre(res, 200, vueCmd(cmd, true));
    const u = C.lireUser(cmd.uid);
    if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : un document de plus`, `Bonjour,\n\nPour votre dossier, il nous faut aussi : ${nom}${p.aide ? ' (' + p.aide + ')' : ''}.\n\nL'ajouter depuis votre espace : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
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
  if (d.statut === 'a_refaire' && cmd.statut === 'verification') cmd.statut = 'elements';
  sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid);
  if (d.statut === 'a_refaire' && u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : une pièce à refaire`, `Bonjour,\n\n« ${p.nom} » : ${p.motif}\n\nL'envoyer de nouveau depuis votre espace : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
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
async function equipeMessage(req, res, url) { const cmd = cmdEquipe(req, res, url); if (cmd) return message(req, res, cmd, 'equipe'); }
async function equipeLancer(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (!['elements', 'verification'].includes(cmd.statut)) return repondre(res, 409, {erreur: 'Le dossier est déjà lancé.'});
  const ech = B.plusJoursOuvres(new Date(), delaiJours(cmd)); ech.setHours(19, 0, 0, 0);
  cmd.statut = 'preparation'; cmd.echeance = ech.toISOString();
  for (const p of cmd.pieces) if (etatPiece(p, cmd) === 'a_verifier') p.statut = 'valide';
  histo(cmd, 'Pièces complètes : plans en préparation'); sauver(cmd);
  repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid);
  if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : c'est parti`, `Bonjour,\n\nNous avons tout ce qu'il faut. Vos plans sont en préparation : vous recevrez l'aperçu au plus tard le ${ech.toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris'})}.\n\nSuivre votre dossier : ${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}${signature}`, CONF.mailA);
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
async function equipeSupprimerLivrable(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (cmd.paiements.solde && cmd.statut === 'livre') return repondre(res, 409, {erreur: 'Dossier déjà livré.'});
  const l = cmd.livrables.find(x => x.id === url.searchParams.get('id')); if (!l) return repondre(res, 404, {});
  cmd.livrables = cmd.livrables.filter(x => x !== l); sauver(cmd);
  fs.rmSync(path.join(dDir(cmd.ref), 'livrables', l.id + '.pdf'), {force: true});
  for (let n = 1; n <= l.pages; n++) fs.rmSync(path.join(dDir(cmd.ref), 'apercu', `${l.id}-${n}.jpg`), {force: true});
  repondre(res, 200, vueCmd(cmd, true));
}
async function equipeEnvoyerApercu(req, res, url) {
  const cmd = cmdEquipe(req, res, url); if (!cmd) return;
  if (!cmd.livrables.length) return repondre(res, 400, {erreur: 'Déposez d\'abord les PDF du dossier.'});
  if (cmd.statut === 'livre') return repondre(res, 409, {erreur: 'Dossier déjà livré.'});
  const d = await lireJson(req) || {};
  cmd.statut = 'apercu'; histo(cmd, 'Aperçu envoyé au client');
  if (texteLong(d.texte, 3000)) cmd.messages.push({de: 'equipe', texte: texteLong(d.texte, 3000), date: new Date().toISOString()});
  sauver(cmd); repondre(res, 200, vueCmd(cmd, true));
  const u = C.lireUser(cmd.uid);
  if (u) await envoyerMail(cmd.email, `Dossier ${cmd.ref} : vos plans sont prêts à relire`, `Bonjour,\n\nVos plans sont prêts. Relisez chaque pièce dans votre espace :\n${C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref)}\n\nUne correction ? Demandez-la depuis la même page, c'est compris dans le prix.\nTout vous convient ? Réglez le solde de ${euro(cmd.solde)} et téléchargez le dossier complet, sans filigrane.${signature}`, CONF.mailA);
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
  clientDossier, clientTexte, clientPlan, clientFichier, clientSupprimerFichier, clientMessage, clientTerminer, clientValider, clientVoir, clientTelecharger,
  equipeListe, equipeDossier, equipeVoir, equipePiece, equipeClasser, equipeFichier, equipeMessage, equipeLancer, equipeLivrable,
  equipeSupprimerLivrable, equipeEnvoyerApercu, equipeZip, analyser, partAcompte, piecesInitiales, listePieces
};
