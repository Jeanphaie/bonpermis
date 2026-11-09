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
    S = {p, a:{}, i:0, q:X.flow(P, p), opt:{depot:false, express:false, visio:false, concept:false, d3:false}, regul:!!regul};
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
    body.querySelector('[data-back]').addEventListener('click', () => { if (!S.q.length) { close(); return; } S.i = S.q.length - 1; S.stage='q'; render(); });
  }

  function renderCheckout(){
    const v = S.v, call = S.call;
    body.innerHTML = `<div class="qtitle" tabindex="-1">${call?'Comment vous joindre ?':'Encore deux choses, et c\'est parti'}</div><p class="qhelp">${call?'On vous rappelle dans la journée, ou le lendemain matin au plus tard.':'Pas besoin de créer un compte avant : il est créé avec votre commande. Vous payez 30 % aujourd\'hui, le solde après l\'aperçu de vos plans.'}</p>
      <form id="co" novalidate>
        <label class="field"><span>L'adresse des travaux</span><input name="adr" autocomplete="off" placeholder="12 rue des Lilas, 44800 Saint-Herblain" required></label>
        <div class="sugs" data-sug aria-live="polite"></div>
        <p class="terrain-info" data-terrain hidden></p>
        <label class="field"><span>${call?'Votre téléphone':'Votre e-mail, pour recevoir le dossier'}</span><input name="mail" type="${call?'tel':'email'}" autocomplete="${call?'tel':'email'}" required></label>
        <p class="form-err" role="alert" hidden></p>
        <button class="btn blue-btn" type="submit">${call?'Me faire rappeler':'Payer l\'acompte de '+euro(acompte(v))+' et lancer mon dossier'}</button>
        ${call?'':'<div class="reassure"><svg width="14" height="14" viewBox="0 0 14 14"><rect x="2.5" y="6" width="9" height="6.5" rx="1.5" fill="none" stroke="currentColor"/><path d="M4.5 6V4.5a2.5 2.5 0 015 0V6" fill="none" stroke="currentColor"/></svg>Paiement sécurisé par Stripe · Carte, Apple Pay, Google Pay, PayPal</div>'}
      </form><button class="back" type="button" data-back>← Retour</button>`;
    // Adresse : suggestions de la Base Adresse Nationale, puis lecture du terrain (parcelle, PLU, secteur protégé).
    const fo = body.querySelector('#co'), adr = fo.adr, sug = body.querySelector('[data-sug]'), info = body.querySelector('[data-terrain]');
    let minuteur = null, lieu = null, demande = 0;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    const majBouton = () => { if (!call) fo.querySelector('button[type=submit]').textContent = 'Payer l\'acompte de ' + euro(acompte(S.v)) + ' et lancer mon dossier'; };
    adr.addEventListener('input', () => {
      lieu = null; info.hidden = true; clearTimeout(minuteur);
      const q = adr.value.trim(); if (q.length < 4) { sug.innerHTML = ''; return; }
      minuteur = setTimeout(async () => {
        const n = ++demande;
        try {
          const j = await (await fetch(API + '/terrain/adresses?q=' + encodeURIComponent(q))).json();
          if (n !== demande) return;
          sug.innerHTML = (j.adresses || []).map((x, i) => `<button type="button" class="sug" data-i="${i}">${esc(x.label)}</button>`).join('');
          sug.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { const x = j.adresses[+b.dataset.i]; adr.value = x.label; sug.innerHTML = ''; lieu = {lon: x.lon, lat: x.lat}; terrain(x); }));
        } catch (x) { sug.innerHTML = ''; }
      }, 250);
    });
    async function terrain(x) {
      info.hidden = false; info.className = 'terrain-info'; info.textContent = 'On regarde votre terrain…';
      let t; try { t = await (await fetch(API + `/terrain?lon=${x.lon}&lat=${x.lat}`)).json(); } catch (e) { info.hidden = true; return; }
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
    body.querySelector('#co').addEventListener('submit', async e => {
      e.preventDefault(); const f = e.target;
      if (!f.adr.value.trim() || !f.mail.value.trim()) { (f.adr.value.trim()?f.mail:f.adr).focus(); return; }
      const btn = f.querySelector('button[type=submit]'), err = f.querySelector('.form-err'), label = btn.textContent;
      btn.disabled = true; btn.textContent = call ? 'Envoi…' : 'Ouverture du paiement sécurisé…'; err.hidden = true;
      const data = {p:S.p, a:S.a, regul:S.regul, opt:S.opt, adresse:f.adr.value.trim(), lieu};
      if (call) { data.tel = f.mail.value.trim(); data.motif = v.kind; } else data.email = f.mail.value.trim();
      try {
        const r = await fetch(API + (call ? '/rappel' : '/commande'), {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)});
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erreur || 'Le service ne répond pas.');
        if (call) { S.stage='done'; render(); return; }
        if (!j.url) throw new Error('Réponse inattendue du service de paiement.');
        location.href = j.url;
      } catch (x) {
        err.textContent = (x && x.message && !/fetch|network|JSON/i.test(x.message) ? x.message : 'Le service ne répond pas pour le moment.') + ' Réessayez, ou écrivez-nous à contact@bonpermis.fr.';
        err.hidden = false; btn.disabled = false; btn.textContent = label;
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
