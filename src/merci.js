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
  el.innerHTML = `<p class="eyebrow">Acompte reçu · ${euro(d.montant)}</p>
    <h1>Merci, votre dossier ${esc(d.ref)} est lancé.</h1>
    <p class="answer">${esc(d.projet)}${d.adresse ? ', ' + esc(d.adresse) : ''}. Un e-mail de confirmation part à ${esc(d.email)}.${d.solde ? ` Le solde de ${euro(d.solde)} se règle après l'aperçu de vos plans.` : ''}</p>
    ${mdp ? `<form class="carte" id="fm" style="margin-top:22px" novalidate>
      <b style="font-family:var(--f-display);font-size:20px">Votre espace est prêt</b>
      <p class="note">Choisissez un mot de passe pour suivre votre dossier depuis n'importe quel appareil. Votre navigateur peut en proposer un et le retenir.</p>
      <label class="field"><span>Mot de passe</span><input name="mdp" type="password" autocomplete="new-password" minlength="10" required><small>10 caractères minimum.</small></label>
      <p class="form-err" role="alert" hidden></p>
      <button class="btn blue-btn" type="submit" style="width:100%;margin-top:12px">Enregistrer et ouvrir mon dossier</button>
      <p class="note" style="text-align:center"><a href="${esc(d.espace)}">Plus tard</a> : le lien est aussi dans l'e-mail.</p></form>` : ''}
    <h2>Ce qu'il nous faut maintenant</h2>
    <ul class="need-list"><li><i>Le projet</i>${esc(d.demandes[0])}</li><li><i>Les mesures</i>${esc(d.demandes[1])}</li><li><i>Les photos</i>${esc(d.demandes[2])}</li></ul>
    ${mdp ? '' : `<p style="margin-top:24px"><a class="btn blue-btn" href="${esc(d.espace)}">Envoyer mes photos et mesures</a></p>`}
    <p class="rules-src">Le délai de préparation commence quand toutes les pièces sont reçues. Gardez la référence ${esc(d.ref)} pour toute question.</p>`;
  const fm = document.getElementById('fm');
  if (fm) fm.addEventListener('submit', async e => {
    e.preventDefault(); const err = fm.querySelector('.form-err');
    if (fm.mdp.value.length < 10) { err.textContent = 'Au moins 10 caractères.'; err.hidden = false; fm.mdp.focus(); return; }
    const r = await fetch('/api/compte/premier-mot-de-passe', {method: 'POST', headers: {'Content-Type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify({session: sid, mdp: fm.mdp.value})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { err.textContent = j.erreur || 'Erreur.'; err.hidden = false; return; }
    location.href = d.espace;
  });
})();
