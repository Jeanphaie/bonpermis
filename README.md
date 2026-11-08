# bonpermis

Dépôt du site **Le Bon Permis** (https://bonpermis.fr) : plans et dossiers pour déposer une déclaration préalable ou un permis de construire.

## Contenu

- `src/` : la source du site. `data.json` (projets et textes du simulateur), `pages.json` (une page par projet : règles, sources officielles, prix), `accueil.html`, `style.css`, `app.js`, et `build.py` qui génère `site/`.
- `site/` : le site statique servi en production, **généré** par `python3 src/build.py` (ne pas modifier à la main, sauf `img/` et les favicons). Accueil + 26 pages projet (`/pergola/`, `/veranda/`…), `sitemap.xml`, `robots.txt`.
- `src/prix.js` : questions du simulateur et grille de prix, **commun** au site et au service de paiement (une seule grille).
- `api/server.js` : service de paiement (Node 22, sans dépendance). Recalcule le prix à partir des réponses, ouvre Stripe Checkout, reçoit la confirmation signée de Stripe (webhook), enregistre la commande dans `/opt/apps/bonpermis-data` et envoie les e-mails (SMTP Hostinger). Routes sous `https://bonpermis.fr/api/`.
- `deploy/` : configuration serveur (Nginx, bloc Docker Compose du site, `compose-paiement.yml`, `installer-paiement.sh`, `maj.sh` et timer de mise à jour).

## Hébergement

- Serveur Hetzner `95.217.60.216`, même Docker Compose que LKI (`/opt/apps`), service `bonpermis`, HTTPS par Traefik / Let's Encrypt.
- Clone sur le serveur : `/opt/apps/bonpermis-src`.
- DNS chez Hostinger : `A @ -> 95.217.60.216`, `CNAME www -> bonpermis.fr`.
- `www.bonpermis.fr` et l'ancien domaine `ouipermis.fr` redirigent en 301 vers `https://bonpermis.fr`.

## Service de paiement

Installation (une fois) ou changement de clés : `sudo bash /opt/apps/bonpermis-src/deploy/installer-paiement.sh`. Les secrets sont dans `/opt/apps/bonpermis-paiement.env` (600, jamais dans le dépôt). Vérification : https://bonpermis.fr/api/sante.

## Publier

Modifier `src/`, lancer `python3 src/build.py`, pousser sur `main`. Le timer `bonpermis-pull.timer` lance `deploy/maj.sh` toutes les 2 minutes : `git pull --ff-only`, Nginx lit `site/` directement, et le service de paiement redémarre seul si `api/` ou la grille de prix a changé. Aucune action sur le serveur.

Pas de force-push : le serveur ne suit qu'en fast-forward.
