(() => {
  const {P, GROUPS, SVCS, NEED, URL} = window.OP;
  const BASE = document.documentElement.dataset.base || '';
  const PH = '<span class="ph"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 54V30L30 14l20 16v24z" fill="none" stroke="#9A968F" stroke-width="1.6"/><path d="M36 54V38h14v16" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="3 2.5"/><path d="M4 54h56" stroke="#9A968F" stroke-width="1.6"/></svg></span>';

  const ov = document.getElementById('overlay'), body = document.getElementById('panelBody'), bar = document.getElementById('barFill');
  const euro = n => n.toLocaleString('fr-FR') + ' €';
  let S = {}, lastFocus = null;

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
    copro:{id:'copro',t:'Êtes-vous en copropriété ?',h:'Un immeuble ou une résidence avec un syndic. Il faudra l\'accord des autres copropriétaires.',c:[['non','Non'],['oui','Oui']]}
  };

  function flow(p){
    const c = P[p].cat, q = [];
    if (c==='petits' && P[p].size) q.push(QUESTIONS[P[p].size]);
    if (c==='agrandir'){ q.push(QUESTIONS.agrandir); q.push(QUESTIONS.total150); }
    if (c==='maison'){ q.push(QUESTIONS.maison); q.push(QUESTIONS.plans); }
    if (c==='ext') q.push(QUESTIONS.terrasse);
    if (c==='usage') q.push(QUESTIONS.usage);
    if (c==='cu') q.push(QUESTIONS.cu);
    if (c==='modif') q.push(QUESTIONS.modif);
    if (!P[p].svc) q.push(QUESTIONS.abf);
    if (P[p].copro) q.push(QUESTIONS.copro);
    return q;
  }

  function verdict(){
    const p = P[S.p], a = S.a, c = p.cat;
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
    if (c==='toit') v = {kind:'dp',base:349,label:'Travaux sur le toit'};
    if (c==='garage') v = {kind:'dp',base:319,label:'Garage transformé'};
    if (c==='maison') v = {kind:'pc',base:590,label:'Maison neuve',re:159};
    v.note = [];
    if (small) v.note.push('Dans un quartier protégé, même les petites constructions demandent une déclaration. On le vérifie avec votre adresse avant de commencer.');
    if (c==='usage' && a.facade==='nsp') v.note.push('Si la façade ou la structure change, il faut un permis à 490 €. On le vérifie sur vos photos et on vous prévient avant de commencer.');
    if (c==='demol') v.note.push('Il n\'est obligatoire que dans un quartier protégé, ou si votre commune l\'a décidé. On le vérifie avec votre adresse et on vous le dit avant de commencer.');
    if (c==='daact') v.note.push('Pour une maison neuve, la mairie demande aussi une attestation énergétique de fin de chantier. On vous met en relation avec un bureau d\'études.');
    if (c==='combles' || P[S.p].n==='Combles aménagés') v.note.push('Les fenêtres de toit sont comprises dans le dossier.');
    if (S.regul) v.note.unshift('Travaux déjà faits : le dossier décrit ce qui existe. Vous nous envoyez des photos de ce qui est construit.');
    if (a.size==='nsp') v.note.push('Pas de souci si vous ne connaissez pas la surface : on la calcule avec vos mesures. S\'il faut un permis plutôt qu\'une déclaration, on vous prévient avant de commencer.');
    if (a.size==='dp40') v.note.push('Entre 20 et 40 m², une déclaration suffit si votre terrain est en zone urbaine. Sinon, il faut un permis à 490 €. On le vérifie avec votre adresse et on vous prévient avant de commencer.');
    if (a.total==='oui' && c==='agrandir' && v.kind==='dp') v.note.push('Comme la maison dépassera 150 m², un architecte devra signer si un permis s\'avère nécessaire. On vous prévient avant de commencer.');
    if (a.total==='nsp') v.note.push('Si la maison dépasse 150 m² après les travaux, un architecte devient obligatoire. On le vérifie et on vous prévient.');
    v.abf = a.abf==='oui' ? 149 : 0;
    if (a.abf==='nsp') v.note.push('On vérifie avec votre adresse si vous êtes en quartier protégé. Les 149 € ne sont ajoutés que si c\'est le cas, et avec votre accord.');
    v.copro = a.copro==='oui' ? 99 : 0;
    return v;
  }

  const pimg = document.getElementById('projImg');
  function showPanel(title, img){ if (img) { pimg.src = `${BASE}img/${img}.webp`; pimg.hidden = false; } else { pimg.removeAttribute('src'); pimg.hidden = true; } document.getElementById('panelTitle').textContent = title; ov.hidden = false; document.body.style.overflow = 'hidden'; }
  function openRegul(opener){
    lastFocus = opener || lastFocus;
    showPanel('Travaux déjà faits', '38-regularisation');
    bar.style.width = '0%';
    const ks = GROUPS.flatMap(g => g.k).filter(k => k!=='demolition');
    body.innerHTML = `<div class="qtitle" tabindex="-1">Qu'avez-vous construit ?</div><p class="qhelp">On prépare le dossier comme si les travaux étaient à venir, au même prix, à partir de photos de ce qui existe.</p><div class="choices">${ks.map(k => `<button class="choice" type="button" data-k="${k}">${P[k].n}<span aria-hidden="true">→</span></button>`).join('')}</div>`;
    body.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => open(b.dataset.k, null, true)));
    body.querySelector('.qtitle').focus();
  }
  function open(p, opener, regul){
    if (p==='regul') return openRegul(opener);
    if (opener) lastFocus = opener;
    S = {p, a:{}, i:0, q:flow(p), opt:{depot:false, express:false, visio:false, concept:false, d3:false}, regul:!!regul};
    if (!S.q.length) S.stage = 'v';
    showPanel((regul?'Travaux déjà faits · ':'') + P[p].n, P[p].img);
    render();
  }
  function close(){ ov.hidden = true; document.body.style.overflow = ''; const h = location.hash.slice(1); if (P[h] || h==='regul') { try { history.replaceState(null, '', location.pathname + location.search); } catch(e){} } if (lastFocus) lastFocus.focus(); }

  function progress(){
    const total = (S.q||[]).length + 2;
    const at = S.stage==='q' ? S.i : S.stage==='v' ? S.q.length : S.stage==='c' ? S.q.length + 1 : total;
    bar.style.width = Math.round(at / total * 100) + '%';
  }

  function render(){
    if (S.i < S.q.length && S.stage!=='v' && S.stage!=='c' && S.stage!=='done') S.stage = 'q';
    progress();
    if (S.stage==='q'){
      const q = S.q[S.i];
      body.innerHTML = `<div class="qtitle" tabindex="-1">${q.t}</div><p class="qhelp">${q.h}</p><div class="choices">${q.c.map(([v,l]) => `<button class="choice" type="button" data-v="${v}">${l}<span aria-hidden="true">→</span></button>`).join('')}</div>${S.i>0?'<button class="back" type="button" data-back>← Question précédente</button>':''}`;
      body.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => { S.a[q.id] = b.dataset.v; S.i++; if (S.i >= S.q.length) S.stage = 'v'; render(); }));
      const bk = body.querySelector('[data-back]'); if (bk) bk.addEventListener('click', () => { S.i--; render(); });
      body.querySelector('.qtitle').focus();
      return;
    }
    if (S.stage==='v') return renderVerdict();
    if (S.stage==='c') return renderCheckout();
    if (S.stage==='done') return renderDone();
  }

  const CONCEPT = ['agrandir','garage','toit','usage'];
  function total(v){ return v.base + (v.re||0) + (v.abf||0) + (v.copro||0) + (S.opt.concept?690:0) + (S.opt.concept&&S.opt.d3?190:0) + (S.opt.depot?69:0) + (S.opt.express&&v.kind==='dp'?49:0) + (S.opt.visio?49:0); }

  function renderVerdict(){
    const v = verdict(); S.v = v;
    const back = '<button class="back" type="button" data-back>← Changer mes réponses</button>';
    if (v.kind==='none'){
      body.innerHTML = `<div class="verdict"><span class="kind">Bonne nouvelle</span><h3>Vous n'avez aucune démarche à faire.</h3><p class="qhelp">Pour des travaux de cette taille, la loi ne demande pas d'autorisation, sauf dans un quartier protégé ou si votre commune a une règle particulière. Vous ne nous devez rien.</p></div>${back}`;
    } else if (v.kind==='call'){
      body.innerHTML = `<div class="verdict"><span class="kind">On s'en occupe</span><h3>${v.title}</h3><p class="qhelp">${v.text}</p></div><button class="btn" type="button" data-call>Être rappelé</button>${back}`;
      body.querySelector('[data-call]').addEventListener('click', () => { S.stage='c'; S.call=true; render(); });
    } else if (v.kind==='archi' || v.kind==='conception'){
      body.innerHTML = `<div class="verdict"><span class="kind">${v.kind==='archi'?'Il vous faut un architecte':'Un projet à dessiner de zéro'}</span><h3>${v.kind==='archi'?'Au-delà de 150 m², la loi impose qu\'un architecte signe le permis.':'Votre maison est encore à concevoir.'}</h3><p class="qhelp">${v.kind==='archi'?'On vous met en relation avec un architecte partenaire, et on prépare le dossier avec lui. Laissez-nous votre numéro, on vous rappelle.':'C\'est un vrai travail de conception, qu\'on préfère chiffrer après vous avoir parlé. Laissez-nous votre numéro, on vous rappelle.'}</p></div><button class="btn" type="button" data-call>Être rappelé</button>${back}`;
      body.querySelector('[data-call]').addEventListener('click', () => { S.stage='c'; S.call=true; render(); });
    } else {
      const dp = v.kind==='dp';
      const c = P[S.p].cat, canC = CONCEPT.includes(c);
      if (!canC) { S.opt.concept = false; S.opt.d3 = false; }
      const delay = v.kind==='pc' ? '5 jours ouvrés' : (dp && S.opt.express ? '24 h ouvrées' : '48 h ouvrées');
      const nd = NEED[S.p] || NEED.extension;
      const ndP = S.opt.concept ? 'Ce que vous voulez : la surface, à quoi ça servira (chambre, salon…), le style qui vous plaît, et une photo d\'inspiration si vous en avez' : nd[0];
      const DO = S.opt.concept ? 'On vous propose deux projets, avec les plans de l\'intérieur et une vue 3D. Vous choisissez, on ajuste, puis on prépare tout le dossier.'
        : canC ? 'On dessine votre projet en respectant les règles de votre commune, on l\'ajuste avec vous, puis on prépare tout le dossier.'
        : c==='maison' ? 'On prépare tout le dossier de permis à partir de vos plans, on le vérifie avec les règles de votre commune, et on fait établir l\'attestation énergétique.'
        : v.kind==='svc' ? 'On prépare et on remplit tout. Il ne vous reste qu\'à envoyer.'
        : 'On place votre projet au bon endroit, on vérifie qu\'il respecte les règles de votre commune, et on dessine tous les plans.';
      const KIND = {dp:['Déclaration de travaux','Une déclaration de travaux suffit.'], pc:['Permis de construire','Il vous faut un permis de construire.'], pd:['Permis de démolir','Il vous faudra peut-être un permis de démolir.'], svc:[v.title, v.h3]}[v.kind];
      body.innerHTML = `<div class="verdict"><span class="kind">${S.regul?'Travaux déjà faits · ':''}${KIND[0]}</span><h3>${KIND[1]}</h3><p class="qhelp">${S.opt.concept ? 'Vous recevez une première proposition sous 5 jours. Une fois validée, votre dossier est prêt en ' + delay + '.' : (v.kind==='svc'?'Prêt':'Votre dossier est prêt') + ' en ' + delay + ' après réception de vos photos.'}</p>
        <div class="need"><b>Ce qu'on vous demandera</b><small>Après le paiement, depuis votre téléphone. Un guide vous accompagne photo par photo.</small>
          <ul><li><i>Le projet</i>${ndP}</li><li><i>Les mesures</i>${nd[1]}</li><li><i>Les photos</i>${nd[2]}</li></ul>
          ${canC&&!S.opt.concept?'<p>Vous n\'avez encore qu\'une idée, sans croquis ni devis ? L\'option conception, juste en dessous, est faite pour ça.</p>':''}
        </div>
        <p class="do"><b>Ce qu'on fait pour vous :</b> ${DO}</p>
        ${URL[S.p]&&!document.body.dataset.page?`<p class="small-note"><a href="${BASE}${URL[S.p]}/">Les règles et le dossier en détail →</a></p>`:''}
        <div class="lines"><div><span>${v.label}</span><span>${euro(v.base)}</span></div>${v.re?`<div><span>Attestation énergétique, obligatoire pour une maison neuve</span><span>+ ${euro(v.re)}</span></div>`:''}${v.abf?`<div><span>Près d'un monument ou en quartier protégé</span><span>+ ${euro(v.abf)}</span></div>`:''}${v.copro?`<div><span>Copropriété : les documents pour le vote</span><span>+ ${euro(v.copro)}</span></div>`:''}</div>
        ${v.note.map(n=>`<p class="small-note">${n}</p>`).join('')}
        <div class="opts">
          ${canC?`<label class="opt"><input type="checkbox" data-o="concept" ${S.opt.concept?'checked':''}><span><b>On conçoit votre projet avec vous</b><small>Vous nous dites ce que vous voulez, on dessine : 2 propositions, les plans de l'intérieur, une vue 3D, et 2 tours d'ajustements</small></span><span class="p">+ 690 €</span></label>`:''}
          ${canC&&S.opt.concept?`<label class="opt"><input type="checkbox" data-o="d3" ${S.opt.d3?'checked':''}><span><b>Vue 3D de l'intérieur</b><small>Pour vous projeter dans vos futures pièces</small></span><span class="p">+ 190 €</span></label>`:''}
          ${dp?`<label class="opt"><input type="checkbox" data-o="express" ${S.opt.express?'checked':''}><span><b>Dossier prêt en 24 h</b><small>Au lieu de 48 h</small></span><span class="p">+ 49 €</span></label>`:''}
          <label class="opt"><input type="checkbox" data-o="depot" ${S.opt.depot?'checked':''}><span><b>On dépose le dossier à votre place</b><small>Sur le site de votre mairie, avec votre accord écrit</small></span><span class="p">+ 69 €</span></label>
          <label class="opt"><input type="checkbox" data-o="visio" ${S.opt.visio?'checked':''}><span><b>20 minutes en visio avec nous</b><small>Pour parler de votre projet avant qu'on commence</small></span><span class="p">+ 49 €</span></label>
        </div>
        <div class="total"><span>Total TTC</span><b>${euro(total(v))}</b></div>
        <p class="small-note">Tout compris : plans, formulaire, relecture, pièces demandées par la mairie. Refus de notre fait : on redépose sans frais.</p>
        </div><button class="btn blue-btn" type="button" data-next>Continuer</button>${back}`;
      body.querySelectorAll('[data-o]').forEach(cb => cb.addEventListener('change', () => { S.opt[cb.dataset.o] = cb.checked; renderVerdict(); }));
      body.querySelector('[data-next]').addEventListener('click', () => { S.stage='c'; S.call=false; render(); });
    }
    body.querySelector('[data-back]').addEventListener('click', () => { if (!S.q.length) { close(); return; } S.i = S.q.length - 1; S.stage='q'; render(); });
  }

  function renderCheckout(){
    const v = S.v, call = S.call;
    body.innerHTML = `<div class="qtitle" tabindex="-1">${call?'Comment vous joindre ?':'Encore deux choses, et c\'est parti'}</div><p class="qhelp">${call?'On vous rappelle dans la journée, ou le lendemain matin au plus tard.':'Juste après, vous confirmerez votre terrain sur une carte. Pas de compte à créer, pas de mot de passe.'}</p>
      <form id="co" novalidate>
        <label class="field"><span>L'adresse des travaux</span><input name="adr" autocomplete="street-address" placeholder="12 rue des Lilas, 44800 Saint-Herblain" required></label>
        <label class="field"><span>${call?'Votre téléphone':'Votre e-mail, pour recevoir le dossier'}</span><input name="mail" type="${call?'tel':'email'}" autocomplete="${call?'tel':'email'}" required></label>
        <button class="btn blue-btn" type="submit">${call?'Me faire rappeler':'Payer '+euro(total(v))+' et lancer mon dossier'}</button>
        ${call?'':'<div class="reassure"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor"/><path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" fill="none" stroke="currentColor"/></svg>Paiement sécurisé par Stripe · Carte, Apple Pay, Google Pay</div>'}
      </form><button class="back" type="button" data-back>← Retour</button>`;
    body.querySelector('#co').addEventListener('submit', e => { e.preventDefault(); const f = e.target; if (!f.adr.value.trim() || !f.mail.value.trim()) { (f.adr.value.trim()?f.mail:f.adr).focus(); return; } S.stage='done'; render(); });
    body.querySelector('[data-back]').addEventListener('click', () => { S.stage='v'; render(); });
    body.querySelector('.qtitle').focus();
  }

  function renderDone(){
    body.innerHTML = `<div class="done"><div class="seal"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M8 15.5l4.5 4.5L22 10" fill="none" stroke="var(--good)" stroke-width="3"/></svg></div><div class="qtitle" tabindex="-1">Ceci est une maquette</div><p class="qhelp" style="max-width:420px;margin:10px auto 0">Le paiement sera activé au lancement du site. Rien n'a été enregistré ni débité.</p></div><button class="btn ghost" type="button" data-close>Fermer</button>`;
    body.querySelector('[data-close]').addEventListener('click', close);
    bar.style.width = '100%';
    body.querySelector('.qtitle').focus();
  }

  document.addEventListener('click', e => {
    const t = e.target.closest('[data-p]'); if (t && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); open(t.dataset.p, t); return; }
    const s = e.target.closest('.js-start');
    if (s) { const a = document.getElementById('projets'); if (!a) return; e.preventDefault(); a.scrollIntoView({behavior:'smooth', block:'start'}); setTimeout(() => { const f = a.querySelector('.tile'); if (f) f.focus({preventScroll:true}); }, 400); }
  });
  // Accès direct : bonpermis.fr/#extension ouvre directement le projet
  const fromHash = () => { const k = decodeURIComponent(location.hash.slice(1)); if (P[k] || k==='regul') open(k, null); };
  window.addEventListener('hashchange', fromHash); fromHash();
  document.getElementById('closeBtn').addEventListener('click', close);
  ov.addEventListener('click', e => { if (e.target === ov) close(); });
  document.addEventListener('keydown', e => { if (e.key==='Escape' && !ov.hidden) close(); });
})();
