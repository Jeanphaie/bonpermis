'use strict';
/* Plans automatiques vendus à l'unité (page /plan-de-masse/).
   - POST /api/plan-masse/apercu        le client a placé son projet : aperçu (filigrane) et brouillon gardé
   - GET  /api/plan-masse/apercu?id=    image PNG de l'aperçu
   - POST /api/plan-masse/payer         ouvre le paiement Stripe : formule « plan » (FORMULES.plan) ou « etude » (plan + étude du PLU par l'équipe)
   - GET  /api/plan-masse/etat?s=cs_…   après le paiement : lien de téléchargement
   - GET  /api/plan-masse/telecharger   le PDF sans filigrane : plan de masse + plan de situation (lien signé, plan payé)
   - POST /api/plan-situation           plan de situation seul, gratuit ; GET /api/plan-situation?id= pour le télécharger
   Brouillons dans DATA_DIR/plans/<id>.json. Le terrain y est gardé : le PDF payé est identique à l'aperçu.
   À l'achat, un code de réduction du montant payé est créé pour le dossier complet (30 jours, un seul usage). */

const B = require('./base');
const T = require('./terrain');
const PR = require('./promos');
const {planMasse, planSituation} = require('./planmasse');
const {fs, path, CONF, repondre, lireJson, texte, journal, euro, envoyerMail, stripe, reference, MAIL_RE} = B;
const {execFile} = require('child_process');

const FORMULES = {plan: {prix: 29, nom: 'Plan de masse'}, etude: {prix: 79, nom: 'Plan de masse et étude du PLU'}};
const PRIX_PLAN = FORMULES.plan.prix;
const PROJETS = {abri: 'Abri de jardin', piscine: 'Piscine', carport: 'Carport', garage: 'Garage', annexe: 'Annexe', pergola: 'Pergola', terrasse: 'Terrasse',
  extension: 'Extension', veranda: 'Véranda', maison: 'Maison', autre: 'Construction'};
const ID_RE = /^[A-Za-z0-9]{12,24}$/;
const jeton = id => B.signer('plan-masse:' + id).slice(0, 32);
const fichier = (id, suffixe) => B.chemin('plans', id + suffixe);
const dateFr = () => new Date().toLocaleDateString('fr-FR', {timeZone: 'Europe/Paris'});
const lancer = (cmd, args, delai = 60000) => new Promise(ok => execFile(cmd, args, {timeout: delai}, e => ok(!e)));
const ll = p => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) && Math.abs(+p[1]) <= 90 && Math.abs(+p[0]) <= 180 ? [+p[0], +p[1]] : null;
const dim = v => (+v >= 0.5 && +v <= 60) ? Math.round(+v * 100) / 100 : null;

// Nettoie le plan envoyé par l'éditeur : rectangles, extension accolée à une façade, surface libre. Dimensions plausibles.
function planPropre(p) {
  if (!p || !Array.isArray(p.formes)) return null;
  const formes = [];
  for (const f of p.formes.slice(0, 5)) {
    if (!f) continue;
    if (f.t === 'rect') { const c = ll(f.c), L = dim(f.L), P = dim(f.P); if (c && L && P) formes.push({t: 'rect', c, L, P, a: Number.isFinite(+f.a) ? +f.a : 0}); }
    else if (f.t === 'accole') { const fa = ll(f.fa), fb = ll(f.fb), L = dim(f.L), P = dim(f.P), d = +f.d; if (fa && fb && L && P && d >= 0 && d <= 60) formes.push({t: 'accole', fa, fb, s: +f.s < 0 ? -1 : 1, d: Math.round(d * 100) / 100, L, P}); }
    else if (f.t === 'poly' && Array.isArray(f.pts)) { const pts = f.pts.slice(0, 30).map(ll); if (pts.length >= 3 && pts.every(Boolean)) formes.push({t: 'poly', pts}); }
  }
  return formes.length ? {formes} : null;
}
const infos = (b, apercu) => ({projet: PROJETS[b.projet] || PROJETS.autre, hauteur: b.hauteur, demandeur: b.nom || '', adresse: b.adresse, date: b.dateFr, piece: 'DP2', apercu});

// ---------- cartes du plan de situation : tuiles du Plan IGN assemblées en une image JPEG ----------
const GEOPF = 'https://data.geopf.fr';
async function tuilePlan(z, x, y) {
  const f = B.chemin('tuiles', 'plan', String(z), String(x), y + '.png');
  try { if (Date.now() - fs.statSync(f).mtimeMs < 90 * 86400000) return f; } catch {}
  const r = await fetch(`${GEOPF}/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&FORMAT=${encodeURIComponent('image/png')}`,
    {signal: AbortSignal.timeout(9000), headers: {'User-Agent': 'bonpermis.fr (plan de situation)'}});
  if (!r.ok || !String(r.headers.get('content-type') || '').startsWith('image/')) throw new Error('tuile ' + r.status);
  fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
  return f;
}
// Une carte de L x H mm à l'échelle 1/ech, centrée sur le point. Renvoie {jpeg, px, echelle, titre} ou null.
async function carte(lon, lat, ech, titre, cle, L = 190, H = 205) {
  if (!B.OUTILS.magick) return null;
  const sortie = fichier(cle, '-carte-' + ech + '.jpg'), PXL = 1122, PXH = Math.round(PXL * H / L);
  try { if (Date.now() - fs.statSync(sortie).mtimeMs < 30 * 86400000) return {jpeg: fs.readFileSync(sortie), px: [PXL, PXH], echelle: ech, titre}; } catch {}
  const sol = L / 1000 * ech, k = Math.cos(lat * Math.PI / 180);
  const z = Math.max(10, Math.min(18, Math.round(Math.log2(156543.03392 * k / (sol / PXL)))));
  const res = 156543.03392 * k / 2 ** z, wpx = sol / res, hpx = wpx * H / L, n = 2 ** z;
  const cx = (lon + 180) / 360 * n * 256, s = Math.sin(lat * Math.PI / 180), cy = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * 256;
  const x0 = Math.floor((cx - wpx / 2) / 256), x1 = Math.floor((cx + wpx / 2) / 256), y0 = Math.floor((cy - hpx / 2) / 256), y1 = Math.floor((cy + hpx / 2) / 256);
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return null;
  // Tuiles demandées quatre par quatre, avec un second essai : l'IGN freine les rafales.
  const lignes = [], essai = async (x, y) => { try { return await tuilePlan(z, x, y); } catch { await new Promise(r => setTimeout(r, 400)); return tuilePlan(z, x, y); } };
  for (let y = y0; y <= y1; y++) {
    const xs = []; for (let x = x0; x <= x1; x++) xs.push(((x % n) + n) % n);
    const rang = []; for (let i = 0; i < xs.length; i += 4) rang.push(...await Promise.all(xs.slice(i, i + 4).map(x => essai(x, y))));
    lignes.push(rang);
  }
  const args = [];
  for (const rang of lignes) args.push('(', ...rang, '+append', ')');
  args.push('-append', '-background', 'white', '-alpha', 'remove', '-alpha', 'off', '-colorspace', 'sRGB',
    '-crop', `${Math.round(wpx)}x${Math.round(hpx)}+${Math.round(cx - wpx / 2 - x0 * 256)}+${Math.round(cy - hpx / 2 - y0 * 256)}`, '+repage', '-resize', `${PXL}x${PXH}!`, '-quality', '84', sortie);
  fs.mkdirSync(path.dirname(sortie), {recursive: true});
  if (!await lancer(B.OUTILS.magick, args)) throw new Error('assemblage des tuiles (' + B.OUTILS.magick + ')');
  return {jpeg: fs.readFileSync(sortie), px: [PXL, PXH], echelle: ech, titre};
}
let derniereErreurCartes = '';
async function cartesSituation(lon, lat, cle) {
  try {
    const c = [await carte(lon, lat, 25000, 'Situation dans la commune', cle), await carte(lon, lat, 5000, 'Situation rapprochée', cle)];
    if (c.every(Boolean)) return c;
    derniereErreurCartes = 'outil image absent ou carte trop grande'; return null;
  } catch (e) { derniereErreurCartes = e.message; journal('plan de situation : cartes indisponibles', e.message); return null; }
}

// ---------- plan de masse : aperçu, paiement, téléchargement ----------
async function apercu(req, res) {
  if (B.trop('plan-apercu:' + B.ip(req), 40)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req, 60000); if (!d) return repondre(res, 400, {erreur: 'Demande illisible.'});
  const plan = planPropre(d.plan), lon = +(d.lieu && d.lieu.lon), lat = +(d.lieu && d.lieu.lat), hauteur = +d.hauteur;
  if (!plan) return repondre(res, 400, {erreur: 'Placez d\'abord votre projet sur le plan.'});
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return repondre(res, 400, {erreur: 'Adresse introuvable.'});
  if (!(hauteur >= 0.1 && hauteur <= 20)) return repondre(res, 400, {erreur: 'Indiquez la hauteur de la construction, en mètres.'});
  const terrain = await T.analyserTerrain(+lon.toFixed(6), +lat.toFixed(6));
  if (!terrain.parcelle || !terrain.parcelle.geometrie) return repondre(res, 502, {erreur: 'Le cadastre ne répond pas pour cette adresse. Réessayez dans un instant.'});
  const id = B.id(12);
  const commune = terrain.parcelle.commune || (terrain.commune && terrain.commune.nom) || '';
  const b = {id, date: new Date().toISOString(), dateFr: dateFr(), lieu: {lon, lat}, projet: PROJETS[d.projet] ? d.projet : 'autre', hauteur: Math.round(hauteur * 100) / 100,
    nom: texte(d.nom, 60), adresse: texte(d.adresse, 120) || commune, plan, terrain, paye: null};
  let r; try { r = planMasse(terrain, plan, infos(b, true)); } catch (e) { return repondre(res, 400, {erreur: e.message}); }
  fs.mkdirSync(B.chemin('plans'), {recursive: true});
  fs.writeFileSync(fichier(id, '-apercu.pdf'), r.pdf);
  if (B.OUTILS.pdftoppm) await lancer('pdftoppm', ['-png', '-r', '110', '-singlefile', fichier(id, '-apercu.pdf'), fichier(id, '-apercu')], 30000);
  b.mesures = r.mesures; b.echelle = r.echelle;
  B.ecrire(b, 'plans', id + '.json');
  journal('plan de masse : aperçu', id, b.projet, commune);
  const z = terrain.zone;
  repondre(res, 200, {id, prix: PRIX_PLAN, formules: FORMULES, echelle: r.echelle, mesures: r.mesures, image: fs.existsSync(fichier(id, '-apercu.png')),
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
  const d = await lireJson(req) || {}, id = String(d.id || ''), email = texte(d.email, 254).toLowerCase(), formule = d.formule === 'etude' ? 'etude' : 'plan';
  const b = ID_RE.test(id) && B.lire('plans', id + '.json');
  if (!b) return repondre(res, 404, {erreur: 'Aperçu introuvable. Refaites votre plan.'});
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Adresse e-mail invalide.'});
  const deja = b.paye ? b.paye.total || PRIX_PLAN : 0;
  if (deja >= FORMULES[formule].prix) return repondre(res, 200, {url: `${CONF.site}/plan-de-masse/?id=${id}&t=${jeton(id)}`});
  const montant = FORMULES[formule].prix - deja; // ce qui a déjà été payé pour le plan est déduit de l'étude
  const nom = `${FORMULES[formule].nom} : ${PROJETS[b.projet].toLowerCase()}, ${b.adresse}`.slice(0, 250), meta = {type: 'plan', plan: id, formule};
  const description = formule === 'etude'
    ? `Plan de masse coté (PDF A3) à télécharger tout de suite, et étude du règlement d'urbanisme de votre terrain pour ce projet, envoyée par e-mail sous 48 h ouvrées.${deja ? ` Les ${deja} € déjà payés sont déduits.` : ''}`
    : `Plan de masse coté et plan de situation au format PDF A3, à télécharger tout de suite. Les ${PRIX_PLAN} € sont déduits de la formule suivante pendant 30 jours.`;
  try {
    const s = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'payment', locale: 'fr', customer_email: email,
      success_url: `${CONF.site}/plan-de-masse/?paye={CHECKOUT_SESSION_ID}`, cancel_url: `${CONF.site}/plan-de-masse/`,
      line_items: [{quantity: 1, price_data: {currency: 'eur', unit_amount: montant * 100, product_data: {name: nom, description}}}],
      metadata: meta, payment_intent_data: {description: nom, metadata: meta},
      consent_collection: {terms_of_service: 'required'},
      custom_text: {terms_of_service_acceptance: {message: `J'accepte les [conditions générales de vente](${CONF.site}/cgv/). Je demande à recevoir mon plan tout de suite et je renonce à mon droit de rétractation pour ce fichier.`}}
    });
    journal('plan de masse : paiement ouvert', id, formule, montant + ' €');
    repondre(res, 200, {url: s.url});
  } catch (e) { journal('erreur Stripe :', e.message); repondre(res, 502, {erreur: 'Le paiement n\'a pas pu s\'ouvrir. Réessayez dans un instant.'}); }
}

// Marque le paiement (une seule fois par session), crée le code de déduction, prévient le client et l'équipe.
async function paiementRecu(s) {
  const id = (s.metadata && s.metadata.plan) || '', formule = s.metadata && s.metadata.formule === 'etude' ? 'etude' : 'plan';
  const b = ID_RE.test(id) && B.lire('plans', id + '.json'); if (!b) { journal('plan de masse : paiement sans brouillon', id); return null; }
  if (b.paye && (b.paye.sessions || [b.paye.session]).includes(s.id)) return b;
  const email = ((s.customer_details && s.customer_details.email) || s.customer_email || '').toLowerCase();
  const fin = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), finFr = fin.split('-').reverse().join('/');
  const total = FORMULES[formule].prix, ancien = b.paye && b.paye.code;
  const code = (formule === 'etude' ? 'ETUDE-' : 'PLAN-') + reference(s.id).slice(3);
  b.paye = {date: new Date().toISOString(), session: s.id, sessions: [...((b.paye && b.paye.sessions) || (b.paye ? [b.paye.session] : [])), s.id], email, code, codeFin: fin, formule, total};
  if (formule === 'etude') b.etude = {demandee: new Date().toISOString(), livree: null};
  B.ecrire(b, 'plans', id + '.json');
  try { if (ancien) PR.desactiver(ancien); PR.creerCode({code, type: 'montant', valeur: total, max: 1, expire: fin, note: `${FORMULES[formule].nom} ${id} déduit du dossier`}); } catch (e) { journal('plan de masse : code non créé', e.message); }
  const lien = `${CONF.site}/plan-de-masse/?id=${id}&t=${jeton(id)}`, z = b.terrain.zone;
  journal('plan de masse : payé', id, formule, reference(s.id));
  if (email) await envoyerMail(email, formule === 'etude' ? 'Votre plan de masse est prêt, l\'étude du PLU arrive' : 'Votre plan de masse est prêt',
    `Bonjour,\n\nVotre plan de masse et votre plan de situation sont prêts. Vous pouvez les télécharger ici, autant de fois que vous voulez :\n${lien}\n\n` +
    (formule === 'etude'
      ? `Nous étudions maintenant le règlement d'urbanisme de votre terrain pour ce projet. Vous recevrez notre réponse par e-mail sous 48 h ouvrées : le projet passe ou non, règle par règle, avec la page du règlement. Ne déposez rien avant de l'avoir reçue.\n\n` +
        `Si vous voulez ensuite qu'on prépare tout le dossier (tous les plans, le formulaire, prêt à déposer en 48 h), vos ${total} € sont déduits avec le code ${code}, valable jusqu'au ${finFr}.\n${CONF.site}/#projets`
      : `Avant de déposer, un point important : ce plan ne vérifie pas que votre projet respecte le règlement d'urbanisme de votre commune. ` +
        `Chaque commune a ses propres règles de distance, de hauteur et d'emprise, et un projet qui en oublie une est refusé, même avec un plan parfait. ` +
        `Il vous reste aussi le formulaire officiel, le plan en coupe, les façades, l'insertion et les photos.\n\n` +
        `On peut s'en charger : dossier complet, règlement étudié, prêt à déposer en 48 h. Vos ${total} € sont déduits avec le code ${code}, valable jusqu'au ${finFr}.\n${CONF.site}/#projets`) + B.signature);
  await envoyerMail(CONF.mailA, formule === 'etude' ? `ÉTUDE PLU À FAIRE sous 48 h (${euro(total)}) : ${b.adresse}` : `Plan de masse vendu (${euro(total)}) : ${b.adresse}`,
    `Plan ${id}, ${PROJETS[b.projet]}, hauteur ${b.hauteur} m, ${b.adresse}.\nClient : ${email}\nPlan (PDF) : ${CONF.site}/api/plan-masse/telecharger?id=${id}&t=${jeton(id)}\n` +
    `Zone : ${z ? z.libelle + ' (' + (z.libelleLong || '') + '), document ' + (z.document || '?') + ', règlement ' + (z.reglement || '?') : 'pas de zone trouvée'}\n` +
    `Mesures : ${JSON.stringify(b.mesures)}\nCode de déduction : ${code}\n` +
    (formule === 'etude' ? `\nÀ FAIRE : étudier le règlement de la zone pour ce projet et répondre au client par e-mail sous 48 h ouvrées (passe ou non, règle par règle, avec les pages).\n` : ''));
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
    repondre(res, 200, {paye: true, id: b.id, t: jeton(b.id), code: b.paye.code, codeFin: b.paye.codeFin, formule: b.paye.formule, total: b.paye.total});
  } catch (e) { journal('plan de masse : état', e.message); repondre(res, 502, {erreur: 'Vérification du paiement impossible pour le moment.'}); }
}

async function telecharger(req, res, url) {
  const id = url.searchParams.get('id') || '', t = url.searchParams.get('t') || '';
  if (!ID_RE.test(id) || !B.egal(t, jeton(id))) return repondre(res, 403, {erreur: 'Lien invalide.'});
  const b = B.lire('plans', id + '.json');
  if (!b || !b.paye) return repondre(res, 403, {erreur: 'Ce plan n\'est pas encore payé.'});
  const f = fichier(id, '.pdf');
  if (!fs.existsSync(f)) {
    const cartes = await cartesSituation(b.lieu.lon, b.lieu.lat, id); // sans les cartes (IGN indisponible), le plan de masse est livré seul
    const r = planMasse(b.terrain, b.plan, infos(b, false), cartes);
    if (cartes) fs.writeFileSync(f, r.pdf); else { res.writeHead(200, {'Content-Type': 'application/pdf', 'Content-Length': r.pdf.length, 'Content-Disposition': 'attachment; filename="plan-de-masse-DP2.pdf"', 'Cache-Control': 'no-store'}); return res.end(r.pdf); }
  }
  B.envoyerFichier(res, f, 'application/pdf', 'plan-de-masse-et-situation.pdf');
}

// ---------- plan de situation seul, gratuit ----------
async function situation(req, res) {
  if (B.trop('plan-situation:' + B.ip(req), 15)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const d = await lireJson(req) || {}, lon = +(d.lieu && d.lieu.lon), lat = +(d.lieu && d.lieu.lat), email = texte(d.email, 254).toLowerCase(), accord = d.accord === true;
  if (!MAIL_RE.test(email)) return repondre(res, 400, {erreur: 'Indiquez votre adresse e-mail pour recevoir le plan.'});
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return repondre(res, 400, {erreur: 'Adresse introuvable.'});
  const terrain = await T.analyserTerrain(+lon.toFixed(6), +lat.toFixed(6));
  if (!terrain.parcelle) return repondre(res, 502, {erreur: 'Le cadastre ne répond pas pour cette adresse. Réessayez dans un instant.'});
  const id = B.id(12), commune = terrain.parcelle.commune || '';
  const cartes = await cartesSituation(lon, lat, 's' + id);
  if (!cartes) return repondre(res, 502, {erreur: 'Les cartes de l\'IGN ne répondent pas pour le moment. Réessayez dans un instant.', detail: derniereErreurCartes});
  const r = planSituation(terrain, cartes, {demandeur: texte(d.nom, 60), adresse: commune, projet: '', date: dateFr()});
  fs.mkdirSync(B.chemin('plans'), {recursive: true}); fs.writeFileSync(fichier('s' + id, '.pdf'), r.pdf);
  // Contact gardé dans DATA_DIR/prospects. « accord » : la personne a coché qu'elle veut recevoir nos conseils ; sans lui, aucune relance.
  B.creer({date: new Date().toISOString(), email, accord, origine: 'plan de situation', commune, parcelle: terrain.parcelle.section + ' ' + terrain.parcelle.numero, lieu: {lon, lat}, zone: terrain.zone ? terrain.zone.libelle : null}, 'prospects', id + '.json');
  journal('plan de situation gratuit', id, commune, accord ? 'accord' : 'sans accord');
  await envoyerMail(email, 'Votre plan de situation',
    `Bonjour,\n\nVoici votre plan de situation (${commune}) :\n${CONF.site}/api/plan-situation?id=${id}\n\n` +
    `C'est la pièce n° 1 de votre dossier. La suivante est le plan de masse : votre terrain vu du dessus, avec votre projet coté. Vous pouvez en voir l'aperçu gratuitement ici :\n${CONF.site}/plan-de-masse/` + B.signature);
  repondre(res, 200, {id, commune, parcelle: terrain.parcelle.section + ' ' + String(terrain.parcelle.numero).replace(/^0+/, '')});
}
function situationPdf(req, res, url) {
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return repondre(res, 400, {erreur: 'Plan inconnu.'});
  B.envoyerFichier(res, fichier('s' + id, '.pdf'), 'application/pdf', 'plan-de-situation-DP1.pdf');
}

module.exports = {apercu, image, payer, etat, telecharger, paiementRecu, situation, situationPdf, PRIX_PLAN, FORMULES, PROJETS, _test: {planPropre, jeton, carte}};
