#!/bin/sh
# Mise à jour du site Le Bon Permis depuis GitHub (lancé toutes les 2 minutes par bonpermis-pull.timer).
# - le site (site/) est lu directement par Nginx : rien à redémarrer ;
# - si le service de paiement ou la grille de prix a changé, on redémarre son conteneur.
set -e
D=/opt/apps/bonpermis-src
avant=$(git -C "$D" rev-parse HEAD)
git -C "$D" pull -q --ff-only origin main
apres=$(git -C "$D" rev-parse HEAD)
if [ "$avant" != "$apres" ] && git -C "$D" diff --name-only "$avant" "$apres" | grep -qE '^(api/|src/prix\.js|src/data\.json|src/pages\.json)'; then
  docker restart bonpermis-paiement >/dev/null 2>&1 || true
fi
