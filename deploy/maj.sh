#!/bin/sh
# Mise à jour du site Le Bon Permis depuis GitHub (lancé toutes les 2 minutes par bonpermis-pull.timer, en root).
# - le site (site/) est lu directement par Nginx : rien à redémarrer ;
# - si l'image du service (deploy/Dockerfile.paiement ou deploy/compose-paiement.yml) a changé, on la reconstruit
#   et on recrée le conteneur ; en cas d'échec, l'ancien conteneur continue de tourner et on réessaie une heure plus tard ;
# - sinon, si le code du service ou la grille de prix a changé, on redémarre simplement le conteneur.
set -e
D=/opt/apps/bonpermis-src
ETAT=/opt/apps/bonpermis-paiement.image
CENV=/opt/apps/bonpermis-paiement.compose.env
avant=$(git -C "$D" rev-parse HEAD)
git -C "$D" pull -q --ff-only origin main
apres=$(git -C "$D" rev-parse HEAD)

[ -f "$CENV" ] || exit 0   # service pas encore installé (installer-paiement.sh)
voulu=$(cat "$D/deploy/Dockerfile.paiement" "$D/deploy/compose-paiement.yml" 2>/dev/null | sha256sum | cut -c1-16)
actuel=$(awk '$2=="ok"{print $1}' "$ETAT" 2>/dev/null || true)
if [ "$voulu" != "$actuel" ]; then
  echec=$(awk -v h="$voulu" '$1==h && $2=="echec"{print $3}' "$ETAT" 2>/dev/null || true)
  if [ -n "$echec" ] && [ $(( $(date +%s) - echec )) -lt 3600 ]; then exit 0; fi
  cd "$D"
  if docker compose --env-file "$CENV" -f deploy/compose-paiement.yml -p bonpermis-paiement up -d --build >/tmp/bonpermis-build.log 2>&1; then
    echo "$voulu ok $(date +%s)" > "$ETAT"
  else
    echo "$voulu echec $(date +%s)" > "$ETAT"
    logger -t bonpermis "reconstruction du service échouée, voir /tmp/bonpermis-build.log" || true
  fi
  exit 0
fi
if [ "$avant" != "$apres" ] && git -C "$D" diff --name-only "$avant" "$apres" | grep -qE '^(api/|src/prix\.js|src/data\.json|src/pages\.json)'; then
  docker restart bonpermis-paiement >/dev/null 2>&1 || true
fi
