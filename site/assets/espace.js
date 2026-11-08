/* Mon espace : connexion / création de compte, projets enregistrés et commandes. */
(() => {
  const el = document.getElementById('espace');
  const q = new URLSearchParams(location.search);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const euro = n => (+n).toLocaleString('fr-FR', {minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2}) + ' €';
  const date = d => new Date(d).toLocaleDateString('fr-FR', {day: 'numeric', month: 'short'});
  const api = async (m, u, corps) => {
    const r = await fetch('/api' + u, {method: m, headers: corps ? {'Content-Type': 'application/json'} : {}, body: corps ? JSON.stringify(corps) : undefined, credentials: 'same-origin'});
    const j = await r.json().catch(() => ({}));
    return {ok: r.ok, s: r.status, j};
  };
  const PENDING = 'bp-projet';
  const lirePending = () => { try { return JSON.parse(localStorage.getItem(PENDING) || 'null'); } catch (e) { return null; } };
  const viderPending = () => { try { localStorage.removeItem(PENDING); } catch (e) {} };
  const suite = q.get('suite') && /^\/espace\/[\w/?=&.-]*$/.test(q.get('suite')) ? q.get('suite') : null;

  async function demarrer() {
    const r = await api('GET', '/espace').catch(() => null);
    if (!r) { el.innerHTML = '<h1>Mon espace</h1><p class="form-err">Le service ne répond pas. Réessayez dans un instant.</p>'; return; }
    if (r.s === 401) return auth();
    if (!r.ok) { el.innerHTML = '<h1>Mon espace</h1><p class="form-err">Le service ne répond pas. Réessayez dans un instant.</p>'; return; }
    const p = lirePending();
    if (p) { viderPending(); const e = await api('POST', '/projets', p); if (!e.ok) alerte = e.j.erreur || 'Le projet n\'a pas pu être enregistré.'; else nouveau = true; return demarrer(); }
    if (suite) { location.replace(suite); return; }
    tableau(r.j);
  }
  let alerte = '', nouveau = false, changer = false;

  // ---------- connexion / création ----------
  function auth(mode) {
    mode = mode || (lirePending() ? 'creer' : 'connexion');
    const p = lirePending();
    el.innerHTML = `<h1>Mon espace</h1>
      <p class="sous">${p ? 'Créez votre compte pour enregistrer votre projet. Aucun paiement à cette étape.' : 'Retrouvez vos projets, vos documents et l\'avancement de votre dossier.'}</p>
      ${q.get('lien') === 'expire' ? '<p class="form-err">Ce lien a expiré. Demandez-en un nouveau ci-dessous.</p>' : ''}
      <div class="onglets" role="tablist">
        <button type="button" role="tab" aria-selected="${mode === 'connexion'}" data-m="connexion">Se connecter</button>
        <button type="button" role="tab" aria-selected="${mode === 'creer'}" data-m="creer">Créer un compte</button>
      </div>
      <form id="f" novalidate>
        <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="email" required></label>
        <label class="field"><span>Mot de passe</span><input name="mdp" type="password" autocomplete="${mode === 'creer' ? 'new-password' : 'current-password'}" minlength="10" required>
          ${mode === 'creer' ? '<small>10 caractères minimum. Votre navigateur peut en proposer un et le retenir pour vous.</small>' : ''}</label>
        ${mode === 'creer' ? '<p class="note">En créant un compte, vous acceptez les <a href="/cgv/">conditions générales</a> et la <a href="/confidentialite/">politique de confidentialité</a>.</p>' : ''}
        <p class="form-err" role="alert" hidden></p>
        <button class="btn blue-btn" type="submit" style="width:100%;margin-top:14px">${mode === 'creer' ? 'Créer mon compte' : 'Me connecter'}</button>
      </form>
      <div class="ou">ou</div>
      <form id="fl" novalidate>
        <p class="note" style="margin:0 0 8px">Mot de passe oublié, ou pas encore de mot de passe ? Recevez un lien de connexion, valable 30 minutes.</p>
        <p class="ok-msg" hidden></p>
        <button class="btn ghost" type="submit" style="width:100%">Recevoir un lien par e-mail</button>
      </form>`;
    el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => auth(b.dataset.m)));
    const f = el.querySelector('#f'), err = f.querySelector('.form-err');
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.hidden = true;
      const email = f.email.value.trim(), mdp = f.mdp.value;
      if (!email) { f.email.focus(); return; }
      if (mode === 'creer' && mdp.length < 10) { err.textContent = 'Choisissez un mot de passe d\'au moins 10 caractères.'; err.hidden = false; f.mdp.focus(); return; }
      const b = f.querySelector('button[type=submit]'); b.disabled = true;
      const r = await api('POST', mode === 'creer' ? '/compte/inscription' : '/compte/connexion', {email, mdp}).catch(() => ({j: {erreur: 'Le service ne répond pas.'}}));
      b.disabled = false;
      if (!r.ok) { err.textContent = r.j.erreur || 'Erreur.'; err.hidden = false; return; }
      demarrer();
    });
    const fl = el.querySelector('#fl');
    fl.addEventListener('submit', async e => {
      e.preventDefault();
      const email = f.email.value.trim();
      if (!email) { err.textContent = 'Indiquez votre e-mail ci-dessus.'; err.hidden = false; f.email.focus(); return; }
      const r = await api('POST', '/compte/lien', {email}).catch(() => ({j: {}}));
      const m = fl.querySelector('.ok-msg');
      m.textContent = r.ok ? `Si un compte existe pour ${email}, un lien vient de partir. Pensez à regarder les indésirables.` : (r.j.erreur || 'Envoi impossible.');
      m.hidden = false;
    });
  }

  // ---------- tableau de bord ----------
  function tableau(d) {
    const choisirMdp = q.get('mdp') === '1' || !d.compte.motDePasse || changer;
    el.innerHTML = `<p class="eyebrow">${esc(d.compte.email)}</p>
      <h1>Mes projets</h1>
      ${q.get('confirme') ? '<p class="ok-msg">Merci, votre adresse e-mail est confirmée.</p>' : ''}
      ${nouveau ? '<p class="ok-msg">Votre projet est enregistré.</p>' : ''}
      ${alerte ? `<p class="form-err">${esc(alerte)}</p>` : ''}
      ${choisirMdp ? `<form class="carte" id="fm" novalidate style="margin-top:16px">
          <b>${d.compte.motDePasse ? 'Choisissez un nouveau mot de passe' : 'Choisissez votre mot de passe'}</b>
          <p class="note">Pour vous reconnecter sans e-mail, depuis n'importe quel appareil.</p>
          <input type="email" autocomplete="username" value="${esc(d.compte.email)}" hidden>
          ${changer ? '<label class="field"><span>Mot de passe actuel</span><input name="ancien" type="password" autocomplete="current-password" required></label>' : ''}
          <label class="field"><span>${changer ? 'Nouveau mot de passe' : 'Mot de passe'}</span><input name="mdp" type="password" autocomplete="new-password" minlength="10" required><small>10 caractères minimum.</small></label>
          <p class="form-err" role="alert" hidden></p>
          <button class="btn blue-btn" type="submit">Enregistrer le mot de passe</button>
        </form>` : ''}
      <div id="cmds"></div><div id="sims"></div>
      <p style="margin-top:22px"><a class="btn ghost" href="/#projets">+ Nouveau projet</a></p>
      <h2>Mon compte</h2>
      <div class="carte rang ecart"><span>${esc(d.compte.email)}</span><span class="rang">${d.compte.motDePasse && !choisirMdp ? '<button class="lien" type="button" data-mdp>Changer le mot de passe</button>' : ''}<button class="lien" type="button" data-out>Se déconnecter</button></span></div>`;
    nouveau = false; alerte = '';
    const cm = el.querySelector('#cmds');
    if (d.commandes.length) cm.innerHTML = '<h2>Mes dossiers</h2>' + d.commandes.map(c => `<a class="carte" href="/espace/dossier/?ref=${c.ref}" style="display:block;text-decoration:none;color:inherit;margin-top:12px">
        <div class="rang ecart"><b style="font-family:var(--f-display);font-size:19px">${esc(c.nom)}</b><span class="pill st-${c.statut}">${esc(c.statutTexte)}</span></div>
        <p class="note">${c.ref} · ${esc(c.commune)} · commandé le ${date(c.date)}</p>
        <p class="note">${c.statut === 'elements' ? `Pièces reçues : ${c.recues.n} sur ${c.recues.sur}` : c.statut === 'apercu' ? 'Vos plans sont prêts à relire.' : c.statut === 'livre' ? 'Dossier prêt à télécharger.' : c.echeance ? 'Aperçu prévu le ' + date(c.echeance) : ''}</p>
        <span class="lien" style="display:inline-block;margin-top:8px">Ouvrir le dossier →</span></a>`).join('');
    const sm = el.querySelector('#sims');
    sm.innerHTML = (d.projets.length ? '<h2>Projets enregistrés</h2>' : (d.commandes.length ? '' : '<p class="sous" style="margin-top:18px">Aucun projet pour l\'instant. Lancez une simulation : vous pourrez l\'enregistrer ici avant de commander.</p>')) +
      d.projets.map(s => `<div class="carte" data-id="${s.id}" style="margin-top:12px">
        <div class="rang ecart"><b style="font-family:var(--f-display);font-size:19px">${esc(s.nom)}</b><span class="pill st-simulation">Simulation</span></div>
        <p class="note">${s.adresse ? esc(s.adresse) + ' · ' : ''}enregistré le ${date(s.date)}</p>
        <div class="prix">${s.lignes.map(l => `<span class="gris">${esc(l.label)}</span><span class="gris">${euro(l.prix)}</span>`).join('')}
          <span class="tot">Prix du dossier</span><span class="tot">${euro(s.total)}</span>
          <span>Acompte à la commande (30 %)</span><span>${euro(s.acompte)}</span>
          <span class="gris">Solde, après l'aperçu des plans</span><span class="gris">${euro(Math.round((s.total - s.acompte) * 100) / 100)}</span></div>
        ${s.adresse ? '' : '<label class="field"><span>Adresse des travaux</span><input name="adr" autocomplete="street-address" placeholder="12 rue des Lilas, 44800 Saint-Herblain"></label>'}
        <p class="form-err" role="alert" hidden></p>
        <div class="rang" style="margin-top:12px"><button class="btn blue-btn" type="button" data-cmd>Commander, payer l'acompte de ${euro(s.acompte)}</button><button class="lien" type="button" data-del>Supprimer</button></div>
      </div>`).join('');
    sm.querySelectorAll('[data-cmd]').forEach(b => b.addEventListener('click', async () => {
      const c = b.closest('[data-id]'), err = c.querySelector('.form-err'), adr = c.querySelector('[name=adr]');
      if (adr && adr.value.trim().length < 5) { err.textContent = 'Indiquez l\'adresse des travaux.'; err.hidden = false; adr.focus(); return; }
      b.disabled = true; b.textContent = 'Ouverture du paiement sécurisé…';
      const r = await api('POST', '/projets/commander?id=' + c.dataset.id, {adresse: adr ? adr.value.trim() : ''}).catch(() => ({j: {}}));
      if (r.ok && r.j.url) { location.href = r.j.url; return; }
      err.textContent = r.j.erreur || 'Le paiement n\'a pas pu s\'ouvrir.'; err.hidden = false; b.disabled = false; b.textContent = 'Réessayer';
    }));
    sm.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
      const c = b.closest('[data-id]'); if (!confirm('Supprimer ce projet enregistré ?')) return;
      await api('DELETE', '/projets?id=' + c.dataset.id); demarrer();
    }));
    const fm = el.querySelector('#fm');
    if (fm) fm.addEventListener('submit', async e => {
      e.preventDefault(); const err = fm.querySelector('.form-err');
      if (fm.mdp.value.length < 10) { err.textContent = 'Au moins 10 caractères.'; err.hidden = false; return; }
      const r = await api('POST', '/compte/mot-de-passe', {mdp: fm.mdp.value, ancien: fm.ancien ? fm.ancien.value : undefined});
      if (!r.ok) { err.textContent = r.j.erreur || 'Erreur.'; err.hidden = false; return; }
      history.replaceState(null, '', '/espace/'); q.delete('mdp'); changer = false;
      fm.outerHTML = '<p class="ok-msg">Mot de passe enregistré.</p>';
    });
    const bm = el.querySelector('[data-mdp]');
    if (bm) bm.addEventListener('click', () => { changer = true; tableau(d); el.querySelector('#fm [name=ancien]').focus(); });
    el.querySelector('[data-out]').addEventListener('click', async () => { await api('POST', '/compte/deconnexion'); location.href = '/'; });
  }

  demarrer();
})();
