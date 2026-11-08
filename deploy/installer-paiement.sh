#!/bin/bash
# Le Bon Permis : installation (ou mise à jour des clés) du service de paiement.
# À lancer une fois sur le serveur, en root :
#   sudo bash /opt/apps/bonpermis-src/deploy/installer-paiement.sh
# On peut le relancer sans risque : il garde les valeurs déjà saisies si on appuie sur Entrée.
set -euo pipefail

SRC=/opt/apps/bonpermis-src
ENVF=/opt/apps/bonpermis-paiement.env
CENV=/opt/apps/bonpermis-paiement.compose.env
DATA=/opt/apps/bonpermis-data

[ "$(id -u)" = 0 ] || { echo "À lancer avec sudo."; exit 1; }
[ -d "$SRC/.git" ] || { echo "Dépôt introuvable dans $SRC."; exit 1; }
command -v docker >/dev/null || { echo "Docker introuvable."; exit 1; }

echo "1/6 Mise à jour du dépôt"
git -C "$SRC" pull -q --ff-only origin main

echo "2/6 Réseau Docker du site"
SITE_CT=$(docker ps -q --filter label=com.docker.compose.service=bonpermis | head -1)
[ -n "$SITE_CT" ] || { echo "Le conteneur du site (service bonpermis) ne tourne pas."; exit 1; }
RESEAUX=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$SITE_CT")
set -- $RESEAUX
if [ $# -eq 1 ]; then RESEAU_WEB=$1; else
  echo "Le site est sur plusieurs réseaux : $RESEAUX"; read -rp "Lequel est celui de Traefik ? " RESEAU_WEB
fi
echo "   réseau : $RESEAU_WEB"
echo "RESEAU_WEB=$RESEAU_WEB" > "$CENV"

echo "3/6 Clés (rien ne s'affiche quand vous collez, c'est normal)"
ancien() { [ -f "$ENVF" ] && grep -E "^$1=" "$ENVF" | head -1 | cut -d= -f2- || true; }
demander() { # nom, question, motif attendu, obligatoire (1/0)
  local v cur; cur=$(ancien "$1")
  while true; do
    if [ -n "$cur" ]; then read -rsp "   $2 [Entrée = garder l'actuelle] : " v; else read -rsp "   $2 : " v; fi; echo
    [ -z "$v" ] && v=$cur
    if [ -z "$v" ] && [ "$4" = 0 ]; then break; fi
    if [[ "$v" =~ $3 ]]; then break; fi
    echo "   Format inattendu, recommencez."
  done
  printf -v "$1" '%s' "$v"
}
demander STRIPE_SECRET_KEY "Clé secrète Stripe (sk_live_... ou rk_live_...)" '^(sk|rk)_(live|test)_[A-Za-z0-9]+$' 1
demander STRIPE_WEBHOOK_SECRET "Secret du webhook Stripe (whsec_...)" '^whsec_[A-Za-z0-9]+$' 1
demander SMTP_PASS "Mot de passe de contact@bonpermis.fr (Entrée pour passer)" '.+' 0
umask 077
cat > "$ENVF" <<EOF
STRIPE_SECRET_KEY=$STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=$STRIPE_WEBHOOK_SECRET
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=contact@bonpermis.fr
SMTP_PASS=$SMTP_PASS
MAIL_FROM=contact@bonpermis.fr
MAIL_TO=contact@bonpermis.fr
EOF
chmod 600 "$ENVF"
umask 022

echo "4/6 Dossier des commandes"
mkdir -p "$DATA"; chown 1000:1000 "$DATA"; chmod 700 "$DATA"

echo "5/6 Démarrage du service"
docker compose --env-file "$CENV" -f "$SRC/deploy/compose-paiement.yml" -p bonpermis-paiement up -d --force-recreate

echo "6/6 Mise à jour automatique (redémarre le service quand son code change)"
cp "$SRC/deploy/systemd/bonpermis-pull.service" /etc/systemd/system/bonpermis-pull.service
systemctl daemon-reload
systemctl restart bonpermis-pull.timer

sleep 4
echo
echo "Vérification :"
curl -fsS https://bonpermis.fr/api/sante && echo || { echo "Le service ne répond pas encore. Journal :"; docker logs --tail 30 bonpermis-paiement; exit 1; }
echo "Terminé."
