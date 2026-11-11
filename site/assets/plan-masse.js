/* Page /plan-de-masse/ : le visiteur choisit son projet, le place sur son terrain (éditeur src/plan.js),
   voit l'aperçu gratuit (filigrane), puis paie pour télécharger le PDF. Service : api/planvente.js. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const fr = (n, d = 2) => Number(n).toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const zone = $('#pm-outil'); if (!zone) return;
  const PRIX = +zone.dataset.prix || 29;
  const etat = {projet: 'abri', hauteur: 2.4, nom: '', plan: null, ap: null};
  const HAUTEURS = {abri: 2.4, piscine: 0.6, carport: 2.6, garage: 3, annexe: 3, pergola: 2.6, terrasse: 0.6, autre: 3};
  const api = async (methode, chemin, corps) => {
    const r = await fetch(chemin, {method: methode, headers: corps ? {'Content-Type': 'application/json'} : {}, body: corps ? JSON.stringify(corps) : undefined});
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erreur || 'Le service ne répond pas. Réessayez dans un instant.'); return j;
  };

  function formulaire(message) {
    zone.innerHTML = `
      ${message ? `<p class="pm-msg">${esc(message)}</p>` : ''}
      <div class="pm-form">
        <label><span>Votre projet</span><select data-projet>
          ${[['abri', 'Abri de jardin'], ['piscine', 'Piscine'], ['carport', 'Carport'], ['garage', 'Garage'], ['annexe', 'Annexe, studio de jardin'], ['pergola', 'Pergola'], ['terrasse', 'Terrasse surélevée'], ['autre', 'Autre construction']].map(([k, n]) => `<option value="${k}"${k === etat.projet ? ' selected' : ''}>${n}</option>`).join('')}
        </select></label>
        <label><span>Hauteur au point le plus haut, en mètres</span><input data-hauteur type="number" inputmode="decimal" min="0.3" max="20" step="0.05" value="${etat.hauteur}"></label>
        <label><span>Nom à faire figurer sur le plan (facultatif)</span><input data-nom maxlength="60" autocomplete="name" value="${esc(etat.nom)}"></label>
      </div>
      <button class="btn blue-btn" type="button" data-go>Placer mon projet sur mon terrain</button>
      <p class="pm-note">Aperçu gratuit, sans compte. Vous ne payez que si le plan vous convient.</p>`;
    const sel = zone.querySelector('[data-projet]'), h = zone.querySelector('[data-hauteur]');
    sel.onchange = () => { etat.projet = sel.value; h.value = HAUTEURS[sel.value] || 3; };
    zone.querySelector('[data-go]').onclick = () => {
      etat.projet = sel.value; etat.hauteur = +String(h.value).replace(',', '.'); etat.nom = zone.querySelector('[data-nom]').value.trim();
      if (!(etat.hauteur >= 0.3 && etat.hauteur <= 20)) { h.focus(); return formulaire('Indiquez la hauteur de la construction, en mètres.'); }
      ouvrirPlan();
    };
  }

  function ouvrirPlan() {
    const type = ['abri', 'piscine', 'carport', 'annexe', 'pergola', 'garage'].includes(etat.projet) ? etat.projet : 'annexe';
    window.BPPlan.ouvrir({mode: 'rect', projet: type, plan: etat.plan, titre: 'Placez votre projet sur votre terrain', sansAutre: true,
      libelleOk: 'Voir mon plan de masse', libelleAttente: 'Préparation du plan…',
      enregistrer: async plan => {
        etat.plan = plan;
        try { etat.ap = await api('POST', '/api/plan-masse/apercu', {lieu: plan.lieu, plan: {formes: plan.formes}, projet: etat.projet, hauteur: etat.hauteur, nom: etat.nom}); }
        catch (e) { formulaire(e.message); return true; }
        apercu(); return true;
      }});
  }

  function apercu(message) {
    const a = etat.ap, m = a.mesures, t = a.terrain;
    const dmin = m.distances && m.distances.length ? Math.min(...m.distances) : null;
    zone.innerHTML = `
      <div class="pm-ap">
        <div class="pm-img">${a.image ? `<img src="/api/plan-masse/apercu?id=${a.id}" alt="Aperçu de votre plan de masse" width="1819" height="1286">` : `<iframe src="/api/plan-masse/apercu?id=${a.id}" title="Aperçu de votre plan de masse"></iframe>`}</div>
        <div class="pm-cote">
          <h3>Votre plan de masse est prêt</h3>
          <ul class="pm-faits">
            <li><b>${esc(t.commune)}</b>parcelle ${esc(t.parcelle)}</li>
            <li><b>1/${a.echelle}</b>échelle, format A3</li>
            <li><b>${fr(m.projet)} m²</b>emprise créée</li>
            ${dmin != null ? `<li><b>${fr(dmin)} m</b>au plus près de la limite</li>` : ''}
          </ul>
          ${message ? `<p class="pm-msg">${esc(message)}</p>` : ''}
          <label class="pm-mail"><span>Votre e-mail, pour recevoir le lien de téléchargement</span><input data-mail type="email" autocomplete="email" inputmode="email"></label>
          <button class="btn blue-btn" type="button" data-payer>Télécharger sans filigrane : ${PRIX} €</button>
          <p class="pm-note">PDF vectoriel A3, prêt à joindre à votre dossier. Les ${PRIX} € sont déduits si vous nous confiez ensuite le dossier complet.</p>
          <button class="lien" type="button" data-modif>Modifier l'emplacement ou les dimensions</button>
          <div class="pm-zone pm-alerte"><b>Attention : ce plan ne garantit pas que votre projet sera accepté</b>
            ${t.zone ? `<span>Votre terrain est en zone ${esc(t.zone)}${t.zoneNom ? ' : ' + esc(t.zoneNom.toLowerCase()) : ''}</span>` : (t.rnu ? '<span>Votre commune applique le règlement national d\'urbanisme</span>' : '')}
            <p>Chaque commune a son propre règlement, différent de celui de la commune d'à côté : distance aux voisins, hauteur, emprise maximale, matériaux, couleurs. Des dizaines de pages techniques. Un plan de masse parfaitement dessiné est refusé si le projet ne respecte pas une seule de ces règles, et il faut alors tout recommencer${dmin != null && dmin < 3 ? `. Votre projet est à ${fr(dmin)} m d'une limite : c'est justement le genre de distance que les règlements encadrent` : ''}.</p>
            <p><b>Pour savoir si ça passe avant de déposer</b>On étudie le règlement de votre terrain en entier et on prépare tout le dossier : 149 €, vos ${PRIX} € déduits.</p>
            <a class="btn ghost" href="../#projets">Voir le dossier complet</a></div>
          ${t.protege ? '<p class="pm-msg">Votre terrain semble être dans un secteur protégé (monument historique ou site). La mairie demandera l\'avis de l\'architecte des Bâtiments de France.</p>' : ''}
        </div>
      </div>`;
    zone.querySelector('[data-modif]').onclick = ouvrirPlan;
    zone.querySelector('[data-payer]').onclick = async ev => {
      const mail = zone.querySelector('[data-mail]').value.trim(), b = ev.currentTarget;
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(mail)) { zone.querySelector('[data-mail]').focus(); return apercu('Indiquez votre adresse e-mail.'); }
      b.disabled = true; b.textContent = 'Ouverture du paiement…';
      try { const r = await api('POST', '/api/plan-masse/payer', {id: a.id, email: mail}); location.href = r.url; }
      catch (e) { apercu(e.message); }
    };
    zone.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function pret(id, t, code, fin) {
    zone.innerHTML = `
      <div class="pm-pret">
        <h3>Merci. Votre plan de masse est prêt.</h3>
        <a class="btn blue-btn" href="/api/plan-masse/telecharger?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}">Télécharger mon plan (PDF)</a>
        <p class="pm-note">Le lien vous a aussi été envoyé par e-mail. Vous pouvez télécharger le plan autant de fois que vous voulez.</p>
        <div class="pm-zone pm-alerte"><b>Avant de déposer : votre projet respecte-t-il le règlement de votre commune ?</b>
          <p>Ce plan ne le vérifie pas. Chaque commune a ses propres règles de distance, de hauteur et d'emprise, et un projet qui en oublie une est refusé, même avec un plan parfait. Il vous reste aussi le formulaire officiel, le plan en coupe, les façades, l'insertion et les photos. On étudie le règlement et on prépare tout en 48 h.${code ? ` Vos ${PRIX} € sont déduits avec le code <b>${esc(code)}</b>${fin ? `, jusqu'au ${esc(fin.split('-').reverse().join('/'))}` : ''}.` : ''}</p>
          <a class="btn ghost" href="../#projets">Voir le prix de mon dossier complet</a></div>
      </div>`;
  }

  // Retour du paiement, ou lien reçu par e-mail.
  const q = new URLSearchParams(location.search);
  if (q.get('paye')) {
    zone.innerHTML = '<p class="pm-note">Vérification du paiement…</p>';
    api('GET', '/api/plan-masse/etat?s=' + encodeURIComponent(q.get('paye')))
      .then(r => r.paye ? pret(r.id, r.t, r.code, r.codeFin) : formulaire('Le paiement n\'a pas abouti. Vous pouvez recommencer.'))
      .catch(e => formulaire(e.message));
    zone.scrollIntoView();
  } else if (q.get('id') && q.get('t')) { pret(q.get('id'), q.get('t')); zone.scrollIntoView(); }
  else formulaire();
})();
