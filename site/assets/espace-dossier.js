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
  const ETATS = {manquant: 'À envoyer', a_verifier: 'Reçu', valide: 'Validé', a_refaire: 'À refaire'};
  let d, livrSel = null, envois = 0;

  async function charger() {
    const r = await api('GET', '/espace/dossier?ref=' + R).catch(() => null);
    if (!r) { el.innerHTML = '<h1>Mon dossier</h1><p class="form-err">Le service ne répond pas. Réessayez dans un instant.</p>'; return; }
    if (r.s === 401) { location.replace('/espace/?suite=' + encodeURIComponent(location.pathname + location.search)); return; }
    if (!r.ok) { el.innerHTML = `<h1>Mon dossier</h1><p class="answer">${esc(r.j.erreur || 'Dossier introuvable.')}</p><p><a href="/espace/">Retour à mon espace</a></p>`; return; }
    d = r.j; afficher();
  }

  function etapes() {
    const ordre = ['elements', 'verification', 'preparation', 'apercu', 'livre'];
    const i = d.statut === 'corrections' ? 3 : ordre.indexOf(d.statut);
    const L = [
      ['Acompte reçu', d.paiements.acompte ? `${euro(d.paiements.acompte.montant)} le ${new Date(d.paiements.acompte.date).toLocaleDateString('fr-FR')}` : ''],
      ['Vos éléments', `${d.recues.n} sur ${d.recues.sur} reçus`],
      ['Vérification par l\'équipe', ''],
      ['Plans en préparation', d.echeance ? 'Aperçu prévu au plus tard le ' + jour(d.echeance) : (d.delai === 1 ? 'en 24 h ouvrées' : d.delai === 2 ? 'en 48 h ouvrées' : `en ${d.delai} jours ouvrés`)],
      ['Aperçu des plans et corrections', d.statut === 'corrections' ? 'Corrections en cours' : ''],
      ['Solde, puis téléchargement', d.paiements.solde ? 'Réglé' : `${euro(d.solde)}`]
    ];
    return '<ol class="etapes">' + L.map((x, k) => {
      const c = k === 0 || k <= i ? 'fait' : (k === i + 1 ? 'encours' : '');
      return `<li class="${d.statut === 'livre' ? 'fait' : c}"><span>${esc(x[0])}${x[1] ? `<small>${esc(x[1])}</small>` : ''}</span></li>`;
    }).join('') + '</ol>';
  }

  function vig(f) {
    const src = `/api/espace/voir?ref=${R}&id=${f.id}&taille=mini`;
    const pv = (d.pieces.find(x => x.id === f.piece) || {}).etat === 'valide';
    const del = d.statut !== 'livre' && f.par === 'client' && !pv ? `<button class="vig-x" type="button" data-del="${f.id}" aria-label="Retirer ${esc(f.nom)}">×</button>` : '';
    return `<span style="position:relative"><button class="vig" type="button" data-voir="${f.id}" aria-label="Voir ${esc(f.nom)}">${f.vue ? `<img src="${src}" alt="" loading="lazy">` : f.type.toUpperCase()}</button>${del}</span>`;
  }

  function pieces() {
    const modif = d.statut !== 'livre';
    return d.pieces.map(p => {
      const fs = d.fichiers.filter(f => f.piece === p.id);
      const etat = p.etat, peutAjouter = modif && etat !== 'valide';
      let corps = '';
      if (p.type === 'texte') corps = modif && etat !== 'valide'
        ? `<label class="field" style="margin-top:8px"><span class="sr-only">${esc(p.nom)}</span><textarea data-texte="${p.id}" rows="3" maxlength="5000" aria-label="${esc(p.nom)}">${esc(p.texte)}</textarea></label><p class="save" data-save="${p.id}" aria-live="polite"></p>`
        : `<p style="white-space:pre-wrap;margin:8px 0 0">${esc(p.texte) || '<span class="note">(vide)</span>'}</p>`;
      else corps = `${fs.length ? `<div class="vignettes">${fs.map(vig).join('')}</div>` : ''}
        ${peutAjouter ? `<label class="ajout">${fs.length ? 'Ajouter' : (p.type === 'photo' ? 'Prendre ou choisir une photo' : 'Ajouter un document')}<input type="file" multiple data-piece="${p.id}" accept="${p.type === 'photo' ? 'image/*' : 'image/*,application/pdf'}"></label>` : ''}
        <div data-prog="${p.id}" aria-live="polite"></div>`;
      return `<div class="piece" id="p-${p.id}"><div class="piece-t"><span><b>${esc(p.nom)}${p.facultatif ? ' <small style="display:inline;font-weight:400">(facultatif)</small>' : ''}</b>${p.aide ? `<small>${esc(p.aide)}</small>` : ''}</span>
        ${p.facultatif && etat === 'manquant' ? '' : `<span class="pill st-${etat}">${ETATS[etat]}</span>`}</div>
        ${etat === 'a_refaire' && p.motif ? `<p class="motif">${esc(p.motif)}</p>` : ''}${corps}</div>`;
    }).join('');
  }

  function apercu() {
    if (!d.livrables.length || !['apercu', 'corrections', 'livre'].includes(d.statut)) return '';
    if (!livrSel || !d.livrables.some(l => l.id === livrSel)) livrSel = d.livrables[0].id;
    const l = d.livrables.find(x => x.id === livrSel), livre = d.statut === 'livre';
    const pages = l.pages && !livre ? Array.from({length: l.pages}, (_, k) => `<img class="page-ap" src="/api/espace/voir?ref=${R}&l=${l.id}&n=${k + 1}" alt="${esc(l.code)}, page ${k + 1}" loading="lazy">`).join('')
      : livre ? '' : '<div class="sans-ap">Aperçu en image indisponible pour cette pièce. Il sera téléchargeable après validation.</div>';
    return `<h2 id="plans">${livre ? 'Votre dossier' : 'Vos plans à relire'}</h2>
      <div class="carte">
        ${livre ? `<p style="margin:0 0 12px">Votre dossier complet, sans filigrane.</p>
          <div class="pile">${d.livrables.map(x => `<a class="rang ecart" href="/api/espace/telecharger?ref=${R}&id=${x.id}" style="text-decoration:none;color:inherit;border-top:1px solid var(--line);padding-top:10px"><span><b>${esc(x.code)}</b> ${esc(x.nom)}</span><span class="lien">Télécharger</span></a>`).join('')}</div>
          <a class="btn blue-btn" href="/api/espace/telecharger?ref=${R}" style="width:100%;margin-top:16px">Tout télécharger (zip)</a>`
        : `<div class="livr-tabs" role="group" aria-label="Pièces du dossier">${d.livrables.map(x => `<button type="button" data-l="${x.id}" aria-pressed="${x.id === l.id}">${esc(x.code)}</button>`).join('')}</div>
          <p style="margin:12px 0 0"><b>${esc(l.code)}</b> ${esc(l.nom)}${l.pages ? ` <span class="note">· ${l.pages} page${l.pages > 1 ? 's' : ''}</span>` : ''}</p>${pages}
          ${d.statut === 'corrections' ? '<p class="ok-msg" style="margin-top:14px">Corrections demandées : nous revenons vers vous avec une nouvelle version.</p>' : `
          <div class="rang" style="margin-top:16px"><button class="btn ghost" type="button" data-corr>Demander une correction</button><button class="btn blue-btn" type="button" data-valider>C'est bon pour moi : payer le solde de ${euro(d.solde)}</button></div>
          <p class="note">Les corrections sont comprises jusqu'au dépôt. Après le solde, vous téléchargez le dossier complet sans filigrane.</p>`}`}
      </div>`;
  }

  function messages() {
    return `<h2>Messages</h2><div class="carte">
      <div class="fil">${d.messages.length ? d.messages.map(m => `<div class="msg ${m.de}${m.type === 'correction' ? ' correction' : ''}"><small>${m.de === 'client' ? 'Vous' : 'Le Bon Permis'} · ${court(m.date)}${m.type === 'correction' ? ' · correction' : ''}</small>${esc(m.texte)}</div>`).join('') : '<p class="note" style="margin:0">Une question ? Écrivez-nous ici, on répond sous 24 h ouvrées.</p>'}</div>
      <form id="fmsg"><label class="field" style="margin:0"><span class="sr-only">Votre message</span><textarea name="t" rows="2" maxlength="3000" aria-label="Votre message" placeholder="Votre message"></textarea></label>
      <label class="rang" style="font-size:14px;margin-top:8px" ${d.statut === 'apercu' ? '' : 'hidden'}><input type="checkbox" name="corr" style="width:18px;height:18px;accent-color:var(--accent)"> C'est une demande de correction des plans</label>
      <p class="form-err" role="alert" hidden></p><div class="rang fin" style="margin-top:8px"><button class="btn petit" type="submit">Envoyer</button></div></form></div>`;
  }

  function afficher() {
    const reste = Math.round((d.total - (d.paiements.acompte ? d.paiements.acompte.montant : 0) - (d.paiements.solde ? d.paiements.solde.montant : 0)) * 100) / 100;
    el.innerHTML = `<p class="eyebrow">Dossier ${esc(d.ref)}</p>
      <h1>${esc(d.nom)}</h1><p class="sous">${esc(d.adresse)}</p>
      ${q.get('paye') ? '<p class="ok-msg" style="margin-top:14px">Merci, le solde est réglé. Votre dossier est prêt à télécharger (la confirmation peut prendre quelques secondes).</p>' : ''}
      <div class="carte" style="margin-top:20px"><div class="rang ecart"><b style="font-family:var(--f-display);font-size:19px">Où en est mon dossier</b><span class="pill st-${d.statut}">${esc(d.statutTexte)}</span></div>${etapes()}</div>
      ${apercu()}
      <h2>Ce qu'il nous faut</h2>
      <p class="note" style="margin-top:-6px">Depuis votre téléphone, c'est plus simple : les photos partent directement. Ce que vous envoyez est enregistré tout de suite.</p>
      <div class="carte">${pieces()}</div>
      ${d.statut === 'elements' ? `<div class="carte" style="margin-top:14px"><b>Vous avez tout envoyé ?</b><p class="note">Prévenez-nous : nous vérifions et lançons vos plans. Vous pourrez encore ajouter des photos ensuite.</p><p class="form-err" role="alert" hidden id="errfin"></p><button class="btn blue-btn" type="button" data-fin style="margin-top:8px">J'ai tout envoyé</button></div>` : ''}
      ${messages()}
      <h2>Ma commande</h2>
      <div class="carte"><div class="prix">
        <span class="tot" style="border:0;padding:0">Prix du dossier</span><span class="tot" style="border:0;padding:0">${euro(d.total)}</span>
        ${d.paiements.acompte ? `<span class="vert">Acompte payé le ${new Date(d.paiements.acompte.date).toLocaleDateString('fr-FR')}</span><span class="vert">${euro(d.paiements.acompte.montant)}</span>` : ''}
        ${d.paiements.solde ? (d.paiements.solde.montant ? `<span class="vert">Solde payé le ${new Date(d.paiements.solde.date).toLocaleDateString('fr-FR')}</span><span class="vert">${euro(d.paiements.solde.montant)}</span>` : '') : `<span class="gris">Solde, à régler après l'aperçu des plans</span><span class="gris">${euro(reste)}</span>`}
      </div><p class="note">Options : ${esc(d.options || 'aucune').replace(/,/g, ', ').replace('aucune', 'aucune option')}. Les reçus de paiement vous sont envoyés par e-mail.</p></div>
      <p style="margin-top:24px"><a href="/espace/">← Tous mes projets</a></p>
      <div class="lis" hidden id="lis" role="dialog" aria-modal="true" aria-label="Photo"></div>`;
    brancher();
  }

  function brancher() {
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
