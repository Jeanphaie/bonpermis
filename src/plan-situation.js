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

  // Ce que l'adresse apprend sur le terrain, dit simplement. Pas de numéro de page, pas de nom de base de données.
  function faits() {
    const f = [];
    if (k.zone) f.push([`Votre terrain est en zone ${k.zone}`, `${k.zoneNom ? k.zoneNom + '. ' : ''}Chaque zone du PLU a ses propres règles : ce qui est permis chez un voisin ne l'est pas forcément chez vous.`]);
    else if (k.rnu) f.push(['Votre commune n\'a pas de PLU', 'C\'est le règlement national d\'urbanisme qui s\'applique, avec ses propres règles de distance et de constructibilité.']);
    if (k.dateReglement) f.push([`Règlement du ${k.dateReglement}`, 'Si vous vous fiez à d\'anciennes règles, ou à ce qu\'un voisin a pu construire avant, elles ont peut-être changé.']);
    if (k.plui) f.push(['Un PLU commun à plusieurs communes', 'Le règlement est plus long, et certaines règles changent d\'une commune à l\'autre à l\'intérieur du même document.']);
    if (k.protege) f.push(['Secteur protégé', 'L\'architecte des Bâtiments de France donne son avis sur les matériaux, les couleurs, les toitures. La mairie met un mois de plus à répondre.']);
    if (k.littoral) f.push(['Commune littorale', 'La loi Littoral s\'ajoute au PLU et limite ce qu\'on peut construire.']);
    for (const x of (k.risques || [])) f.push([`Risque : ${x.libelle.toLowerCase()}`, `${x.niveau ? x.niveau[0].toUpperCase() + x.niveau.slice(1) + '. ' : ''}Il peut imposer des règles de construction en plus.`]);
    return f;
  }
  // Les questions auxquelles le règlement de la zone répond : c'est ce qu'on lit pour le client.
  const QUESTIONS = ['À quelle distance des voisins et de la rue pouvez-vous construire ?', 'Quelle hauteur maximum ?', 'Quelle part du terrain peut être bâtie ?', 'Quels toits, quels matériaux, quelles couleurs ?', 'Quelle clôture, quelle hauteur ?'];

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
          ${f.length ? `<h2>Ce que votre adresse dit déjà</h2><ul class="pm-constat">${f.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ul>` : ''}
          <div class="pm-zone pm-alerte"><b>Votre projet doit respecter le PLU${k.commune ? ' de ' + esc(k.commune) : ''}</b>
            <p>Le PLU, le plan local d'urbanisme, c'est le règlement de votre commune. La mairie compare votre dossier à ce règlement, ligne par ligne. Une seule règle oubliée, et le projet est refusé.</p>
            <p><b>Ce que le PLU décide pour votre terrain${k.zone ? ', en zone ' + esc(k.zone) : ''}</b></p>
            <ul class="ps-q">${QUESTIONS.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
            <p>Les réponses sont différentes dans chaque commune. On lit le PLU en entier pour vous, avant de dessiner.</p></div>
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
