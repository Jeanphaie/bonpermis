'use strict';
/* Suivi des visites, fait maison, sans cookie et sans service extérieur.
   - Chaque page du site envoie un signal à POST /api/v (src/mesure.js) : la page, le site d'où vient le visiteur,
     la campagne (utm_source, utm_campaign, clic sur une annonce Google). Rien d'autre.
   - Le serveur ne garde que des totaux par jour (data/visites/AAAA-MM-JJ.json) : aucune adresse IP, aucun identifiant.
   - Pour compter un visiteur une seule fois dans la journée, on calcule une empreinte à partir de l'adresse IP,
     du navigateur et d'un sel tiré au hasard chaque jour. Les empreintes et le sel du jour sont effacés le lendemain :
     on ne peut ni retrouver une personne, ni la suivre d'un jour à l'autre.
   - Pas comptés : l'équipe connectée, les robots, l'espace équipe, les visiteurs qui s'y sont opposés.
   - L'espace équipe lit GET /api/admin/visites?jours=30. */

const B = require('./base');
const C = require('./comptes');
const {crypto, repondre, lireCorps, journal} = B;

const DOSSIER = 'visites';
const ROBOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|monitor|uptime|curl|wget|python|scrapy|facebookexternalhit|whatsapp|telegram|bingpreview|gptbot|claude|perplexity|semrush|ahrefs|dataprovider/i;
const ETAPES = ['simu', 'prix', 'continuer']; // simulateur ouvert, prix affiché, clic sur « Continuer »
const MAX_CLES = 400;      // au plus 400 pages, sources ou campagnes différentes par jour
const MAX_PAR_VISITEUR = 300; // signaux par visiteur et par jour (au-delà : ignoré)

const jourParis = (d = new Date()) => d.toLocaleDateString('fr-CA', {timeZone: 'Europe/Paris'}); // AAAA-MM-JJ
const vide = jour => ({jour, sel: crypto.randomBytes(16).toString('hex'), vues: 0, visiteurs: 0, mobile: 0, pages: {}, entrees: {}, sources: {}, campagnes: {}, etapes: {}, vus: {}});

// Le jour en cours est gardé en mémoire et écrit sur le disque au plus toutes les 20 secondes.
let J = null, sale = false;
function charger() {
  const jour = jourParis();
  if (J && J.jour === jour) return J;
  if (J) { enregistrer(true); clore(J.jour); }
  J = B.lire(DOSSIER, jour + '.json') || vide(jour);
  if (!J.vus) { J.vus = {}; J.sel = J.sel || crypto.randomBytes(16).toString('hex'); }
  for (const f of B.liste(DOSSIER)) { const j = f.slice(0, 10); if (/^\d{4}-\d\d-\d\d\.json$/.test(f) && j < jour) clore(j); }
  return J;
}
function enregistrer(force) { if (J && (sale || force)) { try { B.ecrire(J, DOSSIER, J.jour + '.json'); sale = false; } catch (e) { journal('visites : écriture impossible', e.message); } } }
// Un jour terminé ne garde que ses totaux : le sel et les empreintes sont effacés.
function clore(jour) {
  const d = B.lire(DOSSIER, jour + '.json'); if (!d || (!d.vus && !d.sel)) return;
  delete d.vus; delete d.sel; B.ecrire(d, DOSSIER, jour + '.json');
}
if (require.main !== module) setInterval(() => enregistrer(), 20000).unref();
process.on('SIGTERM', () => { enregistrer(true); process.exit(0); });
process.on('SIGINT', () => { enregistrer(true); process.exit(0); });

const plus = (o, k) => { if (k in o) o[k]++; else if (Object.keys(o).length < MAX_CLES) o[k] = 1; else o['(autres)'] = (o['(autres)'] || 0) + 1; };

// Page : chemin seul, sans paramètre. Les pages personnelles (espace client) sont regroupées.
function page(p) {
  p = String(p || '').split(/[?#]/)[0].slice(0, 120);
  if (!/^\/[\w\-/.%]*$/.test(p)) return null;
  if (p.startsWith('/admin')) return null;
  if (p.startsWith('/espace/dossier')) return '/espace/dossier/';
  return p.replace(/index\.html$/, '');
}
// D'où vient le visiteur : la campagne si elle est indiquée, sinon le site d'origine rangé par famille.
function source(d, hote) {
  if (d.g) return 'Google Ads';
  const u = String(d.u || '').toLowerCase().replace(/[^a-z0-9_.\-]/g, '').slice(0, 30);
  if (u) return 'Campagne : ' + u;
  let h = String(d.r || '').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9.\-]/g, '').slice(0, 60);
  if (!h || h === hote) return 'Accès direct';
  if (/(^|\.)google\./.test(h)) return 'Google (recherche)';
  if (/(^|\.)bing\.com$/.test(h)) return 'Bing';
  if (/duckduckgo|qwant|ecosia|yahoo|brave\.com|startpage/.test(h)) return 'Autres moteurs';
  if (/facebook|instagram|fb\.com|t\.co$|twitter|x\.com$|linkedin|pinterest|tiktok|youtube/.test(h)) return 'Réseaux sociaux';
  if (/chatgpt|openai|perplexity|claude\.ai|gemini|copilot/.test(h)) return 'Assistants IA';
  return h;
}

// ---------- réception d'un signal ----------
async function signal(req, res) {
  const fin = () => { res.writeHead(204, {'Cache-Control': 'no-store'}); res.end(); };
  let d; try { d = JSON.parse((await lireCorps(req, 2000)).toString('utf8')); } catch { return fin(); }
  const ua = String(req.headers['user-agent'] || '');
  if (!d || typeof d !== 'object' || !ua || ROBOT.test(ua) || C.sessionAdmin(req)) return fin();
  if (req.headers['sec-gpc'] === '1' || req.headers.dnt === '1') return fin(); // le visiteur a demandé à ne pas être suivi
  const j = charger();
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const e = crypto.createHash('sha256').update(j.sel + '|' + ip + '|' + ua).digest('base64url').slice(0, 12);
  let v = j.vus[e];
  const hote = String(req.headers.host || '').replace(/^www\./, '').split(':')[0];

  if (d.e) { // étape du simulateur : comptée une fois par visiteur et par jour
    if (!ETAPES.includes(d.e) || !v) return fin();
    v.e = v.e || [];
    if (!v.e.includes(d.e)) { v.e.push(d.e); plus(j.etapes, d.e); sale = true; }
    return fin();
  }
  const p = page(d.p); if (!p) return fin();
  if (!v) {
    if (Object.keys(j.vus).length >= 50000) return fin();
    v = j.vus[e] = {n: 0};
    j.visiteurs++; if (/Mobi|Android|iPhone/i.test(ua)) j.mobile++;
    plus(j.entrees, p); plus(j.sources, source(d, hote));
    const c = String(d.c || '').toLowerCase().replace(/[^a-z0-9_.\- ]/g, '').trim().slice(0, 40);
    if (c) plus(j.campagnes, c);
  }
  if (++v.n > MAX_PAR_VISITEUR) return fin();
  j.vues++; plus(j.pages, p); sale = true;
  fin();
}

// ---------- lecture par l'équipe ----------
const jourDe = iso => iso ? jourParis(new Date(iso)) : null;
function lecture(req, res, url) {
  if (!C.sessionAdmin(req)) return repondre(res, 401, {erreur: 'Connexion équipe requise.'});
  const n = Math.min(Math.max(parseInt(url.searchParams.get('jours'), 10) || 30, 1), 365);
  charger(); enregistrer(true);
  const jours = [];
  for (let i = n - 1; i >= 0; i--) jours.push(jourParis(new Date(Date.now() - i * 86400e3)));
  const debut = jours[0];
  // Dossiers créés et payés sur la période (lus dans les dossiers eux-mêmes, pas dans la mesure).
  const crees = {}, payes = {}, ca = {};
  for (const f of B.liste('commandes')) {
    if (!/^BP-\w{6}\.json$/.test(f)) continue;
    const c = B.lire('commandes', f); if (!c) continue;
    const jc = jourDe(c.date); if (jc && jc >= debut) crees[jc] = (crees[jc] || 0) + 1;
    const a = c.paiements && c.paiements.acompte;
    if (a && !a.gratuit) { const ja = jourDe(a.date); if (ja && ja >= debut) { payes[ja] = (payes[ja] || 0) + 1; ca[ja] = (ca[ja] || 0) + (c.total || 0); } }
  }
  const plans = {};
  for (const f of B.liste('plans')) {
    if (!f.endsWith('.json')) continue;
    const b = B.lire('plans', f); const jp = b && b.paye && jourDe(b.paye.date);
    if (jp && jp >= debut) plans[jp] = (plans[jp] || 0) + 1;
  }
  const cumul = {pages: {}, entrees: {}, sources: {}, campagnes: {}, etapes: {}};
  const T = {vues: 0, visiteurs: 0, mobile: 0, crees: 0, payes: 0, plans: 0, ca: 0};
  let premier = null;
  const serie = jours.map(jour => {
    const d = B.lire(DOSSIER, jour + '.json') || {};
    if (d.vues && !premier) premier = jour;
    for (const k of Object.keys(cumul)) for (const [c, v] of Object.entries(d[k] || {})) cumul[k][c] = (cumul[k][c] || 0) + v;
    const l = {jour, vues: d.vues || 0, visiteurs: d.visiteurs || 0, crees: crees[jour] || 0, payes: payes[jour] || 0, plans: plans[jour] || 0};
    T.vues += l.vues; T.visiteurs += l.visiteurs; T.mobile += d.mobile || 0; T.crees += l.crees; T.payes += l.payes; T.plans += l.plans; T.ca += ca[jour] || 0;
    return l;
  });
  const tri = (o, max) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, max).map(([nom, n]) => ({nom, n}));
  repondre(res, 200, {jours: n, premier, serie, total: T, pages: tri(cumul.pages, 25), entrees: tri(cumul.entrees, 15), sources: tri(cumul.sources, 15), campagnes: tri(cumul.campagnes, 15), etapes: cumul.etapes});
}

module.exports = {signal, lecture, enregistrer, _page: page, _source: source};
