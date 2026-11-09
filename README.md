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

## Comptes, dossiers et espace équipe

Code du service : `api/server.js` (routes), `api/comptes.js` (comptes, sessions, accès équipe), `api/dossiers.js` (commandes, pièces, livrables, paiements), `api/base.js` (outils).

- **Client** : compte e-mail + mot de passe, ou code à 6 chiffres par e-mail (connexion sans mot de passe, mot de passe oublié). Création en deux temps : e-mail + mot de passe, puis code reçu par e-mail (le compte n'existe qu'une fois l'adresse prouvée). Réponses identiques que l'adresse ait un compte ou non. Mot de passe : 12 caractères minimum, refusé s'il reprend l'e-mail ou figure dans une fuite connue (API Have I Been Pwned, k-anonymat ; `HIBP=0` pour couper). Empreintes scrypt N=2^16 r=8 p=2 (les anciennes sont refaites à la connexion). Changer de mot de passe ou « Déconnecter tous mes appareils » invalide les autres sessions ; e-mail d'alerte au changement. Envois refusés si `Sec-Fetch-Site` indique un autre site. Pages /espace/, /admin/, /commande/ : CSP stricte et anti-clickjacking (`deploy/nginx.conf`). Le compte peut exister sans commande (simulations enregistrées, prix figé). Il est créé automatiquement au paiement ; le mot de passe se choisit sur la page « Commande reçue ». Pages : `/espace/`, `/espace/dossier/?ref=BP-XXXXXX`.
- **Paiement en deux fois** : acompte de 30 % à la commande, solde après l'aperçu des plans (Stripe Checkout, `metadata.type` = `acompte` ou `solde`).
- **Dossier** : pièces demandées propres à chaque projet (`src/pieces.json` : pièces du projet, pièces communes, ajouts si secteur protégé, copropriété ou travaux déjà faits ; liste générique si le fichier manque), textes, photos, documents, avec statut manquant / à vérifier / validé / à refaire, messages, historique. Statuts : elements, verification, preparation (échéance), apercu, corrections, livre.
- **Équipe** : `/admin/`, connexion par code à 6 chiffres envoyé aux adresses de `ADMIN_EMAILS` (par défaut contact@bonpermis.fr et jpk@lk-invest.fr). Liseuse, classement, validation, dépôt des PDF livrés (aperçu en image avec filigrane), envoi de l'aperçu.
- **Images** : l'image Docker (`deploy/Dockerfile.paiement`) ajoute pdftoppm et ImageMagick (HEIC). `deploy/maj.sh` la reconstruit tout seul quand elle change ; sans ces outils, le service fonctionne sans aperçus.
- **Données** : `/opt/apps/bonpermis-data/` (`comptes/`, `projets/`, `commandes/`, `dossiers/BP-XXXXXX/{fichiers,vues,livrables,apercu}`).
