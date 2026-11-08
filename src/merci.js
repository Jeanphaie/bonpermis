/* Page « Commande reçue » : interroge le service de paiement avec la référence Stripe renvoyée dans l'adresse. */
(async () => {
  const el = document.getElementById('merci'), ref = new URLSearchParams(location.search).get('ref');
  const euro = n => n.toLocaleString('fr-FR', {minimumFractionDigits: n % 1 ? 2 : 0}) + ' €';
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const echec = msg => { el.innerHTML = `<h1>Commande</h1><p class="answer">${msg}</p><p>Une question ? Écrivez-nous à <a href="mailto:contact@bonpermis.fr">contact@bonpermis.fr</a>.</p>`; };
  if (!ref) return echec('Aucune commande à afficher.');
  try {
    const r = await fetch('/api/commande?ref=' + encodeURIComponent(ref)), d = await r.json();
    if (!r.ok) return echec(esc(d.erreur || 'Commande introuvable.'));
    if (!d.paye) return echec('Le paiement est en cours de validation. Vous recevrez un e-mail dès qu\'il est confirmé.');
    el.innerHTML = `<p class="eyebrow">Paiement reçu · ${euro(d.montant)}</p>
      <h1>Merci, votre dossier ${esc(d.ref)} est lancé.</h1>
      <p class="answer">${esc(d.projet)}${d.adresse ? ', ' + esc(d.adresse) : ''}. Un e-mail de confirmation part à ${esc(d.email)}.</p>
      <h2>Ce qu'il nous faut maintenant</h2>
      <p>Répondez à l'e-mail de confirmation, ou écrivez à <a href="mailto:contact@bonpermis.fr?subject=${encodeURIComponent('Dossier ' + d.ref)}">contact@bonpermis.fr</a> en indiquant <b>${esc(d.ref)}</b>, avec :</p>
      <ul class="need-list"><li><i>Le projet</i>${esc(d.demandes[0])}</li><li><i>Les mesures</i>${esc(d.demandes[1])}</li><li><i>Les photos</i>${esc(d.demandes[2])}</li></ul>
      <p class="rules-src">Le délai de préparation commence à la réception de ces éléments. Gardez la référence ${esc(d.ref)} pour toute question.</p>`;
  } catch (e) { echec('Impossible d\'afficher la commande pour le moment. Votre paiement, s\'il a abouti, est bien enregistré : vous allez recevoir un e-mail.'); }
})();
