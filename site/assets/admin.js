/* Espace équipe : connexion par code e-mail, liste des dossiers, dossier avec liseuse, pièces, livrables, messages. */
(() => {
  const el = document.getElementById('admin');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const euro = n => (+n).toLocaleString('fr-FR', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}) + ' €';
  const court = d => d ? new Date(d).toLocaleString('fr-FR', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'}) : '';
  const jour = d => d ? new Date(d).toLocaleDateString('fr-FR', {weekday: 'short', day: 'numeric', month: 'short'}) : '';
  const mo = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  const api = async (m, u, corps) => {
    const r = await fetch('/api/admin' + u, {method: m, headers: corps ? {'Content-Type': 'application/json'} : {}, body: corps ? JSON.stringify(corps) : undefined, credentials: 'same-origin'});
    return {ok: r.ok, s: r.status, j: await r.json().catch(() => ({}))};
  };
  const ST = {brouillon: 'Non payé', elements: 'Attente client', verification: 'À vérifier', preparation: 'En préparation', apercu: 'Aperçu envoyé', corrections: 'Corrections', livre: 'Livré'};
  const STC = {elements: 'elements', verification: 'verification', preparation: 'preparation', apercu: 'apercu', corrections: 'corrections', livre: 'livre'};
  const EP = {manquant: 'Manquant', a_verifier: 'À vérifier', valide: 'Validé', a_refaire: 'À refaire'};
  const CODES = ['CERFA', 'DP1', 'DP2', 'DP3', 'DP4', 'DP5', 'DP6', 'DP7', 'DP8', 'DP11', 'PC1', 'PC2', 'PC3', 'PC4', 'PC5', 'PC6', 'PC7', 'PC8', 'NOTICE', 'AUTRE'];
  const NOMS = {CERFA: 'Formulaire', DP1: 'Plan de situation', DP2: 'Plan de masse', DP3: 'Plan en coupe', DP4: 'Plan des façades et toitures', DP5: 'Représentation de l\'aspect extérieur', DP6: 'Insertion dans l\'environnement', DP7: 'Photo environnement proche', DP8: 'Photo paysage lointain', DP11: 'Notice', PC1: 'Plan de situation', PC2: 'Plan de masse', PC3: 'Plan en coupe', PC4: 'Notice descriptive', PC5: 'Plan des façades et toitures', PC6: 'Insertion dans l\'environnement', PC7: 'Photo environnement proche', PC8: 'Photo paysage lointain', NOTICE: 'Notice descriptive', AUTRE: 'Document'};
  let filtre = 'tous', recherche = '', liste = null, d = null, sel = null, zoom = 1, rot = 0;

  // ---------- connexion ----------
  function connexion(etape, email) {
    el.innerHTML = `<div class="esp"><div class="wrap" style="max-width:420px"><h1>Espace équipe</h1>
      <form id="f" class="carte" style="margin-top:18px" novalidate>
        ${etape === 'code' ? `<p style="margin:0 0 6px">Code envoyé à <b>${esc(email)}</b>.</p><label class="field"><span>Code à 6 chiffres</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required></label>`
          : '<label class="field"><span>E-mail de l\'équipe</span><input name="email" type="email" autocomplete="email" required></label>'}
        <p class="form-err" role="alert" hidden></p>
        <button class="btn blue-btn" type="submit" style="width:100%;margin-top:14px">${etape === 'code' ? 'Se connecter' : 'Recevoir un code'}</button>
        ${etape === 'code' ? '<button class="lien" type="button" data-r style="margin-top:12px">Changer d\'e-mail ou renvoyer un code</button>' : ''}
      </form></div></div>`;
    const f = el.querySelector('#f'), err = f.querySelector('.form-err');
    (f.code || f.email).focus();
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.hidden = true;
      if (etape === 'code') {
        const r = await api('POST', '/connexion', {email, code: f.code.value});
        if (!r.ok) { err.textContent = r.j.erreur || 'Erreur.'; err.hidden = false; return; }
        route();
      } else {
        const m = f.email.value.trim(); if (!m) return;
        await api('POST', '/code', {email: m}); connexion('code', m);
      }
    });
    const rr = f.querySelector('[data-r]'); if (rr) rr.addEventListener('click', () => connexion());
  }

  function cadre(contenu, actif) {
    return `<div class="bo"><nav class="bo-nav" aria-label="Équipe">
      <a href="#" class="${actif === 'liste' ? 'on' : ''}">Dossiers</a>
      <a href="#promos" class="${actif === 'promos' ? 'on' : ''}">Codes promo</a>
      <a href="#mails" class="${actif === 'mails' ? 'on' : ''}">E-mails envoyés</a>
      <a href="https://dashboard.stripe.com/payments" target="_blank" rel="noopener">Paiements (Stripe)</a>
      <button type="button" data-out>Se déconnecter</button></nav>
      <main class="bo-main">${contenu}</main></div>`;
  }
  const brancherCadre = () => el.querySelector('[data-out]').addEventListener('click', async () => { await api('POST', '/deconnexion'); location.hash = ''; route(); });

  // ---------- liste ----------
  async function vueListe() {
    const r = await api('GET', '/dossiers');
    if (r.s === 401) return connexion();
    if (!r.ok) { el.innerHTML = '<p class="form-err" style="margin:40px">Le service ne répond pas.</p>'; return; }
    liste = r.j; dessinerListe();
  }
  function dessinerListe() {
    const k = liste.compteurs;
    const F = {tous: () => true, attente: x => x.statut === 'elements', verifier: x => ['verification', 'corrections'].includes(x.statut), preparation: x => x.statut === 'preparation', retard: x => x.retard, livres: x => x.statut === 'livre'};
    const rq = recherche.toLowerCase();
    const L = liste.dossiers.filter(F[filtre]).filter(x => !rq || [x.ref, x.client, x.email, x.commune, x.nom].join(' ').toLowerCase().includes(rq));
    el.innerHTML = cadre(`<div class="rang ecart"><h1>Dossiers</h1>
        <label class="field" style="margin:0"><span class="sr-only">Rechercher</span><input type="search" id="rq" value="${esc(recherche)}" placeholder="Référence, client, ville" aria-label="Rechercher" style="width:260px"></label></div>
      <div class="kpis">${[['tous', liste.dossiers.length, 'Tous'], ['attente', k.attente, 'En attente du client'], ['verifier', k.verifier, 'À vérifier'], ['preparation', k.preparation, 'En préparation'], ['retard', k.retard, 'En retard'], ['livres', k.livres, 'Livrés ce mois']]
        .map(([id, n, t]) => `<button class="kpi" type="button" data-f="${id}" aria-pressed="${filtre === id}"${id === 'retard' && n ? ' style="border-color:#E6A3A3"' : ''}><b>${n}</b><span>${t}</span></button>`).join('')}</div>
      <div class="tbl"><table><thead><tr><th>Réf.</th><th>Client · projet</th><th>Commune</th><th>Pièces</th><th>Statut</th><th>Échéance</th><th>Paiement</th></tr></thead><tbody>
      ${L.length ? L.map(x => `<tr${x.retard ? ' style="background:#FFF5F5"' : x.statut === 'verification' ? ' style="background:#FFFBF0"' : ''}>
        <td><a href="#${x.ref}">${x.ref}</a></td><td><b style="font-weight:500">${esc(x.client)}</b><br><small>${esc(x.nom)}</small></td><td>${esc(x.commune)}</td>
        <td><span class="barre"><i style="width:${x.recues.sur ? Math.round(x.recues.n / x.recues.sur * 100) : 0}%"></i></span>${x.recues.n} / ${x.recues.sur}${x.aVerifier ? `<br><small>${x.aVerifier} à vérifier</small>` : ''}</td>
        <td><span class="pill st-${STC[x.statut]}">${ST[x.statut]}</span></td>
        <td>${x.retard ? `<b style="color:#8A1C1C;font-weight:500">Dépassée (${jour(x.echeance)})</b>` : x.echeance && x.statut === 'preparation' ? jour(x.echeance) : '-'}</td>
        <td>${euro(x.total)}<br><small>${x.paiement === 'solde' ? 'soldé' : 'acompte payé'}</small></td></tr>`).join('') : '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:30px">Aucun dossier.</td></tr>'}
      </tbody></table></div>${liste.rappels ? `<p class="note" style="margin-top:12px">${liste.rappels} demande(s) de rappel reçues par e-mail.</p>` : ''}`, 'liste');
    brancherCadre();
    el.querySelectorAll('[data-f]').forEach(b => b.addEventListener('click', () => { filtre = b.dataset.f; dessinerListe(); }));
    const rqi = el.querySelector('#rq'); rqi.addEventListener('input', () => { recherche = rqi.value; const p = rqi.selectionStart; dessinerListe(); const n = el.querySelector('#rq'); n.focus(); n.setSelectionRange(p, p); });
  }

  // ---------- dossier ----------
  async function vueDossier(ref) {
    const r = await api('GET', '/dossier?ref=' + ref);
    if (r.s === 401) return connexion();
    if (!r.ok) { el.innerHTML = cadre(`<p>${esc(r.j.erreur || 'Introuvable')}</p><a href="#">← Tous les dossiers</a>`); brancherCadre(); return; }
    if (!d || d.ref !== r.j.ref) { sel = null; zoom = 1; rot = 0; }
    d = r.j; dessinerDossier();
  }
  const R = () => encodeURIComponent(d.ref);
  const maj = j => { if (j && j.ref) d = Object.assign(d, j); dessinerDossier(); };

  function visionneuse() {
    const items = [...d.fichiers.map(f => ({k: 'f', id: f.id, f})), ...d.livrables.map(l => ({k: 'l', id: l.id, l}))];
    if (!sel || !items.some(x => x.k === sel.k && x.id === sel.id)) sel = items[0] ? {k: items[0].k, id: items[0].id, n: 1} : null;
    const strip = d.fichiers.map(f => `<button class="vig${sel && sel.k === 'f' && sel.id === f.id ? ' sel' : ''}" type="button" data-s="f:${f.id}" title="${esc(f.nom)}" aria-label="${esc(f.nom)}">${f.vue ? `<img src="/api/admin/voir?ref=${R()}&id=${f.id}&taille=mini" alt="" loading="lazy">` : f.type.toUpperCase()}</button>`).join('')
      + d.livrables.map(l => `<button class="vig${sel && sel.k === 'l' && sel.id === l.id ? ' sel' : ''}" type="button" data-s="l:${l.id}" title="${esc(l.code)}" style="background:#EAEDFB;color:#2340D9">${esc(l.code)}</button>`).join('');
    if (!sel) return `<div class="vis"><div class="vis-c"><p class="vis-vide">Aucun fichier pour l'instant.</p></div></div>`;
    let tete = '', centre = '', pied = '';
    if (sel.k === 'f') {
      const f = d.fichiers.find(x => x.id === sel.id), p = d.pieces.find(x => x.id === f.piece) || {nom: f.piece};
      tete = `<span><b style="font-weight:500">${esc(f.nom)}</b> <small class="note" style="display:inline">· ${esc(p.nom)} · ${mo(f.taille)} · ${f.par === 'equipe' ? 'ajouté par l\'équipe' : court(f.date)}</small></span>`;
      centre = f.type === 'pdf' ? `<iframe src="/api/admin/voir?ref=${R()}&id=${f.id}&taille=original#view=FitH" title="${esc(f.nom)}"></iframe>`
        : f.vue || f.type !== 'heic' ? `<img src="/api/admin/voir?ref=${R()}&id=${f.id}" alt="${esc(f.nom)}" style="transform:scale(${zoom}) rotate(${rot}deg)">` : '<p class="vis-vide">Aperçu HEIC indisponible sur ce serveur : téléchargez l\'original.</p>';
      const etat = p.etat || '';
      pied = `<div class="rang"><label class="field" style="margin:0;flex:1;min-width:200px"><span>Classer dans</span><select id="classer">${d.pieces.filter(x => x.type !== 'texte').map(x => `<option value="${x.id}"${x.id === f.piece ? ' selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label></div>
        <div class="rang" style="align-items:flex-end"><label class="field" style="margin:0;flex:1;min-width:220px"><span>Motif si à refaire (le client le lira)</span><input id="motif" value="${esc(p.motif || '')}" placeholder="Ex. : prenez du recul, toute la maison doit être visible"></label></div>
        <div class="rang"><span>Pièce « ${esc(p.nom)} » : <span class="pill st-${etat}">${EP[etat] || ''}</span></span>
          <button class="btn petit" type="button" data-pst="valide" style="background:var(--good);border-color:var(--good)">Valider la pièce</button>
          <button class="btn petit danger" type="button" data-pst="a_refaire">À refaire</button></div>`;
    } else {
      const l = d.livrables.find(x => x.id === sel.id), n = Math.min(sel.n || 1, Math.max(l.pages, 1));
      tete = `<span><b style="font-weight:500">${esc(l.code)}</b> ${esc(l.nom)} <small class="note" style="display:inline">· ${l.pages ? `aperçu page ${n} / ${l.pages}` : 'pas d\'aperçu image'} · ${mo(l.taille)}</small></span>`;
      centre = l.pages ? `<img src="/api/admin/voir?ref=${R()}&l=${l.id}&n=${n}" alt="${esc(l.code)} page ${n}" style="transform:scale(${zoom})">` : `<iframe src="/api/admin/voir?ref=${R()}&livrable=${l.id}#view=FitH" title="${esc(l.code)}"></iframe>`;
      pied = `<div class="rang">${l.pages > 1 ? `<button class="btn petit ghost" type="button" data-pg="-1">Page précédente</button><button class="btn petit ghost" type="button" data-pg="1">Page suivante</button>` : ''}
        <a class="btn petit ghost" href="/api/admin/voir?ref=${R()}&livrable=${l.id}" target="_blank" rel="noopener">Ouvrir le PDF original</a>
        ${d.statut !== 'livre' ? `<button class="btn petit danger" type="button" data-dl="${l.id}">Retirer cette pièce</button>` : ''}</div>`;
    }
    return `<div class="vis"><div class="vis-h">${tete}<span class="rang">
        <button class="tb" type="button" data-z="-1" aria-label="Zoom arrière">−</button><button class="tb" type="button" data-z="1" aria-label="Zoom avant">+</button>
        <button class="tb" type="button" data-rot aria-label="Pivoter">⟳</button>
        ${sel.k === 'f' ? `<a class="tb" href="/api/admin/voir?ref=${R()}&id=${sel.id}&taille=original" aria-label="Télécharger l'original" download>↓</a>` : ''}</span></div>
      <div class="vis-c">${centre}<button class="lis-b lis-prev" type="button" data-nav="-1" aria-label="Précédent">‹</button><button class="lis-b lis-next" type="button" data-nav="1" aria-label="Suivant">›</button></div>
      <div class="strip">${strip}</div><div class="vis-f">${pied}</div></div>`;
  }

  // Fiche terrain (données IGN) à partir du point choisi par le client dans les suggestions d'adresse.
  let terr = {ref: null, v: null};
  function ficheTerrain() {
    if (!d.lieu) return '<p class="note" style="margin:6px 0 0">Adresse saisie sans suggestion : pas de fiche terrain automatique.</p>';
    const t = terr.ref === d.ref ? terr.v : null; if (!t) return '<p class="note" style="margin:6px 0 0">Lecture du terrain…</p>';
    if (t.erreur) return `<p class="note">${esc(t.erreur)}</p>`;
    const li = [];
    if (t.parcelle) li.push(['Parcelle', `${esc(t.parcelle.section)} ${esc(t.parcelle.numero)} · ${t.parcelle.contenance || t.parcelle.surfaceCalculee} m² · ${esc(t.parcelle.commune)}`]);
    if (t.zone) li.push(['PLU', `${esc(t.zone.libelle)} · ${esc(t.zone.libelleLong)}${t.zone.reglement ? ' · ' + esc(t.zone.reglement) : ''}`]);
    else if (t.commune) li.push(['PLU', t.commune.rnu ? 'Commune au RNU (règles nationales)' : 'Zone non trouvée']);
    li.push(['Protection', t.protections.length ? t.protections.map(p => `${esc(p.libelle)} : ${esc(p.nom)}${p.detail ? ' (' + esc(p.detail) + ')' : ''}`).join('<br>') : (t.secteurProtege === false ? 'Aucune dans les données publiques (à confirmer)' : 'Non vérifiée')]);
    if (Array.isArray(t.risques)) li.push(['Risques', t.risques.length ? t.risques.map(r => esc(r.libelle) + (r.niveau ? ' (' + esc(r.niveau) + ')' : '') + (r.detail ? ' · ' + esc(r.detail) : '')).join('<br>') + (t.georisques ? `<br><a href="${esc(t.georisques)}" target="_blank" rel="noopener">Rapport Géorisques</a>` : '') : 'Aucun risque majeur à l\'adresse']);
    const bs = t.batiments.filter(b => b.surParcelle);
    li.push(['Bâtiments', bs.length ? bs.map(b => `${b.emprise} m² au sol${b.hauteur != null ? ', ' + String(b.hauteur).replace('.', ',') + ' m à la gouttière' : ''}${b.etages ? ', ' + b.etages + ' niv.' : ''}${b.usage ? ' · ' + esc(b.usage) : ''}`).join('<br>') : 'Aucun sur la parcelle']);
    if (t.erreurs && t.erreurs.length) li.push(['Non lu', esc(t.erreurs.join(', '))]);
    return `<dl class="dl" style="margin-top:8px">${li.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl><p class="note" style="margin:6px 0 0">Données IGN (cadastre, BD TOPO, Géoportail de l'urbanisme). Précision métrique, à vérifier.</p>`;
  }
  function chargerTerrain() {
    if (!d.lieu || terr.ref === d.ref) return;
    const ref = d.ref; terr = {ref, v: null};
    fetch(`/api/terrain?lon=${d.lieu.lon}&lat=${d.lieu.lat}`).then(r => r.json()).catch(() => ({erreur: 'Service terrain indisponible.'}))
      .then(v => { if (terr.ref !== ref) return; terr.v = v; const z = el.querySelector('[data-tq]'); if (z) z.innerHTML = ficheTerrain(); });
  }

  function dessinerDossier() {
    const textes = d.pieces.filter(p => p.type === 'texte');
    const lancer = ['elements', 'verification'].includes(d.statut), envoyer = d.livrables.length && !['livre'].includes(d.statut);
    el.innerHTML = cadre(`<a href="#" style="font-size:13px">‹ Tous les dossiers</a>
      <div class="rang ecart" style="margin-top:4px"><h1>${esc(d.ref)} · ${esc(d.client || d.email)} <span class="pill st-${STC[d.statut]}" style="font-family:var(--f-body);vertical-align:middle;font-size:13px">${ST[d.statut]}</span></h1>
        <div class="rang"><a class="btn petit ghost" href="/api/admin/dossier.zip?ref=${R()}">Tout télécharger (zip)</a>
        ${lancer ? '<button class="btn petit blue-btn" type="button" data-lancer>Pièces complètes, lancer les plans</button>' : ''}
        ${envoyer ? `<button class="btn petit blue-btn" type="button" data-apercu>${d.statut === 'apercu' ? 'Renvoyer l\'aperçu' : 'Envoyer l\'aperçu au client'}</button>` : ''}</div></div>
      ${!d.outils.images || !d.outils.pdf ? `<p class="form-err" style="margin-top:10px">Outils d'images absents sur le serveur : ${!d.outils.pdf ? 'pas d\'aperçu des PDF livrés' : ''}${!d.outils.images ? ' pas de conversion des photos HEIC ni de filigrane' : ''}.</p>` : ''}
      <div class="bo-d">
        <aside class="pile">
          <section class="carte"><h3>Commande</h3><dl class="dl">
            <dt>Projet</dt><dd>${esc(d.nom)}</dd><dt>Client</dt><dd>${esc(d.client)}<br><a href="mailto:${esc(d.email)}">${esc(d.email)}</a></dd>
            <dt>Options</dt><dd>${esc((d.options || '').replace(/,/g, ', '))}</dd>
            <dt>Prix</dt><dd>${euro(d.total)}</dd><dt>Acompte</dt><dd style="color:#3E5A38">${d.paiements.acompte ? euro(d.paiements.acompte.montant) + ' le ' + jour(d.paiements.acompte.date) : '-'}</dd>
            <dt>Solde</dt><dd>${d.paiements.solde ? `<span style="color:#3E5A38">payé le ${jour(d.paiements.solde.date)}</span>` : euro(d.solde) + ' à l\'aperçu'}</dd>
            <dt>Échéance</dt><dd>${d.echeance ? jour(d.echeance) : `${d.delai === 1 ? '24 h' : d.delai === 2 ? '48 h' : d.delai + ' jours'} ouvrés après validation`}</dd></dl>
            ${d.liensStripe.map(pi => `<a class="note" style="display:block" href="https://dashboard.stripe.com/payments/${esc(pi)}" target="_blank" rel="noopener">Paiement Stripe ${esc(pi.slice(-6))}</a>`).join('')}</section>
          <section class="carte"><h3>Terrain</h3><p style="margin:0 0 8px;font-size:14px">${esc(d.adresse)}</p>
            <p class="rang" style="font-size:13px;gap:12px"><a href="https://www.geoportail.gouv.fr/carte?q=${encodeURIComponent(d.adresse)}" target="_blank" rel="noopener">Géoportail</a><a href="https://cadastre.data.gouv.fr/" target="_blank" rel="noopener">Cadastre</a><a href="https://www.geoportail-urbanisme.gouv.fr/map/" target="_blank" rel="noopener">PLU</a></p><div data-tq>${ficheTerrain()}</div></section>
          <section class="carte"><h3>Réponses au simulateur</h3>${(d.reponsesLisibles || []).map(([k, v]) => `<p style="margin:0 0 8px;font-size:13px"><span class="note" style="display:block;margin:0">${esc(k)}</span><b style="font-weight:500">${esc(v)}</b></p>`).join('') || '<p class="note">-</p>'}${d.regul === 'true' ? '<p class="note">Travaux déjà réalisés (régularisation)</p>' : ''}</section>
          ${d.pieces.filter(p => p.type === 'plan').map(p => `<section class="carte"><h3>${esc(p.nom)} <span class="pill st-${p.etat}" style="text-transform:none;letter-spacing:0">${EP[p.etat]}</span></h3>${p.plan ? `<div class="plan-mini" data-plan-ap="${p.id}"></div><p style="margin:8px 0 0;font-size:13px;white-space:pre-wrap">${esc(p.texte)}</p><div class="rang" style="margin-top:8px"><button class="lien" type="button" data-tv="${p.id}">Valider</button><button class="lien" type="button" data-tr="${p.id}" style="color:#8A1C1C">À refaire</button></div>` : '<p class="note" style="margin:0">Pas encore placé par le client.</p>'}</section>`).join('')}
          ${textes.map(p => `<section class="carte"><h3>${esc(p.nom)} <span class="pill st-${p.etat}" style="text-transform:none;letter-spacing:0">${EP[p.etat]}</span></h3><p style="margin:0;font-size:14px;white-space:pre-wrap">${esc(p.texte) || '<span class="note">(vide)</span>'}</p>
            ${p.texte ? `<div class="rang" style="margin-top:8px"><button class="lien" type="button" data-tv="${p.id}">Valider</button><button class="lien" type="button" data-tr="${p.id}" style="color:#8A1C1C">À refaire</button></div>` : ''}</section>`).join('')}
        </aside>
        <section>${visionneuse()}</section>
        <aside class="pile">
          <section class="carte"><h3>Pièces demandées · ${d.recues.n} / ${d.recues.sur}</h3>
            ${d.pieces.map(p => { const n = d.fichiers.filter(f => f.piece === p.id).length; const cur = sel && sel.k === 'f' && (d.fichiers.find(f => f.id === sel.id) || {}).piece === p.id;
              return `<div class="pl${cur ? ' sel' : ''}"><button class="nm" type="button" data-pp="${p.id}">${esc(p.nom)}${n ? ` · ${n}` : ''}${p.facultatif ? ' <small class="note" style="display:inline">(facult.)</small>' : ''}</button><span class="pill st-${p.etat}">${EP[p.etat]}</span></div>`; }).join('')}
            <details style="margin-top:10px"><summary class="lien" style="display:inline">+ Demander une pièce</summary>
              <form id="fpiece" class="pile" style="margin-top:8px"><label class="field" style="margin:0"><span>Nom</span><input name="nom" placeholder="Ex. : Accord de la copropriété"></label>
              <label class="field" style="margin:0"><span>Explication pour le client</span><input name="aide"></label>
              <button class="btn petit" type="submit">Demander (e-mail au client)</button></form></details>
            <label class="ajout" style="width:100%;box-sizing:border-box">Ajouter un fichier reçu par e-mail<input type="file" multiple id="upeq" accept="image/*,application/pdf"></label><div id="progeq"></div></section>
          <section class="carte"><h3>Pièces à livrer · ${d.livrables.length}</h3>
            ${d.livrables.map(l => `<div class="pl"><button class="nm" type="button" data-s="l:${l.id}"><b>${esc(l.code)}</b> ${esc(l.nom)}</button><small class="note">${l.pages ? l.pages + ' p.' : 'sans aperçu'}</small></div>`).join('') || '<p class="note" style="margin:0">Aucun PDF déposé.</p>'}
            ${d.statut !== 'livre' ? `<form id="flivr" class="pile" style="margin-top:10px">
              <div class="rang"><label class="field" style="margin:0;flex:1;min-width:110px"><span>Pièce</span><select name="code">${CODES.map(c => `<option>${c}</option>`).join('')}</select></label>
              <label class="field" style="margin:0;flex:2"><span>Intitulé</span><input name="nom" value="${esc(NOMS.CERFA)}"></label></div>
              <label class="ajout" style="margin:0">Choisir le PDF et déposer<input type="file" name="pdf" accept="application/pdf"></label><div id="proglivr"></div></form>
              <p class="note">Le client voit un aperçu en image avec filigrane. Il télécharge les PDF après le solde.</p>` : '<p class="note">Dossier livré : le client télécharge les PDF.</p>'}</section>
          <section class="carte"><h3>Messages</h3>
            <div class="fil">${d.messages.map(m => `<div class="msg ${m.de === 'client' ? 'equipe' : 'client'}${m.type === 'correction' ? ' correction' : ''}"><small>${m.de === 'client' ? 'Client' : 'Équipe'} · ${court(m.date)}${m.type === 'correction' ? ' · correction' : ''}</small>${esc(m.texte)}</div>`).join('') || '<p class="note" style="margin:0">Aucun message.</p>'}</div>
            <form id="fmsg"><label class="field" style="margin:0"><span class="sr-only">Message au client</span><textarea name="t" rows="3" aria-label="Message au client" placeholder="Message au client (envoyé aussi par e-mail)"></textarea></label>
            <div class="rang fin" style="margin-top:8px"><button class="btn petit" type="submit">Envoyer</button></div></form></section>
          <section class="carte"><h3>Historique</h3><ol class="histo">${d.historique.map(h => `<li><b>${court(h.date)}</b> · ${esc(h.texte)}</li>`).join('')}</ol></section>
        </aside></div>`, 'dossier');
    brancherCadre(); brancher(); chargerTerrain();
    if (window.BPPlan) el.querySelectorAll('[data-plan-ap]').forEach(c => { const p = d.pieces.find(x => x.id === c.dataset.planAp); if (p && p.plan) window.BPPlan.apercu(c, p.plan, d.projet); });
  }

  function brancher() {
    const $ = s => el.querySelector(s);
    const items = [...d.fichiers.map(f => ({k: 'f', id: f.id})), ...d.livrables.map(l => ({k: 'l', id: l.id}))];
    el.querySelectorAll('[data-s]').forEach(b => b.addEventListener('click', () => { const [k, id] = b.dataset.s.split(':'); sel = {k, id, n: 1}; zoom = 1; rot = 0; dessinerDossier(); }));
    el.querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => {
      const i = items.findIndex(x => x.k === sel.k && x.id === sel.id); const n = items[(i + +b.dataset.nav + items.length) % items.length]; sel = {...n, n: 1}; zoom = 1; rot = 0; dessinerDossier();
    }));
    el.querySelectorAll('[data-z]').forEach(b => b.addEventListener('click', () => { zoom = Math.min(4, Math.max(.5, zoom + (+b.dataset.z) * .25)); const im = $('.vis-c img'); if (im) im.style.transform = `scale(${zoom}) rotate(${rot}deg)`; }));
    const rb = $('[data-rot]'); if (rb) rb.addEventListener('click', () => { rot = (rot + 90) % 360; const im = $('.vis-c img'); if (im) im.style.transform = `scale(${zoom}) rotate(${rot}deg)`; });
    el.querySelectorAll('[data-pg]').forEach(b => b.addEventListener('click', () => { const l = d.livrables.find(x => x.id === sel.id); sel.n = Math.min(l.pages, Math.max(1, (sel.n || 1) + +b.dataset.pg)); dessinerDossier(); }));
    el.querySelectorAll('[data-pp]').forEach(b => b.addEventListener('click', () => { const f = d.fichiers.find(x => x.piece === b.dataset.pp); if (f) { sel = {k: 'f', id: f.id}; dessinerDossier(); } }));
    const cl = $('#classer'); if (cl) cl.addEventListener('change', async () => { const r = await api('POST', '/classer?ref=' + R(), {fichier: sel.id, piece: cl.value}); maj(r.j); });
    el.querySelectorAll('[data-pst]').forEach(b => b.addEventListener('click', async () => {
      const f = d.fichiers.find(x => x.id === sel.id), motif = ($('#motif') || {}).value || '';
      const r = await api('POST', '/piece?ref=' + R(), {piece: f.piece, statut: b.dataset.pst, motif});
      if (!r.ok) return alert(r.j.erreur || 'Erreur.'); maj(r.j);
    }));
    el.querySelectorAll('[data-tv],[data-tr]').forEach(b => b.addEventListener('click', async () => {
      const piece = b.dataset.tv || b.dataset.tr, refaire = !!b.dataset.tr;
      const motif = refaire ? prompt('Ce qu\'il faut compléter (le client le lira) :') : ''; if (refaire && !motif) return;
      const r = await api('POST', '/piece?ref=' + R(), {piece, statut: refaire ? 'a_refaire' : 'valide', motif}); if (!r.ok) return alert(r.j.erreur || 'Erreur.'); maj(r.j);
    }));
    const lc = $('[data-lancer]'); if (lc) lc.addEventListener('click', async () => {
      if (!confirm('Valider les pièces reçues et lancer les plans ? Le client est prévenu et l\'échéance démarre.')) return;
      const r = await api('POST', '/lancer?ref=' + R()); if (!r.ok) return alert(r.j.erreur || 'Erreur.'); maj(r.j);
    });
    const ap = $('[data-apercu]'); if (ap) ap.addEventListener('click', async () => {
      const t = prompt('Message joint pour le client (facultatif) :', ''); if (t === null) return;
      const r = await api('POST', '/apercu?ref=' + R(), {texte: t}); if (!r.ok) return alert(r.j.erreur || 'Erreur.'); maj(r.j);
    });
    el.querySelectorAll('[data-dl]').forEach(b => b.addEventListener('click', async () => {
      if (!confirm('Retirer ce PDF du dossier ?')) return;
      const r = await api('DELETE', `/livrable?ref=${R()}&id=${b.dataset.dl}`); sel = null; maj(r.j);
    }));
    const fp = $('#fpiece'); if (fp) fp.addEventListener('submit', async e => { e.preventDefault(); const r = await api('POST', '/piece?ref=' + R(), {ajouter: true, nom: fp.nom.value, aide: fp.aide.value}); if (!r.ok) return alert(r.j.erreur || 'Erreur.'); maj(r.j); });
    const fm = $('#fmsg'); fm.addEventListener('submit', async e => { e.preventDefault(); if (!fm.t.value.trim()) return; const r = await api('POST', '/message?ref=' + R(), {texte: fm.t.value}); if (!r.ok) return alert(r.j.erreur || 'Erreur.'); vueDossier(d.ref); });
    const fl = $('#flivr');
    if (fl) {
      fl.code.addEventListener('change', () => { fl.nom.value = NOMS[fl.code.value] || ''; });
      fl.pdf.addEventListener('change', async () => {
        const f = fl.pdf.files[0]; if (!f) return;
        const z = $('#proglivr'); z.innerHTML = `<div class="up"><span>${esc(f.name)} : envoi et préparation de l'aperçu…</span><i><b></b></i></div>`;
        const r = await envoyer(`/api/admin/livrable?ref=${R()}&code=${encodeURIComponent(fl.code.value)}&nom=${encodeURIComponent(fl.nom.value)}`, f, z.querySelector('.up'));
        if (!r.ok) { z.innerHTML = `<div class="up"><em>${esc(r.erreur)}</em></div>`; return; }
        if (r.j.avertissement) alert(r.j.avertissement);
        const nouveau = r.j.livrables[r.j.livrables.length - 1]; d = Object.assign(d, r.j); sel = {k: 'l', id: (r.j.livrables.find(l => !items.some(x => x.id === l.id)) || nouveau).id, n: 1}; dessinerDossier();
      });
    }
    const ue = $('#upeq'); if (ue) ue.addEventListener('change', async () => {
      const z = $('#progeq');
      for (const f of [...ue.files]) { const lg = document.createElement('div'); lg.className = 'up'; lg.innerHTML = `<span>${esc(f.name)}</span><i><b></b></i>`; z.appendChild(lg);
        const r = await envoyer(`/api/admin/fichier?ref=${R()}&piece=autre`, f, lg); if (!r.ok) lg.innerHTML = `<em>${esc(r.erreur)}</em>`; else lg.remove(); }
      vueDossier(d.ref);
    });
  }
  const envoyer = (url, f, ligne) => new Promise(ok => {
    const x = new XMLHttpRequest(); x.open('POST', url);
    x.setRequestHeader('Content-Type', 'application/octet-stream'); x.setRequestHeader('X-Nom-Fichier', encodeURIComponent(f.name));
    x.upload.onprogress = e => { const b = ligne && ligne.querySelector('b'); if (b && e.lengthComputable) b.style.width = Math.round(e.loaded / e.total * 100) + '%'; };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} ok(x.status === 200 ? {ok: true, j} : {erreur: j.erreur || 'Envoi refusé.'}); };
    x.onerror = () => ok({erreur: 'Connexion perdue.'}); x.send(f);
  });

  // ---------- journal des e-mails ----------
  async function vueMails(msg) {
    const r = await api('GET', '/mails');
    if (r.s === 401) return connexion();
    const d = r.j || {}, L = d.mails || [];
    const dt = s => new Date(s).toLocaleString('fr-FR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'});
    el.innerHTML = cadre(`<h1>E-mails envoyés</h1>
      <p class="note">Chaque envoi depuis le site, avec la réponse du serveur d'envoi (${esc((d.smtp || {}).hote || '?')}, expéditeur ${esc((d.smtp || {}).expediteur || '?')}).
      « Remis au serveur » veut dire que Hostinger a accepté l'e-mail : s'il n'arrive pas, c'est la boîte du destinataire qui l'a écarté (regarder alors la boîte contact@bonpermis.fr pour un e-mail de non-remise).</p>
      <form class="carte rang" id="ft" style="margin:16px 0" novalidate>
        <label class="field" style="margin:0;flex:1;min-width:220px"><span>Envoyer un e-mail de test à</span><input name="a" type="email" required placeholder="adresse@exemple.fr"></label>
        <button class="btn blue-btn petit" type="submit" style="align-self:flex-end">Envoyer le test</button>
      </form>
      ${msg ? `<p class="${msg.ok ? 'ok-msg' : 'form-err'}">${esc(msg.t)}</p>` : ''}
      <div class="tbl"><table><thead><tr><th>Date</th><th>Destinataire</th><th>Sujet</th><th>Résultat</th><th>Réponse du serveur</th></tr></thead><tbody>
      ${L.length ? L.map(m => `<tr><td><small>${dt(m.date)}</small></td><td>${esc(m.a)}</td><td>${esc(m.sujet)}</td>
        <td><span class="pill ${m.ok ? 'st-valide' : 'st-a_refaire'}">${m.ok ? 'Remis au serveur' : 'Échec : ' + esc(m.etape)}</span></td>
        <td><small style="word-break:break-word">${esc(m.reponse)}</small></td></tr>`).join('') : '<tr><td colspan="5">Aucun envoi enregistré depuis la mise en place du journal.</td></tr>'}
      </tbody></table></div>`, 'mails');
    brancherCadre();
    const ft = el.querySelector('#ft');
    ft.addEventListener('submit', async e => {
      e.preventDefault(); const b = ft.querySelector('button'); b.disabled = true; b.textContent = 'Envoi…';
      const t = await api('POST', '/mail-test', {a: ft.a.value.trim()});
      const m = t.j || {};
      vueMails(t.ok ? {ok: m.ok, t: m.ok ? `Accepté par le serveur d'envoi : ${(m.dernier || {}).reponse || ''}. Vérifiez la réception.` : `Refusé (${(m.dernier || {}).etape || '?'}) : ${(m.dernier || {}).reponse || ''}`} : {ok: false, t: m.erreur || 'Erreur.'});
    });
  }

  // ---------- codes promo ----------
  async function vuePromos(msg) {
    const r = await api('GET', '/promos');
    if (r.s === 401) return connexion();
    const L = (r.j || {}).codes || [];
    const TY = {pourcent: v => `-${v} %`, montant: v => `-${euro(v)}`, prix: v => `Prix final ${euro(v)}`};
    el.innerHTML = cadre(`<h1>Codes promo</h1>
      <p class="note">Le client saisit le code au moment de payer (« J'ai un code promo »). Le prix est recalculé par le serveur. Prix minimum après remise : 1 € (payé 0,50 € d'acompte + 0,50 € de solde). Un code est compté comme utilisé quand l'acompte est payé.</p>
      <form class="carte" id="fp" style="margin:16px 0" novalidate>
        <div class="rang" style="align-items:flex-end">
          <label class="field" style="margin:0;flex:1;min-width:140px"><span>Code</span><input name="code" required placeholder="TEST1" style="text-transform:uppercase"></label>
          <label class="field" style="margin:0;min-width:170px"><span>Type</span><select name="type"><option value="prix">Prix final fixe</option><option value="pourcent">Remise en %</option><option value="montant">Remise en €</option></select></label>
          <label class="field" style="margin:0;width:110px"><span>Valeur</span><input name="valeur" type="number" min="0" step="0.01" required value="1"></label>
          <label class="field" style="margin:0;width:120px"><span>Utilisations max</span><input name="max" type="number" min="0" step="1" placeholder="illimité"></label>
          <label class="field" style="margin:0;width:160px"><span>Valable jusqu'au</span><input name="expire" type="date"></label>
        </div>
        <label class="field"><span>Note (interne)</span><input name="note" placeholder="Test paiement réel par JP"></label>
        <button class="btn blue-btn petit" type="submit" style="margin-top:12px">Créer ou mettre à jour le code</button>
      </form>
      ${msg ? `<p class="${msg.ok ? 'ok-msg' : 'form-err'}">${esc(msg.t)}</p>` : ''}
      <div class="tbl"><table><thead><tr><th>Code</th><th>Effet</th><th>Utilisé</th><th>Fin</th><th>Note</th><th>État</th></tr></thead><tbody>
      ${L.length ? L.map(p => `<tr><td><b>${esc(p.code)}</b></td><td>${(TY[p.type] || String)(p.valeur)}</td><td>${p.utilises || 0}${p.max ? ' / ' + p.max : ''}</td><td>${p.expire ? esc(p.expire) : '<small>aucune</small>'}</td><td><small>${esc(p.note || '')}</small></td>
        <td><button class="lien" type="button" data-bascule="${esc(p.code)}" data-actif="${p.actif ? '0' : '1'}">${p.actif ? 'Actif · désactiver' : 'Inactif · activer'}</button></td></tr>`).join('') : '<tr><td colspan="6">Aucun code pour l\'instant.</td></tr>'}
      </tbody></table></div>`, 'promos');
    brancherCadre();
    const fp = el.querySelector('#fp');
    fp.addEventListener('submit', async e => {
      e.preventDefault();
      const t = await api('POST', '/promos', {code: fp.code.value, type: fp.type.value, valeur: fp.valeur.value, max: fp.max.value, expire: fp.expire.value, note: fp.note.value});
      vuePromos(t.ok ? {ok: true, t: 'Code enregistré.'} : {ok: false, t: (t.j || {}).erreur || 'Erreur.'});
    });
    el.querySelectorAll('[data-bascule]').forEach(b => b.addEventListener('click', async () => {
      await api('POST', '/promos/actif', {code: b.dataset.bascule, actif: b.dataset.actif === '1'}); vuePromos();
    }));
  }

  function route() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h === 'promos') vuePromos(); else if (h === 'mails') vueMails(); else if (/^BP-[A-Z0-9]{6}$/.test(h)) vueDossier(h); else vueListe();
  }
  window.addEventListener('hashchange', route);
  route();
})();
