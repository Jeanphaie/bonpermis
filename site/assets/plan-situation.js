/* Page /plan-de-situation/ : une adresse, puis l'écran de résultat. On y montre le terrain, ce que les données publiques en disent,
   le plan de situation gratuit (contre l'e-mail), et ce qu'on peut faire ensuite. Service : api/planvente.js. */
(() => {
  const zone = document.querySelector('#ps-res'); if (!zone) return;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const fr = (n, d = 0) => Number(n).toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const ETUDE = +zone.dataset.etude || 79, PLAN = +zone.dataset.plan || 29, DOSSIER = +zone.dataset.dossier || 149;
  const hero = document.querySelector('#ps-hero');
  const api = async (methode, chemin, corps) => {
    const r = await fetch(chemin, {method: methode, headers: corps ? {'Content-Type': 'application/json'} : {}, body: corps ? JSON.stringify(corps) : undefined});
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erreur || 'Le service ne répond pas. Réessayez dans un instant.'); return j;
  };
  let lieu = null, k = null, mail = '', accord = false;

  function faits() {
    const f = [];
    if (k.zone) f.push([`Zone ${k.zone}`, `${k.zoneNom ? k.zoneNom + '. ' : ''}C'est son règlement qui dit ce que vous pouvez construire.`]);
    else if (k.rnu) f.push(['Pas de PLU', 'Votre commune applique le règlement national d\'urbanisme.']);
    if (k.page) f.push([`Page ${k.page}`, `Les règles de votre zone commencent à la page ${k.page} du règlement${k.dateReglement ? ' du ' + k.dateReglement : ''}.`]);
    if (k.protege) f.push(['Secteur protégé', `${(k.protections || []).map(p => p.libelle).join(', ')}. L'architecte des Bâtiments de France donne son avis : un mois de plus.`]);
    if (k.littoral) f.push(['Commune littorale', 'La loi Littoral s\'ajoute au règlement.']);
    for (const x of (k.risques || [])) f.push([x.libelle, `Risque recensé à votre adresse${x.niveau ? ' : ' + x.niveau : ''}.`]);
    return f;
  }

  function resultat(message, pret) {
    const f = faits();
    zone.hidden = false; if (hero) hero.hidden = true;
    zone.innerHTML = `
      <p class="ps-adr">${esc(lieu.label || '')} <button class="lien" type="button" data-autre>Changer d'adresse</button></p>
      <div class="ps-grille">
        <div>
          <h2>Votre terrain</h2>
          <div class="ps-carte" data-carte></div>
          <ul class="pm-faits ps-faits"><li><b>${esc(k.commune)}</b>commune</li><li><b>${esc(k.parcelle)}</b>parcelle</li>${k.surface ? `<li><b>${fr(k.surface)} m²</b>surface</li>` : ''}${k.zone ? `<li><b>${esc(k.zone)}</b>zone du PLU</li>` : ''}</ul>
          <div class="ps-don">
            ${pret ? `<h3>Votre plan de situation est prêt</h3>
              <a class="btn blue-btn" href="/api/plan-situation?id=${encodeURIComponent(pret)}">Télécharger le PDF</a>
              <p class="pm-note">On vous l'a aussi envoyé par e-mail.</p>`
            : `<h3>Votre plan de situation, gratuit</h3>
              ${message ? `<p class="pm-msg">${esc(message)}</p>` : ''}
              <div class="ps-mail"><input data-mail type="email" autocomplete="email" inputmode="email" placeholder="Votre e-mail" aria-label="Votre e-mail" value="${esc(mail)}"><button class="btn blue-btn" type="button" data-ok>Recevoir mon plan</button></div>
              <label class="pm-accord"><input type="checkbox" data-accord${accord ? ' checked' : ''}><span>Je veux bien recevoir vos conseils pour mon dossier</span></label>
              <p class="pm-note">PDF A3, deux cartes IGN, votre terrain repéré. Sans la case cochée, on ne vous écrit qu'une fois.</p>`}
          </div>
        </div>
        <div>
          ${f.length ? `<h2>Ce que votre adresse dit déjà</h2><ul class="pm-constat">${f.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>
          <p class="pm-note">Données publiques (Géoportail de l'urbanisme, Géorisques), parfois incomplètes.</p>` : ''}
          <div class="pm-zone pm-alerte"><b>La mairie ne juge pas vos plans. Elle vérifie ce règlement.</b>
            <p>Distance aux voisins, hauteur, emprise, toit, couleurs : chaque commune a ses règles. Un projet qui en oublie une est refusé, et il faut tout redéposer.</p></div>
          <h2 class="ps-h">On s'en occupe</h2>
          <div class="pm-offre reco"><div><i>Recommandé</i><b>Le dossier complet</b><span>On lit le règlement, on fait tous les plans, on remplit le formulaire. Prêt en 48 h.</span></div><a class="btn blue-btn" href="../#projets">Dès ${DOSSIER} €</a></div>
          <div class="pm-offre"><div><b>Le plan vérifié</b><span>Votre plan de masse, et on vous dit si votre projet passe.</span></div><a class="btn ghost" href="../plan-de-masse/">${ETUDE} €</a></div>
          <div class="pm-offre"><div><b>Le plan de masse</b><span>Vous placez votre projet, le plan sort tout seul. Aperçu gratuit.</span></div><a class="btn ghost" href="../plan-de-masse/">${PLAN} €</a></div>
        </div>
      </div>`;
    if (window.BPPlan) window.BPPlan.apercu(zone.querySelector('[data-carte]'), {mode: 'parcelle', lieu: {lon: lieu.lon, lat: lieu.lat}, formes: [], cotes: [], facades: [], bats: [], existants: []}, 'annexe').catch(() => {});
    zone.querySelector('[data-autre]').onclick = () => { window.BPLieu.garder(null); lieu = k = null; zone.hidden = true; zone.innerHTML = ''; if (hero) { hero.hidden = false; const i = hero.querySelector('input'); if (i) { i.value = ''; i.focus(); } } };
    const ok = zone.querySelector('[data-ok]');
    if (ok) ok.onclick = async () => {
      mail = zone.querySelector('[data-mail]').value.trim(); accord = zone.querySelector('[data-accord]').checked;
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) { resultat('Indiquez votre e-mail.'); zone.querySelector('[data-mail]').focus(); return; }
      ok.disabled = true; ok.textContent = 'Préparation…';
      try { const r = await api('POST', '/api/plan-situation', {lieu: {lon: lieu.lon, lat: lieu.lat}, email: mail, accord}); resultat('', r.id); }
      catch (e) { resultat(e.message); }
    };
  }

  async function charger(l) {
    lieu = l; zone.hidden = false; if (hero) hero.hidden = true;
    zone.innerHTML = '<p class="pm-note">On cherche votre terrain…</p>';
    zone.scrollIntoView({block: 'start'});
    try { k = await api('GET', `/api/plan-situation/terrain?lon=${encodeURIComponent(l.lon)}&lat=${encodeURIComponent(l.lat)}`); resultat(); }
    catch (e) { zone.innerHTML = `<p class="pm-msg">${esc(e.message)}</p><p><button class="lien" type="button" data-autre>Essayer une autre adresse</button></p>`; zone.querySelector('[data-autre]').onclick = () => { window.BPLieu.garder(null); zone.hidden = true; if (hero) hero.hidden = false; }; }
  }
  document.addEventListener('bp-lieu', e => charger(e.detail));
  const deja = window.BPLieu && window.BPLieu.lire(); if (deja) charger(deja);
})();
