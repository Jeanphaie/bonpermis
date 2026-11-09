'use strict';
/* Le terrain d'une adresse, à partir des données publiques gratuites de l'IGN (Géoplateforme et API Carto).
   - GET /api/terrain/adresses?q=...      suggestions d'adresses (Base Adresse Nationale)
   - GET /api/terrain?lon=..&lat=..        parcelle, bâtiments (hauteur à la gouttière), zone du PLU,
                                            secteur protégé (monuments historiques AC1, sites AC2, SPR AC4), commune au RNU
   Chaque source est interrogée séparément : si l'une ne répond pas, le reste est renvoyé et « erreurs » le signale.
   Les données publiques ne sont pas exhaustives (servitudes absentes du Géoportail de l'urbanisme dans certaines communes) :
   l'absence de protection n'est jamais présentée comme une certitude. */

const B = require('./base');
const {fs, path, repondre, journal} = B;

const GEOPF = 'https://data.geopf.fr', CARTO = 'https://apicarto.ign.fr/api';
const DELAI = 9000, DUREE_CACHE = 7 * 86400000;
const cache = new Map();

const PROTECTIONS = {
  ac1: 'Monument historique ou ses abords',
  ac2: 'Site inscrit ou classé',
  ac4: 'Site patrimonial remarquable'
};

// Les noms du Géoportail de l'urbanisme arrivent parfois mal encodés (« SacrÃ©-CÅur »).
function reparer(s) {
  s = String(s || '');
  if (!/[ÃÅÂ]/.test(s)) return s;
  try { const r = Buffer.from(s, 'latin1').toString('utf8'); return r.includes('�') ? s : r; } catch { return s; }
}

async function lireUrl(url) {
  const r = await fetch(url, {signal: AbortSignal.timeout(DELAI), headers: {'User-Agent': 'bonpermis.fr (service terrain)', Accept: 'application/json'}});
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// ---------- géométrie (degrés, petites distances : projection locale en mètres) ----------
const R = 6378137;
function versMetres(origine) {
  const k = Math.cos(origine[1] * Math.PI / 180);
  return p => [(p[0] - origine[0]) * Math.PI / 180 * R * k, (p[1] - origine[1]) * Math.PI / 180 * R];
}
function anneaux(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map(p => p[0]);
  return [];
}
const plat = ring => ring.map(c => [c[0], c[1]]);
function dedans(pt, ring) {
  let ok = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}
function aire(ring, m) { let s = 0; const q = ring.map(m); for (let i = 0, j = q.length - 1; i < q.length; j = i++) s += (q[j][0] + q[i][0]) * (q[j][1] - q[i][1]); return Math.abs(s / 2); }
function centre(ring) { let x = 0, y = 0; const n = ring.length - (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0); for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; } return [x / n, y / n]; }
function boite(rings) {
  let a = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) a = [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)];
  return a;
}

// ---------- adresses ----------
async function adresses(req, res, url) {
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 200);
  if (q.length < 3) return repondre(res, 200, {adresses: []});
  if (B.trop('adr:' + B.ip(req), 300)) return repondre(res, 429, {erreur: 'Trop de demandes.'});
  try {
    const j = await lireUrl(`${GEOPF}/geocodage/search?q=${encodeURIComponent(q)}&limit=6&autocomplete=1`);
    const out = (j.features || []).filter(f => f.geometry && f.geometry.coordinates).map(f => ({
      label: f.properties.label, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1],
      insee: f.properties.citycode, type: f.properties.type
    }));
    repondre(res, 200, {adresses: out}, {'Cache-Control': 'public, max-age=3600'});
  } catch (e) {
    journal('terrain adresses', e.message);
    repondre(res, 502, {erreur: 'La recherche d\'adresse ne répond pas pour le moment.', adresses: []});
  }
}

// ---------- terrain ----------
async function analyserTerrain(lon, lat) {
  const pt = encodeURIComponent(JSON.stringify({type: 'Point', coordinates: [lon, lat]}));
  const erreurs = [];
  const essai = async (nom, f) => { try { return await f(); } catch (e) { erreurs.push(nom); journal('terrain', nom, e.message); return null; } };

  const [parc, zone, sup] = await Promise.all([
    essai('cadastre', () => lireUrl(`${CARTO}/cadastre/parcelle?geom=${pt}`)),
    essai('plu', () => lireUrl(`${CARTO}/gpu/zone-urba?geom=${pt}`)),
    essai('servitudes', () => lireUrl(`${CARTO}/gpu/assiette-sup-s?geom=${pt}`))
  ]);

  const out = {point: [lon, lat], parcelle: null, batiments: [], zone: null, commune: null, protections: [], erreurs};
  const m = versMetres([lon, lat]);

  const fp = parc && (parc.features || [])[0];
  let ringsParcelle = [];
  if (fp) {
    const p = fp.properties;
    ringsParcelle = anneaux(fp.geometry).map(plat);
    out.parcelle = {
      idu: p.idu, section: p.section, numero: p.numero, commune: p.nom_com, insee: p.code_insee,
      contenance: p.contenance, geometrie: fp.geometry && {type: fp.geometry.type, coordinates: fp.geometry.coordinates},
      surfaceCalculee: Math.round(ringsParcelle.reduce((s, r) => s + aire(r, m), 0))
    };
  }

  // Bâtiments autour de la parcelle (ou du point), avec une marge de 15 m pour voir les voisins.
  const b = ringsParcelle.length ? boite(ringsParcelle) : [lon, lat, lon, lat];
  const dLat = 15 / 111320, dLon = 15 / (111320 * Math.cos(lat * Math.PI / 180));
  const bbox = [b[1] - dLat, b[0] - dLon, b[3] + dLat, b[2] + dLon].map(v => v.toFixed(7)).join(',');
  const insee = out.parcelle ? out.parcelle.insee : null;
  const [bati, muni] = await Promise.all([
    essai('batiments', () => lireUrl(`${GEOPF}/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=BDTOPO_V3:batiment&outputFormat=application/json&COUNT=200&BBOX=${bbox},urn:ogc:def:crs:EPSG::4326`)),
    insee ? essai('commune', () => lireUrl(`${CARTO}/gpu/municipality?insee=${encodeURIComponent(insee)}`)) : null
  ]);

  for (const f of (bati && bati.features) || []) {
    const rs = anneaux(f.geometry).map(plat); if (!rs.length) continue;
    const p = f.properties || {};
    if (p.etat_de_l_objet && p.etat_de_l_objet !== 'En service') continue;
    const c = centre(rs[0]);
    out.batiments.push({
      id: p.cleabs || f.id, contour: rs[0],
      surParcelle: ringsParcelle.some(r => dedans(c, r)),
      emprise: Math.round(rs.reduce((s, r) => s + aire(r, m), 0)),
      hauteur: typeof p.hauteur === 'number' ? p.hauteur : null,
      etages: typeof p.nombre_d_etages === 'number' ? p.nombre_d_etages : null,
      usage: p.usage_1 || null, logements: p.nombre_de_logements || 0, leger: !!p.construction_legere
    });
  }

  const fz = zone && (zone.features || [])[0];
  if (fz) {
    const z = fz.properties;
    out.zone = {libelle: z.libelle, libelleLong: reparer(z.libelong), type: z.typezone, document: z.idurba || null, reglement: z.nomfic || null, dateValidite: z.datvalid || null};
  }
  const fm = muni && (muni.features || [])[0];
  if (fm) out.commune = {nom: fm.properties.name, insee: fm.properties.insee, rnu: !!fm.properties.is_rnu, littoral: !!fm.properties.is_coastline};

  const vus = new Set();
  for (const f of (sup && sup.features) || []) {
    const p = f.properties || {}, t = String(p.suptype || '').toLowerCase();
    if (!PROTECTIONS[t]) continue;
    const nom = reparer(p.nomsuplitt) || reparer(p.nomass);
    const cle = t + nom;
    if (vus.has(cle)) continue; vus.add(cle);
    out.protections.push({type: t, libelle: PROTECTIONS[t], nom, detail: p.typeass || ''});
  }
  // Le bâtiment lui-même classé passe avant ses abords, puis par type.
  out.protections.sort((a, c) => (c.detail === 'Monument historique') - (a.detail === 'Monument historique') || a.type.localeCompare(c.type));
  out.secteurProtege = out.protections.length ? true : (erreurs.includes('servitudes') ? null : false);
  out.date = new Date().toISOString();
  return out;
}

function cheminCache(cle) { return B.chemin('terrain', cle.replace(/[^\d.,-]/g, '_') + '.json'); }
async function terrain(req, res, url) {
  const lon = +url.searchParams.get('lon'), lat = +url.searchParams.get('lat');
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) return repondre(res, 400, {erreur: 'Coordonnées invalides.'});
  const cle = lon.toFixed(5) + ',' + lat.toFixed(5);
  const c = cache.get(cle);
  if (c && Date.now() - c.t < DUREE_CACHE) return repondre(res, 200, c.v);
  try { const st = fs.statSync(cheminCache(cle)); if (Date.now() - st.mtimeMs < DUREE_CACHE) { const v = JSON.parse(fs.readFileSync(cheminCache(cle), 'utf8')); cache.set(cle, {t: st.mtimeMs, v}); return repondre(res, 200, v); } } catch {}
  if (B.trop('terrain:' + B.ip(req), 120)) return repondre(res, 429, {erreur: 'Trop de demandes. Réessayez dans quelques minutes.'});
  const v = await analyserTerrain(+lon.toFixed(6), +lat.toFixed(6));
  if (!v.erreurs.length && v.parcelle) {
    cache.set(cle, {t: Date.now(), v});
    if (cache.size > 2000) cache.delete(cache.keys().next().value);
    try { fs.mkdirSync(path.dirname(cheminCache(cle)), {recursive: true}); fs.writeFileSync(cheminCache(cle), JSON.stringify(v)); } catch {}
  }
  repondre(res, 200, v);
}

module.exports = {adresses, terrain, analyserTerrain, reparer, _geo: {dedans, aire, versMetres, centre}};
