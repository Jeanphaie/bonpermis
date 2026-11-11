/* Le Bon Permis : questions du simulateur et calcul du prix.
   Fichier commun au site (navigateur, window.PRIX) et au service de paiement (Node, require).
   Une seule grille de prix : le serveur recalcule toujours le montant à partir des réponses. */
(function (racine, fabrique) {
  if (typeof module === 'object' && module.exports) module.exports = fabrique();
  else racine.PRIX = fabrique();
})(typeof self !== 'undefined' ? self : this, function () {
  const QUESTIONS = {
    abri:{id:'size',t:'Quelle taille fera votre abri ?',h:'La surface au sol, toit compris. Une estimation suffit.',c:[['moins5','Moins de 5 m²'],['dp','Entre 5 et 20 m²'],['pc','Plus de 20 m²'],['nsp','Je ne sais pas']]},
    piscine:{id:'size',t:'Quelle taille fera le bassin ?',h:'La surface de l\'eau seulement, sans les plages autour.',c:[['moins10','Moins de 10 m²'],['dp','Entre 10 et 100 m²'],['pc','Plus de 100 m², ou couverte haute'],['nsp','Je ne sais pas']]},
    annexe:{id:'size',t:'Quelle surface au sol ?',h:'Toit compris. Une estimation suffit.',c:[['dp','Jusqu\'à 20 m²'],['pc','Plus de 20 m²'],['nsp','Je ne sais pas']]},
    agrandir:{id:'size',t:'Combien de mètres carrés ajoutez-vous ?',h:'Une estimation suffit, on affinera avec vos mesures.',c:[['dp','Moins de 20 m²'],['dp40','Entre 20 et 40 m²'],['pc','Plus de 40 m²'],['nsp','Je ne sais pas']]},
    total150:{id:'total',t:'Une fois les travaux faits, la maison fera-t-elle plus de 150 m² ?',h:'Toute la maison, extension comprise. C\'est la limite au-delà de laquelle la loi impose un architecte.',c:[['non','Non'],['oui','Oui'],['nsp','Je ne sais pas']]},
    maison:{id:'size',t:'Quelle surface fera la maison ?',h:'Tous les niveaux additionnés.',c:[['ok','Jusqu\'à 150 m²'],['archi','Plus de 150 m²'],['nsp','Je ne sais pas']]},
    plans:{id:'plans',t:'Avez-vous déjà les plans de la maison ?',h:'Ceux d\'un constructeur, d\'un architecte, ou les vôtres, même faits à la main.',c:[['oui','Oui, j\'ai des plans'],['non','Non, tout est à dessiner']]},
    abf:{id:'abf',t:'Êtes-vous près d\'un monument historique, ou dans un quartier protégé ?',h:'Une vieille église, un château, un centre ancien… Si vous ne savez pas, pas d\'inquiétude : on le vérifie avec votre adresse.',c:[['non','Non'],['oui','Oui'],['nsp','Je ne sais pas']]},
    terrasse:{id:'type',t:'De quoi s\'agit-il ?',h:'Choisissez ce qui ressemble le plus à votre projet.',c:[['plain','Terrasse de plain-pied'],['haute','Terrasse surélevée de plus de 60 cm'],['mur','Mur ou muret de plus de 2 m'],['clim','Climatisation ou pompe à chaleur extérieure']]},
    usage:{id:'facade',t:'Touchez-vous à la façade ou à la structure ?',h:'Par exemple une nouvelle fenêtre, un mur porteur abattu, la toiture modifiée.',c:[['non','Non, seulement l\'intérieur'],['oui','Oui'],['nsp','Je ne sais pas']]},
    cu:{id:'cutype',t:'Que voulez-vous savoir ?',h:'C\'est la mairie qui répond, par écrit. On prépare la demande pour vous.',c:[['a','Les règles qui s\'appliquent à mon terrain'],['b','Si mon projet précis est réalisable']]},
    modif:{id:'accorde',t:'La mairie a-t-elle déjà accordé votre permis ?',h:'Si elle l\'étudie encore, pas besoin de permis modificatif.',c:[['oui','Oui, il est accordé'],['non','Non, il est en cours d\'instruction']]},
    lucarne:{id:'size',t:'Aménagez-vous les combles en même temps ?',h:'Une lucarne seule change seulement le toit. Si elle sert à rendre les combles habitables, la surface créée compte.',c:[['seule','Non, seulement la lucarne'],['dp','Oui, moins de 20 m² créés (40 m² en ville)'],['pc','Oui, plus que ça'],['nsp','Je ne sais pas']]},
    qui:{id:'qui',t:'Le projet est-il à votre nom, ou au nom d\'une société ?',h:'Une SCI, même familiale, compte comme une société. La loi lui impose un architecte pour tout permis de construire.',c:[['perso','À mon nom'],['societe','Au nom d\'une société ou d\'une SCI']]},
    copro:{id:'copro',t:'Êtes-vous en copropriété ?',h:'Un immeuble ou une résidence avec un syndic. Il faudra l\'accord des autres copropriétaires.',c:[['non','Non'],['oui','Oui']]}
  };

  // Projets qui peuvent aboutir à un permis de construire : on demande alors si le demandeur est une société.
  const PC_POSSIBLE = (P, p) => ['agrandir','maison','usage'].includes(P[p].cat) || p === 'lucarne' || (P[p].cat === 'petits' && !!P[p].size);

  function flow(P, p){
    const c = P[p].cat, q = [];
    if (c==='petits' && P[p].size) q.push(QUESTIONS[P[p].size]);
    if (c==='agrandir'){ q.push(QUESTIONS.agrandir); q.push(QUESTIONS.total150); }
    if (c==='maison'){ q.push(QUESTIONS.maison); q.push(QUESTIONS.plans); }
    if (c==='ext') q.push(QUESTIONS.terrasse);
    if (p==='lucarne') q.push(QUESTIONS.lucarne);
    if (c==='usage') q.push(QUESTIONS.usage);
    if (c==='cu') q.push(QUESTIONS.cu);
    if (c==='modif') q.push(QUESTIONS.modif);
    if (PC_POSSIBLE(P, p)) q.push(QUESTIONS.qui);
    if (!P[p].svc) q.push(QUESTIONS.abf);
    if (P[p].copro) q.push(QUESTIONS.copro);
    return q;
  }

  function verdict(P, pk, a, regul){
    const p = P[pk], c = p.cat;
    const small = a.size==='moins5' || a.size==='moins10' || a.type==='plain';
    if (small && a.abf!=='oui') return {kind:'none'};
    if (c==='modif' && a.accorde==='non') return {kind:'call', title:'Tant que la mairie étudie votre dossier, on peut encore le modifier.', text:'Pas besoin de permis modificatif. On reprend les pièces concernées. Laissez-nous votre numéro, on vous rappelle pour voir ce qui change.'};
    if (c==='maison' && (a.size==='archi')) return {kind:'archi'};
    if (c==='maison' && a.plans==='non') return {kind:'conception'};
    if (c==='agrandir' && a.total==='oui' && a.size==='pc') return {kind:'archi'};
    let v;
    if (small) v = {kind:'dp',base:149,label:'Petits travaux en quartier protégé'};
    else if (c==='ext') v = {kind:'dp',base:149,label:'Terrasse, mur ou climatisation'};
    else if (c==='usage') v = (a.facade==='oui') ? {kind:'pc',base:490,label:'Transformation avec travaux de façade'} : {kind:'dp',base:349,label:'Transformation en logement'};
    else if (c==='demol') v = {kind:'pd',base:149,label:'Permis de démolir'};
    else if (c==='cu') v = (a.cutype==='b') ? {kind:'svc',base:149,label:'Certificat d\'urbanisme pour votre projet',title:'Certificat d\'urbanisme',h3:'On demande à la mairie si votre projet est possible.'} : {kind:'svc',base:89,label:'Certificat d\'urbanisme',title:'Certificat d\'urbanisme',h3:'On demande à la mairie les règles de votre terrain.'};
    else if (c==='modif') v = {kind:'svc',base:249,label:'Permis modificatif',title:'Permis modificatif',h3:'On prépare la modification de votre permis.'};
    else if (c==='daact') v = {kind:'svc',base:49,label:'Déclaration de fin de travaux',title:'Fin de travaux',h3:'On prépare votre déclaration de fin de travaux.'};
    if (v) {} else if (c==='petits') v = (a.size==='pc') ? {kind:'pc',base:490,label:'Permis de construire'} : {kind:'dp',base:149,label:'Petits travaux'};
    if (c==='agrandir') v = (a.size==='pc') ? {kind:'pc',base:490,label:'Permis d\'extension'} : {kind:'dp',base:349,label:'Agrandissement'};
    if (c==='toit') v = p.n==='Lucarne' ? (a.size==='pc' ? {kind:'pc',base:490,label:'Lucarne et combles, permis de construire'} : (a.size==='dp' || a.size==='nsp') ? {kind:'dp',base:349,label:'Lucarne et combles aménagés'} : {kind:'dp',base:149,label:'Lucarne'}) : {kind:'dp',base:149,label:'Toiture'};
    if (c==='toit' && p.n==='Lucarne' && a.size==='nsp') v.note = ['Si les combles ne sont pas aménagés, le dossier revient à 149 €.'];
    if (c==='garage') v = {kind:'dp',base:319,label:'Garage transformé'};
    if (c==='maison') v = {kind:'pc',base:590,label:'Maison neuve'};
    if (a.qui === 'societe' && v.kind === 'pc') return {kind:'archi', raison:'societe'};
    v.note = v.note || [];
    if (a.qui === 'societe') v.note.push('Pour une société, une déclaration préalable se dépose sans architecte. Si un permis de construire s\'avère nécessaire, la loi impose un architecte : on vous prévient avant de commencer.');
    if (small) v.note.push('Dans un quartier protégé, même les petites constructions demandent une déclaration. On le vérifie avec votre adresse avant de commencer.');
    if (c==='usage' && a.facade==='nsp') v.note.push('Si la façade ou la structure change, il faut un permis à 490 €. On le vérifie sur vos photos et on vous prévient avant de commencer.');
    if (c==='demol') v.note.push('Il n\'est obligatoire que dans un quartier protégé, ou si votre commune l\'a décidé. On le vérifie avec votre adresse et on vous le dit avant de commencer.');
    if (c==='maison') v.note.push('L\'attestation énergétique (RE2020) exigée avec le permis d\'une maison neuve n\'est pas comprise : elle est établie par un bureau d\'études thermiques, en général celui de votre constructeur. Nous vous indiquons où la glisser dans le dossier.');
    if (c==='daact') v.note.push('Pour une maison neuve, la mairie demande aussi une attestation énergétique de fin de chantier. Elle est établie par le bureau d\'études thermiques de votre constructeur ; elle n\'est pas comprise.');
    if (c==='combles' || p.n==='Combles aménagés') v.note.push('Les fenêtres de toit sont comprises dans le dossier.');
    if (regul) v.note.unshift('Travaux déjà faits : le dossier décrit ce qui existe. Vous nous envoyez des photos de ce qui est construit.');
    if (a.size==='nsp') v.note.push('Pas de souci si vous ne connaissez pas la surface : on la calcule avec vos mesures. S\'il faut un permis plutôt qu\'une déclaration, on vous prévient avant de commencer.');
    if (a.size==='dp40') v.note.push('Entre 20 et 40 m², une déclaration suffit si votre terrain est en zone urbaine. Sinon, il faut un permis à 490 €. On le vérifie avec votre adresse et on vous prévient avant de commencer.');
    if (a.total==='oui' && c==='agrandir' && v.kind==='dp') v.note.push('Comme la maison dépassera 150 m², un architecte devra signer si un permis s\'avère nécessaire. On vous prévient avant de commencer.');
    if (a.total==='nsp') v.note.push('Si la maison dépasse 150 m² après les travaux, un architecte devient obligatoire. On le vérifie et on vous prévient.');
    v.abf = a.abf==='oui' ? 149 : 0;
    if (a.abf==='nsp') v.note.push('On vérifie avec votre adresse si vous êtes en quartier protégé. Les 149 € ne sont ajoutés que si c\'est le cas, et avec votre accord.');
    v.copro = a.copro==='oui' ? 99 : 0;
    if (AMENAG.includes(c)) v.amenag = prixAmenag(c, a);
    return v;
  }


  // Options payantes. Un seul endroit pour les montants et les libellés.
  const OPTIONS = {
    amenag:  {prix: 199, label: 'Plan d\'aménagement intérieur'},
    concept: {prix: 690, label: 'Conception du projet avec vous'},
    d3:      {prix: 190, label: 'Vue 3D de l\'intérieur'},
    express: {prix: 49,  label: 'Dossier prêt en 24 h'},
    depot:   {prix: 99,  label: 'Dépôt et suivi jusqu\'à la réponse de la mairie'},
    visio:   {prix: 49,  label: '20 minutes en visio'}
  };
  // Conception et aménagement intérieur : plus vendus en ligne (10/11/2026). Ce sont des missions de conception,
  // qui demandent une assurance décennale : elles se font sur devis. Pour les rouvrir, remettre les catégories ici.
  const CONCEPT = [];
  // Plan d'aménagement intérieur de la pièce créée : 199 € jusqu'à 40 m², 299 € au-delà.
  // Déjà compris dans l'option conception, donc jamais les deux ensemble.
  const AMENAG = [];
  const prixAmenag = (c, a) => (c === 'agrandir' && a && a.size === 'pc') ? 299 : 199;

  // Garde seulement les options possibles pour ce projet et ce verdict.
  function optionsValides(P, pk, v, opt){
    const o = opt || {}, c = P[pk].cat, canC = CONCEPT.includes(c);
    return {
      amenag: !!(AMENAG.includes(c) && v.amenag && o.amenag && !(canC && o.concept)),
      concept: !!(canC && o.concept),
      d3: !!(canC && o.concept && o.d3),
      express: !!(v.kind === 'dp' && o.express),
      depot: !!o.depot,
      visio: !!o.visio
    };
  }

  // Lignes de la commande, en euros TTC. Le total est leur somme.
  function lignes(P, pk, v, opt){
    const o = optionsValides(P, pk, v, opt), L = [{label: v.label, prix: v.base}];
    if (v.re) L.push({label: 'Attestation énergétique', prix: v.re});
    if (v.abf) L.push({label: 'Monument historique ou quartier protégé', prix: v.abf});
    if (v.copro) L.push({label: 'Copropriété : documents pour le vote', prix: v.copro});
    for (const k of Object.keys(OPTIONS)) if (o[k]) L.push({label: OPTIONS[k].label, prix: k === 'amenag' ? v.amenag : OPTIONS[k].prix});
    return L;
  }
  const total = L => L.reduce((s, l) => s + l.prix, 0);

  // Projets qu'on peut déclarer après coup (« travaux déjà faits »).
  const regulPossible = (P, GROUPS, pk) => GROUPS.some(g => g.k.includes(pk)) && pk !== 'demolition';

  // Vérifie que chaque réponse attendue est l'un des choix proposés. Renvoie les réponses nettoyées, ou null.
  function reponsesValides(P, pk, a){
    if (!P[pk] || !a || typeof a !== 'object') return null;
    const propre = {};
    for (const q of flow(P, pk)) {
      const r = a[q.id];
      if (!q.c.some(([val]) => val === r)) return null;
      propre[q.id] = r;
    }
    return propre;
  }

  return {QUESTIONS, OPTIONS, CONCEPT, AMENAG, flow, verdict, optionsValides, lignes, total, regulPossible, reponsesValides};
});
