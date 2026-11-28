/* Suivi des visites, sans cookie : envoie au site lui-même la page vue et le site d'origine.
   Rien n'est écrit dans le navigateur, rien ne part chez un tiers. Le serveur ne garde que des totaux par jour.
   Opposition : lien « Ne pas compter mes visites » de la page Confidentialité (choix gardé dans ce navigateur). */
(() => {
  const CLE = 'lbp-sans-mesure';
  const refuse = () => { try { return localStorage.getItem(CLE) === '1'; } catch (e) { return false; } };
  const envoyer = o => {
    if (refuse() || navigator.globalPrivacyControl || navigator.doNotTrack === '1') return;
    try { const t = JSON.stringify(o); if (!(navigator.sendBeacon && navigator.sendBeacon('/api/v', t))) fetch('/api/v', {method: 'POST', body: t, keepalive: true}); } catch (e) {}
  };
  // Étapes du simulateur (ouvert, prix affiché, clic sur Continuer) : appelées par app.js.
  window.bpMesure = e => envoyer({e});
  const q = new URLSearchParams(location.search);
  let r = ''; try { r = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) {}
  envoyer({p: location.pathname, r, u: q.get('utm_source') || '', c: q.get('utm_campaign') || '', g: q.has('gclid') || q.has('gbraid') || q.has('wbraid') ? 1 : 0});
  // Présence : un battement par minute tant que la page est visible, 30 min au plus (pour « en ce moment » dans l'espace équipe).
  let battements = 0;
  const battre = () => { if (document.visibilityState === 'visible' && battements < 30) { battements++; envoyer({h: 1}); } };
  setInterval(battre, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') battre(); });

  // Page Confidentialité : bouton pour s'opposer, ou revenir sur son choix.
  const b = document.querySelector('[data-mesure]');
  if (b) {
    const dire = () => { b.textContent = refuse() ? 'Vos visites ne sont pas comptées. Les compter à nouveau' : 'Ne pas compter mes visites'; };
    b.addEventListener('click', () => { try { if (refuse()) localStorage.removeItem(CLE); else localStorage.setItem(CLE, '1'); } catch (e) {} dire(); });
    dire();
  }
})();
