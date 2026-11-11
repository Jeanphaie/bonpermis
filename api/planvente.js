'use strict';
/* Plan de masse automatique vendu à l'unité (page /plan-de-masse/).
   - POST /api/plan-masse/apercu       le client a placé son projet : on fabrique l'aperçu (filigrane) et on garde le brouillon
   - GET  /api/plan-masse/apercu?id=   image PNG de l'aperçu
   - POST /api/plan-masse/payer        ouvre le paiement Stripe (prix : PRIX_PLAN)
   - GET  /api/plan-masse/etat?s=cs_…  après le paiement : lien de téléchargement
   - GET  /api/plan-masse/telecharger  le PDF sans filigrane (lien signé, plan payé)
   Brouillons dans DATA_DIR/plans/<id>.json. Le terrain y est gardé : le PDF payé est identique à l'aperçu.
   À l'achat, un code de réduction du même montant est créé pour le dossier complet (30 jours, un seul usage). */

const B = require('./base');
const T = require('./terrain');
const PR = require('./promos');
const {planMasse} = require('./planmasse');
const {fs, path, CONF, repondre, lireJson, texte, journal, euro, envoyerMail, stripe, reference, MAIL_RE} = B;
const {execFile} = require('child_process');

const PRIX_PLAN = 29;
const PROJETS = {abri: 'Abri de jardin', piscine: 'Piscine', carport: 'Carport', garage: 'Garage', annexe: 'Annexe', pergola: 'Pergola', terrasse: 'Terrasse', autre: 'Construction'};
const ID_RE = /^[A-Za-z0-9]{12,24}$/;
const jeton = id => B.signer('plan-masse:' + id).slice(0, 32);
const fichier = (id, suffixe) => B.chemin('plans', id + suffixe);
const dateFr = () => new Date().toLocaleDateString('fr-FR', {timeZone: 'Europe/Paris'});

// Nettoie le plan envoyé par l'éditeur : rectangles seulement, dimensions plausibles.
function planPropre(p) {
  if (!p || !Array.isArray(p.formes)) return null;
  const formes = [];
  for (const f of p.formes.slice(0, 4)) {
    if (!f || f.t !== 'rect' || !Array.isArray(f.c)) continue;
    const lon = +f.c[0], lat = +f.c[1], L = +f.L, P = +f.P, a = +f.a || 0;
    if (![lon, lat, L, P, a].every(Number.isFinite) || L < 0.5 || L > 60 || P < 0.5 || P > 60 || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    formes.push({t: 'rect', c: [lon, lat], L: Math.round(L * 100) / 100, P: Math.round(P * 100) / 100, a});
  }
  return formes.length ? {formes} : null;
}
const infos = (b, apercu) => ({projet: PROJETS[b.projet] || PROJETS.autre, hauteur: b.hauteur, demandeur: b.nom || '', adresse: b.adresse, date: b.dateFr, piece: 'DP2', apercu});

async function apercu(req, res) {
  if (B.trop('plan-apercu:' + B.ip(req), 40)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req, 60000); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const plan = planPropre(d.plan), lon = +(d.lieu && d.lieu.lon), lat = +(d.lieu && d.lieu.lat), hauteur = +d.hauteur;
  if (!plan) return repondre(res, 400, {erreur: 'Placez d\'abord votre projet sur le plan.'});
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return repondre(res, 400, {erreur: 'Adresse introuvable.'});
  if (!(hauteur >= 0.3 && hauteur <= 20)) return repondre(res, 400, {erreur: 'Indiquez la hauteur de la construction, en mètres.'});
  const terrain = await T.analyserTerrain(+lon.toFixed(6), +lat.toFixed(6));
  if (!terrain.parcelle || !terrain.parcelle.geometrie) return repondre(res, 502, {erreur: 'Le cadastre ne répond pas pour cette adresse. Réessayez dans un instant.'});
  const id = B.id(12);
  const commune = terrain.parcelle.commune || (terrain.commune && terrain.commune.nom) || '';
  const b = {id, date: new Date().toISOString(), dateFr: dateFr(), lieu: {lon, lat}, projet: PROJETS[d.projet] ? d.projet : 'autre', hauteur: Math.round(hauteur * 100) / 100,
    nom: texte(d.nom, 60), adresse: texte(d.adresse, 120) || commune, plan, terrain, paye: null};
  let r; try { r = planMasse(terrain, plan, infos(b, true)); } catch (e) { return repondre(res, 400, {erreur: e.message}); }
  fs.mkdirSync(B.chemin('plans'), {recursive: true});
  fs.writeFileSync(fichier(id, '-apercu.pdf'), r.pdf);
  if (B.OUTILS.pdftoppm) await new Promise(ok => execFile('pdftoppm', ['-png', '-r', '110', '-singlefile', fichier(id, '-apercu.pdf'), fichier(id, '-apercu')], {timeout: 30000}, () => ok()));
  b.mesures = r.mesures; b.echelle = r.echelle;
  B.ecrire(b, 'plans', id + '.json');
  journal('plan de masse : aperçu', id, b.projet, commune);
  const z = terrain.zone;
  repondre(res, 200, {id, prix: PRIX_PLAN, echelle: r.echelle, mesures: r.mesures, image: fs.existsSync(fichier(id, '-apercu.png')),
    terrain: {commune, parcelle: terrain.parcelle.section + ' ' + String(terrain.parcelle.numero).replace(/^0+/, ''), zone: z ? z.libelle : null, zoneNom: z ? z.libelleLong : null,
      protege: terrain.secteurProtege, rnu: !!(terrain.commune && terrain.commune.rnu)}});
}

function image(req, res, url) {
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return repondre(res, 400, {erreur: 'Aperçu inconnu.'});
  const png = fichier(id, '-apercu.png');
  if (fs.existsSync(png)) return B.envoyerFichier(res, png, 'image/png');
  B.envoyerFichier(res, fichier(id, '-apercu.pdf'), 'application/pdf');
}

async function payer(req, res) {
  if (B.tropDeDemandes(req)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req) || {}, id = String(d.id || ''), email = texte(d.email, 254).toLowerCase();
  const b = ID_RE.test(id) && B.lire('plans', id + '.json');
  if (!b) return repondre(res, 404, {erreur: 'Aperçu introuvable. Refaites votre plan.'});
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  if (b.paye) return repondre(res, 200, {url: `${CONF.site}/plan-de-masse/?id=${id}&t=${jeton(id)}`});
  const nom = `Plan de masse : ${PROJETS[b.projet].toLowerCase()}, ${b.adresse}`.slice(0, 250), meta = {type: 'plan', plan: id};
  try {
    const s = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'payment', locale: 'fr', customer_email: email,
      success_url: `${CONF.site}/plan-de-masse/?paye={CHECKOUT_SESSION_ID}`, cancel_url: `${CONF.site}/plan-de-masse/`,
      line_items: [{quantity: 1, price_data: {currency: 'eur', unit_amount: PRIX_PLAN * 100, product_data: {name: nom,
        description: `Plan de masse coté au format PDF A3, à télécharger tout de suite. Les ${PRIX_PLAN} € sont déduits de votre dossier complet pendant 30 jours.`}}}],
      metadata: meta, payment_intent_data: {description: nom, metadata: meta},
      consent_collection: {terms_of_service: 'required'},
      custom_text: {terms_of_service_acceptance: {message: `J'accepte les [conditions générales de vente](${CONF.site}/cgv/). Je demande à recevoir mon plan tout de suite et je renonce à mon droit de rétractation pour ce fichier.`}}
    });
    journal('plan de masse : paiement ouvert', id);
    repondre(res, 200, {url: s.url});
  } catch (e) { journal('erreur Stripe :', e.message); repondre(res, 502, {erreur: 'Le paiement n\'a pas pu s\'ouvrir. Réessayez dans un instant.'}); }
}

// Marque le plan payé (une seule fois), crée le code de déduction, prévient le client et l'équipe.
async function paiementRecu(s) {
  const id = (s.metadata && s.metadata.plan) || '';
  const b = ID_RE.test(id) && B.lire('plans', id + '.json'); if (!b) { journal('plan de masse : paiement sans brouillon', id); return null; }
  if (b.paye) return b;
  const email = ((s.customer_details && s.customer_details.email) || s.customer_email || '').toLowerCase();
  const fin = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const code = 'PLAN-' + reference(s.id).slice(3);
  b.paye = {date: new Date().toISOString(), session: s.id, email, code, codeFin: fin};
  B.ecrire(b, 'plans', id + '.json');
  try { PR.creerCode({code, type: 'montant', valeur: PRIX_PLAN, max: 1, expire: fin, note: 'Plan de masse ' + id + ' déduit du dossier'}); } catch (e) { journal('plan de masse : code non créé', e.message); }
  const lien = `${CONF.site}/plan-de-masse/?id=${id}&t=${jeton(id)}`;
  journal('plan de masse : payé', id, reference(s.id));
  if (email) await envoyerMail(email, 'Votre plan de masse est prêt',
    `Bonjour,\n\nVotre plan de masse est prêt. Vous pouvez le télécharger ici, autant de fois que vous voulez :\n${lien}\n\n` +
    `Avant de déposer, un point important : ce plan ne vérifie pas que votre projet respecte le règlement d'urbanisme de votre commune. ` +
    `Chaque commune a ses propres règles de distance, de hauteur et d'emprise, et un projet qui en oublie une est refusé, même avec un plan parfait. ` +
    `Il vous reste aussi le formulaire officiel, le plan en coupe, les façades, l'insertion et les photos.\n\n` +
    `On peut s'en charger : dossier complet, règlement étudié, prêt à déposer en 48 h. Vos ${PRIX_PLAN} € sont déduits avec le code ${code}, valable jusqu'au ${fin.split('-').reverse().join('/')}.\n${CONF.site}/#projets` + B.signature);
  await envoyerMail(CONF.mailA, `Plan de masse vendu (${euro(PRIX_PLAN)}) : ${b.adresse}`, `Plan ${id}, ${PROJETS[b.projet]}, ${b.adresse}.\nClient : ${email}\nCode de déduction : ${code}\n`);
  return b;
}

// Retour de Stripe sur la page : le paiement est vérifié auprès de Stripe, sans attendre le webhook.
async function etat(req, res, url) {
  const sid = url.searchParams.get('s') || '';
  if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(sid)) return repondre(res, 400, {erreur: 'Paiement inconnu.'});
  try {
    const s = await stripe('GET', '/v1/checkout/sessions/' + encodeURIComponent(sid));
    if (s.payment_status !== 'paid' || !s.metadata || s.metadata.type !== 'plan') return repondre(res, 200, {paye: false});
    const b = await paiementRecu(s); if (!b) return repondre(res, 404, {erreur: 'Plan introuvable.'});
    repondre(res, 200, {paye: true, id: b.id, t: jeton(b.id), code: b.paye.code, codeFin: b.paye.codeFin, prix: PRIX_PLAN});
  } catch (e) { journal('plan de masse : état', e.message); repondre(res, 502, {erreur: 'Vérification du paiement impossible pour le moment.'}); }
}

function telecharger(req, res, url) {
  const id = url.searchParams.get('id') || '', t = url.searchParams.get('t') || '';
  if (!ID_RE.test(id) || !B.egal(t, jeton(id))) return repondre(res, 403, {erreur: 'Lien invalide.'});
  const b = B.lire('plans', id + '.json');
  if (!b || !b.paye) return repondre(res, 403, {erreur: 'Ce plan n\'est pas encore payé.'});
  const f = fichier(id, '.pdf');
  if (!fs.existsSync(f)) fs.writeFileSync(f, planMasse(b.terrain, b.plan, infos(b, false)).pdf);
  B.envoyerFichier(res, f, 'application/pdf', 'plan-de-masse-DP2.pdf');
}

module.exports = {apercu, image, payer, etat, telecharger, paiementRecu, PRIX_PLAN, PROJETS, _test: {planPropre, jeton}};
