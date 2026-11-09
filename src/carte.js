/* Mini-carte IGN (photo aérienne ou plan) avec le contour de la parcelle et le point de l'adresse.
   Les tuiles passent par bonpermis.fr (/api/terrain/tuile) : la page n'appelle aucun site extérieur.
   window.BPCarte(conteneur, {lon, lat}, terrain?, {hauteur}) ; terrain = réponse de /api/terrain (facultatif). */
(() => {
  const RAD = Math.PI / 180;
  function dessiner(el, x, t, o) {
    o = o || {};
    const fond = el.dataset.fond || 'ortho', W = el.clientWidth || 360, H = o.hauteur || 210;
    el.style.height = H + 'px'; el.classList.add('bp-carte');
    const anneaux = [], g = t && t.parcelle && t.parcelle.geometrie;
    if (g) (g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'Polygon' ? g.coordinates : []).forEach(r => anneaux.push(r));
    const px = (z, lon, lat) => { const n = 256 * 2 ** z; return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * n]; };
    let z = 19, cx, cy;
    for (; z >= 15; z--) {
      const pts = anneaux.flat().map(p => px(z, p[0], p[1]));
      if (!pts.length) { [cx, cy] = px(z, x.lon, x.lat); break; }
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      cx = (Math.max(...xs) + Math.min(...xs)) / 2; cy = (Math.max(...ys) + Math.min(...ys)) / 2;
      if (Math.max(...xs) - Math.min(...xs) <= W - 60 && Math.max(...ys) - Math.min(...ys) <= H - 50) break;
    }
    const ox = cx - W / 2, oy = cy - H / 2;
    let h = '';
    for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++)
      for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++)
        h += `<img alt="" draggable="false" src="/api/terrain/tuile?c=${fond}&z=${z}&x=${tx}&y=${ty}" style="left:${Math.round(tx * 256 - ox)}px;top:${Math.round(ty * 256 - oy)}px">`;
    const chemin = anneaux.map(r => 'M' + r.map(p => { const q = px(z, p[0], p[1]); return (q[0] - ox).toFixed(1) + ',' + (q[1] - oy).toFixed(1); }).join('L') + 'Z').join('');
    const m = px(z, x.lon, x.lat);
    h += `<svg width="${W}" height="${H}" aria-hidden="true">${chemin ? `<path d="${chemin}" fill="rgba(1,39,177,.18)" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="${chemin}" fill="none" stroke="#0127B1" stroke-width="2" stroke-linejoin="round"/>` : ''}
      <g transform="translate(${(m[0] - ox).toFixed(1)},${(m[1] - oy).toFixed(1)})"><path d="M0 0c-6-8-10-12-10-17a10 10 0 0 1 20 0c0 5-4 9-10 17z" fill="#0127B1" stroke="#fff" stroke-width="2"/><circle cy="-17" r="3.5" fill="#fff"/></g></svg>
      <div class="mc-bt" role="group" aria-label="Fond de carte"><button type="button" data-fond="ortho" aria-pressed="${fond === 'ortho'}">Photo</button><button type="button" data-fond="plan" aria-pressed="${fond === 'plan'}">Plan</button></div>
      <span class="mc-att">${chemin ? 'Contour : cadastre · ' : ''}© IGN</span>`;
    el.innerHTML = h;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', 'Vue aérienne de l\'adresse' + (chemin ? ' avec le contour de la parcelle' : ''));
    el.querySelectorAll('[data-fond]').forEach(b => b.addEventListener('click', () => { el.dataset.fond = b.dataset.fond; dessiner(el, x, t, o); }));
  }
  window.BPCarte = dessiner;
})();
