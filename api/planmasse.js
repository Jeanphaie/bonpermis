'use strict';
/* Plan de masse automatique (pièce DP2 / PCMI2) : un PDF A3 vectoriel, à l'échelle, fabriqué sans aucune dépendance.
   Entrées : le terrain renvoyé par /api/terrain (parcelle, voisines, bâtiments) et le plan posé par le client dans
   l'éditeur (src/plan.js : formes en longitude / latitude). Sortie : un Buffer PDF.
   Le client place et dimensionne son projet : ce plan met ses données au propre, il ne vérifie pas le PLU.
   Les cotes viennent du cadastre et de la BD TOPO (IGN) : elles n'ont pas valeur de bornage, c'est écrit sur le plan. */

const zlib = require('zlib');

// ---------- petit moteur PDF (Helvetica standard, encodage WinAnsi, flux compressés) ----------
const MM = 72 / 25.4;
const W_REG = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const W_BOLD = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];
const SANS_ACCENT = {'à':'a','â':'a','ä':'a','ç':'c','é':'e','è':'e','ê':'e','ë':'e','î':'i','ï':'i','ô':'o','ö':'o','ù':'u','û':'u','ü':'u','À':'A','Â':'A','Ç':'C','É':'E','È':'E','Ê':'E','Î':'I','Ô':'O','Ù':'U','Û':'U'};
const SPECIAUX = {'€': 0x80, '’': 0x92, '‘': 0x91, '–': 0x96, '—': 0x97, '…': 0x85, 'œ': 0x9C, 'Œ': 0x8C, '“': 0x93, '”': 0x94};
function largeur(s, taille, gras) {
  const T = gras ? W_BOLD : W_REG; let w = 0;
  for (const ch of String(s)) {
    const c = (SANS_ACCENT[ch] || ch).charCodeAt(0);
    w += c >= 32 && c <= 126 ? T[c - 32] : ch === '²' ? 333 : ch === '°' ? 400 : 556;
  }
  return w * taille / 1000 / MM; // en mm
}
function octets(s) {
  let out = '';
  for (const ch of String(s)) {
    let c = SPECIAUX[ch] != null ? SPECIAUX[ch] : ch.charCodeAt(0);
    if (c > 255) c = 63;
    if (c === 40 || c === 41 || c === 92) out += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) out += '\\' + c.toString(8).padStart(3, '0');
    else out += String.fromCharCode(c);
  }
  return out;
}
const n = v => (Math.round(v * 1000) / 1000).toString();

class Page {
  constructor(l, h) { this.l = l; this.h = h; this.ops = []; }
  o(s) { this.ops.push(s); return this; }
  trait(c, ep, tirets) { this.o(`${c.map(v => n(v / 255)).join(' ')} RG ${n(ep * MM)} w ${tirets ? '[' + tirets.map(v => n(v * MM)).join(' ') + '] 0 d' : '[] 0 d'}`); return this; }
  fond(c) { this.o(`${c.map(v => n(v / 255)).join(' ')} rg`); return this; }
  chemin(pts, ferme) { this.o(pts.map((p, i) => `${n(p[0] * MM)} ${n(p[1] * MM)} ${i ? 'l' : 'm'}`).join(' ') + (ferme ? ' h' : '')); return this; }
  ligne(a, b) { return this.chemin([a, b]).o('S'); }
  poly(pts, mode) { return this.chemin(pts, true).o(mode || 'S'); } // S contour, f plein, B les deux
  rect(x, y, l, h, mode) { return this.o(`${n(x * MM)} ${n(y * MM)} ${n(l * MM)} ${n(h * MM)} re ${mode || 'S'}`); }
  cercle(c, r, mode) {
    const k = 0.5523 * r, [x, y] = c, P = (a, b) => `${n(a * MM)} ${n(b * MM)}`;
    return this.o(`${P(x + r, y)} m ${P(x + r, y + k)} ${P(x + k, y + r)} ${P(x, y + r)} c ${P(x - k, y + r)} ${P(x - r, y + k)} ${P(x - r, y)} c ${P(x - r, y - k)} ${P(x - k, y - r)} ${P(x, y - r)} c ${P(x + k, y - r)} ${P(x + r, y - k)} ${P(x + r, y)} c ${mode || 'S'}`);
  }
  // Texte : align 'g' | 'c' | 'd', angle en degrés (sens trigonométrique).
  texte(s, x, y, o = {}) {
    const t = o.taille || 8, gras = !!o.gras, w = largeur(s, t, gras);
    const a = (o.angle || 0) * Math.PI / 180, dx = o.align === 'c' ? -w / 2 : o.align === 'd' ? -w : 0;
    const ox = x + dx * Math.cos(a), oy = y + dx * Math.sin(a);
    this.fond(o.couleur || [15, 23, 51]);
    this.o(`BT /${gras ? 'F2' : 'F1'} ${n(t)} Tf ${n(Math.cos(a))} ${n(Math.sin(a))} ${n(-Math.sin(a))} ${n(Math.cos(a))} ${n(ox * MM)} ${n(oy * MM)} Tm (${octets(s)}) Tj ET`);
    return this;
  }
  // Texte coupé à la largeur donnée ; renvoie l'ordonnée sous la dernière ligne.
  paragraphe(s, x, y, larg, o = {}) {
    const t = o.taille || 7, inter = o.inter || t * 0.47; let ligne = '';
    for (const mot of String(s).split(/\s+/)) {
      const essai = ligne ? ligne + ' ' + mot : mot;
      if (ligne && largeur(essai, t, o.gras) > larg) { this.texte(ligne, x, y, o); y -= inter; ligne = mot; } else ligne = essai;
    }
    if (ligne) { this.texte(ligne, x, y, o); y -= inter; }
    return y;
  }
  decoupe(pts) { return this.o('q').chemin(pts, true).o('W n'); }
  fin() { return this.o('Q'); }
}

function pdf(pages, titre) {
  const objs = []; const add = s => { objs.push(s); return objs.length; };
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const gs = add('<< /Type /ExtGState /ca 0.16 /CA 0.16 >>');
  const idPages = objs.length + 1; objs.push(null);
  const kids = [];
  for (const p of pages) {
    const flux = zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'));
    const c = add(Buffer.concat([Buffer.from(`<< /Length ${flux.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), flux, Buffer.from('\nendstream', 'latin1')]));
    kids.push(add(`<< /Type /Page /Parent ${idPages} 0 R /MediaBox [0 0 ${n(p.l * MM)} ${n(p.h * MM)}] /Contents ${c} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> /ExtGState << /GS1 ${gs} 0 R >> >> >>`));
  }
  objs[idPages - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
  const cat = add(`<< /Type /Catalog /Pages ${idPages} 0 R >>`);
  const info = add(`<< /Title (${octets(titre || 'Plan de masse')}) /Producer (bonpermis.fr) /Creator (Le Bon Permis) >>`);
  const morceaux = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')]; const pos = []; let off = morceaux[0].length;
  objs.forEach((o, i) => {
    pos.push(off);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), Buffer.isBuffer(o) ? o : Buffer.from(o, 'latin1'), Buffer.from('\nendobj\n', 'latin1')]);
    morceaux.push(b); off += b.length;
  });
  let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + pos.map(p => String(p).padStart(10, '0') + ' 00000 n \n').join('');
  x += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R /Info ${info} 0 R >>\nstartxref\n${off}\n%%EOF\n`;
  morceaux.push(Buffer.from(x, 'latin1'));
  return Buffer.concat(morceaux);
}

// ---------- géométrie (mètres, repère local, nord en haut) ----------
const R = 6378137, RAD = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add2 = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
const len = a => Math.hypot(a[0], a[1]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const fermer = pts => (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) ? pts.slice(0, -1) : pts;
const segs = pts => pts.map((p, i) => [p, pts[(i + 1) % pts.length]]);
const centre = pts => mul(pts.reduce((s, p) => add2(s, p), [0, 0]), 1 / pts.length);
const aire = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
function dedans(pt, pts) {
  let ok = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) ok = !ok;
  }
  return ok;
}
function projSeg(p, a, b) { const ab = sub(b, a), t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1))); return add2(a, mul(ab, t)); }
// Rayon o + t.d contre le segment [a, b] : t ou null.
function rayon(o, d, a, b) {
  const e = sub(b, a), det = d[0] * -e[1] + d[1] * e[0]; if (Math.abs(det) < 1e-9) return null;
  const ao = sub(a, o), t = (ao[0] * -e[1] + ao[1] * e[0]) / det, u = (d[0] * ao[1] - d[1] * ao[0]) / det;
  return t > 1e-6 && u >= -1e-6 && u <= 1 + 1e-6 ? t : null;
}
function rectPts(c, L, P, a) {
  const u = [Math.cos(a * RAD), Math.sin(a * RAD)], v = [-u[1], u[0]];
  return [[-L / 2, -P / 2], [L / 2, -P / 2], [L / 2, P / 2], [-L / 2, P / 2]].map(([x, y]) => add2(c, add2(mul(u, x), mul(v, y))));
}
const fr = (v, d = 2) => v.toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d}).replace(/[\u202f\u00a0]/g, ' ');
const anneau = g => !g ? [] : g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates[0][0] : [];

// ---------- le plan ----------
const INK = [15, 23, 51], GRIS = [86, 96, 121], CLAIR = [201, 209, 228], ROUGE = [200, 40, 40], BLEU = [0, 35, 180];
const ECHELLES = [100, 200, 250, 500, 1000, 2000];

/* terrain : réponse de /api/terrain. plan : {formes: [{t:'rect', c:[lon,lat], L, P, a}]}.
   infos : {projet, hauteur, demandeur, adresse, date, piece ('DP2' | 'PCMI2'), apercu (filigrane)}. */
function planMasse(terrain, plan, infos = {}) {
  if (!terrain || !terrain.parcelle || !terrain.parcelle.geometrie) throw new Error('Parcelle introuvable pour cette adresse.');
  const parcLL = fermer(anneau(terrain.parcelle.geometrie));
  const o = centre(parcLL), k = Math.cos(o[1] * RAD);
  const m = p => [(p[0] - o[0]) * RAD * R * k, (p[1] - o[1]) * RAD * R];
  const parc = parcLL.map(m);
  const bats = (terrain.batiments || []).map(b => ({pts: fermer(b.contour).map(m), sur: !!b.surParcelle, h: b.hauteur, emprise: b.emprise}));
  const vois = (terrain.voisines || []).map(v => ({pts: fermer(v.contour).map(m), numero: v.numero}));
  const formes = ((plan && plan.formes) || []).filter(f => f.t === 'rect').map(f => ({pts: rectPts(m(f.c), +f.L, +f.P, +f.a || 0), L: +f.L, P: +f.P}));
  if (!formes.length) throw new Error('Aucun projet placé sur le plan.');

  // Mise en page A3 paysage (mm) : dessin à gauche, colonne à droite, cartouche en bas.
  const PL = 420, PH = 297, pg = new Page(PL, PH);
  const Z = {x: 16, y: 42, l: 284, h: 218}, COL = {x: 310, l: 94};
  const tout = [...parc, ...formes.flatMap(f => f.pts)];
  const xs = tout.map(p => p[0]), ys = tout.map(p => p[1]);
  const bx = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], marge = 5;
  const den = ECHELLES.find(d => (bx[2] - bx[0] + 2 * marge) * 1000 / d <= Z.l && (bx[3] - bx[1] + 2 * marge) * 1000 / d <= Z.h) || 2000;
  const e = 1000 / den, cm = [(bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2], cz = [Z.x + Z.l / 2, Z.y + Z.h / 2];
  const T = p => [cz[0] + (p[0] - cm[0]) * e, cz[1] + (p[1] - cm[1]) * e];

  // Cadre, titre
  pg.trait(INK, 0.35).rect(10, 10, 400, 277);
  pg.texte('PLAN DE MASSE - ÉTAT PROJETÉ', 16, 277, {taille: 15, gras: true});
  pg.texte('Construction projetée cotée dans les trois dimensions, distances aux limites du terrain', 16, 271.5, {taille: 8, couleur: GRIS});

  // --- dessin, découpé à la zone ---
  pg.decoupe([[Z.x, Z.y], [Z.x + Z.l, Z.y], [Z.x + Z.l, Z.y + Z.h], [Z.x, Z.y + Z.h]]);
  pg.fond([247, 248, 252]).rect(Z.x, Z.y, Z.l, Z.h, 'f');
  // Parcelles voisines
  pg.trait(CLAIR, 0.18);
  for (const v of vois) pg.poly(v.pts.map(T));
  for (const v of vois) { const c = T(centre(v.pts)); if (v.numero && c[0] > Z.x + 4 && c[0] < Z.x + Z.l - 4 && c[1] > Z.y + 4 && c[1] < Z.y + Z.h - 4) pg.texte(v.numero, c[0], c[1], {taille: 6.5, align: 'c', couleur: [150, 158, 180]}); }
  // Terrain du projet : fond blanc
  pg.fond([255, 255, 255]).poly(parc.map(T), 'f');
  // Bâtiments voisins puis bâtiments du terrain
  pg.trait([170, 178, 200], 0.15).fond([228, 232, 242]);
  for (const b of bats.filter(b => !b.sur)) pg.poly(b.pts.map(T), 'B');
  pg.trait(INK, 0.3).fond([190, 197, 214]);
  for (const b of bats.filter(b => b.sur)) pg.poly(b.pts.map(T), 'B');
  // Limite du terrain : trait mixte épais
  pg.trait(INK, 0.6, [6, 1.5, 1, 1.5]).poly(parc.map(T));

  // Projet : hachures rouges + contour
  for (const f of formes) {
    const P = f.pts.map(T), X = P.map(p => p[0]), Y = P.map(p => p[1]);
    pg.fond([255, 240, 238]).poly(P, 'f');
    pg.decoupe(P).trait(ROUGE, 0.15);
    for (let d = Math.min(...X) - (Math.max(...Y) - Math.min(...Y)); d < Math.max(...X); d += 1.6) pg.ligne([d, Math.min(...Y)], [d + (Math.max(...Y) - Math.min(...Y)), Math.max(...Y)]);
    pg.fin();
    pg.trait(ROUGE, 0.55).poly(P);
  }

  // Cotes
  const cote = (a, b, txt, coul) => { // a, b en mm papier
    const u = unit(sub(b, a)), v = [-u[1], u[0]], t = 0.9;
    pg.trait(coul, 0.18).ligne(a, b);
    for (const p of [a, b]) pg.ligne(add2(p, mul(add2(u, v), -t)), add2(p, mul(add2(u, v), t)));
    let ang = Math.atan2(u[1], u[0]) / RAD; let nn = v;
    if (ang > 90 || ang <= -90) { ang += ang > 0 ? -180 : 180; nn = mul(v, -1); }
    const w = largeur(txt, 7, true), court = len(sub(b, a)) < w + 3;
    const mi = court ? add2(add2(b, mul(u, w / 2 + 2.2)), mul(nn, -1.0)) : add2(mul(add2(a, b), 0.5), mul(nn, 1.1));
    pg.fond([255, 255, 255]); // petit fond blanc sous le chiffre, pour rester lisible sur les hachures et les limites
    const c0 = add2(mi, mul(nn, 1.0)), uu = [Math.cos(ang * RAD), Math.sin(ang * RAD)], vv = [-uu[1], uu[0]];
    pg.poly([add2(add2(c0, mul(uu, -w / 2 - 0.6)), mul(vv, -1.6)), add2(add2(c0, mul(uu, w / 2 + 0.6)), mul(vv, -1.6)), add2(add2(c0, mul(uu, w / 2 + 0.6)), mul(vv, 1.7)), add2(add2(c0, mul(uu, -w / 2 - 0.6)), mul(vv, 1.7))], 'f');
    pg.texte(txt, mi[0], mi[1], {taille: 7, gras: true, align: 'c', angle: ang, couleur: coul});
  };
  const distances = [];
  for (const f of formes) {
    const c = centre(f.pts), S = segs(f.pts);
    // Pour chaque côté : sa normale vers l'extérieur et la distance à la limite du terrain en face.
    const cotes4 = S.map(([a, b]) => {
      const mid = mul(add2(a, b), 0.5); let nrm = unit([b[1] - a[1], -(b[0] - a[0])]);
      if ((mid[0] - c[0]) * nrm[0] + (mid[1] - c[1]) * nrm[1] < 0) nrm = mul(nrm, -1);
      let best = null; for (const [p, q] of segs(parc)) { const t = rayon(mid, nrm, p, q); if (t != null && (best == null || t < best)) best = t; }
      return {mid, nrm, libre: best == null ? 99 : best};
    });
    // Les deux dimensions se placent sur les deux côtés voisins qui ont le plus de place devant eux.
    let paire = 0, mieux = -1; for (let i = 0; i < 4; i++) { const v = Math.min(cotes4[i].libre, cotes4[(i + 1) % 4].libre); if (v > mieux) { mieux = v; paire = i; } }
    const avecDim = [paire, (paire + 1) % 4];
    S.forEach(([a, b], i) => {
      const {mid, nrm} = cotes4[i], porte = avecDim.includes(i);
      // Dimension du côté (deux côtés suffisent), décalée de 4 mm vers l'extérieur
      if (porte) { const dec = mul(nrm, 4 / e); pg.trait(ROUGE, 0.12).ligne(T(a), T(add2(a, dec))).ligne(T(b), T(add2(b, dec))); cote(T(add2(a, dec)), T(add2(b, dec)), fr(len(sub(b, a))), ROUGE); }
      // Distance à la limite du terrain, perpendiculaire au côté
      const dep = porte ? add2(a, mul(sub(b, a), 0.8)) : mid;
      let best = null; for (const [p, q] of segs(parc)) { const t = rayon(dep, nrm, p, q); if (t != null && (best == null || t < best)) best = t; }
      // Si une construction du terrain est sur le chemin, cette cote n'a pas de sens : on la saute.
      const obstacle = best != null && bats.some(bb => bb.sur && segs(bb.pts).some(([p, q]) => { const t = rayon(dep, nrm, p, q); return t != null && t < best; }));
      if (!obstacle && best != null && best < 60 && dedans(add2(dep, mul(nrm, Math.min(best, 0.05))), parc)) { distances.push(best); cote(T(dep), T(add2(dep, mul(nrm, best))), fr(best), BLEU); }
    });
    // Distance au bâtiment le plus proche du terrain
    let pres = null;
    for (const b of bats.filter(b => b.sur)) {
      for (const p of f.pts) for (const [a2, b2] of segs(b.pts)) { const q = projSeg(p, a2, b2), d = len(sub(p, q)); if (!pres || d < pres.d) pres = {d, a: p, b: q}; }
      for (const p of b.pts) for (const [a2, b2] of S) { const q = projSeg(p, a2, b2), d = len(sub(p, q)); if (!pres || d < pres.d) pres = {d, a: q, b: p}; }
    }
    if (pres && pres.d > 0.3 && pres.d < 40) { f.maison = pres.d; cote(T(pres.a), T(pres.b), fr(pres.d), GRIS); }
    // Nom, hauteur
    const tc = T(c), lg = Math.min(f.L, f.P) * e;
    const nom = String(infos.projet || 'Projet').toUpperCase();
    // Étiquette sur fond blanc : dans la forme si elle est assez grande, sinon on s'en tient à la légende et au tableau.
    const l1 = nom, l2 = infos.hauteur ? 'H ' + fr(+infos.hauteur) + ' m' : '', tl = 6.5, wl = Math.max(largeur(l1, tl, true), largeur(l2, tl));
    if (lg > 9 && Math.max(f.L, f.P) * e > wl * 0.7) { pg.fond([255, 255, 255]).rect(tc[0] - wl / 2 - 1, tc[1] - 3.6, wl + 2, l2 ? 7.4 : 4.2, 'f'); pg.texte(l1, tc[0], tc[1] + (l2 ? 0.9 : -1.2), {taille: tl, gras: true, align: 'c', couleur: ROUGE}); if (l2) pg.texte(l2, tc[0], tc[1] - 2.3, {taille: tl, align: 'c', couleur: ROUGE}); }
  }
  // Bâtiments du terrain : libellé et hauteur connue
  for (const b of bats.filter(b => b.sur && aire(b.pts) > 30)) {
    const c = T(centre(b.pts));
    pg.texte('EXISTANT', c[0], c[1] + 0.6, {taille: 6.5, gras: true, align: 'c'});
    if (b.h) pg.texte('égout ' + fr(b.h, 1) + ' m env.', c[0], c[1] - 2.4, {taille: 5.5, align: 'c', couleur: GRIS});
  }
  pg.fin();
  pg.trait(CLAIR, 0.2).rect(Z.x, Z.y, Z.l, Z.h);

  // Nord (en haut à droite du dessin)
  const N = [Z.x + Z.l - 10, Z.y + Z.h - 14];
  pg.fond(INK).poly([[N[0], N[1] + 7], [N[0] - 2.4, N[1] - 2], [N[0], N[1]]], 'f');
  pg.trait(INK, 0.25).poly([[N[0], N[1] + 7], [N[0] + 2.4, N[1] - 2], [N[0], N[1]]]);
  pg.texte('N', N[0], N[1] + 8.4, {taille: 8, gras: true, align: 'c'});
  // Échelle graphique
  const pas = den <= 100 ? 2 : den <= 250 ? 5 : den <= 500 ? 10 : 20, E0 = [Z.x + 6, Z.y + 7];
  pg.fond([255, 255, 255]).rect(E0[0] - 3, E0[1] - 4, pas * 2 * e + 16, 10, 'f');
  for (let i = 0; i < 2; i++) { pg.fond(i ? [255, 255, 255] : INK).trait(INK, 0.2).rect(E0[0] + i * pas * e, E0[1], pas * e, 1.4, 'B'); }
  [0, pas, pas * 2].forEach((v, i) => pg.texte(String(v), E0[0] + i * pas * e, E0[1] + 2.4, {taille: 6, align: 'c'}));
  pg.texte('m', E0[0] + 2 * pas * e + 4, E0[1] + 2.4, {taille: 6});
  pg.texte('Échelle 1/' + den, E0[0], E0[1] - 2.8, {taille: 6, couleur: GRIS});

  // --- colonne de droite ---
  let y = 258; const X = COL.x;
  const titre = t => { pg.texte(t, X, y, {taille: 8, gras: true}); y -= 2; pg.trait(INK, 0.3).ligne([X, y], [X + COL.l, y]); y -= 5; };
  titre('LÉGENDE');
  const leg = (dessin, t) => { dessin(y); pg.texte(t, X + 14, y, {taille: 7}); y -= 6; };
  leg(yy => pg.trait(INK, 0.3).fond([190, 197, 214]).rect(X, yy - 1, 10, 4, 'B'), 'Construction existante conservée');
  leg(yy => { pg.fond([255, 240, 238]).trait(ROUGE, 0.5).rect(X, yy - 1, 10, 4, 'B'); pg.decoupe([[X, yy - 1], [X + 10, yy - 1], [X + 10, yy + 3], [X, yy + 3]]).trait(ROUGE, 0.15); for (let d = X - 4; d < X + 10; d += 1.6) pg.ligne([d, yy - 1], [d + 4, yy + 3]); pg.fin(); }, 'Construction projetée');
  leg(yy => pg.trait([170, 178, 200], 0.15).fond([228, 232, 242]).rect(X, yy - 1, 10, 4, 'B'), 'Bâti voisin (IGN)');
  leg(yy => pg.trait(INK, 0.6, [6, 1.5, 1, 1.5]).ligne([X, yy + 1], [X + 10, yy + 1]), 'Limite du terrain (cadastre)');
  leg(yy => pg.trait(BLEU, 0.2).ligne([X, yy + 1], [X + 10, yy + 1]), 'Distance aux limites du terrain (m)');
  leg(yy => pg.trait(ROUGE, 0.2).ligne([X, yy + 1], [X + 10, yy + 1]), 'Dimensions de la construction projetée (m)');
  y -= 4;

  titre('SURFACES');
  const terrainM2 = terrain.parcelle.contenance || terrain.parcelle.surfaceCalculee || Math.round(aire(parc));
  const exist = bats.filter(b => b.sur).reduce((s, b) => s + (b.emprise || aire(b.pts)), 0);
  const projet = formes.reduce((s, f) => s + f.L * f.P, 0);
  const lignes = [
    ['Terrain (surface cadastrale)', fr(terrainM2, 0) + ' m²'],
    ['Emprise au sol existante (IGN)', fr(exist, 0) + ' m²'],
    ['Emprise au sol créée', fr(projet) + ' m²'],
    ['Emprise totale après travaux', fr(exist + projet, 0) + ' m², soit ' + fr((exist + projet) / terrainM2 * 100, 1) + ' %']
  ];
  for (const [a, b] of lignes) { pg.texte(a, X, y, {taille: 7, couleur: GRIS}); pg.texte(b, X + COL.l, y, {taille: 7, gras: true, align: 'd'}); y -= 2; pg.trait(CLAIR, 0.15).ligne([X, y], [X + COL.l, y]); y -= 4.5; }
  y -= 4;

  titre('CONSTRUCTION PROJETÉE');
  const f0 = formes[0];
  const det = [
    ['Nature', infos.projet || 'Projet'],
    ['Longueur x largeur', fr(f0.L) + ' x ' + fr(f0.P) + ' m'],
    infos.hauteur ? ['Hauteur au point le plus haut', fr(+infos.hauteur) + ' m'] : null,
    distances.length ? ['Distance minimale aux limites', fr(Math.min(...distances)) + ' m'] : null,
    f0.maison ? ['Distance à la construction existante', fr(f0.maison) + ' m'] : null
  ].filter(Boolean);
  for (const [a, b] of det) { pg.texte(a, X, y, {taille: 7, couleur: GRIS}); pg.texte(b, X + COL.l, y, {taille: 7, gras: true, align: 'd'}); y -= 2; pg.trait(CLAIR, 0.15).ligne([X, y], [X + COL.l, y]); y -= 4.5; }
  y -= 4;

  titre('À SAVOIR');
  const z = terrain.zone;
  const notes = [
    z ? `Terrain en zone ${z.libelle} du plan local d'urbanisme${terrain.commune && terrain.commune.nom ? ' (' + terrain.commune.nom[0] + terrain.commune.nom.slice(1).toLowerCase() + ')' : ''}. Ce plan ne vérifie pas que le projet respecte le règlement de cette zone.` : (terrain.commune && terrain.commune.rnu ? 'Commune sans plan local d\'urbanisme : le règlement national d\'urbanisme s\'applique.' : null),
    'Limites et surface du terrain : plan cadastral (DGFiP). Bâtiments existants : BD TOPO (IGN). Ces données peuvent s\'écarter du terrain réel de 1 à 2 m : les cotes n\'ont pas valeur de bornage.',
    'Emplacement, dimensions et hauteur de la construction projetée : indiqués par le demandeur.'
  ].filter(Boolean);
  for (const t of notes) { y = pg.paragraphe('- ' + t, X, y, COL.l, {taille: 6.5, couleur: GRIS, inter: 3.1}); y -= 1.5; }

  // --- cartouche ---
  const cy = 10, ch = 22;
  pg.trait(INK, 0.7).ligne([10, cy + ch], [410, cy + ch]);
  const cols = [['DEMANDEUR', infos.demandeur || '', 55], ['ADRESSE DU TERRAIN', infos.adresse || '', 85], ['PARCELLE', terrain.parcelle.section + ' ' + String(terrain.parcelle.numero).replace(/^0+/, ''), 35],
    ['PROJET', infos.projet || '', 70], ['DOCUMENT', 'Plan de masse - état projeté', 65], ['ÉCHELLE', '1/' + den, 22], ['FORMAT', 'A3', 18], ['DATE', infos.date || '', 22]];
  let cx = 10;
  for (const [lab, val, w] of cols) {
    pg.texte(lab, cx + 3, cy + ch - 6, {taille: 5, couleur: GRIS});
    let t = String(val), tl = 8; while (largeur(t, tl, lab === 'DOCUMENT') > w - 6 && tl > 5.5) tl -= 0.5;
    pg.texte(t, cx + 3, cy + ch - 13, {taille: tl, gras: lab === 'DOCUMENT'});
    cx += w; pg.trait(CLAIR, 0.2).ligne([cx, cy], [cx, cy + ch]);
  }
  pg.texte('PIÈCE', cx + 3, cy + ch - 6, {taille: 5, couleur: GRIS});
  pg.texte(infos.piece || 'DP2', cx + 3, cy + 4.5, {taille: 20, gras: true});
  pg.texte('Plan établi avec bonpermis.fr à partir des données publiques du cadastre et de l\'IGN.', 210, 5.5, {taille: 6, align: 'c', couleur: GRIS});

  // Filigrane de l'aperçu gratuit
  if (infos.apercu) {
    pg.o('q /GS1 gs');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) pg.texte('APERÇU - bonpermis.fr', 40 + i * 105, 55 + j * 85, {taille: 26, gras: true, angle: 28, couleur: [0, 35, 180]});
    pg.o('Q');
  }
  return {pdf: pdf([pg], 'Plan de masse - ' + (infos.adresse || '')), echelle: den, mesures: {terrain: terrainM2, existant: Math.round(exist), projet, distances: distances.map(d => Math.round(d * 100) / 100), maison: f0.maison || null}};
}

module.exports = {planMasse, _pdf: {Page, pdf, largeur}};
