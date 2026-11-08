/* Ancien lien « Mon dossier » (première version) : on ouvre la session et on renvoie vers l'espace. */
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get('d') && q.get('t')) location.replace('/api/compte/acces?d=' + encodeURIComponent(q.get('d')) + '&t=' + encodeURIComponent(q.get('t')));
  else location.replace('/espace/');
})();
