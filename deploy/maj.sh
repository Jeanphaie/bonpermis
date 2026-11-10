#!/bin/sh
# Mise à jour du site Le Bon Permis depuis GitHub (lancé toutes les 2 minutes par bonpermis-pull.timer, en root).
# - le site (site/) est lu directement par Nginx : rien à redémarrer, sauf si deploy/nginx.conf change ;
# - les pages publiques modifiées sont signalées à Bing par IndexNow ;
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

# Nginx : sa configuration est montée comme fichier seul, le conteneur garde l'ancienne version après un git pull.
# Quand elle change, on la teste dans un conteneur jetable, puis on redémarre Nginx (une à deux secondes de coupure).
# Si le test échoue, on ne touche à rien : le site continue avec l'ancienne configuration.
if [ "$avant" != "$apres" ] && git -C "$D" diff --name-only "$avant" "$apres" | grep -qx 'deploy/nginx.conf'; then
  if docker run --rm -v "$D/deploy/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:1.27-alpine nginx -t >/tmp/bonpermis-nginx.log 2>&1; then
    c=$(docker ps -q --filter "label=traefik.http.routers.bonpermis.service=bonpermis" | head -1)
    if [ -n "$c" ]; then docker restart "$c" >/dev/null 2>&1 || true; fi
  else
    logger -t bonpermis "nginx.conf invalide, Nginx non redémarré, voir /tmp/bonpermis-nginx.log" || true
  fi
fi

# IndexNow : on signale à Bing (et aux moteurs qui suivent ce protocole) les pages publiques qui viennent de changer.
# La clé n'est pas un secret : c'est le fichier site/<clé>.txt qui prouve qu'on tient le site.
if [ "$avant" != "$apres" ]; then
  urls=$(git -C "$D" diff --name-only "$avant" "$apres" -- site | grep -E 'index\.html$' \
    | grep -vE '^site/(espace|admin|commande|dossier)/' | sed -e 's#^site/##' -e 's#index\.html$##' \
    | awk '{printf "%s\"https://bonpermis.fr/%s\"", (NR>1?",":""), $0}' || true)
  if [ -n "$urls" ]; then
    curl -s -m 20 -o /dev/null -X POST 'https://api.indexnow.org/indexnow' -H 'Content-Type: application/json; charset=utf-8' \
      -d "{\"host\":\"bonpermis.fr\",\"key\":\"57d73c89722b332c8c9376ec85d72e20\",\"keyLocation\":\"https://bonpermis.fr/57d73c89722b332c8c9376ec85d72e20.txt\",\"urlList\":[$urls]}" || true
  fi
fi

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
if [ "$avant" != "$apres" ] && git -C "$D" diff --name-only "$avant" "$apres" | grep -qE '^(api/|src/prix\.js|src/data\.json|src/pages\.json|src/pieces\.json)'; then
  docker restart bonpermis-paiement >/dev/null 2>&1 || true
fi
