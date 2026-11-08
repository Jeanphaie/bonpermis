# bonpermis

Dépôt du site **Le Bon Permis** (https://bonpermis.fr) : plans et dossiers pour déposer une déclaration préalable ou un permis de construire.

## Contenu

- `site/` : le site statique servi en production (`index.html` + `img/`).
- `deploy/` : configuration serveur (Nginx, bloc Docker Compose pour Traefik, timer de mise à jour).

## Hébergement

- Serveur Hetzner `95.217.60.216`, même Docker Compose que LKI (`/opt/apps`), service `bonpermis`, HTTPS par Traefik / Let's Encrypt.
- Clone sur le serveur : `/opt/apps/bonpermis-src`.
- DNS chez Hostinger : `A @ -> 95.217.60.216`, `CNAME www -> bonpermis.fr`.
- `www.bonpermis.fr` et l'ancien domaine `ouipermis.fr` redirigent en 301 vers `https://bonpermis.fr`.

## Publier

Pousser sur `main`. Le timer `bonpermis-pull.timer` fait `git pull --ff-only` toutes les 2 minutes ; Nginx lit `site/` directement. Aucune action sur le serveur.

Pas de force-push : le serveur ne suit qu'en fast-forward.
