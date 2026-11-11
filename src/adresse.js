/* Champ d'adresse du site (accueil, plan de situation, plan de masse) : suggestions de la Base Adresse Nationale via /api/terrain/adresses.
   <div class="adr" data-vers="plan-de-situation/"> : après le choix, l'adresse est gardée pour la session (window.BPLieu) et la page indiquée s'ouvre.
   Sans data-vers, l'événement « bp-lieu » est envoyé sur le document. L'adresse n'est jamais mise dans l'URL. */
(() => {
  const CLE = 'bp-lieu';
  const lire = () => { try { const l = JSON.parse(sessionStorage.getItem(CLE)); return l && Number.isFinite(l.lon) && Number.isFinite(l.lat) ? l : null; } catch (e) { return null; } };
  const garder = l => { try { if (l) sessionStorage.setItem(CLE, JSON.stringify(l)); else sessionStorage.removeItem(CLE); } catch (e) {} };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  function brancher(boite) {
    if (boite.dataset.pret) return; boite.dataset.pret = '1';
    boite.innerHTML = `<label class="adr-l" for="adr-${boite.dataset.id || 'a'}">${esc(boite.dataset.label || 'Adresse de votre terrain')}</label>
      <div class="adr-c"><input id="adr-${boite.dataset.id || 'a'}" type="text" autocomplete="off" inputmode="search" placeholder="${esc(boite.dataset.exemple || '12 rue des Lilas, 44000 Nantes')}">
      <button class="btn blue-btn" type="button">${esc(boite.dataset.bouton || 'Voir mon terrain')}</button></div><div class="adr-s" role="listbox"></div>`;
    const inp = boite.querySelector('input'), sug = boite.querySelector('.adr-s'), btn = boite.querySelector('button');
    let tm, n = 0, liste = [];
    const choisir = a => {
      const l = {lon: a.lon, lat: a.lat, label: a.label}; garder(l); inp.value = a.label; sug.innerHTML = '';
      if (boite.dataset.vers) location.href = boite.dataset.vers; else document.dispatchEvent(new CustomEvent('bp-lieu', {detail: l}));
    };
    const chercher = () => { clearTimeout(tm); tm = setTimeout(async () => {
      const k = ++n, q = inp.value.trim(); if (q.length < 4) { sug.innerHTML = ''; liste = []; return; }
      try {
        const r = await fetch('/api/terrain/adresses?q=' + encodeURIComponent(q)); const j = await r.json().catch(() => ({})); if (k !== n) return;
        // Service d'adresses de l'IGN en panne : on le dit, au lieu d'accuser l'adresse.
        if (!r.ok) { liste = []; sug.innerHTML = '<p class="adr-rien">La recherche d\'adresse est en panne pour quelques minutes (service public de l\'IGN). Réessayez un peu plus tard, ou appelez-nous au <a href="tel:+33184166553">01 84 16 65 53</a>.</p>'; return; }
        liste = j.adresses || [];
        sug.innerHTML = liste.length ? liste.map((a, i) => `<button type="button" class="sug" role="option" data-i="${i}">${esc(a.label)}</button>`).join('') : '<p class="adr-rien">Adresse introuvable. Essayez avec le nom de la rue et la commune.</p>';
        sug.querySelectorAll('[data-i]').forEach(b => b.onclick = () => choisir(liste[+b.dataset.i]));
      } catch (e) {}
    }, 220); };
    // data-reprend : l'adresse déjà donnée ailleurs sur le site est proposée d'office.
    let repris = 'reprend' in boite.dataset ? lire() : null; if (repris) inp.value = repris.label;
    inp.addEventListener('input', () => { repris = null; });
    inp.addEventListener('input', chercher);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (liste[0]) choisir(liste[0]); } });
    btn.onclick = () => { if (repris && inp.value === repris.label) choisir(repris); else if (liste[0]) choisir(liste[0]); else { inp.focus(); chercher(); } };
  }
  window.BPLieu = {lire, garder, brancher};
  document.addEventListener('click', e => { const a = e.target.closest('[data-adresse]'); if (!a) return; const i = document.querySelector('.adr input'); if (!i) return; e.preventDefault(); i.scrollIntoView({behavior: 'smooth', block: 'center'}); setTimeout(() => i.focus({preventScroll: true}), 450); });
  const tout = () => document.querySelectorAll('.adr').forEach(brancher);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tout); else tout();
})();
