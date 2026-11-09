/* Plan du projet sur le terrain (espace client et espace équipe).
   Fond : photo aérienne IGN (tuiles relayées par /api/terrain/tuile). Parcelle et bâtiments : /api/terrain.
   Les formes sont gardées en longitude / latitude ; les calculs se font en mètres dans un repère local.
   Gestes selon le projet (src/pieces.json « modes ») :
     rect      rectangle libre (abri, annexe, carport, piscine)       rects     un ou plusieurs rectangles (maison neuve)
     accole    rectangle collé à une façade (extension, véranda…)     polygone  surface libre point par point (terrasse)
     limites   côtés du terrain à clore (clôture)                     point     emplacement sur la limite (portail)
     facades   une ou plusieurs façades (fenêtres, façade)            toit      côté du toit (fenêtre de toit, lucarne, panneaux)
     batiment  un ou plusieurs bâtiments (combles, garage…)           parcelle  le terrain seul (certificat d'urbanisme)
   window.BPPlan.ouvrir({...}) ouvre l'éditeur ; window.BPPlan.apercu(conteneur, plan) dessine un plan enregistré. */
(() => {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const nb = (n, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const NS = 'http://www.w3.org/2000/svg';
  const R = 6378137, RAD = Math.PI / 180;

  // ---------- repère local en mètres ----------
  function repere(o) {
    const k = Math.cos(o[1] * RAD);
    return {
      m: p => [(p[0] - o[0]) * RAD * R * k, (p[1] - o[1]) * RAD * R],
      ll: q => [o[0] + q[0] / (RAD * R * k), o[1] + q[1] / (RAD * R)]
    };
  }
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add = (a, b) => [a[0] + b[0], a[1] + b[1]], mul = (a, k) => [a[0] * k, a[1] * k];
  const len = a => Math.hypot(a[0], a[1]), unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  function aire(pts) { let s = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) s += (pts[j][0] + pts[i][0]) * (pts[j][1] - pts[i][1]); return Math.abs(s / 2); }
  function centre(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
  function ferme(pts) { const a = pts[0], b = pts[pts.length - 1]; return pts.length > 1 && a[0] === b[0] && a[1] === b[1] ? pts.slice(0, -1) : pts; }
  function segs(pts) { const o = []; for (let i = 0; i < pts.length; i++) o.push([pts[i], pts[(i + 1) % pts.length]]); return o; }
  function distSeg(p, a, b) { const ab = sub(b, a), t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1))); return len(sub(p, add(a, mul(ab, t)))); }
  function projSeg(p, a, b) { const ab = sub(b, a), t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1))); return add(a, mul(ab, t)); }
  function dedans(p, pts) { let ok = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) ok = !ok; } return ok; }
  function croise(a, b, c, d) { const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])); return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b); }
  function distPolys(A, B) { // distance minimale entre deux contours (0 s'ils se coupent)
    let m = Infinity;
    for (const [a, b] of segs(A)) for (const [c, d] of segs(B)) { if (croise(a, b, c, d)) return 0; m = Math.min(m, distSeg(a, c, d), distSeg(b, c, d), distSeg(c, a, b), distSeg(d, a, b)); }
    return m;
  }
  const ORIENT = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest'];
  const orient = v => ORIENT[Math.round(((Math.atan2(v[0], v[1]) / RAD) + 360) % 360 / 45) % 8];
  function rectPts(c, L, P, ang) { const u = [Math.cos(ang * RAD), Math.sin(ang * RAD)], v = [-u[1], u[0]]; return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => add(c, add(mul(u, i * L / 2), mul(v, j * P / 2)))); }

  // ---------- données ----------
  async function lireTerrain(lieu) {
    try { const r = await fetch(`/api/terrain?lon=${lieu.lon}&lat=${lieu.lat}`); return await r.json(); } catch (e) { return {erreur: true, batiments: [], protections: [], erreurs: ['reseau']}; }
  }
  // Monde : parcelle, bâtiments (dont ceux dessinés par le client), segments utiles, en mètres.
  function monde(t, lieu, existants) {
    const ringP = t && t.parcelle && t.parcelle.geometrie ? ferme((t.parcelle.geometrie.type === 'MultiPolygon' ? t.parcelle.geometrie.coordinates[0][0] : t.parcelle.geometrie.coordinates[0]).map(c => [c[0], c[1]])) : null;
    const o = ringP ? centre(ringP) : [lieu.lon, lieu.lat];
    const F = repere(o);
    const parc = ringP ? ringP.map(F.m) : null;
    const bats = ((t && t.batiments) || []).map(b => ({id: b.id, pts: ferme(b.contour).map(F.m), sur: b.surParcelle, hauteur: b.hauteur, etages: b.etages}));
    for (const e of existants || []) bats.push({id: e.id, pts: e.ll.map(F.m), sur: true, dessine: true});
    return {F, parc, bats, t};
  }

  // ---------- géométrie des formes ----------
  // Chaque forme stockée → contour en mètres (pour l'affichage et les mesures).
  function contour(f, W) {
    const m = W.F.m;
    if (f.t === 'rect') return rectPts(m(f.c), f.L, f.P, f.a);
    if (f.t === 'accole') {
      const a = m(f.fa), b = m(f.fb), u = unit(sub(b, a)), n = [f.s * -u[1], f.s * u[0]];
      const p0 = add(a, mul(u, f.d)), p1 = add(p0, mul(u, f.L));
      return [p0, p1, add(p1, mul(n, f.P)), add(p0, mul(n, f.P))];
    }
    if (f.t === 'poly') return f.pts.map(m);
    return null;
  }

  // ---------- dessin SVG ----------
  function el(tag, at, parent) { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); if (parent) parent.appendChild(e); return e; }
  const ptsAttr = (pts) => pts.map(p => `${p[0].toFixed(2)},${(-p[1]).toFixed(2)}`).join(' ');

  // Tuiles Web Mercator couvrant la vue, placées dans le repère local.
  function fond(g, W, vue, couche) {
    g.innerHTML = '';
    const lat0 = W.F.ll([0, 0])[1], largeur = vue[2];
    let z = Math.floor(Math.log2(156543.03 * Math.cos(lat0 * RAD) / (largeur / 900)));
    z = Math.max(15, Math.min(couche === 'plan' ? 19 : 20, z));
    const n = 2 ** z;
    const tx = lon => (lon + 180) / 360 * n, ty = lat => (1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * n;
    const lon2 = x => x / n * 360 - 180, lat2 = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) / RAD;
    const hg = W.F.ll([vue[0], -vue[1]]), bd = W.F.ll([vue[0] + vue[2], -(vue[1] + vue[3])]);
    const x0 = Math.floor(tx(hg[0])), x1 = Math.floor(tx(bd[0])), y0 = Math.floor(ty(hg[1])), y1 = Math.floor(ty(bd[1]));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const a = W.F.m([lon2(x), lat2(y)]), b = W.F.m([lon2(x + 1), lat2(y + 1)]);
      el('image', {href: `/api/terrain/tuile?c=${couche}&z=${z}&x=${x}&y=${y}`, x: a[0], y: -a[1], width: b[0] - a[0] + 0.05, height: (a[1] - b[1]) + 0.05, preserveAspectRatio: 'none'}, g);
    }
  }

  // ---------- résumé et mesures ----------
  function mesurer(plan, W, P) {
    const me = {}, l = [], alertes = [];
    const parc = W.parc;
    const surfs = [];
    for (const f of plan.formes) {
      const c = contour(f, W); if (!c) continue;
      const s = aire(c); surfs.push(s);
      let txt = '';
      if (f.t === 'rect') txt = `${nb(f.L)} m × ${nb(f.P)} m`;
      if (f.t === 'accole') { const a = W.F.m(f.fa), b = W.F.m(f.fb), u = unit(sub(b, a)); txt = `collé à la façade ${orient([f.s * -u[1], f.s * u[0]])}, ${nb(f.L)} m le long de la façade × ${nb(f.P)} m de profondeur`; }
      if (f.t === 'poly') txt = `${c.length} côtés`;
      l.push(`${txt ? txt + ', ' : ''}${nb(s)} m² au sol`);
      if (parc) {
        const dl = Math.min(...c.map(p => Math.min(...segs(parc).map(([a, b]) => distSeg(p, a, b)))));
        const hors = c.some(p => !dedans(p, parc));
        me.limite = Math.min(me.limite == null ? Infinity : me.limite, hors ? 0 : dl);
        if (hors) alertes.push('Le projet dépasse les limites du terrain (cadastre). Vérifiez son emplacement, ou dites-nous si le cadastre est faux.');
      }
      const autres = W.bats.filter(b => b.sur && !(f.t === 'accole' && b.id === f.bat));
      for (const b of autres) if (c.some(p => dedans(p, b.pts)) || b.pts.some(p => dedans(p, c))) { alertes.push('Le projet chevauche un bâtiment existant.'); break; }
    }
    if (surfs.length) {
      me.surface = surfs.reduce((a, b) => a + b, 0);
      if (me.limite != null && me.limite !== Infinity) {
        l.push(`Distance à la limite la plus proche : ${nb(me.limite)} m`);
        if (me.limite > 0 && me.limite < 3) alertes.push('À moins de 3 m d\'une limite : le PLU impose souvent un recul. On le vérifie ; si possible, mesurez cette distance sur place.');
      }
      if (P !== 'maison' && me.surface > 20 && me.surface <= 40) alertes.push('Plus de 20 m² : en zone urbaine avec PLU une déclaration suffit jusqu\'à 40 m², sinon un permis. On vérifie pour vous.');
      if (P !== 'maison' && me.surface > 40) alertes.push('Plus de 40 m² : un permis de construire est probablement nécessaire. On vérifie pour vous.');
    }
    if (plan.mode === 'limites' || plan.mode === 'point') {
      const L = (plan.cotes || []).reduce((s, k) => { const [a, b] = segs(W.parc)[k] || []; return a ? s + len(sub(b, a)) : s; }, 0);
      if (plan.mode === 'limites') { me.longueur = L; l.push(`${(plan.cotes || []).length} côté(s) du terrain, ${nb(L)} m au total`); }
      if (plan.mode === 'point' && plan.formes[0]) l.push('Portail placé sur la limite du terrain');
    }
    if (['facades', 'toit'].includes(plan.mode)) {
      const fs = plan.facades || [];
      me.facades = fs.length;
      l.push(fs.map(f => { const a = W.F.m(f.a), b = W.F.m(f.b), bat = W.bats.find(x => x.id === f.bat), c = bat ? centre(bat.pts) : a, mil = mul(add(a, b), .5), n = sub(mil, c); return `${plan.mode === 'toit' ? 'côté du toit' : 'façade'} ${orient(n)} (${nb(len(sub(b, a)))} m)`; }).join(', ') || '');
    }
    if (plan.mode === 'batiment') {
      const bs = W.bats.filter(b => (plan.bats || []).includes(b.id));
      me.emprise = bs.reduce((s, b) => s + aire(b.pts), 0);
      l.push(bs.map(b => `bâtiment de ${nb(aire(b.pts), 0)} m² au sol${b.hauteur != null ? ', ' + nb(b.hauteur) + ' m à la gouttière' : ''}`).join(', '));
    }
    if (plan.mode === 'parcelle' && W.t && W.t.parcelle) l.push(`Parcelle ${W.t.parcelle.section} ${String(W.t.parcelle.numero).replace(/^0+/, '')}, ${W.t.parcelle.contenance || W.t.parcelle.surfaceCalculee} m²`);
    if ((plan.existants || []).length) l.push('Maison dessinée par le client (absente du cadastre)');
    return {mesures: me, lignes: l.filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)), alertes: [...new Set(alertes)]};
  }

  // ---------- éditeur ----------
  const CONSIGNE = {
    rect: 'Touchez le plan à l\'endroit du projet, puis ajustez ses dimensions. Faites-le glisser pour le déplacer.',
    rects: 'Touchez le plan pour placer la maison. Vous pouvez ajouter un second volume (garage, annexe).',
    accole: 'Touchez la façade contre laquelle se fera le projet, puis réglez ses dimensions.',
    polygone: 'Touchez le plan pour poser chaque angle de la surface, dans l\'ordre.',
    limites: 'Touchez les côtés du terrain où se fera la clôture.',
    point: 'Touchez la limite du terrain à l\'endroit du portail.',
    facades: 'Touchez la ou les façades concernées.',
    toit: 'Touchez le côté du toit concerné (le bord de la maison de ce côté).',
    batiment: 'Touchez le ou les bâtiments concernés.',
    parcelle: 'Vérifiez que c\'est bien votre terrain.'
  };
  const DEFAUT = {abri: [3, 2], carport: [5, 3], piscine: [8, 4], annexe: [5, 4], maison: [10, 8], extension: [4, 4], veranda: [4, 3], pergola: [4, 3], solaire: [5, 3]};

  async function ouvrir(o) {
    const fen = document.createElement('div');
    fen.className = 'plan-fen'; fen.setAttribute('role', 'dialog'); fen.setAttribute('aria-modal', 'true'); fen.setAttribute('aria-label', 'Plan du projet');
    document.body.appendChild(fen); document.body.style.overflow = 'hidden';
    const fermer = () => { fen.remove(); document.body.style.overflow = ''; };
    let lieu = o.lieu || (o.plan && o.plan.lieu) || null;

    // Pas de point connu : on demande l'adresse.
    if (!lieu) {
      lieu = await new Promise(res => {
        fen.innerHTML = `<div class="plan-boite"><div class="plan-tete"><b>Où se trouve votre terrain ?</b><button type="button" class="plan-x" aria-label="Fermer">×</button></div>
          <div class="plan-corps"><label class="field"><span>Adresse des travaux</span><input data-adr autocomplete="off" value="${esc(o.adresse || '')}"></label><div class="sugs" data-sug></div>
          <p class="note">Choisissez votre adresse dans la liste.</p></div></div>`;
        fen.querySelector('.plan-x').onclick = () => { fermer(); res(null); };
        const inp = fen.querySelector('[data-adr]'), sug = fen.querySelector('[data-sug]'); let tm, n = 0;
        const chercher = () => { clearTimeout(tm); tm = setTimeout(async () => { const k = ++n; const q = inp.value.trim(); if (q.length < 4) { sug.innerHTML = ''; return; }
          try { const j = await (await fetch('/api/terrain/adresses?q=' + encodeURIComponent(q))).json(); if (k !== n) return;
            sug.innerHTML = (j.adresses || []).map((a, i) => `<button type="button" class="sug" data-i="${i}">${esc(a.label)}</button>`).join('');
            sug.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { const a = j.adresses[+b.dataset.i]; res({lon: a.lon, lat: a.lat}); });
          } catch (e) {} }, 250); };
        inp.addEventListener('input', chercher); if (inp.value) chercher(); inp.focus();
      });
      if (!lieu) return;
    }

    fen.innerHTML = '<div class="plan-boite"><div class="plan-corps"><p>Chargement du plan de votre terrain…</p></div></div>';
    const t = await lireTerrain(lieu);
    const mode = o.mode;
    // État de travail (repris d'un plan enregistré).
    const st = Object.assign({mode, formes: [], cotes: [], facades: [], bats: [], existants: [], couche: 'ortho', marge: 12}, o.plan ? JSON.parse(JSON.stringify(o.plan)) : {});
    st.mode = mode; st.formes = st.formes || [];
    let W = monde(t, lieu, st.existants), sel = st.formes.length - 1, dessinMaison = false;

    fen.innerHTML = `<div class="plan-boite">
      <div class="plan-tete"><b>${esc(o.titre || 'Votre projet sur le plan')}</b><button type="button" class="plan-x" aria-label="Fermer">×</button></div>
      <p class="plan-consigne" data-consigne></p>
      <div class="plan-carte"><svg data-svg role="img" aria-label="Plan du terrain"><g data-fond></g><g data-calques></g></svg>
        <div class="plan-zoom"><button type="button" data-z="-1" aria-label="Rapprocher">+</button><button type="button" data-z="1" aria-label="Éloigner">−</button><button type="button" data-couche aria-label="Changer de fond">Plan</button></div></div>
      <div class="plan-ctrl" data-ctrl></div>
      <div class="plan-mes" data-mes aria-live="polite"></div>
      <div class="plan-pied">
        <button type="button" class="btn blue-btn" data-ok>Enregistrer</button>
        <button type="button" class="lien" data-autre>Je préfère décrire autrement</button>
      </div></div>`;
    const svg = fen.querySelector('[data-svg]'), gFond = fen.querySelector('[data-fond]'), gC = fen.querySelector('[data-calques]');
    const ctrl = fen.querySelector('[data-ctrl]'), mesEl = fen.querySelector('[data-mes]');
    fen.querySelector('.plan-x').onclick = fermer;
    fen.querySelector('[data-autre]').onclick = () => { fermer(); if (o.autrement) o.autrement(); };
    fen.querySelector('[data-consigne]').textContent = (!W.parc ? 'Le cadastre ne répond pas pour cette adresse : placez le projet sur la photo, on vérifiera les limites. ' : '') + CONSIGNE[mode];

    // Vue : terrain entier + marge.
    let vue;
    function cadrer() {
      const pts = [...(W.parc || [[0, 0]]), ...W.bats.filter(b => b.sur).flatMap(b => b.pts)];
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), m = st.marge;
      let x0 = Math.min(...xs) - m, x1 = Math.max(...xs) + m, y0 = Math.min(...ys) - m, y1 = Math.max(...ys) + m;
      const w = x1 - x0, h = y1 - y0, r = svg.clientWidth / (svg.clientHeight || 1) || 1.3;
      if (w / h < r) { const nw = h * r; x0 -= (nw - w) / 2; x1 = x0 + nw; } else { const nh = w / r; y0 -= (nh - h) / 2; y1 = y0 + nh; }
      vue = [x0, -y1, x1 - x0, y1 - y0];
      svg.setAttribute('viewBox', vue.join(' '));
      fond(gFond, W, vue, st.couche);
    }
    const ech = () => vue[2] / (svg.clientWidth || 600); // mètres par pixel écran
    function versM(ev) { const r = svg.getBoundingClientRect(); return [vue[0] + (ev.clientX - r.left) / r.width * vue[2], -(vue[1] + (ev.clientY - r.top) / r.height * vue[3])]; }

    // Côtés cliquables : façades (bâtiments sur la parcelle) ou limites (parcelle).
    const cotesParcelle = () => W.parc ? segs(W.parc) : [];
    const facadesDispo = () => W.bats.filter(b => b.sur).flatMap(b => segs(b.pts).map(([a, c]) => ({bat: b.id, a, b: c, ctr: centre(b.pts)})));

    function dessiner() {
      gC.innerHTML = '';
      const sw = ech();
      if (W.parc) el('polygon', {points: ptsAttr(W.parc), class: 'pl-parc', 'stroke-width': 2.5 * sw}, gC);
      for (const b of W.bats) el('polygon', {points: ptsAttr(b.pts), class: 'pl-bat' + (b.sur ? '' : ' voisin') + (st.bats.includes(b.id) ? ' choisi' : '') + (b.dessine ? ' dessine' : ''), 'stroke-width': 1.5 * sw, 'data-bat': b.id}, gC);
      if (mode === 'limites' || mode === 'point') cotesParcelle().forEach(([a, b], k) => el('line', {x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], class: 'pl-cote' + (st.cotes.includes(k) ? ' choisi' : ''), 'stroke-width': (st.cotes.includes(k) ? 6 : 3) * sw, 'data-cote': k}, gC));
      if (['facades', 'toit', 'accole'].includes(mode)) facadesDispo().forEach((f, k) => {
        const pris = st.facades.some(x => x.bat === f.bat && len(sub(W.F.m(x.a), f.a)) < .05 && len(sub(W.F.m(x.b), f.b)) < .05);
        el('line', {x1: f.a[0], y1: -f.a[1], x2: f.b[0], y2: -f.b[1], class: 'pl-fac' + (pris ? ' choisi' : ''), 'stroke-width': (pris ? 6 : 4) * sw, 'data-fac': k}, gC);
      });
      st.formes.forEach((f, i) => {
        if (f.t === 'point') { const p = W.F.m(f.p); el('circle', {cx: p[0], cy: -p[1], r: 6 * sw, class: 'pl-forme choisi'}, gC); return; }
        const c = contour(f, W); if (!c) return;
        el('polygon', {points: ptsAttr(c), class: 'pl-forme' + (i === sel ? ' choisi' : ''), 'stroke-width': 2 * sw, 'data-forme': i}, gC);
      });
      if (mode === 'polygone' && st.brouillon) { const pts = st.brouillon.map(W.F.m); if (pts.length) { el('polyline', {points: ptsAttr(pts), class: 'pl-forme', fill: 'none', 'stroke-width': 2 * sw}, gC); pts.forEach(p => el('circle', {cx: p[0], cy: -p[1], r: 4 * sw, class: 'pl-pt'}, gC)); } }
      // Repère d'échelle (5 m) et nord.
      const ex = vue[0] + vue[2] * .04, ey = vue[1] + vue[3] * .95;
      el('line', {x1: ex, y1: ey, x2: ex + 5, y2: ey, class: 'pl-ech', 'stroke-width': 3 * sw}, gC);
      const tx = el('text', {x: ex, y: ey - 6 * sw, class: 'pl-txt', 'font-size': 12 * sw}, gC); tx.textContent = '5 m';
      const nt = el('text', {x: vue[0] + vue[2] * .04, y: vue[1] + vue[3] * .07, class: 'pl-txt', 'font-size': 14 * sw}, gC); nt.textContent = 'N ↑';
      majMesures();
    }

    function majMesures() {
      const r = mesurer(st, W, o.projet);
      mesEl.innerHTML = (r.lignes.length ? `<p>${r.lignes.map(esc).join('<br>')}</p>` : '') + r.alertes.map(a => `<p class="plan-alerte">${esc(a)}</p>`).join('');
      return r;
    }

    // Contrôles selon le mode.
    function controles() {
      const f = st.formes[sel];
      let h = '';
      if ((mode === 'rect' || mode === 'rects') && f) h = `<div class="plan-champs"><label>Longueur (m)<input type="number" step="0.1" min="0.5" max="60" data-k="L" value="${f.L}"></label><label>Largeur (m)<input type="number" step="0.1" min="0.5" max="60" data-k="P" value="${f.P}"></label>
        <label>Orientation<input type="range" min="-90" max="90" step="1" data-k="a" value="${Math.round(f.a)}"></label></div>
        <div class="plan-btns"><button type="button" class="lien" data-aligner>Aligner sur la maison</button>${mode === 'rects' ? '<button type="button" class="lien" data-ajout>+ Ajouter un volume</button>' : ''}<button type="button" class="lien" data-suppr>Supprimer</button></div>`;
      if (mode === 'accole' && f) { const a = W.F.m(f.fa), b = W.F.m(f.fb), Lf = len(sub(b, a));
        h = `<div class="plan-champs"><label>Le long de la façade (m)<input type="number" step="0.1" min="0.5" max="40" data-k="L" value="${f.L}"></label><label>Profondeur (m)<input type="number" step="0.1" min="0.5" max="30" data-k="P" value="${f.P}"></label>
        <label>Position le long de la façade<input type="range" min="${Math.min(0, Lf - f.L).toFixed(1)}" max="${Math.max(0, Lf - f.L).toFixed(1)}" step="0.1" data-k="d" value="${f.d}"></label></div>
        <div class="plan-btns"><button type="button" class="lien" data-suppr>Changer de façade</button></div>`; }
      if (mode === 'polygone') h = `<div class="plan-btns">${st.brouillon && st.brouillon.length >= 3 ? '<button type="button" class="btn petit" data-pfin>Terminer la surface</button>' : ''}${(st.brouillon || []).length ? '<button type="button" class="lien" data-annule>Retirer le dernier point</button>' : ''}${st.formes.length ? '<button type="button" class="lien" data-suppr>Recommencer</button>' : ''}</div>`;
      if (['accole', 'facades', 'toit', 'batiment'].includes(mode) && !f) h += `<div class="plan-btns"><button type="button" class="lien" data-maison>${dessinMaison ? 'Touchez le plan pour placer votre maison' : 'Ma maison n\'apparaît pas sur le plan : je la dessine'}</button></div>`;
      if ((st.existants || []).length && !f) h += `<div class="plan-champs">${st.existants.map((e, i) => `<label>Maison dessinée : longueur (m)<input type="number" step="0.5" min="3" max="40" data-ek="L" data-ei="${i}" value="${e.L}"></label><label>largeur (m)<input type="number" step="0.5" min="3" max="40" data-ek="P" data-ei="${i}" value="${e.P}"></label>`).join('')}</div>`;
      ctrl.innerHTML = h;
      ctrl.querySelectorAll('[data-k]').forEach(i => i.addEventListener('input', () => { const v = +i.value; if (!Number.isFinite(v)) return; f[i.dataset.k] = v; if (i.dataset.k === 'L' && mode === 'accole') { controles(); } dessiner(); }));
      ctrl.querySelectorAll('[data-ek]').forEach(i => i.addEventListener('change', () => { const e = st.existants[+i.dataset.ei]; e[i.dataset.ek] = Math.max(3, +i.value || e[i.dataset.ek]); e.ll = rectPts(W.F.m(e.c), e.L, e.P, e.a || 0).map(W.F.ll); W = monde(t, lieu, st.existants); dessiner(); }));
      const q = s => ctrl.querySelector(s);
      if (q('[data-suppr]')) q('[data-suppr]').onclick = () => { st.formes.splice(sel, 1); sel = st.formes.length - 1; st.brouillon = null; controles(); dessiner(); };
      if (q('[data-ajout]')) q('[data-ajout]').onclick = () => { attenteAjout = true; ctrl.querySelector('[data-ajout]').textContent = 'Touchez le plan pour placer le volume'; };
      if (q('[data-aligner]')) q('[data-aligner]').onclick = () => {
        const c = W.F.m(f.c); let best = null;
        for (const fa of facadesDispo()) { const d = distSeg(c, fa.a, fa.b); if (!best || d < best.d) best = {d, fa}; }
        if (best) { const v = sub(best.fa.b, best.fa.a); let a = Math.atan2(v[1], v[0]) / RAD; while (a > 90) a -= 180; while (a < -90) a += 180; f.a = a; controles(); dessiner(); }
      };
      if (q('[data-pfin]')) q('[data-pfin]').onclick = () => { st.formes = [{t: 'poly', pts: st.brouillon}]; st.brouillon = null; sel = 0; controles(); dessiner(); };
      if (q('[data-annule]')) q('[data-annule]').onclick = () => { st.brouillon.pop(); controles(); dessiner(); };
      if (q('[data-maison]')) q('[data-maison]').onclick = () => { dessinMaison = true; controles(); };
    }
    let attenteAjout = false;

    // Clic / toucher sur le plan.
    function toucher(ev) {
      const p = versM(ev), tol = 14 * ech();
      if (dessinMaison) {
        const e = {id: 'dessin-' + (st.existants.length + 1), c: W.F.ll(p), L: 10, P: 8, a: 0};
        e.ll = rectPts(p, e.L, e.P, 0).map(W.F.ll); st.existants.push(e); dessinMaison = false;
        W = monde(t, lieu, st.existants); controles(); dessiner(); return;
      }
      if (mode === 'rect' || mode === 'rects') {
        const k = ev.target.getAttribute && ev.target.getAttribute('data-forme');
        if (k != null) { sel = +k; controles(); dessiner(); return; }
        if (st.formes.length && mode === 'rect') { st.formes[0].c = W.F.ll(p); dessiner(); return; }
        if (mode === 'rects' && st.formes.length && !attenteAjout) { st.formes[sel].c = W.F.ll(p); dessiner(); return; }
        const [L, P] = DEFAUT[o.projet] || [4, 3];
        st.formes.push({t: 'rect', c: W.F.ll(p), L: attenteAjout ? 6 : L, P: attenteAjout ? 3 : P, a: 0}); sel = st.formes.length - 1; attenteAjout = false;
        controles(); dessiner(); return;
      }
      if (mode === 'polygone') { if (st.formes.length) return; st.brouillon = (st.brouillon || []).concat([W.F.ll(p)]); controles(); dessiner(); return; }
      if (mode === 'limites' || mode === 'point') {
        let best = null; cotesParcelle().forEach(([a, b], k) => { const d = distSeg(p, a, b); if (!best || d < best.d) best = {d, k, a, b}; });
        if (!best || best.d > tol * 2) return;
        if (mode === 'limites') { st.cotes = st.cotes.includes(best.k) ? st.cotes.filter(x => x !== best.k) : st.cotes.concat(best.k); }
        else { st.cotes = [best.k]; st.formes = [{t: 'point', p: W.F.ll(projSeg(p, best.a, best.b))}]; }
        dessiner(); return;
      }
      if (['facades', 'toit', 'accole'].includes(mode)) {
        let best = null; facadesDispo().forEach(f => { const d = distSeg(p, f.a, f.b); if (!best || d < best.d) best = {d, f}; });
        if (!best || best.d > tol * 2) return;
        const f = best.f;
        if (mode === 'accole') {
          if (st.formes.length) return;
          const u = unit(sub(f.b, f.a)), n = [-u[1], u[0]], mil = mul(add(f.a, f.b), .5), s = ((mil[0] - f.ctr[0]) * n[0] + (mil[1] - f.ctr[1]) * n[1]) >= 0 ? 1 : -1;
          const Lf = len(sub(f.b, f.a)), [L, P] = DEFAUT[o.projet] || [4, 3], LL = Math.min(L, Math.max(1, Math.round(Lf * 10) / 10));
          const d = Math.max(0, Math.min(Lf - LL, ((p[0] - f.a[0]) * u[0] + (p[1] - f.a[1]) * u[1]) - LL / 2));
          st.formes = [{t: 'accole', bat: f.bat, fa: W.F.ll(f.a), fb: W.F.ll(f.b), s, L: LL, P, d: Math.round(d * 10) / 10}]; sel = 0;
          controles(); dessiner(); return;
        }
        const i = st.facades.findIndex(x => x.bat === f.bat && len(sub(W.F.m(x.a), f.a)) < .05 && len(sub(W.F.m(x.b), f.b)) < .05);
        if (i >= 0) st.facades.splice(i, 1); else st.facades.push({bat: f.bat, a: W.F.ll(f.a), b: W.F.ll(f.b)});
        dessiner(); return;
      }
      if (mode === 'batiment') {
        const b = W.bats.find(x => dedans(p, x.pts)); if (!b) return;
        st.bats = st.bats.includes(b.id) ? st.bats.filter(x => x !== b.id) : st.bats.concat(b.id); dessiner(); return;
      }
    }
    // Glisser une forme (rect) pour la déplacer.
    let glisse = null, bouge = false;
    svg.addEventListener('pointerdown', ev => {
      const k = ev.target.getAttribute && ev.target.getAttribute('data-forme');
      if (k != null && st.formes[+k] && st.formes[+k].t === 'rect') { sel = +k; glisse = {i: +k, p0: versM(ev), c0: W.F.m(st.formes[+k].c)}; bouge = false; svg.setPointerCapture(ev.pointerId); controles(); }
    });
    svg.addEventListener('pointermove', ev => { if (!glisse) return; const p = versM(ev), d = sub(p, glisse.p0); if (len(d) > 3 * ech()) bouge = true; if (bouge) { st.formes[glisse.i].c = W.F.ll(add(glisse.c0, d)); dessiner(); } });
    svg.addEventListener('pointerup', ev => { const g = glisse; glisse = null; if (g && bouge) return; toucher(ev); });

    fen.querySelectorAll('[data-z]').forEach(b => b.onclick = () => { st.marge = Math.max(2, Math.min(80, st.marge + (+b.dataset.z) * (st.marge > 15 ? 10 : 4))); cadrer(); dessiner(); });
    const bc = fen.querySelector('[data-couche]'); bc.onclick = () => { st.couche = st.couche === 'ortho' ? 'plan' : 'ortho'; bc.textContent = st.couche === 'ortho' ? 'Plan' : 'Photo'; cadrer(); };

    fen.querySelector('[data-ok]').onclick = async () => {
      if (mode === 'polygone' && st.brouillon && st.brouillon.length >= 3 && !st.formes.length) { st.formes = [{t: 'poly', pts: st.brouillon}]; st.brouillon = null; }
      const vide = (['rect', 'rects', 'accole', 'polygone', 'point'].includes(mode) && !st.formes.length) || (mode === 'limites' && !st.cotes.length) || (['facades', 'toit'].includes(mode) && !st.facades.length) || (mode === 'batiment' && !st.bats.length);
      if (vide) { mesEl.insertAdjacentHTML('afterbegin', '<p class="plan-alerte">Placez d\'abord votre projet sur le plan, ou choisissez « Je préfère décrire autrement ».</p>'); return; }
      const r = majMesures();
      const plan = {mode, formes: st.formes, cotes: st.cotes, facades: st.facades, bats: st.bats, existants: (st.existants || []).map(e => ({id: e.id, c: e.c, L: e.L, P: e.P, a: e.a || 0, ll: e.ll})), mesures: r.mesures, lieu, couche: st.couche, marge: st.marge};
      const resume = [...r.lignes, ...r.alertes.map(a => 'À vérifier : ' + a)].join('\n');
      const b = fen.querySelector('[data-ok]'); b.disabled = true; b.textContent = 'Enregistrement…';
      const ok = await o.enregistrer(plan, resume).catch(() => false);
      if (ok) fermer(); else { b.disabled = false; b.textContent = 'Enregistrer'; mesEl.insertAdjacentHTML('afterbegin', '<p class="plan-alerte">L\'enregistrement n\'a pas marché. Réessayez.</p>'); }
    };

    requestAnimationFrame(() => { cadrer(); controles(); dessiner(); });
    window.addEventListener('resize', () => { if (document.body.contains(fen)) { cadrer(); dessiner(); } });
  }

  // ---------- aperçu d'un plan enregistré (espace équipe, dossier client) ----------
  async function apercu(cont, plan) {
    if (!plan || !plan.lieu) { cont.innerHTML = ''; return; }
    const t = await lireTerrain(plan.lieu), W = monde(t, plan.lieu, plan.existants);
    cont.innerHTML = '<svg class="plan-apercu" role="img" aria-label="Plan du projet"><g data-fond></g><g data-c></g></svg>';
    const svg = cont.querySelector('svg'), g = cont.querySelector('[data-c]');
    const pts = [...(W.parc || [[0, 0]]), ...plan.formes.map(f => contour(f, W)).filter(Boolean).flat()];
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), m = 6;
    const vue = [Math.min(...xs) - m, -(Math.max(...ys) + m), Math.max(...xs) - Math.min(...xs) + 2 * m, Math.max(...ys) - Math.min(...ys) + 2 * m];
    svg.setAttribute('viewBox', vue.join(' '));
    fond(cont.querySelector('[data-fond]'), W, vue, plan.couche || 'ortho');
    const sw = vue[2] / 400;
    if (W.parc) el('polygon', {points: ptsAttr(W.parc), class: 'pl-parc', 'stroke-width': 2 * sw}, g);
    for (const b of W.bats) el('polygon', {points: ptsAttr(b.pts), class: 'pl-bat' + (b.sur ? '' : ' voisin') + ((plan.bats || []).includes(b.id) ? ' choisi' : '') + (b.dessine ? ' dessine' : ''), 'stroke-width': 1.2 * sw}, g);
    if (W.parc) (plan.cotes || []).forEach(k => { const s = segs(W.parc)[k]; if (s) el('line', {x1: s[0][0], y1: -s[0][1], x2: s[1][0], y2: -s[1][1], class: 'pl-cote choisi', 'stroke-width': 4 * sw}, g); });
    for (const f of plan.facades || []) { const a = W.F.m(f.a), b = W.F.m(f.b); el('line', {x1: a[0], y1: -a[1], x2: b[0], y2: -b[1], class: 'pl-fac choisi', 'stroke-width': 4 * sw}, g); }
    for (const f of plan.formes || []) {
      if (f.t === 'point') { const p = W.F.m(f.p); el('circle', {cx: p[0], cy: -p[1], r: 4 * sw, class: 'pl-forme choisi'}, g); continue; }
      const c = contour(f, W); if (c) el('polygon', {points: ptsAttr(c), class: 'pl-forme choisi', 'stroke-width': 1.5 * sw}, g);
    }
  }

  window.BPPlan = {ouvrir, apercu, _test: {repere, aire, distSeg, rectPts, contour, monde, mesurer, orient, distPolys}};
})();
