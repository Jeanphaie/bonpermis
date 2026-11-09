/* Dossier client : avancement, pièces à envoyer, messages, aperçu des plans, solde et téléchargement. */
(() => {
  const el = document.getElementById('dossier');
  const q = new URLSearchParams(location.search), ref = q.get('ref') || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const euro = n => (+n).toLocaleString('fr-FR', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}) + ' €';
  const jour = d => new Date(d).toLocaleDateString('fr-FR', {weekday: 'long', day: 'numeric', month: 'long'});
  const court = d => new Date(d).toLocaleString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  const mo = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  const R = encodeURIComponent(ref);
  const api = async (m, u, corps) => {
    const r = await fetch('/api' + u, {method: m, headers: corps ? {'Content-Type': 'application/json'} : {}, body: corps ? JSON.stringify(corps) : undefined, credentials: 'same-origin'});
    return {ok: r.ok, s: r.status, j: await r.json().catch(() => ({}))};
  };
  let d, livrSel = null, envois = 0;

  async function charger() {
    const r = await api('GET', '/espace/dossier?ref=' + R).catch(() => null);
    if (!r) { el.innerHTML = '<h1>Mon dossier</h1><p class="form-err">Le service ne répond pas. Réessayez dans un instant.</p>'; return; }
    if (r.s === 401) { location.replace('/espace/?suite=' + encodeURIComponent(location.pathname + location.search)); return; }
    if (!r.ok) { el.innerHTML = `<h1>Mon dossier</h1><p class="answer">${esc(r.j.erreur || 'Dossier introuvable.')}</p><p><a href="/espace/">Retour à mon espace</a></p>`; return; }
    d = r.j; afficher();
    // Retour du paiement : la confirmation de Stripe peut arriver quelques secondes après.
    if (q.get('paye') === 'acompte' && d.statut === 'brouillon' && attente++ < 15) setTimeout(charger, 2000);
  }

  // ---------- avancement en 5 étapes ----------
  function etapes() {
    const pos = {brouillon: 0, elements: 1, verification: 2, preparation: 3, apercu: 3, corrections: 3, livre: 5}[d.statut] ?? 1;
    const delai = d.delai === 1 ? '24 h ouvrées' : d.delai === 2 ? '48 h ouvrées' : `${d.delai} jours ouvrés`;
    const L = [
      d.paiements.acompte ? ['Acompte payé', new Date(d.paiements.acompte.date).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'})] : ['Validation', `Acompte de ${euro(acompteAff())} à régler`],
      ['Vos pièces', pos <= 1 ? `${pos === 1 ? 'En cours · ' : ''}${d.recues.n} sur ${d.recues.sur}` : `${d.recues.n} sur ${d.recues.sur} reçues`],
      ['Vérification', pos === 2 ? 'En cours, sous 24 h ouvrées' : 'sous 24 h ouvrées'],
      ['Aperçu des plans', d.statut === 'preparation' && d.echeance ? 'Au plus tard le ' + jour(d.echeance) : d.statut === 'apercu' ? 'À relire' : d.statut === 'corrections' ? 'Corrections en cours' : delai],
      ['Dossier prêt', d.paiements.solde ? 'Téléchargeable' : 'après le solde']
    ];
    return `<ol class="dz-etapes" aria-label="Avancement du dossier">${L.map((x, k) => {
      const c = k < pos ? 'fait' : k === pos ? 'encours' : '';
      return `<li class="${c}"${c === 'encours' ? ' aria-current="step"' : ''}><i aria-hidden="true"></i><span><b>${esc(x[0])}</b>${x[1] ? `<small>${esc(x[1])}</small>` : ''}</span></li>`;
    }).join('')}</ol>`;
  }

  // ---------- exemples de photos (dessins simples : bien / à éviter) ----------
  const EX = {
    face: '<rect y="80" width="150" height="24" fill="#B9C7A8"/><path d="M30 44 L75 18 L120 44 Z" fill="#8C5A4A"/><rect x="34" y="44" width="82" height="42" fill="#F3EDE2"/><rect x="68" y="58" width="14" height="28" fill="#6B7C93"/><rect x="42" y="54" width="16" height="14" fill="#9DB4D0"/><rect x="92" y="54" width="16" height="14" fill="#9DB4D0"/>',
    biais: '<rect y="80" width="150" height="24" fill="#B9C7A8"/><path d="M20 50 L70 22 L140 36 L140 46 Z" fill="#8C5A4A"/><path d="M24 50 L140 44 L140 94 L24 86 Z" fill="#F3EDE2"/><path d="M96 58 L106 58 L106 90 L96 89 Z" fill="#6B7C93"/><path d="M34 58 L50 57 L50 70 L34 71 Z" fill="#9DB4D0"/>',
    rue: '<rect y="76" width="150" height="28" fill="#9AA39A"/><rect x="8" y="34" width="38" height="44" fill="#E7E0D3"/><rect x="54" y="22" width="44" height="56" fill="#F1ECE2"/><path d="M50 24 L76 8 L102 24 Z" fill="#8C5A4A"/><rect x="104" y="38" width="38" height="40" fill="#DDD5C7"/><rect x="70" y="56" width="10" height="22" fill="#6B7C93"/>',
    pres: '<rect width="150" height="104" fill="#F1ECE2"/><rect x="40" y="30" width="34" height="74" fill="#6B7C93"/><rect x="90" y="20" width="40" height="34" fill="#9DB4D0"/>',
    nuit: '<rect width="150" height="104" fill="#2A2E38"/><rect x="24" y="30" width="96" height="56" fill="#3A3F4B"/>',
    jour: '<rect width="150" height="104" fill="#CFE0F2"/><rect y="72" width="150" height="32" fill="#A9C08E"/><rect x="20" y="30" width="80" height="48" fill="#F3EDE2"/><rect x="104" y="58" width="30" height="20" fill="none" stroke="#0127B1" stroke-width="2" stroke-dasharray="4 3"/>',
    menuiserie: '<rect width="150" height="104" fill="#E9E1D2"/><rect x="40" y="10" width="70" height="84" fill="#fff"/><rect x="48" y="18" width="24" height="68" fill="#AFC3DA"/><rect x="78" y="18" width="24" height="68" fill="#AFC3DA"/><rect x="10" y="10" width="26" height="84" fill="#5C7A64"/><rect x="114" y="10" width="26" height="84" fill="#5C7A64"/>',
    flou: '<rect width="150" height="104" fill="#D9D3C7"/><rect x="30" y="20" width="90" height="64" rx="12" fill="#C9C1B3"/>'
  };
  // Exemples par pièce : [dessin, légende] pour « Bien » puis « À éviter ».
  function exemples(p) {
    const n = (p.id + ' ' + p.nom).toLowerCase();
    if (p.type !== 'photo') return null;
    if (/menuiser|mat[ée]ria/.test(n)) return [['menuiserie', 'à 1 ou 2 m, couleurs nettes'], ['flou', 'floue ou trop loin']];
    if (/rue|loin/.test(n)) return [['rue', 'de loin, les voisines dans le cadre'], ['pres', 'trop près']];
    if (/endroit|terrain/.test(n)) return [['jour', 'de jour, l\'endroit entier'], ['nuit', 'trop sombre']];
    if (/fa[cç]ade|face|change|toit|mur/.test(n)) return [['face', 'bien en face, en entier'], ['biais', 'de biais ou coupée']];
    return [['jour', 'en plein jour, en entier'], ['nuit', 'sombre ou floue']];
  }
  const figure = (k, bien, leg) => `<figure class="dz-ex ${bien ? 'bien' : 'mal'}"><div><svg viewBox="0 0 150 104" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${EX[k]}</svg><span aria-hidden="true">${bien ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.4"><path d="M6 6l12 12M18 6L6 18"/></svg>'}</span></div><figcaption><b>${bien ? 'Bien' : 'À éviter'}</b> : ${esc(leg)}</figcaption></figure>`;

  function vig(f) {
    const src = `/api/espace/voir?ref=${R}&id=${f.id}&taille=mini`;
    const pv = (d.pieces.find(x => x.id === f.piece) || {}).etat === 'valide';
    const del = d.statut !== 'livre' && f.par === 'client' && !pv ? `<button class="vig-x" type="button" data-del="${f.id}" aria-label="Retirer ${esc(f.nom)}">×</button>` : '';
    return `<span style="position:relative"><button class="vig" type="button" data-voir="${f.id}" aria-label="Voir ${esc(f.nom)}">${f.vue ? `<img src="${src}" alt="" loading="lazy">` : f.type.toUpperCase()}</button>${del}</span>`;
  }

  // ---------- pièces, par groupe ----------
  const ETATS = {manquant: ['À envoyer', 'st-manquant'], a_verifier: ['Reçue, on vérifie', 'st-a_verifier'], valide: ['Validée', 'st-valide'], a_refaire: ['À refaire', 'st-a_refaire']};
  function groupe(p) {
    const id = p.id;
    if (/^secte-/.test(id)) return 'abf';
    if (/^(copro|lotis|locat)-/.test(id)) return 'situation';
    if (/^regul-/.test(id)) return 'regul';
    if (['rue', 'endroit', 'loin'].includes(id)) return 'lieu';
    if (['plans', 'autre', 'documents'].includes(id)) return 'docs';
    return 'projet';
  }
  const GROUPES = [['projet', 'Votre projet'], ['lieu', 'Photos du lieu'], ['abf', 'Pour l\'architecte des Bâtiments de France'], ['situation', 'Copropriété, lotissement, location'], ['regul', 'Les travaux déjà faits'], ['docs', 'Documents utiles']];

  function piece(p) {
    const modif = d.statut !== 'livre', fs = d.fichiers.filter(f => f.piece === p.id);
    const etat = p.etat, peutAjouter = modif && etat !== 'valide';
    const [lib, cls] = p.facultatif && etat === 'manquant' ? ['Si vous l\'avez', 'st-simulation'] : ETATS[etat];
    let corps = '';
    if (p.type === 'texte') corps = modif && etat !== 'valide'
      ? `<textarea class="dz-texte" data-texte="${p.id}" rows="2" maxlength="5000" aria-label="${esc(p.nom)}" placeholder="${esc(exempleTexte(p))}">${esc(p.texte)}</textarea><p class="save" data-save="${p.id}" aria-live="polite"></p>`
      : `<p class="dz-lu">${esc(p.texte) || '<span class="note">(vide)</span>'}</p>`;
    else {
      const ex = peutAjouter && !fs.length ? exemples(p) : null;
      const ajout = peutAjouter ? `<label class="dz-depot${ex ? '' : ' petit'}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0127B1" stroke-width="1.8" aria-hidden="true">${p.type === 'photo' ? '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>' : '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>'}</svg>
          <span><b>${fs.length ? (p.type === 'photo' ? 'Ajouter une autre photo' : 'Ajouter un autre fichier') : p.type === 'photo' ? 'Prendre ou déposer une photo' : 'Ajouter un fichier'}</b><small>${p.type === 'photo' ? 'JPG, PNG, HEIC · plusieurs à la fois possible' : 'PDF ou photo · 25 Mo maximum'}</small></span>
          <input type="file" multiple data-piece="${p.id}" accept="${p.type === 'photo' ? 'image/*' : 'image/*,application/pdf'}"></label>` : '';
      corps = `${fs.length ? `<div class="vignettes">${fs.map(vig).join('')}</div>` : ''}
        ${ex || ajout ? `<div class="dz-ajout">${ex ? figure(ex[0][0], true, ex[0][1]) + figure(ex[1][0], false, ex[1][1]) : ''}${ajout}</div>` : ''}
        <div data-prog="${p.id}" aria-live="polite"></div>`;
    }
    return `<div class="dz-piece" id="p-${p.id}">
      <div class="dz-piece-t"><div><h4>${esc(p.nom)}</h4>${p.aide ? `<p>${esc(p.aide)}</p>` : ''}</div><span class="pill ${cls}">${lib}</span></div>
      ${etat === 'a_refaire' && p.motif ? `<p class="motif">${esc(p.motif)}</p>` : ''}${corps}</div>`;
  }

  // Exemple écrit dans le champ vide, pour que chacun voie quoi répondre.
  function exempleTexte(p) {
    const n = (p.id + ' ' + p.nom).toLowerCase();
    if (/porte/.test(n)) return 'Exemple : porte d\'entrée, 2,15 m de haut et 0,90 m de large';
    if (/adoss|autoport/.test(n)) return 'Exemple : adossée à la maison';
    if (/mat[ée]riau|teinte/.test(n)) return 'Exemple : aluminium gris anthracite (RAL 7016), lames orientables';
    if (/date/.test(n)) return 'Exemple : été 2019';
    if (/mesure/.test(n)) return 'Exemple : 4 m x 3 m, à 2 m de la clôture du voisin';
    if (p.id === 'projet') return 'Exemple : pergola en aluminium gris de 4 m x 3 m, contre la façade arrière, toit en lames orientables';
    return 'Écrivez votre réponse ici';
  }

  function carteplan(p) {
    const modif = d.statut !== 'livre' && p.etat !== 'valide';
    return `<section class="dz-plan" id="p-${p.id}">
      ${p.plan ? `<div class="plan-mini" data-plan-ap="${p.id}"></div>` : '<svg width="120" height="84" viewBox="0 0 120 84" aria-hidden="true"><rect width="120" height="84" rx="10" fill="#27304D"/><path d="M16 14 L96 10 L104 70 L20 74 Z" fill="none" stroke="#8EA2FF" stroke-width="2" stroke-dasharray="4 3"/><rect x="40" y="26" width="40" height="22" fill="#4A5578"/><rect x="48" y="48" width="26" height="14" fill="none" stroke="#FFD34D" stroke-width="2.5"/></svg>'}
      <div class="dz-plan-t"><h3>${p.plan ? 'Votre projet est placé sur le plan' : 'Placez votre projet sur le plan'}</h3>
        <p>${p.plan ? (p.texte ? esc(p.texte) : 'Vous pouvez encore le déplacer ou le modifier.') : 'Dessinez-le à sa place, à la bonne taille : on en tire le plan de masse. 2 minutes, au doigt ou à la souris.'}</p>
        ${p.etat === 'a_refaire' && p.motif ? `<p class="motif">${esc(p.motif)}</p>` : ''}</div>
      ${modif ? `<div class="dz-plan-b"><button class="btn${p.plan ? ' ghost' : ''}" type="button" data-plan="${p.id}">${p.plan ? 'Modifier' : 'Ouvrir le plan'}</button><button class="lien" type="button" data-autrement>Je préfère décrire autrement</button></div>` : `<span class="pill ${ETATS[p.etat][1]}">${ETATS[p.etat][0]}</span>`}
    </section>`;
  }

  function pieces() {
    const plan = d.pieces.find(p => p.type === 'plan'), L = d.pieces.filter(p => p.type !== 'plan');
    let n = 0;
    return (plan ? carteplan(plan) : '') + GROUPES.map(([g, titre]) => {
      const lot = L.filter(p => groupe(p) === g); if (!lot.length) return '';
      n++;
      return `<section class="dz-carte dz-groupe"><h3>${n}. ${esc(titre)}</h3>${lot.map(piece).join('')}</section>`;
    }).join('');
  }

  function apercu() {
    if (!d.livrables.length || !['apercu', 'corrections', 'livre'].includes(d.statut)) return '';
    if (!livrSel || !d.livrables.some(l => l.id === livrSel)) livrSel = d.livrables[0].id;
    const l = d.livrables.find(x => x.id === livrSel), livre = d.statut === 'livre';
    const pages = l.pages && !livre ? Array.from({length: l.pages}, (_, k) => `<img class="page-ap" src="/api/espace/voir?ref=${R}&l=${l.id}&n=${k + 1}" alt="${esc(l.code)}, page ${k + 1}" loading="lazy">`).join('')
      : livre ? '' : '<div class="sans-ap">Aperçu en image indisponible pour cette pièce. Il sera téléchargeable après validation.</div>';
    return `<section class="dz-carte" id="plans"><h2 class="dz-h2">${livre ? 'Votre dossier est prêt' : 'Vos plans à relire'}</h2>
        ${livre ? `<p style="margin:0 0 12px">Votre dossier complet, sans filigrane.</p>
          <div class="pile">${d.livrables.map(x => `<a class="rang ecart" href="/api/espace/telecharger?ref=${R}&id=${x.id}" style="text-decoration:none;color:inherit;border-top:1px solid var(--line);padding-top:10px"><span><b>${esc(x.code)}</b> ${esc(x.nom)}</span><span class="lien">Télécharger</span></a>`).join('')}</div>
          <a class="btn blue-btn" href="/api/espace/telecharger?ref=${R}" style="width:100%;margin-top:16px">Tout télécharger (zip)</a>`
        : `<div class="livr-tabs" role="group" aria-label="Pièces du dossier">${d.livrables.map(x => `<button type="button" data-l="${x.id}" aria-pressed="${x.id === l.id}">${esc(x.code)}</button>`).join('')}</div>
          <p style="margin:12px 0 0"><b>${esc(l.code)}</b> ${esc(l.nom)}${l.pages ? ` <span class="note">· ${l.pages} page${l.pages > 1 ? 's' : ''}</span>` : ''}</p>${pages}
          ${d.statut === 'corrections' ? '<p class="ok-msg" style="margin-top:14px">Corrections demandées : nous revenons vers vous avec une nouvelle version.</p>' : `
          <div class="rang" style="margin-top:16px"><button class="btn ghost" type="button" data-corr>Demander une correction</button><button class="btn blue-btn" type="button" data-valider>C'est bon pour moi : payer le solde de ${euro(d.solde)}</button></div>
          <p class="note">Les corrections sont comprises jusqu'au dépôt. Après le solde, vous téléchargez le dossier complet sans filigrane.</p>`}`}
      </section>`;
  }

  function messages() {
    return `<section class="dz-carte dz-side"><h3>Une question ?</h3>
      <div class="fil">${d.messages.length ? d.messages.map(m => `<div class="msg ${m.de}${m.type === 'correction' ? ' correction' : ''}"><small>${m.de === 'client' ? 'Vous' : 'L\'équipe'} · ${court(m.date)}${m.type === 'correction' ? ' · correction' : ''}</small>${esc(m.texte)}</div>`).join('') : '<p class="note" style="margin:0">Écrivez-nous ici, on répond sous 24 h ouvrées.</p>'}</div>
      <form id="fmsg"><label for="fmsg-t" class="note" style="display:block;margin:0 0 6px">Votre message</label><textarea id="fmsg-t" name="t" rows="2" maxlength="3000" placeholder="Écrivez-nous ici" class="dz-texte"></textarea>
      <label class="rang" style="font-size:14px;margin-top:8px" ${d.statut === 'apercu' ? '' : 'hidden'}><input type="checkbox" name="corr" style="width:18px;height:18px;accent-color:var(--accent)"> C'est une demande de correction des plans</label>
      <p class="form-err" role="alert" hidden></p><button class="btn ghost petit" type="submit" style="margin-top:8px">Envoyer</button></form></section>`;
  }

  // Colonne de gauche : terrain (carte IGN, parcelle, PLU, protections) et commande.
  function terrainBloc() {
    return `<section class="dz-carte dz-side dz-terrain">${d.lieu ? '<div class="dz-carte-map" data-carte></div>' : ''}
      <div class="dz-side-c"><p class="dz-adr">${esc(d.adresse)}</p><dl class="dz-dl" data-terrain-dl><dt>Terrain</dt><dd class="note">${d.lieu ? 'Lecture des données publiques…' : 'Adresse saisie à la main : nous vérifions le terrain.'}</dd></dl><div data-terrain-note></div></div></section>`;
  }
  function commandeBloc() {
    const lignes = d.lignes && d.lignes.length ? d.lignes : [[d.nom, d.total]];
    const L = lignes.map(l => Array.isArray(l) ? l : [l.label, l.prix]);
    const kind = {dp: 'Déclaration préalable de travaux', pc: 'Permis de construire', pd: 'Permis de démolir', svc: 'Démarche d\'urbanisme'}[d.kind] || '';
    return `<section class="dz-carte dz-side"><h3>Votre choix</h3>
      <p class="dz-choix"><b>${esc(d.nom)}</b>${kind ? `<span>${kind}</span>` : ''}</p>
      <div class="prix">${L.map(([lab, px]) => `<span class="gris">${esc(lab)}</span><span class="gris">${euro(px)}</span>`).join('')}
        <span class="tot">Total</span><span class="tot">${euro(d.total)}</span>
        ${!d.paiements.acompte ? `<span>Acompte, à la validation</span><span>${euro(acompteAff())}</span>` : ''}
        ${d.paiements.acompte ? `<span class="vert">Acompte payé le ${new Date(d.paiements.acompte.date).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'})}</span><span class="vert">${euro(d.paiements.acompte.montant)}</span>` : ''}
        ${d.paiements.solde ? (d.paiements.solde.montant ? `<span class="vert">Solde payé le ${new Date(d.paiements.solde.date).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'})}</span><span class="vert">${euro(d.paiements.solde.montant)}</span>` : '') : `<span class="gris">Solde, après l'aperçu</span><span class="gris">${euro(promoOk ? promoOk.solde : d.solde)}</span>`}
      </div><p class="note">Options : ${esc(d.options || 'aucune').replace(/,/g, ', ').replace('aucune', 'aucune')}. Les reçus de paiement vous sont envoyés par e-mail.</p></section>`;
  }

  // ---------- validation du dossier (statut « brouillon ») : paiement de l'acompte ----------
  let promoOk = null;
  const acompteAff = () => promoOk ? promoOk.acompte : d.acompte;
  function blocValider() {
    if (d.statut !== 'brouillon') return '';
    const total = promoOk ? promoOk.total : d.total, solde = promoOk ? promoOk.solde : d.solde;
    return `<section class="dz-valider" id="valider">
      <div class="dz-valider-t">
        <h2>Validez votre dossier pour qu'on commence</h2>
        <p>Acompte de <b>${euro(acompteAff())}</b>, soit 30 % du prix de ${euro(total)}. Le solde de ${euro(solde)} se règle après l'aperçu de vos plans, quand tout vous convient.${d.recues.n < d.recues.sur ? ' Vous pouvez envoyer vos pièces avant ou après : rien n\'est perdu.' : ''}</p>
        <ul class="dz-garanties">
          <li>Paiement sécurisé par Stripe : carte, Apple Pay, Google Pay, PayPal</li>
          <li>Corrections des plans comprises jusqu'au dépôt</li>
          <li>Refus dû à une erreur de notre part : on corrige et on redépose gratuitement</li>
        </ul>
      </div>
      <div class="dz-valider-a">
        <button class="btn blue-btn dz-payer" type="button" data-payer>Valider et payer ${euro(acompteAff()).replace(' ', '\u00a0')}</button>
        <div class="promo dz-promo">${promoOk ? `<p class="promo-msg ok">Code ${esc(promoOk.code)} appliqué : -${euro(promoOk.remise)}. <button type="button" class="lien" data-promo-retirer>Retirer</button></p>` : `<button type="button" class="more-btn" data-promo-ouvrir>J'ai un code promo</button>
          <div class="promo-l" data-promo hidden><input name="promo" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="Code promo" aria-label="Code promo"><button type="button" class="btn ghost" data-promo-ok>Appliquer</button></div>
          <p class="promo-msg err" data-promo-msg aria-live="polite"></p>`}</div>
        <p class="form-err" role="alert" hidden data-payer-err></p>
      </div>
    </section>`;
  }
  function barrePayer() {
    if (d.statut !== 'brouillon') return '';
    return `<div class="dz-barre-payer" role="region" aria-label="Valider le dossier"><span><b>Dossier non validé</b><small>Acompte de ${euro(acompteAff())}, solde après l'aperçu</small></span><button class="btn blue-btn" type="button" data-payer>Valider et payer</button></div>`;
  }
  function brancherPaiement() {
    el.querySelectorAll('[data-payer]').forEach(b => b.addEventListener('click', async () => {
      const err = el.querySelector('[data-payer-err]');
      el.querySelectorAll('[data-payer]').forEach(x => { x.disabled = true; }); const lab = b.textContent; b.textContent = 'Ouverture du paiement sécurisé…';
      const r = await api('POST', '/espace/dossier/payer?ref=' + R, {promo: promoOk ? promoOk.code : undefined}).catch(() => ({j: {}}));
      if (r.ok && r.j.url) { location.href = r.j.url; return; }
      el.querySelectorAll('[data-payer]').forEach(x => { x.disabled = false; }); b.textContent = lab;
      if (err) { err.textContent = r.j.erreur || 'Le paiement n\'a pas pu s\'ouvrir. Réessayez.'; err.hidden = false; err.scrollIntoView({block: 'center'}); }
    }));
    const ouvrir = el.querySelector('[data-promo-ouvrir]');
    if (ouvrir) {
      const zone = el.querySelector('[data-promo]'), champ = zone.querySelector('input'), msg = el.querySelector('[data-promo-msg]');
      ouvrir.addEventListener('click', () => { ouvrir.hidden = true; zone.hidden = false; champ.focus(); });
      const verifier = async () => {
        const code = champ.value.trim(); if (!code) return;
        msg.textContent = 'Vérification…';
        const r = await api('POST', '/promo', {code, ref}).catch(() => ({j: {}}));
        if (!r.ok) { msg.textContent = r.j.erreur || 'Code non valable.'; return; }
        promoOk = r.j; afficher(); const v = document.getElementById('valider'); if (v) v.scrollIntoView({block: 'center'});
      };
      zone.querySelector('[data-promo-ok]').addEventListener('click', verifier);
      champ.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); verifier(); } });
    }
    const ret = el.querySelector('[data-promo-retirer]');
    if (ret) ret.addEventListener('click', () => { promoOk = null; afficher(); });
  }

  function afficher() {
    const w = el.closest('.wrap'); if (w) w.classList.add('dz-large');
    const manque = d.pieces.filter(p => !p.facultatif && p.etat === 'manquant').length;
    const statut = d.statut === 'brouillon' ? ['Non validé : acompte à régler', 'attente'] : d.statut === 'elements' && manque ? [`À vous : ${manque} pièce${manque > 1 ? 's' : ''} à envoyer`, 'attente'] : d.statut === 'apercu' ? ['À vous : relire vos plans', 'attente'] : [d.statutTexte, d.statut === 'livre' ? 'ok' : 'info'];
    const kind = {dp: 'Déclaration préalable', pc: 'Permis de construire', pd: 'Permis de démolir'}[d.kind] || '';
    const pct = Math.round(d.recues.n / Math.max(1, d.recues.sur) * 100);
    const prochaine = d.statut === 'livre' ? null : d.pieces.find(p => !p.facultatif && p.type !== 'plan' && (p.etat === 'a_refaire' || p.etat === 'manquant'));
    el.innerHTML = `<a href="/espace/" class="dz-retour">← Mes dossiers</a>
      <div class="dz-tete"><div><p class="eyebrow" style="margin:0">Dossier ${esc(d.ref)}${kind ? ' · ' + kind : ''}</p><h1>${esc(d.nom)}</h1></div>
        <span class="dz-statut ${statut[1]}"><i aria-hidden="true"></i>${esc(statut[0])}</span></div>
      ${bandeau()}
      ${etapes()}
      ${blocValider()}
      <div class="dz-cols">
        <aside class="dz-gauche">${terrainBloc()}${commandeBloc()}${messages()}</aside>
        <div class="dz-droite">
          ${apercu()}
          <section class="dz-carte dz-entete-pieces"><div class="dz-ep-l"><h2 class="dz-h2">Vos pièces</h2><span><b>${d.recues.n} sur ${d.recues.sur}</b> envoyées</span></div>
            <div class="dz-barre" aria-hidden="true"><i style="width:${pct}%"></i></div>
            ${prochaine ? `<a class="dz-prochaine" href="#p-${prochaine.id}"><span><small>Prochaine étape</small><b>${esc(prochaine.nom)}</b></span><span class="dz-go">Y aller ↓</span></a>` : ''}
            <p class="note">${d.statut === 'brouillon' ? 'Vous pouvez les envoyer dès maintenant, avant de valider. ' : ''}Tout est enregistré au fur et à mesure : vous pouvez arrêter et revenir plus tard, ou continuer sur votre téléphone.</p></section>
          ${pieces()}
          ${d.statut === 'elements' ? `<section class="dz-carte dz-fin"><div><h3 style="margin:0">Vous avez tout envoyé ?</h3><p class="note">Prévenez-nous : on vérifie et le délai de préparation démarre.</p><p class="form-err" role="alert" hidden id="errfin"></p></div><button class="btn blue-btn" type="button" data-fin>${manque ? `J'ai tout envoyé (il en manque ${manque})` : 'J\'ai tout envoyé'}</button></section>` : ''}
        </div>
      </div>
      ${barrePayer()}
      <div class="lis" hidden id="lis" role="dialog" aria-modal="true" aria-label="Photo"></div>`;
    document.body.classList.toggle('dz-a-payer', d.statut === 'brouillon');
    brancher();
    brancherPaiement();
    terrainCharger();
  }

  function bandeau() {
    if (q.get('paye') === 'acompte') return d.statut === 'brouillon'
      ? '<div class="dz-bandeau attente" role="status"><b>Paiement reçu, validation en cours.</b> Cela prend quelques secondes.</div>'
      : `<div class="dz-bandeau ok" role="status"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span><b>Paiement accepté : votre dossier est validé.</b> ${d.statut === 'verification' ? 'Toutes vos pièces sont là : nous les vérifions sous 24 h ouvrées.' : `Il reste ${d.recues.sur - d.recues.n} pièce${d.recues.sur - d.recues.n > 1 ? 's' : ''} à envoyer, ci-dessous.`} Un e-mail de confirmation vous est envoyé.</span></div>`;
    if (q.get('paye')) return '<div class="dz-bandeau ok" role="status"><b>Merci, le solde est réglé.</b> Votre dossier est prêt à télécharger (la confirmation peut prendre quelques secondes).</div>';
    if (q.get('nouveau') && d.statut === 'brouillon') return '<div class="dz-bandeau info" role="status"><b>Votre dossier est créé.</b> Voici tout ce qu\'il nous faut. Envoyez vos pièces quand vous voulez, puis validez le dossier en réglant l\'acompte : nous commençons à ce moment-là.</div>';
    return '';
  }
  let attente = 0;

  // Données du terrain (même service que le simulateur), lues une fois par visite.
  let terrainCache = null;
  async function terrainCharger() {
    const zone = el.querySelector('[data-carte]'), dl = el.querySelector('[data-terrain-dl]'), note = el.querySelector('[data-terrain-note]');
    if (!d.lieu || !dl) return;
    if (zone && window.BPCarte) window.BPCarte(zone, d.lieu, terrainCache, {hauteur: 170});
    if (!terrainCache) { try { terrainCache = await (await fetch(`/api/terrain?lon=${d.lieu.lon}&lat=${d.lieu.lat}`)).json(); } catch (e) { terrainCache = {}; } }
    const t = terrainCache || {}, L = [];
    if (t.parcelle) L.push(['Parcelle', `${esc(t.parcelle.section)} ${esc(String(t.parcelle.numero).replace(/^0+/, ''))}${t.parcelle.contenance ? ', ' + t.parcelle.contenance.toLocaleString('fr-FR') + ' m²' : ''}`]);
    if (t.zone) L.push(['Zone PLU', esc(t.zone.libelle) + (t.zone.libelleLong && t.zone.libelleLong !== t.zone.libelle ? ', ' + esc(t.zone.libelleLong.toLowerCase()) : '')]);
    else if (t.commune && t.commune.rnu) L.push(['Règles', 'règlement national d\'urbanisme']);
    if (t.protections && t.protections.length) L.push(['Protection', esc(t.protections[0].libelle) + (t.protections[0].nom ? ' « ' + esc(t.protections[0].nom) + ' »' : '')]);
    dl.innerHTML = L.length ? L.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('') : '<dt>Terrain</dt><dd class="note">Données publiques indisponibles pour le moment.</dd>';
    if (t.secteurProtege && note) note.innerHTML = '<p class="dz-abf">L\'architecte des Bâtiments de France donnera son avis : c\'est pour lui qu\'on vous demande les matériaux et teintes exacts.</p>';
    if (zone && window.BPCarte && t.parcelle) window.BPCarte(zone, d.lieu, t, {hauteur: 170});
  }

  // Plan du projet (src/plan.js) : ouverture de l'éditeur, aperçu, repli vers la description écrite.
  function decrireAutrement() {
    const t = el.querySelector('[data-texte="projet"]') || el.querySelector('[data-texte]');
    if (t) { t.scrollIntoView({behavior: 'smooth', block: 'center'}); setTimeout(() => t.focus(), 400); }
  }
  function brancherPlan() {
    if (!window.BPPlan) return;
    el.querySelectorAll('[data-plan-ap]').forEach(c => { const p = d.pieces.find(x => x.id === c.dataset.planAp); if (p && p.plan) window.BPPlan.apercu(c, p.plan); });
    el.querySelectorAll('[data-autrement]').forEach(b => b.addEventListener('click', decrireAutrement));
    el.querySelectorAll('[data-plan]').forEach(b => b.addEventListener('click', () => {
      const p = d.pieces.find(x => x.id === b.dataset.plan);
      window.BPPlan.ouvrir({mode: p.mode, projet: d.projet, lieu: d.lieu, adresse: d.adresse, plan: p.plan, titre: d.nom, autrement: decrireAutrement,
        enregistrer: async (plan, resume) => { const r = await api('POST', '/espace/dossier/plan?ref=' + R, {plan, resume}); if (r.ok) { d = r.j; afficher(); } return r.ok; }});
    }));
  }
  function brancher() {
    brancherPlan();
    // textes : enregistrement automatique
    el.querySelectorAll('[data-texte]').forEach(t => { let m; t.addEventListener('input', () => {
      const s = el.querySelector(`[data-save="${t.dataset.texte}"]`); s.textContent = '…'; clearTimeout(m);
      m = setTimeout(async () => { const r = await api('POST', '/espace/dossier/texte?ref=' + R, {piece: t.dataset.texte, texte: t.value}).catch(() => ({})); s.textContent = r.ok ? 'Enregistré.' : 'Pas enregistré : vérifiez votre connexion.'; const p = d.pieces.find(x => x.id === t.dataset.texte); if (r.ok && p) p.texte = t.value; }, 900);
    }); });
    // fichiers
    el.querySelectorAll('input[type=file][data-piece]').forEach(inp => inp.addEventListener('change', async () => {
      const fichiers = [...inp.files], piece = inp.dataset.piece, zone = el.querySelector(`[data-prog="${piece}"]`); inp.value = '';
      envois++;
      for (const f of fichiers) {
        const ligne = document.createElement('div'); ligne.className = 'up'; ligne.innerHTML = `<span>${esc(f.name)}</span><i><b></b></i>`; zone.appendChild(ligne);
        if (f.size > 25 * 1048576) { ligne.innerHTML = `<span>${esc(f.name)}</span><em>Trop lourd (25 Mo maximum)</em>`; continue; }
        let r = await envoyer(f, piece, ligne); if (r.erreur === 'Connexion perdue.') r = await envoyer(f, piece, ligne);
        if (r.ok) ligne.remove(); else ligne.innerHTML = `<span>${esc(f.name)}</span><em>${esc(r.erreur)}</em>`;
      }
      envois--; if (!envois && !zone.querySelector('em')) charger(); else if (!envois) { const err = zone.innerHTML; await charger(); const z = el.querySelector(`[data-prog="${piece}"]`); if (z) z.innerHTML = err; }
    }));
    el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Retirer ce fichier ?')) return;
      const r = await api('DELETE', `/espace/dossier/fichier?ref=${R}&id=${b.dataset.del}`); if (!r.ok) alert(r.j.erreur || 'Impossible.'); charger();
    }));
    el.querySelectorAll('[data-voir]').forEach(b => b.addEventListener('click', () => liseuse(b.dataset.voir)));
    el.querySelectorAll('[data-l]').forEach(b => b.addEventListener('click', () => { livrSel = b.dataset.l; afficher(); document.getElementById('plans').scrollIntoView(); }));
    const fin = el.querySelector('[data-fin]');
    if (fin) fin.addEventListener('click', async () => {
      if (envois) return alert('Patientez : des fichiers sont encore en cours d\'envoi.');
      const manque = d.pieces.filter(p => !p.facultatif && p.etat === 'manquant');
      if (manque.length && !confirm(`Il manque encore : ${manque.map(p => p.nom).join(', ')}. Prévenir l'équipe quand même ?`)) return;
      const r = await api('POST', '/espace/dossier/terminer?ref=' + R);
      if (!r.ok) { const e = el.querySelector('#errfin'); e.textContent = r.j.erreur || 'Erreur.'; e.hidden = false; return; }
      charger();
    });
    const corr = el.querySelector('[data-corr]');
    if (corr) corr.addEventListener('click', () => { const f = el.querySelector('#fmsg'); f.corr.checked = true; f.t.placeholder = 'Quelle pièce, et que faut-il changer ?'; f.t.focus(); f.scrollIntoView({block: 'center'}); });
    const val = el.querySelector('[data-valider]');
    if (val) val.addEventListener('click', async () => {
      val.disabled = true; val.textContent = 'Ouverture du paiement sécurisé…';
      const r = await api('POST', '/espace/dossier/valider?ref=' + R).catch(() => ({j: {}}));
      if (r.ok && r.j.url) { location.href = r.j.url; return; }
      alert(r.j.erreur || 'Le paiement n\'a pas pu s\'ouvrir.'); val.disabled = false; val.textContent = 'Réessayer';
    });
    el.querySelector('#fmsg').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target, err = f.querySelector('.form-err');
      if (!f.t.value.trim()) { f.t.focus(); return; }
      const r = await api('POST', '/espace/dossier/message?ref=' + R, {texte: f.t.value, correction: f.corr.checked});
      if (!r.ok) { err.textContent = r.j.erreur || 'Envoi impossible.'; err.hidden = false; return; }
      charger();
    });
  }

  const envoyer = (f, piece, ligne) => new Promise(ok => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/espace/dossier/fichier?ref=${R}&piece=${encodeURIComponent(piece)}`);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.setRequestHeader('X-Nom-Fichier', encodeURIComponent(f.name));
    x.upload.onprogress = e => { if (e.lengthComputable) ligne.querySelector('b').style.width = Math.round(e.loaded / e.total * 100) + '%'; };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} ok(x.status === 200 ? {ok: true} : {erreur: j.erreur || 'Envoi refusé.'}); };
    x.onerror = () => ok({erreur: 'Connexion perdue.'});
    x.send(f);
  });

  // Liseuse plein écran pour les photos et documents envoyés
  function liseuse(fid) {
    const f0 = d.fichiers.find(x => x.id === fid); if (!f0) return;
    const L = d.fichiers.filter(x => x.piece === f0.piece);
    let i = L.indexOf(f0);
    const lis = document.getElementById('lis'), avant = document.activeElement;
    const rendu = () => {
      const f = L[i], p = d.pieces.find(x => x.id === f.piece) || {};
      lis.innerHTML = `<div class="lis-h"><button class="lis-b" type="button" data-x aria-label="Fermer">×</button><span>${esc(p.nom || '')} · ${i + 1} / ${L.length}</span><span style="width:44px"></span></div>
        <div class="lis-c">${f.type === 'pdf' ? `<div class="lis-pdf"><b>${esc(f.nom)}</b><p class="note">${mo(f.taille)}</p><a class="btn" href="/api/espace/voir?ref=${R}&id=${f.id}" target="_blank" rel="noopener">Ouvrir le PDF</a></div>`
          : f.vue || f.type !== 'heic' ? `<img src="/api/espace/voir?ref=${R}&id=${f.id}" alt="${esc(f.nom)}">` : `<div class="lis-pdf"><b>${esc(f.nom)}</b><p class="note">Photo bien reçue. L'aperçu de ce format n'est pas disponible ici.</p></div>`}
          ${L.length > 1 ? '<button class="lis-b lis-prev" type="button" data-p aria-label="Précédente">‹</button><button class="lis-b lis-next" type="button" data-n aria-label="Suivante">›</button>' : ''}</div>
        <div style="padding:12px 16px;font-size:13px;color:#C9C9CF">${esc(f.nom)} · ${mo(f.taille)}</div>`;
      lis.querySelector('[data-x]').addEventListener('click', fermer);
      const p1 = lis.querySelector('[data-p]'), n1 = lis.querySelector('[data-n]');
      if (p1) p1.addEventListener('click', () => { i = (i - 1 + L.length) % L.length; rendu(); });
      if (n1) n1.addEventListener('click', () => { i = (i + 1) % L.length; rendu(); });
      lis.querySelector('[data-x]').focus();
    };
    const touche = e => { if (e.key === 'Escape') fermer(); if (e.key === 'ArrowLeft' && L.length > 1) { i = (i - 1 + L.length) % L.length; rendu(); } if (e.key === 'ArrowRight' && L.length > 1) { i = (i + 1) % L.length; rendu(); } };
    function fermer() { lis.hidden = true; lis.innerHTML = ''; document.removeEventListener('keydown', touche); document.body.style.overflow = ''; if (avant) avant.focus(); }
    lis.hidden = false; document.body.style.overflow = 'hidden'; document.addEventListener('keydown', touche); rendu();
  }

  if (!/^BP-[A-Z0-9]{6}$/.test(ref)) { el.innerHTML = '<h1>Mon dossier</h1><p class="answer">Lien incomplet.</p><p><a href="/espace/">Ouvrir mon espace</a></p>'; return; }
  charger();
})();
