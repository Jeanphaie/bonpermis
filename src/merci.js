/* Page « Commande reçue » : interroge le service avec la référence Stripe, puis propose de choisir un mot de passe. */
(async () => {
  const el = document.getElementById('merci'), sid = new URLSearchParams(location.search).get('ref');
  const euro = n => (+n).toLocaleString('fr-FR', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}) + ' €';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const echec = msg => { el.innerHTML = `<h1>Commande</h1><p class="answer">${msg}</p><p>Une question ? Écrivez-nous à <a href="mailto:contact@bonpermis.fr">contact@bonpermis.fr</a>.</p>`; };
  if (!sid) return echec('Aucune commande à afficher.');
  let d;
  // La confirmation de Stripe peut arriver quelques secondes après le retour sur le site : on réessaie un peu.
  for (let k = 0; k < 6; k++) {
    try {
      const r = await fetch('/api/commande?ref=' + encodeURIComponent(sid), {credentials: 'same-origin'}); d = await r.json();
      if (!r.ok) return echec(esc(d.erreur || 'Commande introuvable.'));
    } catch (e) { return echec('Impossible d\'afficher la commande pour le moment. Votre paiement, s\'il a abouti, est bien enregistré : vous allez recevoir un e-mail.'); }
    if (!d.paye || d.enregistree) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!d.paye) return echec('Le paiement est en cours de validation. Vous recevrez un e-mail dès qu\'il est confirmé.');
  const mdp = d.compte && !d.compte.motDePasse;
  const kind = {dp: 'déclaration préalable', pc: 'permis de construire', pd: 'permis de démolir'}[d.kind] || '';
  const delai = d.delai === 1 ? '24 h ouvrées' : d.delai === 5 ? '5 jours ouvrés' : d.delai ? `${d.delai === 2 ? '48 h' : d.delai + ' jours'} ouvrées` : '';
  const nb = d.nbPieces ? `${d.nbPieces} éléments${d.nbPhotos ? `, dont ${d.nbPhotos} photo${d.nbPhotos > 1 ? 's' : ''}` : ''}. Environ 10 minutes, depuis votre téléphone.` : 'Photos, mesures et quelques précisions, depuis votre téléphone.';
  const w = el.closest('.wrap'); if (w) w.classList.add('ok-large');
  el.innerHTML = `<div class="ok-carte">
      <div class="ok-coche" aria-hidden="true"><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#1F7A45" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>
      <p class="ok-sur">Paiement accepté</p>
      <h1>Merci, votre dossier est ouvert.</h1>
      <p class="ok-sous">Votre acompte de ${euro(d.montant)} est bien reçu. Un e-mail de confirmation part à ${esc(d.email)}.</p>
      <p class="ok-ref"><span>Référence</span><b>${esc(d.ref)}</b></p>
      <div class="ok-recap">
        <div><span>Projet</span><b>${esc(d.projet)}${kind ? `, ${kind}` : ''}</b></div>
        <div><span>Adresse des travaux</span><b>${esc(d.adresse || '')}</b></div>
        <div><span>Reste à payer</span><b>${euro(d.solde || 0)}</b><small>${d.solde ? 'après l\'aperçu de vos plans' : 'rien'}</small></div>
      </div>
    </div>
    ${mdp ? `<form class="ok-mdp" id="fm" novalidate>
      <h2>Choisissez votre mot de passe</h2>
      <p class="note">Votre espace est créé avec ${esc(d.email)}. Un mot de passe vous permet d'y revenir depuis n'importe quel appareil.</p>
      <input type="email" autocomplete="username" value="" hidden>
      <label class="field"><span>Mot de passe</span><input name="mdp" type="password" autocomplete="new-password" minlength="12" maxlength="256" required><small>12 caractères minimum. Le plus simple : 3 ou 4 mots sans rapport.</small></label>
      <p class="form-err" role="alert" hidden></p>
      <button class="btn blue-btn" type="submit" style="width:100%;margin-top:12px">Enregistrer et ouvrir mon dossier</button>
      <p class="note" style="text-align:center"><a href="${esc(d.espace)}">Plus tard</a> : le lien est aussi dans l'e-mail.</p></form>` : ''}
    <h2 class="ok-h2">La suite, en 3 étapes</h2>
    <ol class="ok-etapes">
      <li class="on"><span>1</span><b>Vous envoyez vos pièces</b><p>${esc(nb)}</p><em>Maintenant</em></li>
      <li><span>2</span><b>On vérifie tout</b><p>S'il manque quelque chose, on vous le dit précisément.</p><em>Sous 24 h ouvrées</em></li>
      <li><span>3</span><b>Vous relisez vos plans</b><p>Aperçu en ligne, corrections comprises, puis le solde.</p><em>${delai ? esc(delai) + ' après vos pièces' : 'Après vos pièces'}</em></li>
    </ol>
    ${mdp ? '' : `<div class="ok-cta"><a class="btn blue-btn" href="${esc(d.espace)}">Ouvrir mon dossier et envoyer mes pièces <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a><span class="note">Vous pouvez aussi le faire plus tard : le lien est dans l'e-mail.</span></div>`}
    <p class="note" style="margin-top:20px">Le délai de préparation commence quand toutes les pièces sont reçues. Gardez la référence ${esc(d.ref)} pour toute question : contact@bonpermis.fr.</p>`;
  const fm = document.getElementById('fm');
  if (fm) fm.addEventListener('submit', async e => {
    e.preventDefault(); const err = fm.querySelector('.form-err');
    if ([...fm.mdp.value].length < 12) { err.textContent = 'Au moins 12 caractères.'; err.hidden = false; fm.mdp.focus(); return; }
    const r = await fetch('/api/compte/premier-mot-de-passe', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify({session: sid, mdp: fm.mdp.value})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = j.erreur || 'Erreur.'; err.hidden = false; return; }
    location.href = d.espace;
  });
})();
