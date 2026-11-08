# ouipermis

Dépôt du site **Le Bon Permis** (bonpermis.fr, ancien nom Oui Permis : ouipermis.fr redirige vers bonpermis.fr) : plans et dossiers pour déposer une déclaration préalable ou un permis de construire.

## Contenu

- `site/` : le site statique servi en production (`index.html` + `img/`, 38 illustrations). Source : artifact « Oui Permis » v27.
- `deploy/` : configuration serveur (Nginx + bloc Docker Compose pour Traefik).

## Hébergement

- Serveur Hetzner `95.217.60.216`, même Docker Compose que LKI (`/opt/apps`), HTTPS par Traefik / Let's Encrypt.
- DNS chez Hostinger, pour bonpermis.fr et ouipermis.fr : `A @ -> 95.217.60.216`, `CNAME www -> domaine`.

## Première mise en ligne (une seule fois, sur le serveur)

```bash
git clone https://github.com/Jeanphaie/ouipermis /opt/apps/ouipermis-src
# insérer deploy/service-ouipermis.yml dans /opt/apps/docker-compose.yml, juste avant le service lki-frontend
# (mêmes réglages Traefik que LKI : entrypoint websecure, certresolver letsencrypt, réseau web, middleware security-headers@file)
cd /opt/apps && docker compose up -d ouipermis
```

## Mettre à jour le site

```bash
cd /opt/apps/ouipermis-src && git pull
```

Rien d'autre : le conteneur lit le dossier `site/` directement.
