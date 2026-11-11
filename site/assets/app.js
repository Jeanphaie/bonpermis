(() => {
  const {P, GROUPS, SVCS, NEED, URL} = window.OP;
  const X = window.PRIX;
  const API = '/api';
  const BASE = document.documentElement.dataset.base || '';
  const PH = '<span class="ph"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 54V30L30 14l20 16v24z" fill="none" stroke="#9A968F" stroke-width="1.6"/><path d="M36 54V38h14v16" fill="none" stroke="var(--accent)" stroke-width="2" stroke-dasharray="3 2.5"/><path d="M4 54h56" stroke="#9A968F" stroke-width="1.6"/></svg></span>';

  const ov = document.getElementById('overlay'), body = document.getElementById('panelBody'), bar = document.getElementById('barFill');
  const euro = n => n.toLocaleString('fr-FR', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}) + ' €';
  let S = {}, lastFocus = null;

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
    S = {p, a:{}, i:0, q:X.flow(P, p), opt:{depot:false, express:false, visio:false, concept:false, d3:false, amenag:false}, regul:!!regul, stage:'a'};
    showPanel((regul?'Travaux déjà faits · ':'') + P[p].n, P[p].img);
    render();
  }
  function close(){ ov.hidden = true; document.body.style.overflow = ''; const h = location.hash.slice(1); if (P[h] || h==='regul') { try { history.replaceState(null, '', location.pathname + location.search); } catch(e){} } if (lastFocus) lastFocus.focus(); }

  function progress(){
    const total = (S.q||[]).length + 3;
    const at = S.stage==='a' ? 0 : S.stage==='q' ? S.i + 1 : S.stage==='v' ? S.q.length + 1 : S.stage==='c' ? S.q.length + 2 : total;
    bar.style.width = Math.round(at / total * 100) + '%';
  }

  function render(){
    if (S.i < S.q.length && !['a','v','c','done'].includes(S.stage)) S.stage = 'q';
    progress();
    if (S.stage==='a') return renderAdresse();
    if (S.stage==='q'){
      const q = S.q[S.i];
      body.innerHTML = `<div class="qtitle" tabindex="-1">${q.t}</div><p class="qhelp">${q.h}</p><div class="choices">${q.c.map(([v,l]) => `<button class="choice" type="button" data-v="${v}">${l}<span aria-hidden="true">→</span></button>`).join('')}</div><button class="back" type="button" data-back>← ${S.i>0?'Question précédente':'Adresse'}</button>`;
      body.querySelectorAll('.choice').forEach(b => b.addEventListener('click', () => { S.a[q.id] = b.dataset.v; S.i++; if (S.i >= S.q.length) S.stage = 'v'; render(); }));
      const bk = body.querySelector('[data-back]'); if (bk) bk.addEventListener('click', () => { if (S.i > 0) S.i--; else S.stage = 'a'; render(); });
      body.querySelector('.qtitle').focus();
      return;
    }
    if (S.stage==='v') return renderVerdict();
    if (S.stage==='c') return renderCheckout();
    if (S.stage==='done') return renderDone();
  }

  // Étape « adresse » : analyse du terrain dès le début (cadastre, PLU, monuments et sites protégés, risques).
  // Le secteur protégé trouvé répond à la question correspondante ; sans données, la question reste posée.
  function renderAdresse(){
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    body.innerHTML = `<div class="qtitle" tabindex="-1">Où se trouvent les travaux ?</div><p class="qhelp">On analyse tout de suite votre terrain : cadastre, plan d'urbanisme, monuments protégés et risques.</p>
      <div class="field adr-wrap"><label for="an-adr"><span>L'adresse des travaux</span></label>
        <input id="an-adr" autocomplete="off" placeholder="Tapez le début : 12 rue des Lilas, Saint-Herblain" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="an-sug" value="${esc(S.adresse || '')}">
        <ul class="sugs" id="an-sug" role="listbox"></ul></div>
      <div class="mini-carte" data-carte hidden></div>
      <div class="analyse" data-an hidden aria-live="polite"></div>
      <button class="btn blue-btn" type="button" data-suite ${S.terrain ? '' : 'hidden'}>Continuer</button>
      <button class="back" type="button" data-sans>Je n'ai pas encore l'adresse exacte →</button>`;
    const adr = body.querySelector('#an-adr'), an = body.querySelector('[data-an]'), suite = body.querySelector('[data-suite]');
    let n = 0;
    const W = adresseWidget(body, adr, body.querySelector('#an-sug'), body.querySelector('[data-carte]'), {
      choisir: x => analyser(x),
      effacer: () => { n++; S.lieu = null; S.terrain = null; an.hidden = true; suite.hidden = true; }
    });
    const LIGNES = [['adresse', 'Adresse'], ['parcelle', 'Parcelle cadastrale (IGN)'], ['plu', 'Zone du plan local d\'urbanisme'], ['abf', 'Monuments et sites protégés'], ['risques', 'Risques naturels (Géorisques)']];
    const dessiner = (vals) => {
      an.hidden = false;
      an.innerHTML = '<p class="an-t">Analyse de votre terrain</p>' + LIGNES.map(([k, l]) => { const v = vals[k];
        return `<div class="an-l ${v ? v.c : 'cours'}"><span class="an-i" aria-hidden="true"></span><b>${l}</b><span class="an-v">${v ? v.t : 'en cours…'}</span></div>`; }).join('');
    };
    async function analyser(x) {
      const k = ++n; S.adresse = x.label; S.lieu = {lon: x.lon, lat: x.lat}; S.terrain = null; suite.hidden = true;
      S.q = X.flow(P, S.p); delete S.a.abf;
      const vals = {adresse: {c: 'ok', t: esc(x.label)}}; dessiner(vals);
      let t; try { t = await (await fetch(API + `/terrain?lon=${x.lon}&lat=${x.lat}`)).json(); } catch (e) { t = {erreurs: ['reseau'], protections: [], batiments: []}; }
      if (k !== n) return;
      W.carte(x, t);
      const err = c => (t.erreurs || []).includes(c);
      const final = {adresse: vals.adresse,
        parcelle: t.parcelle ? {c: 'ok', t: `${esc(t.parcelle.section)} ${esc(String(t.parcelle.numero).replace(/^0+/, ''))} · ${(t.parcelle.contenance || t.parcelle.surfaceCalculee).toLocaleString('fr-FR')} m²`} : {c: 'nd', t: err('cadastre') ? 'service indisponible, on vérifiera' : 'non trouvée, on vérifiera'},
        plu: t.zone ? {c: 'ok', t: `Zone ${esc(t.zone.libelle)}${t.zone.libelleLong && t.zone.libelleLong !== t.zone.libelle ? ' · ' + esc(t.zone.libelleLong) : ''}`} : t.commune && t.commune.rnu ? {c: 'ok', t: 'Règles nationales (pas de PLU)'} : {c: 'nd', t: 'non trouvée, on vérifiera'},
        abf: t.secteurProtege ? {c: 'alerte', t: esc(t.protections[0].nom || t.protections[0].libelle) + (t.protections.length > 1 ? ` et ${t.protections.length - 1} autre${t.protections.length > 2 ? 's' : ''}` : '')} : t.secteurProtege === false ? {c: 'ok', t: 'Aucun périmètre trouvé'} : {c: 'nd', t: 'non vérifié, on vérifiera'},
        risques: Array.isArray(t.risques) ? (t.risques.length ? {c: 'alerte', t: t.risques.map(r => esc(r.libelle)).join(', ')} : {c: 'ok', t: 'Aucun risque majeur à l\'adresse'}) : {c: 'nd', t: 'non vérifié'}};
      // Apparition ligne par ligne, une fois les résultats reçus.
      const cles = ['parcelle', 'plu', 'abf', 'risques'];
      for (let i = 0; i < cles.length; i++) { await new Promise(r => setTimeout(r, 220)); if (k !== n) return; vals[cles[i]] = final[cles[i]]; dessiner(vals); }
      S.terrain = t;
      if (!P[S.p].svc) {
        const qa = S.q.findIndex(q => q.id === 'abf');
        if (t.secteurProtege === true || t.secteurProtege === false) {
          S.a.abf = t.secteurProtege ? 'oui' : 'nsp';
          if (qa >= 0) S.q.splice(qa, 1);
        }
        if (t.secteurProtege) an.insertAdjacentHTML('beforeend', '<p class="an-n">Votre terrain est en secteur protégé : l\'architecte des Bâtiments de France donnera son avis. On prépare le dossier en conséquence (supplément de 149 €).</p>');
      }
      if ((t.risques || []).length) an.insertAdjacentHTML('beforeend', '<p class="an-n">On tient compte de ces risques dans les plans (cotes, matériaux, pièces demandées par la mairie).</p>');
      suite.hidden = false; suite.focus();
    }
    const aller = () => { S.i = 0; S.stage = S.q.length ? 'q' : 'v'; render(); };
    suite.addEventListener('click', aller);
    body.querySelector('[data-sans]').addEventListener('click', () => { n++; S.lieu = null; S.terrain = null; S.q = X.flow(P, S.p); aller(); });
    if (S.lieu && S.adresse) analyser({lon: S.lieu.lon, lat: S.lieu.lat, label: S.adresse}); else adr.focus();
  }

  const CONCEPT = X.CONCEPT;
  function total(v){ return X.total(X.lignes(P, S.p, v, S.opt)); }
  function acompte(v){ return Math.round(Math.round(total(v) * 100) * 0.3) / 100; }

  function renderVerdict(){
    const v = X.verdict(P, S.p, S.a, S.regul); S.v = v;
    const back = '<button class="back" type="button" data-back>← Changer mes réponses</button>';
    if (v.kind==='none'){
      body.innerHTML = `<div class="verdict"><span class="kind">Bonne nouvelle</span><h3>Vous n'avez aucune démarche à faire.</h3><p class="qhelp">Pour des travaux de cette taille, la loi ne demande pas d'autorisation, sauf dans un quartier protégé ou si votre commune a une règle particulière. Vous ne nous devez rien.</p></div>${back}`;
    } else if (v.kind==='call'){
      body.innerHTML = `<div class="verdict"><span class="kind">On s'en occupe</span><h3>${v.title}</h3><p class="qhelp">${v.text}</p></div><button class="btn" type="button" data-call>Être rappelé</button>${back}`;
      body.querySelector('[data-call]').addEventListener('click', () => { S.stage='c'; S.call=true; render(); });
    } else if (v.kind==='archi' || v.kind==='conception'){
      body.innerHTML = `<div class="verdict"><span class="kind">${v.kind==='archi'?'Il vous faut un architecte':'Un projet à dessiner de zéro'}</span><h3>${v.kind==='archi'?(v.raison==='societe'?'Pour une société, la loi impose un architecte pour tout permis de construire.':'Au-delà de 150 m², la loi impose qu\'un architecte établisse le projet.'):'Votre maison est encore à concevoir.'}</h3><p class="qhelp">${v.kind==='archi'?'On vous met en relation avec un architecte partenaire, qui conçoit le projet et signe avec vous. Laissez-nous votre numéro, on vous rappelle.':'C\'est un vrai travail de conception, qu\'on préfère chiffrer après vous avoir parlé. Laissez-nous votre numéro, on vous rappelle.'}</p></div><button class="btn" type="button" data-call>Être rappelé</button>${back}`;
      body.querySelector('[data-call]').addEventListener('click', () => { S.stage='c'; S.call=true; render(); });
    } else {
      const dp = v.kind==='dp';
      const c = P[S.p].cat, canC = CONCEPT.includes(c);
      if (!canC) { S.opt.concept = false; S.opt.d3 = false; }
      const canA = !!v.amenag && !S.opt.concept;
      if (!canA) S.opt.amenag = false;
      const delay = v.kind==='pc' ? '5 jours ouvrés' : (dp && S.opt.express ? '24 h ouvrées' : '48 h ouvrées');
      const nd = NEED[S.p] || NEED.extension;
      const ndP = S.opt.concept ? 'Ce que vous voulez : la surface, à quoi ça servira (chambre, salon…), le style qui vous plaît, et une photo d\'inspiration si vous en avez' : nd[0];
      const DO = S.opt.concept ? 'On vous propose deux projets, avec les plans de l\'intérieur et une vue 3D. Vous choisissez, on ajuste, puis on prépare tout le dossier.'
        : canC ? 'On vérifie que votre projet respecte les règles de votre commune, on trace les plans à l\'échelle d\'après votre croquis, puis on prépare tout le dossier.'
        : c==='maison' ? 'On prépare tout le dossier de permis à partir de vos plans, on le vérifie avec les règles de votre commune, et on vous dit où joindre l\'attestation énergétique de votre constructeur.'
        : v.kind==='svc' ? 'On prépare et on remplit tout. Il ne vous reste qu\'à envoyer.'
        : 'On vérifie que votre projet respecte les règles de votre commune, à l\'emplacement que vous avez choisi, et on trace tous les plans.';
      const KIND = {dp:['Déclaration de travaux','Une déclaration de travaux suffit.'], pc:['Permis de construire','Il vous faut un permis de construire.'], pd:['Permis de démolir','Il vous faudra peut-être un permis de démolir.'], svc:[v.title, v.h3]}[v.kind];
      body.innerHTML = `<div class="verdict"><span class="kind">${S.regul?'Travaux déjà faits · ':''}${KIND[0]}</span><h3>${KIND[1]}</h3><p class="qhelp">${S.opt.concept ? 'Vous recevez une première proposition sous 5 jours. Une fois validée, votre dossier est prêt en ' + delay + '.' : (v.kind==='svc'?'Prêt':'Votre dossier est prêt') + ' en ' + delay + ' après réception de vos photos.'}</p>
        <div class="need"><b>Ce qu'on vous demandera</b><small>Votre projet tel que vous l'avez, même en croquis à main levée. Après le paiement, depuis votre téléphone, avec un guide pas à pas.</small>
          <ul><li><i>Le projet</i>${ndP}</li><li><i>Les mesures</i>${nd[1]}</li><li><i>Les photos</i>${nd[2]}</li></ul>
          ${['agrandir','garage','toit','usage'].includes(c)?'<p>Vous n\'avez encore qu\'une idée, sans croquis ni devis ? La conception du projet se fait sur devis : appelez-nous.</p>':''}
        </div>
        <p class="do"><b>Ce qu'on fait pour vous :</b> ${DO}</p>
        ${URL[S.p]&&!document.body.dataset.page?`<p class="small-note"><a href="${BASE}${URL[S.p]}/">Les règles et le dossier en détail →</a></p>`:''}
        <div class="lines"><div><span>${v.label}</span><span>${euro(v.base)}</span></div>${v.re?`<div><span>Attestation énergétique, obligatoire pour une maison neuve</span><span>+ ${euro(v.re)}</span></div>`:''}${v.abf?`<div><span>Près d'un monument ou en quartier protégé</span><span>+ ${euro(v.abf)}</span></div>`:''}${v.copro?`<div><span>Copropriété : les documents pour le vote</span><span>+ ${euro(v.copro)}</span></div>`:''}</div>
        ${v.note.map(n=>`<p class="small-note">${n}</p>`).join('')}
        <div class="opts">
          ${canA?`<label class="opt"><input type="checkbox" data-o="amenag" ${S.opt.amenag?'checked':''}><span><b>Plan d'aménagement intérieur</b><small>La pièce créée, meublée et cotée : une proposition, une retouche. Fait avant le dépôt, pour placer les fenêtres au bon endroit${v.amenag>199?'. Prix pour plus de 40 m²':''}</small></span><span class="p">+ ${v.amenag} €</span></label>`:''}
          ${canC?`<label class="opt"><input type="checkbox" data-o="concept" ${S.opt.concept?'checked':''}><span><b>On conçoit votre projet avec vous</b><small>Vous nous dites ce que vous voulez, on dessine : 2 propositions, les plans de l'intérieur, une vue 3D, et 2 tours d'ajustements</small></span><span class="p">+ 690 €</span></label>`:''}
          ${canC&&S.opt.concept?`<label class="opt"><input type="checkbox" data-o="d3" ${S.opt.d3?'checked':''}><span><b>Vue 3D de l'intérieur</b><small>Pour vous projeter dans vos futures pièces</small></span><span class="p">+ 190 €</span></label>`:''}
          ${dp?`<label class="opt"><input type="checkbox" data-o="express" ${S.opt.express?'checked':''}><span><b>Dossier prêt en 24 h</b><small>Au lieu de 48 h</small></span><span class="p">+ 49 €</span></label>`:''}
          <label class="opt"><input type="checkbox" data-o="depot" ${S.opt.depot?'checked':''}><span><b>On dépose et on suit le dossier jusqu'à la réponse de la mairie</b><small>Dépôt en ligne avec votre accord écrit, accusé de réception, réponse aux demandes de pièces de la mairie, nouvelles à chaque étape</small></span><span class="p">+ ${X.OPTIONS.depot.prix} €</span></label>
          <label class="opt"><input type="checkbox" data-o="visio" ${S.opt.visio?'checked':''}><span><b>20 minutes en visio avec nous</b><small>Pour parler de votre projet avant qu'on commence</small></span><span class="p">+ 49 €</span></label>
        </div>
        <div class="total"><span>Total TTC</span><b>${euro(total(v))}</b></div>
        <div class="lines acompte-l"><div><span>Aujourd'hui, acompte de 30 %</span><span>${euro(acompte(v))}</span></div><div><span>Après l'aperçu de vos plans, le solde</span><span>${euro(Math.round((total(v) - acompte(v)) * 100) / 100)}</span></div></div>
        <p class="small-note">Tout compris : plans, formulaire, relecture, pièces demandées par la mairie. Refus de notre fait : on redépose sans frais.</p>
        </div><button class="btn blue-btn" type="button" data-next>Continuer</button>
        <button class="btn ghost" type="button" data-save style="margin-top:10px">Enregistrer dans mon espace</button><p class="small-note" data-saved aria-live="polite"></p>${back}`;
      body.querySelectorAll('[data-o]').forEach(cb => cb.addEventListener('change', () => { S.opt[cb.dataset.o] = cb.checked; renderVerdict(); }));
      body.querySelector('[data-next]').addEventListener('click', () => { S.stage='c'; S.call=false; render(); });
      body.querySelector('[data-save]').addEventListener('click', async e => {
        const b = e.currentTarget, out = body.querySelector('[data-saved]'), proj = {p:S.p, a:S.a, regul:S.regul, opt:S.opt, adresse:''};
        b.disabled = true;
        try {
          const r = await fetch(API + '/projets', {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(proj)});
          if (r.status === 401) { try { localStorage.setItem('bp-projet', JSON.stringify(proj)); } catch (x) {} location.href = BASE + 'espace/'; return; }
          const j = await r.json().catch(() => ({}));
          out.innerHTML = r.ok ? `Enregistré. <a href="${BASE}espace/">Voir mon espace →</a>` : (j.erreur || 'Enregistrement impossible.');
        } catch (x) { out.textContent = 'Le service ne répond pas.'; }
        b.disabled = false;
      });
    }
    body.querySelector('[data-back]').addEventListener('click', () => { if (!S.q.length) { S.stage='a'; render(); return; } S.i = S.q.length - 1; S.stage='q'; render(); });
  }

  // Champ adresse : liste déroulante accessible (Base Adresse Nationale) et mini-carte IGN avec le contour de la parcelle.
  // o.choisir(x) quand une adresse est choisie, o.effacer() dès que le texte change.
  function adresseWidget(body, adr, sug, carteEl, o) {
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    // Liste déroulante accessible : flèches, Entrée, Échap ; un clic ou Entrée choisit l'adresse.
    let liste = [], actif = -1, minuteur = null, demande = 0;
    const afficher = () => {
      sug.innerHTML = liste.map((x, i) => `<li role="option" id="${sug.id}-${i}" class="sug${i === actif ? ' on' : ''}" aria-selected="${i === actif}" data-i="${i}"><b>${esc(x.rue || x.label)}</b>${x.ville ? `<small>${esc(x.ville)}</small>` : ''}</li>`).join('');
      adr.setAttribute('aria-expanded', liste.length > 0 ? 'true' : 'false');
      if (actif >= 0) adr.setAttribute('aria-activedescendant', sug.id + '-' + actif); else adr.removeAttribute('aria-activedescendant');
    };
    const fermerListe = () => { liste = []; actif = -1; afficher(); };
    const choisir = x => { adr.value = x.label; fermerListe(); carte(x, null); o.choisir(x); };
    sug.addEventListener('pointerdown', e => { const li = e.target.closest('[data-i]'); if (!li) return; e.preventDefault(); choisir(liste[+li.dataset.i]); });
    adr.addEventListener('keydown', e => {
      if (!liste.length) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); actif = (actif + 1) % liste.length; afficher(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); actif = actif <= 0 ? liste.length - 1 : actif - 1; afficher(); }
      else if (e.key === 'Enter') { e.preventDefault(); choisir(liste[Math.max(actif, 0)]); }
      else if (e.key === 'Escape') { fermerListe(); }
    });
    adr.addEventListener('blur', () => setTimeout(fermerListe, 150));
    adr.addEventListener('input', () => {
      o.effacer(); carteEl.hidden = true; clearTimeout(minuteur);
      const q = adr.value.trim(); if (q.length < 3) { fermerListe(); return; }
      minuteur = setTimeout(async () => {
        const n = ++demande;
        try {
          const j = await (await fetch(API + '/terrain/adresses?q=' + encodeURIComponent(q))).json();
          if (n !== demande || document.activeElement !== adr) return;
          liste = j.adresses || []; actif = -1; afficher();
        } catch (x) { fermerListe(); }
      }, 200);
    });
    // Mini-carte : photo aérienne IGN (tuiles relayées par bonpermis.fr), contour de la parcelle et point de l'adresse.
    let fond = 'ortho';
    function carte(x, t) {
      const RAD = Math.PI / 180, W = carteEl.parentNode.clientWidth || 520, H = 230;
      carteEl.hidden = false; carteEl.style.height = H + 'px';
      const anneaux = [];
      const g = t && t.parcelle && t.parcelle.geometrie;
      if (g) (g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'Polygon' ? g.coordinates : []).forEach(r => anneaux.push(r));
      const px = (z, lon, lat) => { const n = 256 * 2 ** z; return [(lon + 180) / 360 * n, (1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2 * n]; };
      // Zoom : le plus fort qui fait tenir la parcelle (photo IGN jusqu'au niveau 19).
      let z = 19, cx, cy;
      for (; z >= 15; z--) {
        const pts = anneaux.flat().map(p => px(z, p[0], p[1]));
        if (!pts.length) { [cx, cy] = px(z, x.lon, x.lat); break; }
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...ys) - Math.min(...ys);
        cx = (Math.max(...xs) + Math.min(...xs)) / 2; cy = (Math.max(...ys) + Math.min(...ys)) / 2;
        if (bw <= W - 60 && bh <= H - 50) break;
      }
      const ox = cx - W / 2, oy = cy - H / 2;
      let h = '';
      for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++)
        for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++)
          h += `<img alt="" draggable="false" src="${API}/terrain/tuile?c=${fond}&z=${z}&x=${tx}&y=${ty}" style="left:${Math.round(tx * 256 - ox)}px;top:${Math.round(ty * 256 - oy)}px">`;
      const chemin = anneaux.map(r => 'M' + r.map(p => { const q = px(z, p[0], p[1]); return (q[0] - ox).toFixed(1) + ',' + (q[1] - oy).toFixed(1); }).join('L') + 'Z').join('');
      const [mx, my] = px(z, x.lon, x.lat).map((v, i) => v - (i ? oy : ox));
      h += `<svg width="${W}" height="${H}" aria-hidden="true">${chemin ? `<path d="${chemin}" fill="rgba(1,39,177,.18)" stroke="#fff" stroke-width="4" stroke-linejoin="round"/><path d="${chemin}" fill="none" stroke="#0127B1" stroke-width="2" stroke-linejoin="round"/>` : ''}
        <g transform="translate(${mx.toFixed(1)},${my.toFixed(1)})"><path d="M0 0c-6-8-10-12-10-17a10 10 0 0 1 20 0c0 5-4 9-10 17z" fill="#0127B1" stroke="#fff" stroke-width="2"/><circle cy="-17" r="3.5" fill="#fff"/></g></svg>
        <div class="mc-bt" role="group" aria-label="Fond de carte"><button type="button" data-fond="ortho" aria-pressed="${fond === 'ortho'}">Photo</button><button type="button" data-fond="plan" aria-pressed="${fond === 'plan'}">Plan</button></div>
        <span class="mc-att">${chemin ? 'Contour : cadastre · ' : ''}© IGN</span>`;
      carteEl.innerHTML = h;
      carteEl.setAttribute('role', 'img');
      carteEl.setAttribute('aria-label', 'Vue aérienne de l\'adresse' + (chemin ? ' avec le contour de la parcelle' : ''));
      carteEl.querySelectorAll('[data-fond]').forEach(b => b.addEventListener('click', () => { fond = b.dataset.fond; carte(x, t); }));
    }
    return {carte};
  }

  function renderCheckout(){
    const v = S.v, call = S.call;
    body.innerHTML = `<div class="qtitle" tabindex="-1">${call?'Comment vous joindre ?':'Créez votre dossier'}</div><p class="qhelp">${call?'On vous rappelle dans la journée, ou le lendemain matin au plus tard.':'Gratuit et sans engagement. Vous voyez tout de suite les pièces à fournir et vous pouvez commencer à les envoyer. L\'acompte de '+euro(acompte(v))+' (30 %) se règle quand vous validez le dossier.'}</p>
      <form id="co" novalidate>
        <div class="field adr-wrap"><label for="co-adr"><span>L'adresse des travaux</span></label>
          <input id="co-adr" name="adr" autocomplete="off" placeholder="Tapez le début : 12 rue des Lilas, Saint-Herblain" required role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="co-sug">
          <ul class="sugs" id="co-sug" role="listbox" data-sug></ul></div>
        <div class="mini-carte" data-carte hidden></div>
        <p class="terrain-info" data-terrain hidden></p>
        <label class="field"><span>${call?'Votre téléphone':'Votre e-mail'}</span><input name="mail" type="${call?'tel':'email'}" autocomplete="${call?'tel':'email'}" required></label>
        ${call?'':`<div class="co-code" data-code hidden><label class="field"><span data-code-lab>Code reçu par e-mail</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" placeholder="000000"></label><button type="button" class="more-btn" data-code-renvoi>Renvoyer le code</button></div>`}
        <p class="form-err" role="alert" hidden></p>
        <button class="btn blue-btn" type="submit">${call?'Me faire rappeler':'Créer mon dossier'}</button>
        ${call?'':'<div class="reassure"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor"/><path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" fill="none" stroke="currentColor"/></svg>Rien à payer maintenant · acompte réglé plus tard, par Stripe</div>'}
      </form><button class="back" type="button" data-back>← Retour</button>`;
    // Adresse : suggestions de la Base Adresse Nationale, puis lecture du terrain (parcelle, PLU, secteur protégé).
    const fo = body.querySelector('#co'), adr = fo.adr, sug = body.querySelector('[data-sug]'), info = body.querySelector('[data-terrain]');
    let minuteur = null, lieu = null, demande = 0;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const majBouton = () => {};
    // Adresse : liste déroulante (Base Adresse Nationale) et mini-carte, communes avec l'étape « adresse ».
    const W = adresseWidget(body, adr, sug, body.querySelector('[data-carte]'), {
      choisir: x => { lieu = {lon: x.lon, lat: x.lat}; terrain(x); },
      effacer: () => { lieu = null; info.hidden = true; }
    });
    const carte = (x, t) => W.carte(x, t);
    if (S.lieu) { adr.value = S.adresse; lieu = S.lieu; terrain({lon: S.lieu.lon, lat: S.lieu.lat, label: S.adresse}); }
    async function terrain(x) {
      info.hidden = false; info.className = 'terrain-info'; info.textContent = 'On regarde votre terrain…';
      let t; try { t = await (await fetch(API + `/terrain?lon=${x.lon}&lat=${x.lat}`)).json(); } catch (e) { info.hidden = true; return; }
      if (lieu && lieu.lon === x.lon && lieu.lat === x.lat) carte(x, t);
      const l = [];
      if (t.parcelle) l.push(`Parcelle ${esc(t.parcelle.section)} ${esc(String(t.parcelle.numero).replace(/^0+/, ''))}${t.parcelle.contenance ? ', ' + t.parcelle.contenance.toLocaleString('fr-FR') + ' m²' : ''}`);
      if (t.zone) l.push(`Zone ${esc(t.zone.libelle)} du plan local d'urbanisme${t.zone.libelleLong && t.zone.libelleLong !== t.zone.libelle ? ' (' + esc(t.zone.libelleLong.toLowerCase()) + ')' : ''}`);
      else if (t.commune && t.commune.rnu) l.push('Commune sans plan local d\'urbanisme : ce sont les règles nationales qui s\'appliquent');
      let html = l.length ? `<b>Votre terrain</b><span>${l.join('<br>')}</span>` : '';
      const peutAbf = !P[S.p].svc;
      if (t.secteurProtege && peutAbf) {
        const pr = t.protections[0];
        html += `<span class="tp-alerte"><b>Secteur protégé :</b> ${esc(pr.libelle.toLowerCase())}${pr.nom ? ' « ' + esc(pr.nom) + ' »' : ''}. L'architecte des Bâtiments de France donnera son avis sur votre projet.</span>`;
        if (S.a.abf !== 'oui') {
          S.a.abf = 'oui'; S.v = X.verdict(P, S.p, S.a, S.regul); majBouton();
          html += `<span class="tp-prix">Le supplément secteur protégé de ${euro(S.v.abf || 149)} s'applique. Nouveau total : ${euro(total(S.v))}.</span>`;
        }
      } else if (t.secteurProtege === false && peutAbf && S.a.abf === 'nsp') {
        html += '<span>Aucune protection trouvée dans les données publiques. On le confirme en préparant votre dossier.</span>';
      }
      if (!html) { info.hidden = true; return; }
      info.innerHTML = html;
    }
    // Création du dossier : sans compte connecté, un code est d'abord envoyé à l'e-mail (2e envoi avec le code).
    let attendCode = false;
    const zoneCode = fo.querySelector('[data-code]');
    if (zoneCode) {
      fo.code.addEventListener('input', () => { fo.code.value = fo.code.value.replace(/\D/g, '').slice(0, 6); if (fo.code.value.length === 6) fo.requestSubmit(); });
      fo.querySelector('[data-code-renvoi]').addEventListener('click', () => { attendCode = false; zoneCode.hidden = true; fo.code.value = ''; fo.requestSubmit(); });
    }
    body.querySelector('#co').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target;
      if (!f.adr.value.trim() || !f.mail.value.trim()) { (f.adr.value.trim()?f.mail:f.adr).focus(); return; }
      const btn = f.querySelector('button[type=submit]'), err = f.querySelector('.form-err'), label = btn.textContent;
      if (attendCode && f.code.value.length !== 6) { f.code.focus(); return; }
      btn.disabled = true; btn.textContent = call ? 'Envoi…' : 'Création du dossier…'; err.hidden = true;
      const data = {p:S.p, a:S.a, regul:S.regul, opt:S.opt, adresse:f.adr.value.trim(), lieu};
      if (call) { data.tel = f.mail.value.trim(); data.motif = v.kind; } else { data.email = f.mail.value.trim(); if (attendCode) data.code = f.code.value; }
      try {
        const r = await fetch(API + (call ? '/rappel' : '/dossier/creer'), {method:'POST', headers:{'Content-Type':'application/json'}, credentials:'same-origin', body:JSON.stringify(data)});
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erreur || 'Le service ne répond pas.');
        if (call) { S.stage='done'; render(); return; }
        if (j.etape === 'code') {
          attendCode = true; zoneCode.hidden = false; f.mail.readOnly = true;
          zoneCode.querySelector('[data-code-lab]').textContent = `Code envoyé à ${data.email} (regardez aussi les indésirables)`;
          btn.disabled = false; btn.textContent = 'Valider le code et créer mon dossier'; f.code.focus(); return;
        }
        if (!j.url) throw new Error('Réponse inattendue du service.');
        location.href = j.url;
      } catch (x) {
        err.textContent = (x && x.message && !/fetch|network|JSON/i.test(x.message) ? x.message : 'Le service ne répond pas pour le moment.') + (attendCode ? '' : ' Réessayez, ou écrivez-nous à contact@bonpermis.fr.');
        err.hidden = false; btn.disabled = false; btn.textContent = label;
        if (attendCode) { f.code.select(); }
      }
    });
    body.querySelector('[data-back]').addEventListener('click', () => { S.stage='v'; render(); });
    body.querySelector('.qtitle').focus();
    if (!call) fetch(API + '/espace', {credentials:'same-origin'}).then(r => r.ok ? r.json() : null).then(j => {
      const m = body.querySelector('#co [name=mail]'); if (!j || !m) return;
      m.value = j.compte.email; m.readOnly = true; m.closest('label').querySelector('span').textContent = 'Votre compte';
    }).catch(() => {});
  }

  function renderDone(){
    body.innerHTML = `<div class="done"><div class="seal"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M8 15.5l4.5 4.5L22 10" fill="none" stroke="var(--good)" stroke-width="3"/></svg></div><div class="qtitle" tabindex="-1">C'est noté, on vous rappelle.</div><p class="qhelp" style="max-width:420px;margin:10px auto 0">Dans la journée, ou le lendemain matin au plus tard. Rien ne vous a été facturé.</p></div><button class="btn ghost" type="button" data-close>Fermer</button>`;
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
