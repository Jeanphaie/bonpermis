#!/usr/bin/env python3
"""Génère le site Le Bon Permis dans site/ à partir de src/.

    python3 src/build.py

Sources :
  src/data.json     projets, groupes, services, « ce qu'on vous demandera » (partagé avec le simulateur)
  src/pages.json    contenu des pages projet (règles, sources officielles, prix)
  src/accueil.html  contenu de l'accueil ({{TUILES}} remplacé par la grille des projets)
  src/style.css, src/app.js
Sortie : site/index.html, site/<page>/index.html, site/assets/, site/sitemap.xml, site/robots.txt
Les images de site/img/ ne sont pas touchées.
"""
import json, html, shutil
from pathlib import Path

SRC = Path(__file__).resolve().parent
SITE = SRC.parent / 'site'
DOMAINE = 'https://bonpermis.fr'
EMAIL = 'contact@bonpermis.fr'
TEL = '01 84 16 65 53'
TEL_HREF = 'tel:+33184166553'
# Identifiant Google Ads (AW-XXXXXXXXXX). Vide = aucune balise, aucun bandeau cookies, politique « pas de cookie publicitaire ».
ADS_ID = ''
LEGAL = [('mentions-legales', 'Mentions légales'), ('cgv', 'Conditions générales de vente'), ('confidentialite', 'Politique de confidentialité')]

D = json.loads((SRC / 'data.json').read_text(encoding='utf-8'))
PG = json.loads((SRC / 'pages.json').read_text(encoding='utf-8'))
P, GROUPS, SVCS, NEED = D['P'], D['GROUPS'], D['SVCS'], D['NEED']
PAGES, SOURCES, MAJ = PG['pages'], PG['_sources'], PG['_maj']
URL = {k: v['slug'] for k, v in PAGES.items()}
REGUL_IMG = '38-regularisation'

MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
def date_txt(iso):
    y, m, d = iso.split('-')
    return f"{int(d)} {MOIS[int(m) - 1]} {y}"


MAJ_TXT = date_txt(MAJ)


def maj(k):
    # Date de dernière relecture propre à une page (champ « maj » de pages.json), sinon la date générale.
    return PAGES.get(k, {}).get('maj', MAJ)

# Prix de base par projet (pour les données structurées). Même grille que le simulateur.
BASE = {'petits': 149, 'ext': 149, 'agrandir': 349, 'garage': 319, 'toit': 149, 'maison': 590,
        'usage': 349, 'demol': 149, 'cu': 89, 'modif': 249, 'daact': 49}

e = lambda s: html.escape(s, quote=True)


def nom(k):
    if k == 'regul':
        return 'Déclarer des travaux déjà faits'
    return PAGES.get(k, {}).get('n') or P[k]['n']


def img(k):
    if k == 'regul':
        return REGUL_IMG
    return PAGES.get(k, {}).get('img') or P[k]['img']


def head(titre, desc, chemin, base, jsonld):
    url = DOMAINE + '/' + chemin
    ld = '\n'.join(f'<script type="application/ld+json">{json.dumps(j, ensure_ascii=False)}</script>' for j in jsonld)
    return f'''<!DOCTYPE html>
<html lang="fr" data-base="{base}"{f' data-ads="{ADS_ID}"' if ADS_ID else ''}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(titre)}</title>
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/favicon-192.png" type="image/png" sizes="192x192">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="website">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="Le Bon Permis">
<meta property="og:title" content="{e(titre)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{url}">
<link rel="preload" href="{base}assets/fonts/geist.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="{base}assets/style.css">
{ld}
</head>
'''


def entete(base, accueil, simu=None):
    a = '' if accueil else base
    logo = '#top' if accueil else (base or './')
    liens = f'''<a href="{a}#projets">Projets</a>
      <a href="{base}plan-de-masse/">Plan de masse</a>
      <a href="{base}regularisation-avant-vente/">Avant une vente</a>
      <a href="{a}#comment">Comment ça marche</a>
      <a href="{a}#tarifs">Tarifs</a>
      <a href="{a}#faq">Questions</a>'''
    # Sur une page projet, « Commencer » ouvre directement le simulateur de ce projet.
    cta = (f'<button class="btn" type="button" data-p="{simu}">Mon prix</button>' if simu
           else f'<a class="btn{" js-start" if accueil else ""}" href="{a}#projets">Commencer</a>')
    return f'''<header class="top">
  <div class="wrap">
    <a class="logo" href="{logo}" aria-label="Le Bon Permis, accueil">
      <img src="/img/logo-le-bon-permis.png" alt="Le Bon Permis" width="198" height="22">
    </a>
    <nav class="links" aria-label="Sections">
      {liens}
    </nav>
    <div class="top-act"><a class="tel-lien" href="{TEL_HREF}" aria-label="Appeler Le Bon Permis au {TEL}"><i><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg></i><span><small>Une question ?</small>{TEL}</span></a><a class="espace-lien" href="/espace/" aria-label="Mon espace"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg><span>Mon espace</span></a>
    {cta}
    <details class="mnav"><summary aria-label="Menu"><span></span><span></span><span></span></summary><nav aria-label="Sections">{liens}<a href="/espace/">Mon espace</a><a href="{TEL_HREF}"><b>{TEL}</b></a></nav></details></div>
  </div>
</header>
'''


def pied(base):
    cols = []
    for g in GROUPS:
        cols.append((g['t'], g['k']))
    cols.append(('Les autres démarches', [s['k'] for s in SVCS] + [k for k in PAGES if k not in P and k != 'regul']))
    blocs = ''.join(
        f'<div><b>{e(t)}</b><ul>' + ''.join(f'<li><a href="{base}{URL[k]}/">{e(nom(k))}</a></li>' for k in ks if k in URL) + '</ul></div>'
        for t, ks in cols)
    blocs += f'<div><b>Outils</b><ul><li><a href="{base}plan-de-situation/">Plan de situation gratuit</a></li><li><a href="{base}plan-de-masse/">Plan de masse en ligne</a></li></ul></div>'
    return f'''<footer>
  <div class="wrap">
    <nav class="plan" aria-label="Tous les projets">{blocs}</nav>
    <div class="legal">
      <span>© 2026 Le Bon Permis, un service de LK Invest. Entreprise privée, sans lien avec les administrations.</span>
      <span><a href="{TEL_HREF}">{TEL}</a> · <a href="mailto:{EMAIL}">{EMAIL}</a> · <a href="{base}mentions-legales/">Mentions légales</a> · <a href="{base}cgv/">CGV</a> · <a href="{base}confidentialite/">Confidentialité</a>{' · <a href="#" data-cookies>Cookies</a>' if ADS_ID else ''}</span>
    </div>
  </div>
</footer>
'''


def barre_mobile(simu=None):
    cta = f'<button type="button" class="bm-prix" data-p="{simu}">Mon prix</button>' if simu else '<a class="bm-prix js-start" href="#projets">Mon prix</a>'
    return f'<div class="barre-mobile"><a class="bm-tel" href="{TEL_HREF}"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>{TEL}</a>{cta}</div>\n'

OVERLAY = '''
<!-- CONFIGURATEUR -->
<div class="overlay" id="overlay" hidden>
  <div class="panel" role="dialog" aria-modal="true" aria-labelledby="panelTitle">
    <div class="panel-top">
      <div class="proj"><img id="projImg" alt=""><span id="panelTitle"></span></div>
      <button class="x" id="closeBtn" type="button" aria-label="Fermer">×</button>
    </div>
    <div class="bar"><i id="barFill" style="width:0"></i></div>
    <div class="panel-body" id="panelBody"></div>
  </div>
</div>
'''


def scripts(base):
    cons = f'<script src="{base}assets/consentement.js"></script>\n' if ADS_ID else ''
    return f'<script src="{base}assets/data.js"></script>\n<script src="{base}assets/prix.js"></script>\n<script src="{base}assets/app.js"></script>\n{cons}</body>\n</html>\n'


def tuile(k, base, simu=True):
    p = P[k]
    sub = f"<small>{e(p['sub'])}</small>" if p.get('sub') else ''
    return (f'<a class="tile" href="{base}{URL[k]}/"' + (f' data-p="{k}"' if simu else '') + f'><img src="{base}img/{p["img"]}.webp" alt="" loading="lazy" width="480" height="480">'
            f'<span>{e(p["n"])}{sub}</span></a>')


def tuiles_accueil():
    out = []
    for g in GROUPS:
        out.append(f'<div class="group"><div class="group-h"><h3>{e(g["t"])}</h3><small>{e(g["s"])}</small></div>'
                   f'<div class="tiles">{"".join(tuile(k, "", False) for k in g["k"])}</div></div>')
    svc = ''.join(f'<a class="svc" href="{URL[s["k"]]}/"><b>{e(s["n"])}</b><span>{e(s["d"])}</span><em>{e(s["p"])}</em></a>' for s in SVCS)
    out.append(f'<div class="group"><div class="group-h"><h3>Les autres démarches</h3><small>Avant, pendant ou après les travaux</small></div><div class="svcs">{svc}</div></div>')
    return ''.join(out)


ORGA = {"@type": "Organization", "@id": DOMAINE + "/#org", "name": "Le Bon Permis", "url": DOMAINE + "/",
        "description": "Dossiers de déclaration préalable et de permis de construire pour les particuliers, partout en France. Un service de LK Invest.",
        "parentOrganization": {"@type": "Organization", "name": "LK Invest"}, "areaServed": "FR", "telephone": "+33184166553", "email": EMAIL}


def faq_ld(src):
    import re
    qs = re.findall(r'<details><summary>(.*?)</summary><p>(.*?)</p></details>', src, re.S)
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": html.unescape(q), "acceptedAnswer": {"@type": "Answer", "text": html.unescape(r)}} for q, r in qs]}


def accueil():
    corps = (SRC / 'accueil.html').read_text(encoding='utf-8').replace('{{TUILES}}', tuiles_accueil())
    ld = [{"@context": "https://schema.org", **ORGA},
          {"@context": "https://schema.org", "@type": "WebSite", "name": "Le Bon Permis", "url": DOMAINE + "/", "inLanguage": "fr-FR"},
          faq_ld(corps)]
    titre = 'Le Bon Permis : déclaration préalable et permis de construire en ligne'
    desc = ("Abri, piscine, extension, véranda : envoyez votre projet, même en croquis. On vérifie qu'il respecte le PLU de votre commune, "
            "puis on trace les plans et on remplit le dossier de mairie. Prix connu en une minute, prêt en 48 h.")
    return head(titre, desc, '', '', ld) + '<body>\n\n' + entete('', True) + '\n' + corps + '\n' + pied('') + OVERLAY + '<script src="assets/adresse.js"></script>\n' + scripts('')


def page(k):
    c, base, slug = PAGES[k], '../', URL[k]
    n = nom(k)
    need = NEED.get(k)
    simu = c.get('simu', k)  # projet ouvert dans le simulateur (une page peut en ouvrir un autre)
    if simu == 'regul':
        need = ['Ce qui a été construit : type, dimensions, matériaux, et la date approximative des travaux',
                'Les dimensions de ce qui existe et la distance aux limites du terrain',
                'Des photos de ce qui est construit, la maison vue de la rue, le terrain vu de loin']
    regles = ''.join(f'<tr><th scope="row">{e(a)}</th><td>{e(b)}</td></tr>' for a, b in c['regles'])
    srcs = ' · '.join(f'<a href="{SOURCES[s][1]}" rel="noopener" target="_blank">{e(SOURCES[s][0])}</a>' for s in c['sources'])
    liens = ''.join(tuile(l, base, False) if l in P else (
        f'<a class="tile" href="{base}{URL[l]}/"><img src="{base}img/{img(l)}.webp" alt="" loading="lazy" width="480" height="480"><span>{e(nom(l))}</span></a>'
        if l in PAGES else '') for l in c['liens'])
    # Sections facultatives : étapes, erreurs fréquentes, FAQ (avec balisage FAQPage)
    etapes_html = '' if not c.get('etapes') else (
        f'<h2 class="mt">{e(c.get("etapes_titre", "Comment ça se passe"))}</h2><ol class="steps-list">'
        + ''.join(f'<li><b>{e(t)}</b> {e(x)}</li>' for t, x in c['etapes']) + '</ol>')
    erreurs_html = '' if not c.get('erreurs') else (
        f'<h2 class="mt">{e(c.get("erreurs_titre", "Les erreurs qui bloquent un dossier"))}</h2><ul class="need-list">'
        + ''.join(f'<li>{e(x)}</li>' for x in c['erreurs']) + '</ul>')
    faq_html = '' if not c.get('faq') else (
        '<section id="faq" class="page-sec alt"><div class="wrap narrow"><h2>Questions fréquentes</h2><div class="faq">'
        + ''.join(f'<details><summary>{e(q)}</summary><p>{e(r)}</p></details>' for q, r in c['faq']) + '</div></div></section>')
    blocs_html = ''.join(f'<h2 class="mt">{e(t)}</h2>' + ''.join(f'<p class="lead">{e(x)}</p>' for x in paras)
                         for t, paras in c.get('blocs', []))
    if blocs_html.startswith('<h2 class="mt">'):
        blocs_html = '<h2>' + blocs_html[len('<h2 class="mt">'):]
    # Exemple de dossier réel (avec l'accord écrit du client, données personnelles masquées) : planches cliquables
    ex = c.get('exemple')
    exemple_html = '' if not ex else (
        f'<section id="exemple" class="page-sec alt"><div class="wrap"><h2>{e(ex["titre"])}</h2>'
        + ''.join(f'<p class="lead">{e(x)}</p>' for x in ex['intro'])
        + '<div class="planches">' + ''.join(
            f'<figure><a href="../img/{ex["dossier"]}/{f}.webp" target="_blank" rel="noopener"><img src="../img/{ex["dossier"]}/{f}-p.webp" alt="{e(code)} : {e(nom_p)}, exemple réel" loading="lazy" width="720" height="509"></a>'
            f'<figcaption><b>{e(code)}</b> {e(nom_p)}<span>{e(leg)}</span></figcaption></figure>' for f, code, nom_p, leg in ex['planches'])
        + f'</div><p class="rules-src">{e(ex["note"])}</p></div></section>')
    blocs_sup = '' if not (blocs_html or etapes_html or erreurs_html) else f'<section class="page-sec"><div class="wrap narrow">{blocs_html}{etapes_html}{erreurs_html}</div></section>'
    gar_t, gar_p = c.get('garantie', ["Si la mairie dit non à cause de nous, on reprend tout, sans frais.",
                                      "Un refus ou une pièce manquante à cause d'une erreur dans le dossier ? On corrige et on redépose, sans rien vous facturer."])
    cta_txt = c.get('cta_txt', f"Dossier prêt en {c['delai']} après réception de vos photos. Près d'un monument : + 149 €. En copropriété : + 99 €.")
    # Plusieurs cas de prix (déclaration ou permis...) : une case par cas, jamais deux prix dans la même phrase
    offres = c.get('offres')
    if offres:
        faits_prix = ''.join(f'<span><b>{e(p)}</b>{e(t)}</span>' for p, t in offres)
        cta_prix = 'Dès ' + offres[0][0]
        cta_lignes = '<ul class="cta-offres">' + ''.join(f'<li><b>{e(p)}</b> {e(t)}</li>' for p, t in offres) + '</ul>'
        if 'cta_txt' not in c:
            cta_txt = "Délais comptés à partir de la réception de vos photos. Prix TTC, tout compris. Près d'un monument : + 149 €. En copropriété : + 99 €."
    else:
        faits_prix = f"<span><b>{e(c['prix'])}</b>Prix TTC tout compris</span><span><b>{e(c['delai'])}</b>Dossier prêt</span>"
        cta_prix, cta_lignes = c['prix'], ''
    need_html = '' if not need else (
        '<ul class="need-list">' + ''.join(f'<li><i>{t}</i>{e(x)}</li>' for t, x in zip(['Le projet', 'Les mesures', 'Les photos'], need)) + '</ul>')
    cat = 'regul' if simu == 'regul' else P[simu]['cat']
    prix_num = BASE.get(cat, 149)
    ld = [
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Le Bon Permis", "item": DOMAINE + "/"},
            {"@type": "ListItem", "position": 2, "name": n, "item": f"{DOMAINE}/{slug}/"}]},
        {"@context": "https://schema.org", "@type": "Service", "name": c['h1'], "serviceType": "Préparation de dossier d'urbanisme",
         "provider": {"@id": DOMAINE + "/#org"}, "areaServed": "FR",
         "offers": {"@type": "Offer", "price": str(prix_num), "priceCurrency": "EUR"}},
    ]
    if c.get('faq'):
        ld.append({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": r}} for q, r in c['faq']]})
    titre = c['titre']
    corps = f'''<main id="top">
<section class="page-hero">
  <div class="wrap page-grid">
    <div>
      <nav class="crumbs" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <a href="../#projets">Projets</a> › <span>{e(n)}</span></nav>
      <h1>{e(c['h1'])}</h1>
      <p class="answer">{e(c['chapo'])}</p>
      <div class="hero-cta">
        <button class="btn blue-btn" type="button" data-p="{simu}">{e(c.get("cta", "Voir mon prix en une minute"))}</button>
        <a class="btn ghost" href="#regles">Les règles en détail</a>
      </div>
      <div class="facts">{faits_prix}<span><b>{e(c.get("fait3", ["Sans frais", "Si refus de notre fait"])[0])}</b>{e(c.get("fait3", ["Sans frais", "Si refus de notre fait"])[1])}</span></div>
    </div>
    <div class="page-art"><img src="../img/{img(k)}.webp" alt="{e(n)} : illustration du projet" width="480" height="480" fetchpriority="high"></div>
  </div>
</section>

<section id="regles" class="page-sec">
  <div class="wrap narrow">
    <h2>Quelle démarche pour votre projet ?</h2>
    <table class="rules"><thead><tr><th scope="col">Votre situation</th><th scope="col">Ce qu'il faut</th></tr></thead><tbody>{regles}</tbody></table>
    <p class="rules-note">{e(c['note'])}</p>
    <p class="rules-src">Règles générales du code de l'urbanisme. Le plan local d'urbanisme de votre commune peut être plus strict : on le vérifie avec votre adresse avant de dessiner. Sources : {srcs}. Mis à jour le {date_txt(maj(k))}.</p>
  </div>
</section>

<section class="page-sec alt">
  <div class="wrap narrow">
    <h2>Ce qu'on vous demandera</h2>
    <p class="lead">Votre projet, sous la forme que vous avez : un croquis à main levée suffit. Vous l'envoyez après le paiement, depuis votre téléphone, avec un guide pas à pas.</p>
    {need_html}
    <h2 class="mt">Ce qu'on fait pour vous</h2>
    <p class="lead">D'abord, on étudie en entier le plan local d'urbanisme qui s'applique à votre terrain : le règlement de votre zone, les chapitres communs, le lexique, les protections. Distances aux voisins, hauteur, emprise, clôtures, couleurs : votre projet est confronté à chaque règle. Si votre projet ne passe pas tel quel, on vous le dit avant de commencer, avec la règle qui bloque : vous décidez de ce que vous changez. Ensuite on trace à l'échelle, d'après votre croquis et vos mesures, tous les plans demandés par la mairie, et on remplit le formulaire officiel. Une deuxième personne relit tout. Vous n'avez plus qu'à déposer, ou on dépose pour vous.</p>
    <div class="cta-box">
      <div><b>{e(cta_prix)}</b>{cta_lignes}<span>{e(cta_txt)}</span></div>
      <button class="btn blue-btn" type="button" data-p="{simu}">Voir mon prix exact</button>
    </div>
  </div>
</section>
{exemple_html}{blocs_sup}
{faq_html}
<section class="page-sec">
  <div class="wrap">
    <div class="guarantee">
      <div class="seal"><svg width="30" height="30" viewBox="0 0 30 30"><path d="M8 15.5l4.5 4.5L22 10" fill="none" stroke="var(--accent)" stroke-width="3"/></svg></div>
      <div>
        <h3>{e(gar_t)}</h3>
        <p>{e(gar_p)}</p>
      </div>
    </div>
    <h2 class="mt">Projets proches</h2>
    <div class="tiles related">{liens}</div>
  </div>
</section>
</main>
'''
    return head(titre, c['desc'], slug + '/', base, ld) + f'<body data-page="{simu}">\n\n' + entete(base, False, simu if simu in P or simu == 'regul' else None) + '\n' + corps + '\n' + pied(base) + OVERLAY + scripts(base)


COOKIES_SANS = ("<p>Le site n'utilise pas de cookie publicitaire ni de mesure d'audience. Seuls des cookies techniques servent à garder "
                "votre session ouverte quand vous vous connectez à votre espace : ils sont indispensables et ne demandent pas d'accord. "
                "Si cela change, nous vous demanderons votre accord avant.</p>")
COOKIES_ADS = ("<p>Des cookies techniques servent à garder votre session ouverte quand vous vous connectez à votre espace : ils sont "
               "indispensables et ne demandent pas d'accord.</p>"
               "<p>Si vous l'acceptez, le site charge aussi la balise de Google Ads (Google Ireland Limited). Elle dépose des cookies "
               "qui nous disent quelle annonce vous a amené ici et si une commande a suivi, pour ne payer que les publicités utiles. "
               "Nous n'utilisons ni publicité personnalisée ni reciblage. Sans votre accord, rien n'est chargé ni déposé.</p>"
               "<p>Votre choix, accepté ou refusé, est gardé 6 mois, puis redemandé. Vous pouvez le changer à tout moment avec le lien "
               "« Cookies » en bas de chaque page : un refus efface les cookies Google déjà déposés. Pour savoir comment Google utilise "
               "ces données : <a href=\"https://policies.google.com/technologies/partner-sites?hl=fr\" rel=\"noopener\" target=\"_blank\">"
               "policies.google.com</a>.</p>")


def legale(slug, titre):
    base = '../'
    corps = (SRC / 'legal' / f'{slug}.html').read_text(encoding='utf-8').replace('{{EMAIL}}', EMAIL).replace('{{TEL}}', TEL).replace('{{TEL_HREF}}', TEL_HREF).replace('{{COOKIES}}', COOKIES_ADS if ADS_ID else COOKIES_SANS)
    html_ = f'''<main id="top">
<section class="page-sec legal-page">
  <div class="wrap narrow">
    <nav class="crumbs" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <span>{e(titre)}</span></nav>
    <h1>{e(titre)}</h1>
    <p class="rules-src">Mis à jour le {MAJ_TXT}.</p>
    {corps}
  </div>
</section>
</main>
'''
    desc = f"{titre} du site Le Bon Permis (bonpermis.fr), service de LK Invest."
    return head(f'{titre} | Le Bon Permis', desc, slug + '/', base, []) + '<body data-page="legal">\n\n' + entete(base, False) + '\n' + html_ + '\n' + pied(base) + OVERLAY + scripts(base)


def page_app(chemin, titre, desc, ident, script, large=False):
    """Pages de l'espace client et de l'équipe : coquille HTML, le contenu est rendu par le script."""
    base = '../' * chemin.count('/')
    if large:
        corps = f'<main id="top"><div id="{ident}"><p class="answer" style="padding:40px">Chargement…</p></div></main>\n'
    else:
        corps = f"""<main id="top">
<section class="esp">
  <div class="wrap narrow" id="{ident}" aria-live="polite">
    <h1>{e(titre)}</h1>
    <p class="answer">Chargement…</p>
  </div>
</section>
</main>
"""
    h = head(f'{titre} | Le Bon Permis', desc, chemin, base, [])
    h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">\n<meta name="referrer" content="same-origin">')
    h = h.replace('</head>', f'<link rel="stylesheet" href="{base}assets/espace.css">\n</head>')
    return h + f'<body data-page="{ident}">\n\n' + entete(base, False) + '\n' + corps + '\n' + (pied(base) if not large else '') + (f'<script src="{base}assets/plan.js"></script>\n' if script in ('espace-dossier.js', 'admin.js') else '') + (f'<script src="{base}assets/pdf-lib.min.js" defer></script>\n<script src="{base}assets/cerfa.js"></script>\n' if script == 'admin.js' else '') + (f'<script src="{base}assets/carte.js"></script>\n' if script == 'espace-dossier.js' else '') + f'<script src="{base}assets/{script}"></script>\n</body>\n</html>\n'


APPS = [
    ('commande/merci/', 'Votre commande', 'Confirmation de votre commande Le Bon Permis.', 'merci', 'merci.js', False),
    ('espace/', 'Mon espace', 'Vos projets et vos dossiers Le Bon Permis.', 'espace', 'espace.js', False),
    ('espace/dossier/', 'Mon dossier', 'Suivi de votre dossier Le Bon Permis.', 'dossier', 'espace-dossier.js', False),
    ('admin/', 'Espace équipe', 'Espace équipe Le Bon Permis.', 'admin', 'admin.js', True),
    ('dossier/', 'Mon dossier', 'Redirection vers votre espace.', 'dossier', 'dossier.js', False),
]


# Clé IndexNow (Bing) : pas un secret, elle doit être lisible à la racine du site. La même est dans deploy/maj.sh.
INDEXNOW = '57d73c89722b332c8c9376ec85d72e20'


def page_404():
    """Page servie par Nginx avec le code 404 pour toute adresse inconnue. Chemins absolus : elle s'affiche à n'importe quelle profondeur."""
    base = '/'
    liens = ''.join(f'<li><a href="/{URL[k]}/">{e(nom(k))}</a></li>' for k in ('extension', 'pergola', 'abri', 'piscine', 'garage', 'regul') if k in PAGES)
    corps = f'''<main id="top">
<section class="page-sec">
  <div class="wrap narrow">
    <h1>Cette page n'existe pas</h1>
    <p class="answer">L'adresse a changé ou contient une erreur. Voici où aller.</p>
    <div class="hero-cta"><a class="btn blue-btn" href="/">Retour à l'accueil</a><a class="btn ghost" href="/#projets">Tous les projets</a></div>
    <h2 class="mt">Quelques pages utiles</h2>
    <ul class="need-list">{liens}</ul>
  </div>
</section>
</main>
'''
    h = head('Page introuvable | Le Bon Permis', "Cette page n'existe pas sur bonpermis.fr.", '404.html', base, [])
    h = h.replace('<meta charset="utf-8">', '<meta charset="utf-8">\n<meta name="robots" content="noindex">')
    return h + '<body data-page="legal">\n\n' + entete(base, False) + '\n' + corps + '\n' + pied(base) + OVERLAY + scripts(base)


# ---------- page outil : plan de masse automatique ----------
PRIX_PLAN, PRIX_ETUDE = 29, 79  # les mêmes montants sont dans api/planvente.js (FORMULES)
PM_FAQ = [
    ("Qu'est-ce qu'un plan de masse ?",
     "C'est le terrain vu du dessus, à l'échelle : ses limites, les constructions qui existent, celle que vous voulez ajouter, avec ses dimensions et ses distances aux limites. C'est la pièce n° 2 du dossier (DP2 pour une déclaration préalable, PCMI2 pour un permis de construire)."),
    ("Que veut dire « coté dans les trois dimensions » ?",
     "Le plan doit donner la longueur, la largeur et la hauteur de la construction. Les deux premières se lisent sur le dessin, la hauteur est écrite à côté. C'est le code de l'urbanisme qui le demande (articles R. 431-9 et R. 431-36)."),
    ("Ce plan suffit-il pour déposer ma déclaration préalable ?",
     "Non. Vous avez deux pièces sur huit : le plan de masse et le plan de situation. Il faut aussi le formulaire officiel, le plan en coupe, les façades, l'insertion du projet et deux photos. Et il faut que le projet respecte le règlement de votre commune, ce que ce plan ne vérifie pas."),
    ("Le plan de situation est-il vraiment gratuit ?",
     "Oui. Il a sa propre page : vous tapez votre adresse, vous donnez votre e-mail, vous recevez le PDF. Il est aussi inclus en deuxième page du plan de masse."),
    ("Que contient l'étude du règlement, dans le plan vérifié ?",
     "Une personne de notre équipe lit le règlement de la zone où se trouve votre terrain, les chapitres auxquels il renvoie et son lexique, puis confronte votre projet à chaque règle : distances, hauteur, emprise, aspect. Vous recevez la réponse par e-mail sous 48 h ouvrées, avec la page du règlement pour chaque point. C'est la mairie qui décide en dernier."),
    ("D'où viennent les limites de mon terrain ?",
     "Du plan cadastral, et les bâtiments de la base de données de l'IGN. Ces données publiques peuvent s'écarter du terrain réel de 1 à 2 mètres. Le plan le précise : les cotes n'ont pas valeur de bornage. Si une distance est juste, à quelques centimètres près, seul un géomètre peut la garantir."),
    ("Et si je préfère que vous fassiez tout ?",
     "C'est notre dossier complet : on étudie le règlement de votre commune, on trace tous les plans à partir de votre croquis, on remplit le formulaire. Le prix du plan de masse est déduit pendant 30 jours."),
]


def page_plan_masse():
    base = '../'
    faq = ''.join(f'<details><summary>{e(q)}</summary><p>{e(r)}</p></details>' for q, r in PM_FAQ)
    ld = [
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Le Bon Permis", "item": DOMAINE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Plan de masse", "item": DOMAINE + "/plan-de-masse/"}]},
        {"@context": "https://schema.org", "@type": "Product", "name": "Plan de masse coté en ligne", "description": "Plan de masse coté dans les trois dimensions, au format PDF A3, généré à partir du cadastre.",
         "brand": {"@id": DOMAINE + "/#org"}, "offers": {"@type": "Offer", "price": str(PRIX_PLAN), "priceCurrency": "EUR", "availability": "https://schema.org/InStock"}},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": r}} for q, r in PM_FAQ]},
    ]
    corps = f"""<main id="top">
<section class="page-hero">
  <div class="wrap narrow">
    <nav class="crumbs" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <span>Plan de masse</span></nav>
    <h1>Votre plan de masse en 2 minutes</h1>
    <p class="answer">Tapez votre adresse. Posez votre projet. Les distances se calculent toutes seules.</p>
  </div>
  <div class="wrap">
    <div id="pm-outil" class="outil-carte" data-prix="{PRIX_PLAN}" data-etude="{PRIX_ETUDE}" data-dossier="149" aria-live="polite"><p class="pm-note">Chargement…</p></div>
    <p class="outil-sous">Aperçu gratuit · PDF prêt à déposer {PRIX_PLAN} € · <a href="../plan-de-situation/">Plan de situation gratuit</a></p>
  </div>
</section>

<section class="page-sec">
  <div class="wrap narrow">
    <h2>Notre vrai métier : lire le règlement de votre commune</h2>
    <p class="lead">N'importe quel outil dessine un plan. Ce qui fait accepter ou refuser un dossier, c'est le plan local d'urbanisme, le PLU : le règlement de votre commune. Il est différent dans chaque commune, il fait des dizaines de pages, et il se lit comme un texte de loi.</p>
    <ol class="steps-list">
      <li>On repère votre zone sur le plan de zonage, à partir de votre adresse.</li>
      <li>On lit le règlement de cette zone en entier, article par article.</li>
      <li>On lit les chapitres communs auxquels il renvoie : clôtures, toitures, stationnement, espaces verts.</li>
      <li>On lit le lexique : la façon dont la commune mesure une hauteur ou une emprise change le résultat.</li>
      <li>On vérifie les protections et les risques : monument historique, zone inondable, littoral.</li>
      <li>On confronte votre projet à chaque règle, et on vous dit ce qui passe et ce qui bloque, avec la page du règlement.</li>
    </ol>
    <p class="lead" style="margin-top:20px"><b>Un exemple réel.</b> À Tarnos, dans les Landes, en zone U40.9 : pas de mur plein en clôture, alors qu'il est admis dans les communes voisines. Emprise au sol limitée à 40 % du terrain, bâti existant compris. Toit plat autorisé ici, interdit dans d'autres communes du même plan. Ces règles tiennent en quelques lignes aux pages 34, 52 et 121 à 123 du règlement. Un projet qui en ignore une est refusé.</p>
    <p class="rules-src">Règlement écrit du PLUi du Seignanx, approuvé le 18 décembre 2025.</p>
    <h2 class="mt">Trois formules, chacune contient la précédente</h2>
    <table class="rules"><thead><tr><th scope="col">Formule</th><th scope="col">Ce que vous recevez</th><th scope="col">Prix</th></tr></thead><tbody>
      <tr><td><b>Le plan</b></td><td>Plan de masse coté et plan de situation, en PDF, tout de suite. Vous placez votre projet vous-même. Ne dit pas si le projet est autorisé.</td><td><b>{PRIX_PLAN} €</b></td></tr>
      <tr><td><b>Le plan vérifié</b></td><td>Le plan, et notre équipe étudie le règlement d'urbanisme de votre terrain : votre projet passe ou non, règle par règle, avec la page du règlement. Réponse sous 48 h ouvrées.</td><td><b>{PRIX_ETUDE} €</b></td></tr>
      <tr><td><b>Le dossier complet</b></td><td>On étudie le règlement, on trace tous les plans d'après votre croquis, on remplit le formulaire. Vous n'avez plus qu'à déposer. Prêt en 48 h.</td><td><b>Dès 149 €</b></td></tr>
    </tbody></table>
    <p class="rules-note">Ce que vous payez pour une formule est déduit si vous passez à la suivante dans les 30 jours. Le plan de situation seul est gratuit.</p>
    <h2 class="mt">Ce qu'il y a sur le plan</h2>
    <ul class="need-list">
      <li><i>Votre terrain</i>Ses limites d'après le cadastre, les parcelles voisines et leurs numéros, le nord et l'échelle.</li>
      <li><i>Ce qui existe</i>La maison et les autres constructions, d'après les relevés de l'IGN.</li>
      <li><i>Votre projet</i>À l'emplacement que vous choisissez, avec sa longueur, sa largeur et sa hauteur : les trois dimensions que demande la mairie. Abri, piscine, garage, extension collée à la maison, terrasse de forme libre, maison en plusieurs volumes.</li>
      <li><i>L'accès</i>Le côté du terrain qui donne sur la voie, repéré d'après votre adresse.</li>
      <li><i>Les distances</i>Aux limites du terrain et à la maison, calculées automatiquement.</li>
      <li><i>Les surfaces</i>Le terrain, l'emprise au sol existante, l'emprise créée et le total en pourcentage.</li>
      <li><i>Le plan de situation</i>En deuxième page : deux cartes de l'IGN, à deux échelles, avec votre terrain repéré. C'est la pièce n° 1 du dossier.</li>
    </ul>
    <h2 class="mt">Un plan juste peut quand même être refusé</h2>
    <p class="lead">Ce plan met votre projet au propre. Il ne dit pas s'il est autorisé, et il ne garantit rien.</p>
    <p class="lead">Ce que la mairie vérifie, c'est le plan local d'urbanisme, le PLU. Chaque commune a le sien, différent de celui de la commune voisine : distance aux limites, hauteur maximale et façon de la mesurer, emprise au sol autorisée, forme du toit, matériaux, couleurs, clôtures. Des dizaines de pages techniques, avec un lexique et des renvois d'un chapitre à l'autre.</p>
    <p class="lead">Si votre projet ne respecte pas une seule de ces règles, la mairie s'y oppose, même avec un plan parfaitement dessiné. Vous avez alors perdu le mois d'instruction et il faut redéposer un dossier corrigé. Aucun outil automatique, le nôtre compris, ne fait cette lecture à votre place.</p>
    <p class="lead">Ce plan ne remplace pas non plus un géomètre : les limites viennent du cadastre et n'ont pas valeur de bornage.</p>
    <div class="cta-box">
      <div><b>Pour savoir si ça passe avant de déposer : le dossier complet, dès 149 €</b><span>On étudie en entier le règlement de votre terrain et on vous dit si le projet passe, avant de tracer. Puis on fait tous les plans d'après votre croquis et on remplit le formulaire. Prêt en 48 h. Ce que vous avez payé pour le plan est déduit pendant 30 jours.</span></div>
      <a class="btn blue-btn" href="../#projets">Voir mon prix</a>
    </div>
  </div>
</section>

<section class="page-sec alt">
  <div class="wrap narrow">
    <h2>Un plan de masse fait par nous</h2>
    <p class="lead">Pour comparer : le plan de masse d'un vrai dossier de permis de construire, tracé par notre équipe, avec le calcul d'emprise demandé par le règlement de la commune. Données personnelles masquées, publié avec l'accord de la propriétaire.</p>
    <figure class="pm-ex"><a href="../img/exemple-extension/pcmi2-plan-de-masse.webp" target="_blank" rel="noopener"><img src="../img/exemple-extension/pcmi2-plan-de-masse-p.webp" alt="Plan de masse d'un dossier de permis de construire, exemple réel" loading="lazy" width="720" height="509"></a></figure>
    <p class="rules-src">Le plan de masse est exigé par le code de l'urbanisme : article R. 431-36 b pour une déclaration préalable, article R. 431-9 pour un permis de construire. Mis à jour le {date_txt('2026-11-11')}.</p>
  </div>
</section>

<section id="faq" class="page-sec">
  <div class="wrap narrow"><h2>Questions fréquentes</h2><div class="faq">{faq}</div></div>
</section>
</main>
"""
    h = head(f'Plan de masse en ligne : coté, à l\'échelle, {PRIX_PLAN} € | Le Bon Permis',
             f"Plan de masse coté dans les 3 dimensions pour déclaration préalable ou permis de construire. Posez votre projet sur votre terrain : aperçu et plan de situation gratuits, PDF prêt à déposer pour {PRIX_PLAN} €.",
             'plan-de-masse/', base, ld)
    h = h.replace('</head>', f'<link rel="stylesheet" href="{base}assets/espace.css">\n</head>')
    return (h + '<body data-page="legal">\n\n' + entete(base, False) + '\n' + corps + '\n' + pied(base) + OVERLAY
            + f'<script src="{base}assets/plan.js"></script>\n<script src="{base}assets/adresse.js"></script>\n<script src="{base}assets/plan-masse.js"></script>\n' + scripts(base))


PS_FAQ = [
    ("C'est quoi, un plan de situation ?",
     "Une carte qui montre où se trouve votre terrain dans la commune. C'est la pièce n° 1 du dossier : DP1 pour une déclaration préalable, PCMI1 pour un permis de construire."),
    ("Qu'est-ce que je reçois ?",
     "Un PDF au format A3 avec deux cartes de l'IGN, une large et une rapprochée, votre terrain entouré en rouge, le nord et l'échelle. Prêt à joindre à votre dossier."),
    ("C'est vraiment gratuit ?",
     "Oui. On vous demande seulement votre e-mail pour vous l'envoyer. Pas de compte, pas de carte bancaire."),
    ("Et après ?",
     "Il vous faut le plan de masse, les façades, la coupe, le formulaire. Et surtout un projet qui respecte le règlement de votre commune. On peut tout faire pour vous."),
]


def page_plan_situation():
    base = '../'
    faq = ''.join(f'<details><summary>{e(q)}</summary><p>{e(r)}</p></details>' for q, r in PS_FAQ)
    ld = [
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Le Bon Permis", "item": DOMAINE + "/"},
            {"@type": "ListItem", "position": 2, "name": "Plan de situation", "item": DOMAINE + "/plan-de-situation/"}]},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
            {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": r}} for q, r in PS_FAQ]},
    ]
    corps = f"""<main id="top">
<section class="page-hero">
  <div class="wrap narrow" id="ps-hero">
    <nav class="crumbs" aria-label="Fil d'Ariane"><a href="../">Accueil</a> › <span>Plan de situation</span></nav>
    <h1>Votre plan de situation, gratuit</h1>
    <p class="answer">Tapez votre adresse. On vous montre votre terrain et ce que dit le règlement de votre commune.</p>
    <div class="outil-carte"><div class="adr" data-id="ps" data-bouton="Voir mon terrain"></div></div>
    <p class="outil-sous">Gratuit · Sans compte · PDF prêt à déposer (DP1, PCMI1)</p>
  </div>
  <div class="wrap"><div id="ps-res" class="outil-carte" data-plan="{PRIX_PLAN}" data-etude="{PRIX_ETUDE}" data-dossier="149" aria-live="polite" hidden></div></div>
</section>

<section class="page-sec">
  <div class="wrap narrow">
    <h2>Trois choses à savoir</h2>
    <ul class="need-list">
      <li><i>La pièce n° 1</i>La mairie la demande dans tous les dossiers, pour savoir où est votre terrain.</li>
      <li><i>Deux cartes</i>Une vue large de la commune, une vue rapprochée du quartier. Votre terrain est entouré.</li>
      <li><i>Ce n'est que le début</i>Ce qui fait accepter un dossier, c'est le respect du règlement de la commune. C'est ce qu'on vérifie pour vous.</li>
    </ul>
    <div class="cta-box">
      <div><b>On fait tout le dossier, dès 149 €</b><span>Règlement lu en entier, tous les plans, le formulaire. Prêt en 48 h.</span></div>
      <a class="btn blue-btn" href="../#projets">Voir mon prix</a>
    </div>
  </div>
</section>

<section id="faq" class="page-sec alt">
  <div class="wrap narrow"><h2>Questions fréquentes</h2><div class="faq">{faq}</div>
  <p class="rules-src">Pièce prévue par l'article R. 431-36 a du code de l'urbanisme. Fond de carte : Plan IGN. Mis à jour le {date_txt('2026-11-11')}.</p></div>
</section>
</main>
"""
    h = head('Plan de situation gratuit en ligne (DP1, PCMI1) | Le Bon Permis',
             "Plan de situation gratuit pour déclaration préalable ou permis de construire. Tapez votre adresse : deux cartes IGN, votre terrain repéré, PDF prêt à déposer.",
             'plan-de-situation/', base, ld)
    h = h.replace('</head>', f'<link rel="stylesheet" href="{base}assets/espace.css">\n</head>')
    return (h + '<body data-page="legal">\n\n' + entete(base, False) + '\n' + corps + '\n' + pied(base) + OVERLAY
            + f'<script src="{base}assets/plan.js"></script>\n<script src="{base}assets/adresse.js"></script>\n<script src="{base}assets/plan-situation.js"></script>\n' + scripts(base))


def sitemap(chemins):
    """Date de dernière modification par page, d'après son contenu : src/dates.json garde l'empreinte
    du texte de chaque page et la date du jour où elle a changé. Rien à remplir à la main."""
    import hashlib, datetime, re as _re
    f = SRC / 'dates.json'
    memo = json.loads(f.read_text(encoding='utf-8')) if f.exists() else {}
    auj = datetime.date.today().isoformat()
    connues = {URL[k] + '/': maj(k) for k in PAGES}
    for c in chemins:
        html = (SITE / c / 'index.html').read_text(encoding='utf-8')
        corps = html[html.find('<main'):html.find('</main>')]
        corps = _re.sub(r'Mis à jour le [^.<]+', '', corps)
        h = hashlib.sha256(corps.encode('utf-8')).hexdigest()[:16]
        if c not in memo:
            memo[c] = {'h': h, 'd': connues.get(c, MAJ)}
        elif memo[c]['h'] != h:
            memo[c] = {'h': h, 'd': auj}
    f.write_text(json.dumps(memo, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
    urls = ''.join(f'<url><loc>{DOMAINE}/{c}</loc><lastmod>{memo[c]["d"]}</lastmod></url>\n' for c in chemins)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{urls}</urlset>\n'


def main():
    (SITE / 'assets').mkdir(exist_ok=True)
    data = {'P': P, 'GROUPS': GROUPS, 'SVCS': SVCS, 'NEED': NEED, 'URL': URL}
    (SITE / 'assets' / 'data.js').write_text('window.OP = ' + json.dumps(data, ensure_ascii=False) + ';\n', encoding='utf-8')
    for f in ('app.js', 'prix.js', 'consentement.js', 'merci.js', 'dossier.js', 'espace.js', 'espace-dossier.js', 'admin.js', 'espace.css', 'plan.js', 'carte.js', 'plan-masse.js', 'plan-situation.js', 'adresse.js', 'cerfa.js', 'pdf-lib.min.js'):
        shutil.copy(SRC / f, SITE / 'assets' / f)
    shutil.copy(SRC / 'style.css', SITE / 'assets' / 'style.css')
    shutil.copytree(SRC / 'cerfa', SITE / 'assets' / 'cerfa', dirs_exist_ok=True)
    shutil.copytree(SRC / 'fonts', SITE / 'assets' / 'fonts', dirs_exist_ok=True)
    (SITE / 'index.html').write_text(accueil(), encoding='utf-8')
    chemins = ['']
    for k in PAGES:
        d = SITE / URL[k]
        d.mkdir(exist_ok=True)
        (d / 'index.html').write_text(page(k), encoding='utf-8')
        chemins.append(URL[k] + '/')
    for slug, titre in LEGAL:
        (SITE / slug).mkdir(exist_ok=True)
        (SITE / slug / 'index.html').write_text(legale(slug, titre), encoding='utf-8')
        chemins.append(slug + '/')
    for chemin, titre, desc, ident, script, large in APPS:
        (SITE / chemin).mkdir(parents=True, exist_ok=True)
        (SITE / chemin / 'index.html').write_text(page_app(chemin, titre, desc, ident, script, large), encoding='utf-8')
    (SITE / 'plan-de-masse').mkdir(exist_ok=True)
    (SITE / 'plan-de-masse' / 'index.html').write_text(page_plan_masse(), encoding='utf-8')
    chemins.append('plan-de-masse/')
    (SITE / 'plan-de-situation').mkdir(exist_ok=True)
    (SITE / 'plan-de-situation' / 'index.html').write_text(page_plan_situation(), encoding='utf-8')
    chemins.append('plan-de-situation/')
    (SITE / '404.html').write_text(page_404(), encoding='utf-8')
    (SITE / (INDEXNOW + '.txt')).write_text(INDEXNOW, encoding='utf-8')
    # Preuve de propriété pour Google Search Console (propriété https://bonpermis.fr/) : ne pas supprimer.
    (SITE / 'google31aaa23d49f801da.html').write_text('google-site-verification: google31aaa23d49f801da.html', encoding='utf-8')
    (SITE / 'sitemap.xml').write_text(sitemap(chemins), encoding='utf-8')
    (SITE / 'robots.txt').write_text(f'User-agent: *\nAllow: /\nDisallow: /commande/\nDisallow: /dossier/\nDisallow: /espace/\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: {DOMAINE}/sitemap.xml\n', encoding='utf-8')
    print(f'{len(chemins)} pages générées dans {SITE}')


if __name__ == '__main__':
    main()
