/* Page /plan-de-masse/ : le visiteur choisit son projet, le place sur son terrain (éditeur src/plan.js),
   voit l'aperçu gratuit (filigrane), puis choisit sa formule : le plan seul, le plan vérifié (étude du PLU), ou le dossier complet.
   Le plan de situation seul est gratuit. Service : api/planvente.js. */
(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const fr = (n, d = 2) => Number(n).toLocaleString('fr-FR', {minimumFractionDigits: d, maximumFractionDigits: d});
  const zone = $('#pm-outil'); if (!zone) return;
  const PRIX = +zone.dataset.prix || 29, ETUDE = +zone.dataset.etude || 79, DOSSIER = +zone.dataset.dossier || 149;
  const etat = {projet: 'abri', hauteur: 2.4, plan: null, ap: null, mail: '', lieu: window.BPLieu ? window.BPLieu.lire() : null};
  // Chaque projet : son nom, sa hauteur courante, et la façon de le poser sur le plan (modes de l'éditeur).
  const PROJETS = [['abri', 'Abri de jardin', 2.4, 'rect'], ['piscine', 'Piscine', 0.6, 'rect'], ['carport', 'Carport', 2.6, 'rect'], ['garage', 'Garage', 3, 'rect'],
    ['annexe', 'Annexe, studio de jardin', 3, 'rect'], ['pergola', 'Pergola', 2.6, 'rect'], ['extension', 'Extension de la maison', 3.2, 'accole'], ['veranda', 'Véranda', 2.8, 'accole'],
    ['terrasse', 'Terrasse (forme libre)', 0.6, 'polygone'], ['maison', 'Maison neuve', 6, 'rects'], ['autre', 'Autre construction', 3, 'rect']];
  const P = k => PROJETS.find(p => p[0] === k) || PROJETS[PROJETS.length - 1];
  const api = async (methode, chemin, corps) => {
    const r = await fetch(chemin, {method: methode, headers: corps ? {'Content-Type': 'application/json'} : {}, body: corps ? JSON.stringify(corps) : undefined});
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erreur || 'Le service ne répond pas. Réessayez dans un instant.'); return j;
  };

  function formulaire(message) {
    // 1. L'adresse, et rien d'autre.
    if (!etat.lieu) {
      zone.innerHTML = `${message ? `<p class="pm-msg">${esc(message)}</p>` : ''}<div class="adr" data-id="pm" data-bouton="Voir mon terrain"></div>
        <p class="pm-note">Aperçu gratuit, sans compte.</p>`;
      window.BPLieu.brancher(zone.querySelector('.adr'));
      return;
    }
    // 2. Le projet et sa hauteur.
    zone.innerHTML = `
      ${message ? `<p class="pm-msg">${esc(message)}</p>` : ''}
      <p class="ps-adr">${esc(etat.lieu.label || '')} <button class="lien" type="button" data-autre>Changer d'adresse</button></p>
      <div class="pm-form deux">
        <label><span>Votre projet</span><select data-projet>${PROJETS.map(([k, n]) => `<option value="${k}"${k === etat.projet ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
        <label><span>Sa hauteur, en mètres</span><input data-hauteur type="number" inputmode="decimal" min="0.1" max="20" step="0.05" value="${etat.hauteur}"></label>
      </div>
      <button class="btn blue-btn" type="button" data-go>Placer mon projet sur mon terrain</button>
      <p class="pm-note">Aperçu gratuit. Vous ne payez que si le plan vous convient.</p>`;
    const sel = zone.querySelector('[data-projet]'), h = zone.querySelector('[data-hauteur]');
    sel.onchange = () => { etat.projet = sel.value; etat.plan = null; h.value = P(sel.value)[2]; };
    zone.querySelector('[data-autre]').onclick = () => { window.BPLieu.garder(null); etat.lieu = null; etat.plan = null; formulaire(); };
    zone.querySelector('[data-go]').onclick = () => {
      if (sel.value !== etat.projet) etat.plan = null;
      etat.projet = sel.value; etat.hauteur = +String(h.value).replace(',', '.');
      if (!(etat.hauteur >= 0.1 && etat.hauteur <= 20)) { h.focus(); return formulaire('Indiquez la hauteur, en mètres.'); }
      ouvrirPlan();
    };
  }
  document.addEventListener('bp-lieu', e => { etat.lieu = e.detail; etat.plan = null; formulaire(); });

  function ouvrirPlan() {
    const [k, , , mode] = P(etat.projet), type = ['abri', 'piscine', 'carport', 'annexe', 'pergola', 'garage', 'extension', 'veranda', 'maison', 'terrasse'].includes(k) ? k : 'annexe';
    window.BPPlan.ouvrir({mode, projet: type, plan: etat.plan, lieu: {lon: etat.lieu.lon, lat: etat.lieu.lat}, adresse: etat.lieu.label, titre: 'Placez votre projet sur votre terrain', sansAutre: true,
      libelleOk: 'Voir mon plan de masse', libelleAttente: 'Préparation du plan…',
      enregistrer: async plan => {
        etat.plan = plan;
        try { etat.ap = await api('POST', '/api/plan-masse/apercu', {lieu: plan.lieu, plan: {formes: plan.formes}, projet: etat.projet, hauteur: etat.hauteur, adresse: (etat.lieu.label || '').slice(0, 120)}); }
        catch (e) { formulaire(e.message); return true; }
        apercu(); return true;
      }});
  }

  function apercu(message) {
    const a = etat.ap, m = a.mesures, t = a.terrain;
    const dmin = m.distances && m.distances.length ? Math.min(...m.distances) : null;
    zone.innerHTML = `
      <div class="pm-ap">
        <div>
          <div class="pm-img">${a.image ? `<img src="/api/plan-masse/apercu?id=${a.id}" alt="Aperçu de votre plan de masse" width="1819" height="1286">` : `<iframe src="/api/plan-masse/apercu?id=${a.id}" title="Aperçu de votre plan de masse"></iframe>`}</div>
          <ul class="pm-faits">
            <li><b>${esc(t.commune)}</b>parcelle ${esc(t.parcelle)}</li>
            <li><b>1/${a.echelle}</b>échelle, format A3</li>
            <li><b>${fr(m.projet)} m²</b>emprise créée</li>
            ${dmin != null ? `<li><b>${fr(dmin)} m</b>au plus près de la limite</li>` : (m.accole ? '<li><b>Accolée</b>à la construction existante</li>' : '')}
          </ul>
          <button class="lien" type="button" data-modif>Modifier l'emplacement ou les dimensions</button>
        </div>
        <div class="pm-cote">
          <h3>Votre plan de masse est prêt. Que voulez-vous en faire ?</h3>
          ${message ? `<p class="pm-msg">${esc(message)}</p>` : ''}
          <label class="pm-mail"><span>Votre e-mail, pour recevoir votre plan</span><input data-mail type="email" autocomplete="email" inputmode="email" value="${esc(etat.mail)}"></label>
          <div class="pm-offre">
            <div><b>Le plan</b><span>Plan de masse et plan de situation, sans filigrane, à télécharger tout de suite.</span><span class="pm-moins">Ne dit pas si votre projet est autorisé.</span></div>
            <button class="btn ghost" type="button" data-payer="plan">${PRIX} €</button>
          </div>
          <div class="pm-offre">
            <div><b>Le plan vérifié</b><span>Le plan, et on étudie le règlement de votre terrain${t.zone ? ` (zone ${esc(t.zone)})` : ''} : votre projet passe ou non, règle par règle. Réponse sous 48 h.</span></div>
            <button class="btn ghost" type="button" data-payer="etude">${ETUDE} €</button>
          </div>
          <div class="pm-offre reco">
            <div><i>Recommandé</i><b>Le dossier complet</b><span>On étudie le règlement, on trace tous les plans, on remplit le formulaire. Vous n'avez plus qu'à déposer. Prêt en 48 h.</span></div>
            <a class="btn blue-btn" href="../#projets">Dès ${DOSSIER} €</a>
          </div>
          <p class="pm-note">Chaque formule contient la précédente. Ce que vous payez aujourd'hui est déduit si vous passez à la formule du dessus dans les 30 jours.</p>
          <div class="pm-zone pm-alerte"><b>Attention : un plan de masse ne garantit pas que votre projet sera accepté</b>
            ${t.zone ? `<span>Votre terrain est en zone ${esc(t.zone)}${t.zoneNom ? ' : ' + esc(t.zoneNom.toLowerCase()) : ''}</span>` : (t.rnu ? '<span>Votre commune applique le règlement national d\'urbanisme</span>' : '')}
            <p>Chaque commune a son propre règlement, différent de celui de la commune d'à côté : distance aux voisins, hauteur, emprise maximale, matériaux, couleurs. Des dizaines de pages techniques. Un plan parfaitement dessiné est refusé si le projet ne respecte pas une seule de ces règles, et il faut alors tout recommencer${dmin != null && dmin < 3 ? `. Votre projet est à ${fr(dmin)} m d'une limite : c'est justement le genre de distance que les règlements encadrent` : ''}.</p></div>
          ${t.protege ? '<p class="pm-msg">Votre terrain semble être dans un secteur protégé (monument historique ou site). La mairie demandera l\'avis de l\'architecte des Bâtiments de France.</p>' : ''}
        </div>
      </div>`;
    zone.querySelector('[data-modif]').onclick = ouvrirPlan;
    zone.querySelectorAll('[data-payer]').forEach(b => b.onclick = async () => {
      const champ = zone.querySelector('[data-mail]'); etat.mail = champ.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(etat.mail)) { apercu('Indiquez votre adresse e-mail pour recevoir votre plan.'); zone.querySelector('[data-mail]').focus(); return; }
      b.disabled = true; b.textContent = '…';
      try { const r = await api('POST', '/api/plan-masse/payer', {id: a.id, email: etat.mail, formule: b.dataset.payer}); location.href = r.url; }
      catch (e) { apercu(e.message); }
    });
    zone.scrollIntoView({behavior: 'smooth', block: 'start'});
  }

  function pret(id, t, r = {}) {
    const etude = r.formule === 'etude', fin = r.codeFin ? r.codeFin.split('-').reverse().join('/') : '';
    zone.innerHTML = `
      <div class="pm-pret">
        <h3>Merci. Votre plan de masse est prêt.</h3>
        <a class="btn blue-btn" href="/api/plan-masse/telecharger?id=${encodeURIComponent(id)}&t=${encodeURIComponent(t)}">Télécharger mon plan de masse et mon plan de situation (PDF)</a>
        <p class="pm-note">Le lien vous a aussi été envoyé par e-mail. Vous pouvez télécharger le fichier autant de fois que vous voulez.</p>
        ${etude ? `<div class="pm-zone"><b>L'étude du règlement est lancée</b><p>Vous recevrez notre réponse par e-mail sous 48 h ouvrées : le projet passe ou non, règle par règle, avec la page du règlement. Ne déposez rien avant de l'avoir reçue.</p>
            <p>Pour qu'on prépare ensuite tout le dossier, vos ${r.total} € sont déduits${r.code ? ` avec le code <b>${esc(r.code)}</b>` : ''}${fin ? `, jusqu'au ${esc(fin)}` : ''}.</p><a class="btn ghost" href="../#projets">Voir le dossier complet</a></div>`
        : `<div class="pm-zone pm-alerte"><b>Avant de déposer : votre projet respecte-t-il le règlement de votre commune ?</b>
          <p>Ce plan ne le vérifie pas. Chaque commune a ses propres règles de distance, de hauteur et d'emprise, et un projet qui en oublie une peut être refusé, même avec un plan parfait. Il vous reste aussi le formulaire officiel, le plan en coupe, les façades, l'insertion et les photos.</p>
          <p>On étudie le règlement et on prépare tout en 48 h.${r.code ? ` Vos ${r.total || PRIX} € sont déduits avec le code <b>${esc(r.code)}</b>${fin ? `, jusqu'au ${esc(fin)}` : ''}.` : ''}</p>
          <a class="btn ghost" href="../#projets">Voir le prix de mon dossier complet</a></div>`}
      </div>`;
  }

  // Retour du paiement, ou lien reçu par e-mail.
  const q = new URLSearchParams(location.search);
  if (q.get('paye')) {
    zone.innerHTML = '<p class="pm-note">Vérification du paiement…</p>';
    api('GET', '/api/plan-masse/etat?s=' + encodeURIComponent(q.get('paye')))
      .then(r => r.paye ? pret(r.id, r.t, r) : formulaire('Le paiement n\'a pas abouti. Vous pouvez recommencer.'))
      .catch(e => formulaire(e.message));
    zone.scrollIntoView();
  } else if (q.get('id') && q.get('t')) { pret(q.get('id'), q.get('t')); zone.scrollIntoView(); }
  else formulaire();
})();
