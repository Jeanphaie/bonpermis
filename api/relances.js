'use strict';
/* Relances des dossiers pas finalisés.
   Deux cas : dossier créé mais pas validé (acompte non réglé), dossier validé mais pièces manquantes.
   - Automatiques : seulement si l'équipe les a activées dans l'espace équipe (réglage « relancesAuto », éteint par défaut).
     Une passe toutes les 30 minutes, envois entre 9 h et 19 h (heure de Paris), du lundi au vendredi.
   - À la main : bouton « Relancer le client » sur la fiche du dossier (POST /api/admin/relancer?ref=).
   Jamais de relance pour un dossier archivé, livré, ou dont le client a cliqué « ne plus me relancer ».
   Les relances automatiques ne partent pas pour un dossier resté plus de 15 jours sans suite. */

const B = require('./base');
const C = require('./comptes');
const D = require('./dossiers');
const {crypto, CONF, repondre, lireJson, journal, envoyerMail, euro, signature} = B;

const JOUR = 86400e3;
// Jours écoulés depuis le début de la phase avant chaque relance.
const PLAN = {paiement: [1, 4, 10], pieces: [2, 6]};
const AGE_MAX = 15 * JOUR;
const REGLAGES = 'reglages.json';
const reglages = () => Object.assign({relancesAuto: false}, B.lire(REGLAGES) || {});

const phaseDe = cmd => cmd.archive ? null : cmd.statut === 'brouillon' ? 'paiement' : cmd.statut === 'elements' ? 'pieces' : null;
const jetonStop = cmd => crypto.createHash('sha256').update(`${cmd.ref}|${cmd.uid}|${cmd.date}`).digest('hex').slice(0, 20);
const manquantes = cmd => { try { return (D.vueCmd(cmd, false).pieces || []).filter(p => !p.facultatif && p.etat === 'manquant' && !p.plusTard).map(p => p.nom); } catch (e) { return []; } };

// Début de la phase en cours : création du dossier, ou dernière fois que le dossier est passé « en attente du client ».
function debutPhase(cmd, phase) {
  if (phase === 'paiement') return new Date(cmd.date).getTime();
  const h = (cmd.historique || []).find(x => !/^Relance/.test(x.texte));
  const acompte = cmd.paiements && cmd.paiements.acompte ? new Date(cmd.paiements.acompte.date).getTime() : 0;
  return Math.max(acompte, h ? new Date(h.date).getTime() : 0) || new Date(cmd.date).getTime();
}
function etat(cmd) {
  const r = cmd.relances || {};
  const phase = phaseDe(cmd);
  const n = r.phase === phase ? (r.n || 0) : 0;
  return {phase, n, dernier: r.phase === phase ? r.dernier || null : null, stop: !!r.stop, prevues: phase ? PLAN[phase].length : 0};
}

// Texte de la relance n (0, 1, 2) pour ce dossier. lien = accès direct à l'espace client.
function texteRelance(cmd, phase, n, lien) {
  const stop = `\n\nVous ne souhaitez plus de rappel pour ce dossier ? ${CONF.site}/api/relance/stop?ref=${cmd.ref}&t=${jetonStop(cmd)}`;
  const tel = '01 84 16 65 53';
  if (phase === 'paiement') {
    const acompte = euro(cmd.acompte);
    if (n === 0) return [`Votre dossier ${cmd.ref} vous attend`,
      `Bonjour,\n\nVotre dossier « ${cmd.nom} » (${cmd.adresse}) est prêt dans votre espace, mais il n'est pas encore validé.\n\nNous commençons dès que l'acompte de ${acompte} est réglé : lecture du règlement de votre mairie, puis vos plans.\n\nReprendre mon dossier : ${lien}\n\nVous pouvez envoyer vos photos avant ou après, rien n'est perdu.${signature}${stop}`];
    if (n === 1) return [`Une question sur votre dossier ${cmd.ref} ?`,
      `Bonjour,\n\nVotre dossier « ${cmd.nom} » n'est toujours pas validé. Si quelque chose vous retient, dites-le nous : une réponse à cet e-mail suffit, ou appelez le ${tel}.\n\nPour rappel : chaque mairie a son propre règlement, et un seul détail oublié peut faire refuser un dossier. Nous lisons celui de votre commune avant de dessiner, et si une règle bloque votre projet, nous vous le disons tout de suite.\n\nReprendre mon dossier : ${lien}${signature}${stop}`];
    return [`Dernier rappel pour votre dossier ${cmd.ref}`,
      `Bonjour,\n\nC'est notre dernier message au sujet de votre dossier « ${cmd.nom} ». Il reste dans votre espace, avec tout ce que vous avez déjà envoyé, et vous pouvez le valider quand vous voulez.\n\nReprendre mon dossier : ${lien}\n\nSi votre projet a changé ou si vous avez une question, répondez simplement à cet e-mail.${signature}${stop}`];
  }
  const m = manquantes(cmd), liste = m.length ? '\n\nCe qu\'il nous manque :\n' + m.map(x => '- ' + x).join('\n') : '';
  if (n === 0) return [`Dossier ${cmd.ref} : il nous manque ${m.length > 1 ? m.length + ' éléments' : 'un élément'}`,
    `Bonjour,\n\nVotre dossier « ${cmd.nom} » est validé, mais nous ne pouvons pas encore commencer vos plans.${liste}\n\nEnvoyer mes pièces : ${lien}\n\nDepuis votre téléphone, cela prend quelques minutes. Une pièce vous pose problème ? Répondez à cet e-mail ou appelez le ${tel}, on trouve une solution ensemble.${signature}${stop}`];
  return [`Dossier ${cmd.ref} : on attend vos pièces pour commencer`,
    `Bonjour,\n\nNous n'avons toujours pas tout ce qu'il faut pour préparer votre dossier « ${cmd.nom} ». Le délai de préparation ne démarre qu'à la réception de vos pièces.${liste}\n\nEnvoyer mes pièces : ${lien}\n\nSi vous n'avez pas une pièce, dites-le nous : on peut souvent faire sans.${signature}${stop}`];
}

async function envoyer(cmd, auto) {
  const e = etat(cmd); if (!e.phase) return {erreur: 'Ce dossier n\'attend rien du client.'};
  const n = Math.min(e.n, PLAN[e.phase].length - 1);
  const u = C.lireUser(cmd.uid);
  const lien = u ? C.lienLong(u, '/espace/dossier/?ref=' + cmd.ref) : `${CONF.site}/espace/dossier/?ref=${cmd.ref}`;
  const [sujet, corps] = texteRelance(cmd, e.phase, n, lien);
  const ok = await envoyerMail(cmd.email, sujet, corps, CONF.mailA);
  if (!ok) return {erreur: 'L\'e-mail n\'est pas parti (voir le journal des e-mails).'};
  const frais = D.lireCmd(cmd.ref) || cmd; // relu : le dossier a pu changer pendant l'envoi
  frais.relances = {phase: e.phase, n: e.n + 1, dernier: new Date().toISOString(), stop: !!(frais.relances && frais.relances.stop)};
  frais.historique.unshift({date: new Date().toISOString(), texte: `Relance ${e.phase === 'paiement' ? 'paiement' : 'pièces'} n° ${e.n + 1} envoyée (${auto ? 'automatique' : 'par l\'équipe'}) : ${sujet}`});
  D.sauver(frais);
  journal('relance', frais.ref, e.phase, e.n + 1, auto ? 'auto' : 'manuelle');
  return {ok: true, cmd: frais};
}

// Relance automatique due maintenant ?
function due(cmd, maintenant) {
  const e = etat(cmd); if (!e.phase || e.stop || e.n >= PLAN[e.phase].length) return false;
  const debut = debutPhase(cmd, e.phase);
  if (maintenant - debut > AGE_MAX) return false;
  if (e.phase === 'pieces' && !manquantes(cmd).length) return false;
  if (e.dernier && maintenant - new Date(e.dernier).getTime() < 20 * 3600e3) return false;
  return maintenant - debut >= PLAN[e.phase][e.n] * JOUR;
}
const heureOuvree = d => {
  const p = new Intl.DateTimeFormat('fr-FR', {timeZone: 'Europe/Paris', hour: 'numeric', weekday: 'short', hour12: false}).formatToParts(d);
  const h = +p.find(x => x.type === 'hour').value, j = p.find(x => x.type === 'weekday').value;
  return h >= 9 && h < 19 && !/^(sam|dim)/.test(j);
};
let enCours = false;
async function passe() {
  if (enCours || !reglages().relancesAuto || !heureOuvree(new Date())) return;
  enCours = true;
  try {
    const refs = B.liste('commandes').filter(f => /^BP-\w{6}\.json$/.test(f)).map(f => f.slice(0, -5));
    let envois = 0;
    for (const ref of refs) {
      if (envois >= 20) break; // garde-fou : jamais plus de 20 relances par passe
      const cmd = D.lireCmd(ref); if (!cmd || !due(cmd, Date.now())) continue;
      const r = await envoyer(cmd, true); if (r.ok) envois++;
    }
  } catch (e) { journal('relances :', e.message); }
  enCours = false;
}

// ---------- routes ----------
const admin = (req, res) => { const a = C.sessionAdmin(req); if (!a) repondre(res, 401, {erreur: 'Connexion équipe requise.'}); return a; };
// Prochaine relance prévue, pour l'affichage dans l'espace équipe.
function resume(cmd) {
  const e = etat(cmd); if (!e.phase) return null;
  const debut = debutPhase(cmd, e.phase), reste = e.n < PLAN[e.phase].length;
  const trop = Date.now() - debut > AGE_MAX;
  return {phase: e.phase, envoyees: e.n, prevues: e.prevues, dernier: e.dernier, stop: e.stop,
    prochaine: reste && !e.stop && !trop ? new Date(debut + PLAN[e.phase][e.n] * JOUR).toISOString() : null, tropAncien: trop};
}
function lireReglages(req, res) {
  if (!admin(req, res)) return;
  const ex = {ref: 'BP-XXXXXX', uid: 'x', date: new Date().toISOString(), nom: 'Abri de jardin', adresse: '12 rue des Lilas, 44000 Nantes', acompte: 44.7, statut: 'brouillon', pieces: [], fichiers: [], historique: [], paiements: {}};
  const lien = `${CONF.site}/espace/dossier/?ref=BP-XXXXXX`;
  const textes = [0, 1, 2].map(n => texteRelance(ex, 'paiement', n, lien)).map(([s, c], i) => ({quand: `Non payé, J+${PLAN.paiement[i]}`, sujet: s, corps: c}))
    .concat([0, 1].map(n => { const [s, c] = texteRelance(ex, 'pieces', n, lien); return {quand: `Pièces manquantes, J+${PLAN.pieces[n]}`, sujet: s, corps: c}; }));
  repondre(res, 200, {...reglages(), plan: PLAN, textes});
}
async function ecrireReglages(req, res) {
  const qui = admin(req, res); if (!qui) return;
  const d = await lireJson(req) || {};
  const r = reglages(); r.relancesAuto = !!d.relancesAuto; B.ecrire(r, REGLAGES);
  journal('relances automatiques', r.relancesAuto ? 'activées' : 'désactivées', 'par', qui);
  repondre(res, 200, r);
  if (r.relancesAuto) passe();
}
async function relancer(req, res, url) {
  if (!admin(req, res)) return;
  const cmd = D.lireCmd(url.searchParams.get('ref')); if (!cmd) return repondre(res, 404, {erreur: 'Dossier introuvable.'});
  const r = await envoyer(cmd, false);
  if (r.erreur) return repondre(res, 409, {erreur: r.erreur});
  repondre(res, 200, {...D.vueCmd(r.cmd, true), relances: resume(r.cmd)});
}
// Lien « ne plus me relancer » dans les e-mails.
function stop(req, res, url) {
  const cmd = D.lireCmd(url.searchParams.get('ref') || '');
  const ok = !!cmd && url.searchParams.get('t') === jetonStop(cmd);
  if (ok && !(cmd.relances && cmd.relances.stop)) {
    cmd.relances = Object.assign({}, cmd.relances, {stop: true});
    cmd.historique.unshift({date: new Date().toISOString(), texte: 'Le client ne veut plus de rappel pour ce dossier'});
    D.sauver(cmd);
  }
  const page = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Le Bon Permis</title></head><body style="font-family:system-ui,sans-serif;max-width:520px;margin:80px auto;padding:0 20px;color:#14162B"><h1 style="font-size:22px">${ok ? 'C\'est noté.' : 'Lien invalide.'}</h1><p>${ok ? 'Vous ne recevrez plus de rappel pour ce dossier. Il reste dans votre espace, vous pouvez le reprendre quand vous voulez.' : 'Ce lien n\'est plus valable.'}</p><p><a href="${CONF.site}/espace/">Mon espace</a></p></body></html>`;
  res.writeHead(ok ? 200 : 404, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(page)});
  res.end(page);
}

module.exports = {passe, resume, lireReglages, ecrireReglages, relancer, stop, due, texteRelance, PLAN};
