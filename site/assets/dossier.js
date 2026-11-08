/* Page « Mon dossier » : le client décrit son projet et envoie ses photos depuis son téléphone.
   Accès par lien privé (?d=BP-XXXXXX&t=jeton), sans compte. Les photos partent une par une, avec progression. */
(async () => {
  const el = document.getElementById('dossier');
  const q = location.search, prm = new URLSearchParams(q);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const mo = n => n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' Ko' : (n / 1048576).toFixed(1).replace('.', ',') + ' Mo';
  const echec = msg => { el.innerHTML = `<h1>Mon dossier</h1><p class="answer">${msg}</p><p>Écrivez-nous à <a href="mailto:contact@bonpermis.fr">contact@bonpermis.fr</a>.</p>`; };
  if (!prm.get('d') || !prm.get('t')) return echec('Ce lien est incomplet. Utilisez le lien reçu par e-mail après votre paiement.');

  let d;
  try {
    const r = await fetch('/api/dossier' + q); d = await r.json();
    if (!r.ok) return echec(esc(d.erreur || 'Dossier introuvable.'));
  } catch (e) { return echec('Impossible d\'ouvrir le dossier pour le moment. Réessayez dans quelques minutes.'); }

  const liste = () => d.fichiers.length
    ? d.fichiers.map(f => `<li><span>${esc(f.nom)}</span><small>${mo(f.taille)}</small></li>`).join('')
    : '<li class="vide">Aucun fichier pour l\'instant.</li>';

  if (d.termine) {
    el.innerHTML = `<p class="eyebrow">Dossier ${esc(d.ref)} · transmis</p>
      <h1>Tout est bien reçu.</h1>
      <p class="answer">${esc(d.projet)}${d.adresse ? ', ' + esc(d.adresse) : ''}. Nous vérifions vos éléments et revenons vers vous si une information manque.</p>
      <h2>Fichiers transmis</h2><ul class="files">${liste()}</ul>
      <p class="rules-src">Un oubli ? Écrivez à <a href="mailto:contact@bonpermis.fr?subject=${encodeURIComponent('Dossier ' + d.ref)}">contact@bonpermis.fr</a> en indiquant ${esc(d.ref)}.</p>`;
    return;
  }

  const i = d.infos || {};
  el.innerHTML = `<p class="eyebrow">Dossier ${esc(d.ref)}</p>
    <h1>Envoyez-nous votre projet</h1>
    <p class="answer">${esc(d.projet)}${d.adresse ? ', ' + esc(d.adresse) : ''}. Tout se fait ici, depuis votre téléphone. Vous pouvez revenir plus tard avec le même lien : ce qui est envoyé reste enregistré.</p>

    <h2>1. Le projet</h2>
    <label class="field"><span>Décrivez ce que vous voulez faire</span><small>${esc(d.demandes[0])}</small>
      <textarea id="projet" rows="4" maxlength="5000">${esc(i.projet || '')}</textarea></label>
    <label class="field"><span>Les mesures</span><small>${esc(d.demandes[1])}</small>
      <textarea id="mesures" rows="4" maxlength="5000">${esc(i.mesures || '')}</textarea></label>
    <label class="field"><span>Remarques (facultatif)</span>
      <textarea id="remarques" rows="2" maxlength="5000">${esc(i.remarques || '')}</textarea></label>
    <p class="save" id="save" aria-live="polite"></p>

    <h2>2. Les photos</h2>
    <p>${esc(d.demandes[2])}</p>
    <p class="rules-src">Photos (JPG, PNG, HEIC d'iPhone, WebP) ou PDF. 25 Mo maximum par fichier, ${d.limites.nb} fichiers au plus.</p>
    <label class="btn ghost drop" for="f">Ajouter des photos<input id="f" type="file" multiple accept="image/*,application/pdf" hidden></label>
    <div id="prog" aria-live="polite"></div>
    <ul class="files" id="liste">${liste()}</ul>

    <h2>3. C'est terminé ?</h2>
    <p>Quand tout est envoyé, validez. Nous recevons votre dossier et commençons.</p>
    <div class="form-err" id="err" hidden></div>
    <button class="btn blue-btn" id="fin" type="button">J'ai tout envoyé</button>`;

  const $ = id => document.getElementById(id);
  const err = m => { $('err').textContent = m; $('err').hidden = !m; };

  // Enregistrement automatique du texte, une seconde après la dernière frappe.
  let minuteur, enCours = Promise.resolve();
  const sauver = () => {
    enCours = fetch('/api/dossier/infos' + q, {method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({projet: $('projet').value, mesures: $('mesures').value, remarques: $('remarques').value})})
      .then(r => { $('save').textContent = r.ok ? 'Enregistré.' : 'Pas enregistré, réessayez.'; })
      .catch(() => { $('save').textContent = 'Pas de connexion : le texte sera enregistré dès qu\'elle revient.'; });
    return enCours;
  };
  ['projet', 'mesures', 'remarques'].forEach(id => $(id).addEventListener('input', () => {
    $('save').textContent = '…'; clearTimeout(minuteur); minuteur = setTimeout(sauver, 1000);
  }));

  // Envoi d'un fichier avec suivi de progression (XMLHttpRequest donne l'avancement, fetch non).
  const envoyer = (f, ligne) => new Promise(ok => {
    const x = new XMLHttpRequest();
    x.open('POST', '/api/dossier/fichier' + q);
    x.setRequestHeader('Content-Type', 'application/octet-stream');
    x.setRequestHeader('X-Nom-Fichier', encodeURIComponent(f.name));
    x.upload.onprogress = e => { if (e.lengthComputable) ligne.querySelector('b').style.width = Math.round(e.loaded / e.total * 100) + '%'; };
    x.onload = () => { let j = {}; try { j = JSON.parse(x.responseText); } catch (e) {} ok(x.status === 200 ? {ok: true, ...j} : {erreur: j.erreur || 'Envoi refusé.'}); };
    x.onerror = () => ok({erreur: 'Connexion perdue.'});
    x.send(f);
  });

  $('f').addEventListener('change', async e => {
    const fichiers = [...e.target.files]; e.target.value = '';
    err('');
    for (const f of fichiers) {
      const ligne = document.createElement('div');
      ligne.className = 'up';
      ligne.innerHTML = `<span>${esc(f.name)}</span><i><b></b></i>`;
      $('prog').appendChild(ligne);
      if (f.size > d.limites.fichier) { ligne.innerHTML = `<span>${esc(f.name)}</span><em>Trop lourd (25 Mo maximum)</em>`; continue; }
      let r = await envoyer(f, ligne);
      if (r.erreur === 'Connexion perdue.') r = await envoyer(f, ligne); // une seconde tentative
      if (r.ok) { d.fichiers.push({nom: r.nom, taille: r.taille}); ligne.remove(); $('liste').innerHTML = liste(); }
      else ligne.innerHTML = `<span>${esc(f.name)}</span><em>${esc(r.erreur)}</em>`;
    }
  });

  $('fin').addEventListener('click', async () => {
    err('');
    if (!d.fichiers.length && !confirm('Vous n\'avez envoyé aucune photo. Valider quand même ?')) return;
    clearTimeout(minuteur); await sauver(); await enCours;
    $('fin').disabled = true; $('fin').textContent = 'Envoi…';
    try {
      const r = await fetch('/api/dossier/terminer' + q, {method: 'POST'}), j = await r.json();
      if (!r.ok) { err(j.erreur || 'Validation impossible.'); $('fin').disabled = false; $('fin').textContent = 'J\'ai tout envoyé'; return; }
      location.reload();
    } catch (e) { err('Connexion perdue. Réessayez.'); $('fin').disabled = false; $('fin').textContent = 'J\'ai tout envoyé'; }
  });
})();
