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
  // Vues : « connexion », « creer », puis « code » (6 chiffres reçus par e-mail). Le mot de passe n'est jamais gardé
  // dans la page au-delà de l'envoi. Les champs portent les bons autocomplete pour les gestionnaires de mots de passe.
  const MIN = 12;
  const OEIL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const OEIL_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 3l18 18M10.6 5.1A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
  const ICO = {
    cadenas: '<path d="M6 11h12v10H6z"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/>',
    empreinte: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
    carte: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="M3 10h18M7 15h4"/>',
    dossier: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v4m0 0 2-2m-2 2-2-2"/>'
  };
  const ico = k => `<span class="a-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[k]}</svg></span>`;
  const ASIDE = `<aside class="a-side" aria-label="Sécurité de votre compte">
      <p class="a-kicker">Votre espace</p>
      <h2>Vos plans, vos pièces et vos paiements, au même endroit.</h2>
      <ul class="a-liste">
        <li>${ico('cadenas')}<div><b>Connexion chiffrée</b><span>Tout passe en HTTPS, de votre navigateur à notre serveur.</span></div></li>
        <li>${ico('empreinte')}<div><b>Mot de passe illisible, même pour nous</b><span>Nous gardons seulement une empreinte irréversible (scrypt). Les mots de passe connus des pirates sont refusés.</span></div></li>
        <li>${ico('carte')}<div><b>Paiement par Stripe</b><span>Votre numéro de carte ne passe jamais par nos serveurs.</span></div></li>
        <li>${ico('dossier')}<div><b>Documents privés</b><span>Visibles par vous et par l'équipe qui prépare votre dossier, hébergés dans l'Union européenne.</span></div></li>
      </ul>
      <p class="a-pied"><a href="/confidentialite/">Comment nous protégeons vos données</a></p>
    </aside>`;
  const etat = {email: '', usage: 'creer', renvoi: 0};
  let minuteur = null;

  function champMdp(nom, label, auto, extra) {
    return `<div class="a-champ">
      <div class="a-lab"><label for="a-${nom}">${label}</label>${extra || ''}</div>
      <div class="a-mdp">
        <input id="a-${nom}" name="${nom}" type="password" autocomplete="${auto}" required spellcheck="false" autocapitalize="off" maxlength="256" aria-describedby="a-${nom}-aide">
        <button type="button" class="a-voir" aria-controls="a-${nom}" aria-pressed="false" aria-label="Afficher le mot de passe">${OEIL}</button>
      </div>
      <p class="a-maj" id="a-${nom}-maj" hidden>Majuscules activées</p>
      <div id="a-${nom}-aide"></div>
    </div>`;
  }
  function brancherMdp(racine) {
    racine.querySelectorAll('.a-voir').forEach(b => b.addEventListener('click', () => {
      const i = racine.querySelector('#' + b.getAttribute('aria-controls')), v = i.type === 'password';
      i.type = v ? 'text' : 'password'; b.setAttribute('aria-pressed', v); b.setAttribute('aria-label', v ? 'Masquer le mot de passe' : 'Afficher le mot de passe');
      b.innerHTML = v ? OEIL_X : OEIL; i.focus();
    }));
    racine.querySelectorAll('.a-mdp input').forEach(i => {
      const m = racine.querySelector('#' + i.id + '-maj');
      const f = e => { if (e.getModifierState) m.hidden = !e.getModifierState('CapsLock'); };
      i.addEventListener('keydown', f); i.addEventListener('keyup', f); i.addEventListener('blur', () => { m.hidden = true; });
    });
  }
  // Indications honnêtes : longueur et ressemblance avec l'e-mail. La vérification des fuites se fait côté serveur.
  function criteres(mdp, email) {
    const n = [...mdp].length, loc = (email.split('@')[0] || '').toLowerCase();
    const varie = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter(r => r.test(mdp)).length;
    const perso = loc.length >= 4 && mdp.toLowerCase().includes(loc);
    let niv = n < MIN ? (n ? 1 : 0) : n >= 20 || (n >= 15 && varie >= 2) ? 4 : varie >= 3 || n >= 15 ? 3 : 2;
    if (perso || /^(.)\1+$/.test(mdp)) niv = Math.min(niv, 1);
    return {long: n >= MIN, perso: !perso && !!mdp, niv, n};
  }
  function aideCreation(i, email) {
    const z = el.querySelector('#a-mdp-aide');
    const maj = () => {
      const c = criteres(i.value, email());
      const mots = ['', 'Trop court', 'Correct', 'Solide', 'Très solide'];
      z.innerHTML = `<div class="a-force" data-n="${c.niv}" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
        <ul class="a-crit">
          <li class="${c.long ? 'ok' : ''}">${MIN} caractères minimum${i.value ? ` (${c.n})` : ''}</li>
          <li class="${c.perso ? 'ok' : ''}">Différent de votre e-mail</li>
        </ul>
        <p class="a-astuce">${i.value ? `<b>${mots[c.niv] || ''}</b>. ` : ''}Le plus simple : 3 ou 4 mots sans rapport, comme <i>lampe velo orage citron</i>. Votre navigateur peut aussi en créer un et le retenir.</p>`;
    };
    i.addEventListener('input', maj); maj();
  }

  function auth(mode) {
    mode = mode || (lirePending() ? 'creer' : 'connexion');
    clearInterval(minuteur);
    const p = lirePending();
    el.closest('.wrap').classList.add('a-large');
    if (mode === 'code') return vueCode();
    const creer = mode === 'creer';
    const bandeau = p ? '<div class="a-info" role="status"><b>Votre simulation est prête à être enregistrée.</b> Créez votre compte : elle apparaîtra dans votre espace, au prix affiché. Aucun paiement à cette étape.</div>'
      : q.get('lien') === 'expire' ? '<div class="a-err-b" role="alert">Ce lien a expiré. Connectez-vous, ou recevez un code par e-mail.</div>' : '';
    el.innerHTML = `<div class="a-grille">
      <div class="a-carte">
        <h1>${creer ? 'Créer votre compte' : 'Connexion'}</h1>
        <p class="a-sous">${creer ? 'Pour enregistrer vos projets, envoyer vos pièces et suivre votre dossier.' : 'Retrouvez vos projets, vos documents et l\'avancement de votre dossier.'}</p>
        ${bandeau}
        <form id="f" method="post" action="#" novalidate>
          <div class="a-champ">
            <div class="a-lab"><label for="a-email">Adresse e-mail</label></div>
            <input id="a-email" name="email" type="email" autocomplete="username" inputmode="email" autocapitalize="off" spellcheck="false" required maxlength="254" value="${esc(etat.email)}" placeholder="vous@exemple.fr">
          </div>
          ${champMdp('mdp', 'Mot de passe', creer ? 'new-password' : 'current-password', creer ? '' : '<button type="button" class="a-lien" data-oubli>Mot de passe oublié ?</button>')}
          <p class="a-err" role="alert" hidden></p>
          <button class="a-btn" type="submit">${creer ? 'Créer mon compte' : 'Se connecter'}</button>
          ${creer ? '<p class="a-legal">En créant un compte, vous acceptez les <a href="/cgv/">conditions générales</a> et la <a href="/confidentialite/">politique de confidentialité</a>. Nous vous enverrons un code pour vérifier votre adresse.</p>' : ''}
        </form>
        ${creer ? '' : `<div class="a-ou"><span>ou</span></div>
        <button class="a-btn a-btn2" type="button" data-code>Recevoir un code par e-mail</button>`}
        <p class="a-bascule">${creer ? 'Déjà un compte ? <button type="button" class="a-lien" data-m="connexion">Se connecter</button>' : 'Pas encore de compte ? <button type="button" class="a-lien" data-m="creer">Créer un compte</button>'}</p>
      </div>
      ${ASIDE}
    </div>`;
    const f = el.querySelector('#f'), err = f.querySelector('.a-err'), btn = f.querySelector('.a-btn');
    const iEmail = f.email, iMdp = f.mdp;
    brancherMdp(f);
    if (creer) aideCreation(iMdp, () => iEmail.value.trim());
    iEmail.addEventListener('input', () => { etat.email = iEmail.value.trim(); });
    const montrer = (t, champ) => {
      err.textContent = t; err.hidden = false;
      [iEmail, iMdp].forEach(i => i.removeAttribute('aria-invalid'));
      if (champ) { champ.setAttribute('aria-invalid', 'true'); champ.focus(); }
    };
    el.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => { etat.email = iEmail.value.trim(); auth(b.dataset.m); }));
    const emailOk = () => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(iEmail.value.trim());
    f.addEventListener('submit', async e => {
      e.preventDefault(); err.hidden = true;
      const email = iEmail.value.trim(), mdp = iMdp.value;
      if (!emailOk()) return montrer('Indiquez une adresse e-mail valide.', iEmail);
      if (!mdp) return montrer('Indiquez votre mot de passe.', iMdp);
      if (creer) {
        const c = criteres(mdp, email);
        if (!c.long) return montrer(`Choisissez un mot de passe d'au moins ${MIN} caractères.`, iMdp);
        if (!c.perso) return montrer('Le mot de passe ne doit pas reprendre votre e-mail.', iMdp);
      }
      btn.disabled = true; btn.classList.add('charge'); btn.setAttribute('aria-busy', 'true');
      const r = await api('POST', creer ? '/compte/inscription' : '/compte/connexion', {email, mdp}).catch(() => ({j: {erreur: 'Le service ne répond pas. Vérifiez votre connexion et réessayez.'}}));
      btn.disabled = false; btn.classList.remove('charge'); btn.removeAttribute('aria-busy');
      if (!r.ok) { if (!creer) iMdp.value = ''; return montrer(r.j.erreur || 'Erreur.', r.j.champ === 'mdp' || !creer ? iMdp : null); }
      etat.email = email;
      if (creer) { iMdp.value = ''; etat.usage = 'creer'; etat.renvoi = Date.now(); return auth('code'); }
      demarrer();
    });
    const envoyerCode = async () => {
      err.hidden = true;
      if (!emailOk()) return montrer('Indiquez d\'abord votre adresse e-mail.', iEmail);
      const email = iEmail.value.trim();
      const r = await api('POST', '/compte/code', {email}).catch(() => ({j: {erreur: 'Le service ne répond pas.'}}));
      if (!r.ok) return montrer(r.j.erreur || 'Envoi impossible.', iEmail);
      etat.email = email; etat.usage = 'entrer'; etat.renvoi = Date.now(); auth('code');
    };
    el.querySelectorAll('[data-code],[data-oubli]').forEach(b => b.addEventListener('click', envoyerCode));
    (iEmail.value ? iMdp : iEmail).focus();
  }

  function vueCode() {
    const creer = etat.usage === 'creer';
    el.innerHTML = `<div class="a-grille">
      <div class="a-carte">
        <button type="button" class="a-retour" data-retour>← ${creer ? 'Modifier l\'adresse' : 'Retour'}</button>
        <h1>Vérifiez vos e-mails</h1>
        <p class="a-sous">${creer ? 'Si cette adresse peut recevoir un compte, un code à 6 chiffres vient de partir' : 'Si un compte existe pour cette adresse, un code à 6 chiffres vient de partir'} vers <b>${esc(etat.email)}</b>. Il est valable 15 minutes.</p>
        <form id="fc" novalidate>
          <div class="a-champ">
            <div class="a-lab"><label for="a-code">Code reçu par e-mail</label></div>
            <input id="a-code" class="a-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="7" required placeholder="000000">
          </div>
          <p class="a-err" role="alert" hidden></p>
          <button class="a-btn" type="submit">${creer ? 'Valider et créer mon compte' : 'Me connecter'}</button>
        </form>
        <p class="a-aide-code">Rien reçu ? Regardez dans les indésirables. <button type="button" class="a-lien" data-renvoi></button></p>
      </div>
      ${ASIDE}
    </div>`;
    const f = el.querySelector('#fc'), i = f.code, err = f.querySelector('.a-err'), btn = f.querySelector('.a-btn'), rv = el.querySelector('[data-renvoi]');
    el.querySelector('[data-retour]').addEventListener('click', () => auth(creer ? 'creer' : 'connexion'));
    const tic = () => {
      const s = Math.max(0, 60 - Math.round((Date.now() - etat.renvoi) / 1000));
      rv.disabled = s > 0; rv.textContent = s > 0 ? `Renvoyer un code dans ${s} s` : 'Renvoyer un code';
      if (!s) clearInterval(minuteur);
    };
    tic(); minuteur = setInterval(tic, 1000);
    rv.addEventListener('click', async () => {
      if (creer) { auth('creer'); el.querySelector('#a-mdp').focus(); err.hidden = true; return; } // le mot de passe n'est pas gardé : on le redemande
      const r = await api('POST', '/compte/code', {email: etat.email}).catch(() => ({j: {}}));
      if (!r.ok) { err.textContent = r.j.erreur || 'Envoi impossible.'; err.hidden = false; return; }
      etat.renvoi = Date.now(); clearInterval(minuteur); tic(); minuteur = setInterval(tic, 1000);
      err.hidden = true; i.value = ''; i.focus();
    });
    let envoi = false;
    const valider = async () => {
      if (envoi) return;
      const code = i.value.replace(/\D/g, '');
      if (code.length !== 6) { err.textContent = 'Le code compte 6 chiffres.'; err.hidden = false; i.focus(); return; }
      envoi = true; btn.disabled = true; btn.classList.add('charge'); err.hidden = true;
      const r = await api('POST', '/compte/verifier', {email: etat.email, code, usage: etat.usage}).catch(() => ({j: {erreur: 'Le service ne répond pas.'}}));
      envoi = false; btn.disabled = false; btn.classList.remove('charge');
      if (!r.ok) { err.textContent = r.j.erreur || 'Code incorrect.'; err.hidden = false; i.setAttribute('aria-invalid', 'true'); i.select(); return; }
      clearInterval(minuteur);
      if (r.j.nouveau) nouveauCompte = true;
      if (etat.usage === 'entrer') proposerMdp = true;
      demarrer();
    };
    i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 6); i.removeAttribute('aria-invalid'); if (i.value.length === 6) valider(); });
    f.addEventListener('submit', e => { e.preventDefault(); valider(); });
    i.focus();
  }
  let nouveauCompte = false, proposerMdp = false;

  // ---------- tableau de bord ----------
  function tableau(d) {
    const choisirMdp = q.get('mdp') === '1' || !d.compte.motDePasse || changer || proposerMdp;
    const w = el.closest('.wrap'); if (w) w.classList.remove('a-large');
    el.innerHTML = `<p class="eyebrow">${esc(d.compte.email)}</p>
      <h1>Mes projets</h1>
      ${nouveauCompte ? '<p class="ok-msg">Bienvenue, votre compte est créé et votre adresse e-mail vérifiée.</p>' : ''}
      ${q.get('confirme') ? '<p class="ok-msg">Merci, votre adresse e-mail est confirmée.</p>' : ''}
      ${nouveau ? '<p class="ok-msg">Votre projet est enregistré.</p>' : ''}
      ${alerte ? `<p class="form-err">${esc(alerte)}</p>` : ''}
      ${choisirMdp ? `<form class="carte" id="fm" novalidate style="margin-top:16px">
          <b>${proposerMdp && d.compte.motDePasse ? 'Mot de passe oublié ? Choisissez-en un nouveau' : d.compte.motDePasse ? 'Choisissez un nouveau mot de passe' : 'Choisissez votre mot de passe'}</b>
          <p class="note">${proposerMdp ? 'Vous êtes connecté avec un code. Ce formulaire reste disponible 15 minutes. Sinon, ignorez-le.' : 'Pour vous reconnecter sans e-mail, depuis n\'importe quel appareil.'} Vos autres appareils seront déconnectés.</p>
          <input type="email" autocomplete="username" value="${esc(d.compte.email)}" hidden>
          ${changer ? '<label class="field"><span>Mot de passe actuel</span><input name="ancien" type="password" autocomplete="current-password" required></label>' : ''}
          <label class="field"><span>${changer ? 'Nouveau mot de passe' : 'Mot de passe'}</span><input name="mdp" type="password" autocomplete="new-password" minlength="${MIN}" maxlength="256" required><small>${MIN} caractères minimum. Le plus simple : 3 ou 4 mots sans rapport.</small></label>
          <p class="form-err" role="alert" hidden></p>
          <button class="btn blue-btn" type="submit">Enregistrer le mot de passe</button>
        </form>` : ''}
      <div id="cmds"></div><div id="sims"></div>
      <p style="margin-top:22px"><a class="btn ghost" href="/#projets">+ Nouveau projet</a></p>
      <h2>Mon compte</h2>
      <div class="carte rang ecart"><span>${esc(d.compte.email)}</span><span class="rang">${d.compte.motDePasse && !choisirMdp ? '<button class="lien" type="button" data-mdp>Changer le mot de passe</button>' : ''}<button class="lien" type="button" data-out>Se déconnecter</button><button class="lien" type="button" data-partout>Déconnecter tous mes appareils</button></span></div>`;
    nouveau = false; alerte = ''; nouveauCompte = false;
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
      if ([...fm.mdp.value].length < MIN) { err.textContent = `Au moins ${MIN} caractères.`; err.hidden = false; fm.mdp.focus(); return; }
      const r = await api('POST', '/compte/mot-de-passe', {mdp: fm.mdp.value, ancien: fm.ancien ? fm.ancien.value : undefined});
      if (!r.ok) { err.textContent = r.j.erreur || 'Erreur.'; err.hidden = false; return; }
      history.replaceState(null, '', '/espace/'); q.delete('mdp'); changer = false; proposerMdp = false;
      fm.outerHTML = '<p class="ok-msg">Mot de passe enregistré.</p>';
    });
    const bm = el.querySelector('[data-mdp]');
    if (bm) bm.addEventListener('click', () => { changer = true; tableau(d); el.querySelector('#fm [name=ancien]').focus(); });
    el.querySelector('[data-out]').addEventListener('click', async () => { await api('POST', '/compte/deconnexion', {}); location.href = '/'; });
    el.querySelector('[data-partout]').addEventListener('click', async () => {
      if (!confirm('Déconnecter ce compte sur tous les appareils, y compris celui-ci ?')) return;
      await api('POST', '/compte/deconnexion', {partout: true}); location.href = '/espace/';
    });
  }

  demarrer();
})();
