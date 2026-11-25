/* Le Bon Permis : contrôles de cohérence d'un dossier (commande, plan du client, textes, terrain, fiche PLU).
   Fichier commun à l'espace équipe (navigateur, window.BPControles) et au service (Node, require).
   Entrée : d = dossier vu par l'équipe, t = fiche terrain (ou null), fiche = fiche PLU de la zone (ou null).
   Sortie : [{niveau: 'bloquant' | 'attention', texte}] */
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.BPControles = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {
  const nb = x => (Math.round(x * 10) / 10).toLocaleString('fr-FR');
  const MOIS = /janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec/gi;
  return function controles(d, t, fiche) {
    const out = [], B = x => out.push({niveau: 'bloquant', texte: x}), A = x => out.push({niveau: 'attention', texte: x});
    const pieces = d.pieces || [], plan = (pieces.find(p => p.type === 'plan' && p.plan) || {}).plan;
    const surf = plan && plan.mesures && plan.mesures.surface, colle = plan && (plan.formes || []).some(f => f.t === 'accole');
    const separe = ['abri', 'annexe', 'carport'].includes(d.projet);
    for (const p of pieces.filter(x => x.type === 'texte' && x.texte)) {
      const m = String(p.texte).match(/(\d+(?:[.,]\d+)?)\s*m?\s*[x×*]\s*(\d+(?:[.,]\d+)?)/i); if (!m) continue;
      const a = parseFloat(m[1].replace(',', '.')) * parseFloat(m[2].replace(',', '.'));
      if (surf && Math.abs(a - surf) > Math.max(3, surf * .2)) B(`« ${p.nom} » donne ${m[0]} soit ${nb(a)} m², le plan donne ${nb(surf)} m². Demander la vraie mesure.`);
      if (!surf && separe && a > 20 && d.kind === 'dp') B(`« ${p.nom} » donne ${nb(a)} m² : au-delà de 20 m², il faut un permis, la commande est une déclaration.`);
      break;
    }
    if (surf && separe && !colle) {
      if (surf > 20 && d.kind === 'dp') B(`Le plan donne ${nb(surf)} m² : construction séparée de plus de 20 m², il faut un permis. La commande est une déclaration : modifier la commande.`);
      if (surf <= 20 && d.kind === 'pc') A(`Le plan donne ${nb(surf)} m² : une déclaration suffit peut-être. La commande est un permis : vérifier et ajuster le prix.`);
    }
    if (d.adresse && !/^\s*\d/.test(d.adresse)) A('Adresse sans numéro : la parcelle retenue est peut-être celle d\'un voisin. Confirmer la parcelle avec le client.');
    const tx = id => ((pieces.find(p => p.id === id) || {}).texte || '').trim();
    if (tx('cerfa-naissance') && !/[a-zà-ü]{3,}/i.test(tx('cerfa-naissance').replace(MOIS, ''))) A('Lieu de naissance absent (demandé par le Cerfa).');
    if (tx('cerfa-adresse') && !/(\+33|0)\s*[1-9](?:[\s.-]*\d{2}){4}/.test(tx('cerfa-adresse'))) A('Téléphone absent de l\'adresse postale (demandé par le Cerfa).');
    if ((d.fichiers || []).some(f => ['rue', 'endroit'].includes(f.piece) && /capture|screenshot|screen shot/i.test(f.nom))) A('Une photo est une capture d\'écran (Street View ?) : préférer une photo prise par le client.');
    if (d.regul === 'true') A('Travaux déjà faits : la prescription de 10 ans ne joue pas si un permis était exigé (L.421-9 5°). Le dossier doit respecter le PLU actuel.');
    if (t && Array.isArray(t.prescriptions)) for (const p of t.prescriptions.filter(x => x.alerte)) B(`Prescription du PLU sur la parcelle : ${p.libelle}. Lire la règle correspondante.`);
    if (t && t.zone && !fiche && fiche !== undefined) A(`Zone ${t.zone.libelle} : pas encore de fiche PLU dans la base. Lire le règlement et créer la fiche.`);
    if (fiche && t && t.parcelle && surf && fiche.emprise && fiche.emprise.max_pct) {
      const terrain = t.parcelle.contenance || t.parcelle.surfaceCalculee, bati = (t.batiments || []).filter(b => b.surParcelle).reduce((s, b) => s + b.emprise, 0);
      const max = terrain * fiche.emprise.max_pct / 100, tot = bati + (d.regul === 'true' ? 0 : surf);
      if (tot + (d.regul === 'true' ? surf : 0) > max) B(`Emprise : ${nb(bati + surf)} m² bâtis pour ${nb(max)} m² autorisés (${fiche.emprise.max_pct} % de ${terrain} m², p.${fiche.emprise.page}).`);
    }
    return out;
  };
});
