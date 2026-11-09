/* Consentement aux cookies publicitaires (Google Ads).
   - Rien ne se passe si aucun identifiant Google Ads n'est configuré (attribut data-ads absent sur <html>).
   - Aucune balise Google n'est chargée avant un clic sur « Accepter » (mode de base).
   - Le choix, accepté ou refusé, est gardé 6 mois (recommandation CNIL), puis redemandé.
   - Un lien portant l'attribut data-cookies (pied de page) rouvre le bandeau à tout moment. */
(() => {
  const ID = document.documentElement.dataset.ads;
  if (!ID) return;
  const CLE = 'lbp-consentement', DUREE = 182 * 24 * 3600 * 1000;
  const lire = () => { try { const c = JSON.parse(localStorage.getItem(CLE)); return c && Date.now() - c.t < DUREE ? c.v : null; } catch (e) { return null; } };
  const ecrire = v => { try { localStorage.setItem(CLE, JSON.stringify({v, t: Date.now()})); } catch (e) {} };

  let charge = false;
  function chargerGoogle() {
    if (charge) return; charge = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { dataLayer.push(arguments); };
    gtag('consent', 'default', {ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'denied', analytics_storage: 'denied'});
    gtag('js', new Date());
    gtag('config', ID);
    const s = document.createElement('script');
    s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(ID);
    document.head.appendChild(s);
  }

  let bandeau;
  function afficher() {
    if (bandeau) { bandeau.hidden = false; return; }
    const base = document.documentElement.dataset.base || '';
    bandeau = document.createElement('div');
    bandeau.className = 'cookies'; bandeau.setAttribute('role', 'dialog'); bandeau.setAttribute('aria-label', 'Cookies');
    bandeau.innerHTML = `<p>On aimerait savoir quelles publicités Google vous ont amené ici, pour ne payer que celles qui servent. Cela dépose un cookie Google. Rien n'est déposé si vous refusez. <a href="${base}confidentialite/#cookies">En savoir plus</a></p>
      <div><button type="button" class="btn ghost" data-c="non">Refuser</button><button type="button" class="btn ghost" data-c="oui">Accepter</button></div>`;
    bandeau.addEventListener('click', e => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      ecrire(b.dataset.c); bandeau.hidden = true;
      if (b.dataset.c === 'oui') chargerGoogle();
      else {
        // Retrait ou refus : on efface les cookies Google déjà déposés, puis on recharge si la balise tournait.
        document.cookie.split(';').map(c => c.trim().split('=')[0]).filter(n => /^(_gcl|_ga|_gid)/.test(n))
          .forEach(n => { document.cookie = n + '=; Max-Age=0; path=/'; document.cookie = n + '=; Max-Age=0; path=/; domain=.' + location.hostname.replace(/^www\./, ''); });
        if (charge) location.reload();
      }
    });
    document.body.appendChild(bandeau);
  }

  document.addEventListener('click', e => { const l = e.target.closest('[data-cookies]'); if (l) { e.preventDefault(); afficher(); } });
  const choix = lire();
  if (choix === 'oui') chargerGoogle(); else if (choix === null) afficher();
})();
