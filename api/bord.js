'use strict';
/* Tableau de bord de l'espace équipe : ventes, clients, paniers abandonnés, demandes de rappel, plans vendus, exports.
   Tout est calculé à la demande à partir des dossiers, des comptes et des plans : aucune donnée en double.
   - GET  /api/admin/bord?jours=30      chiffres clés, comparaison avec la période précédente, ce qu'il y a à faire
   - GET  /api/admin/clients            un client par compte : dossiers, montant encaissé, projets enregistrés
   - GET  /api/admin/rappels            demandes de rappel ; POST /api/admin/rappels {id, traite} pour cocher
   - GET  /api/admin/plans              plans vendus à l'unité
   - GET  /api/admin/export.csv?quoi=encaissements|dossiers|clients   fichiers pour le tableur ou le comptable */

const B = require('./base');
const C = require('./comptes');
const D = require('./dossiers');
const {repondre, lireJson} = B;

const jourParis = d => new Date(d).toLocaleDateString('fr-CA', {timeZone: 'Europe/Paris'});
const r2 = n => Math.round(n * 100) / 100;
const equipe = (req, res) => C.sessionAdmin(req) ? true : (repondre(res, 401, {erreur: 'Connexion équipe requise.'}), false);

const commandes = () => B.liste('commandes').filter(f => /^BP-\w{6}\.json$/.test(f)).map(f => D.lireCmd(f.slice(0, -5))).filter(Boolean);
const plansPayes = () => B.liste('plans').filter(f => f.endsWith('.json')).map(f => B.lire('plans', f)).filter(b => b && b.paye);
const nomDe = cmd => { try { return D.nomClient(cmd) || ''; } catch (e) { return cmd.nom_client || ''; } };

// Toutes les sommes réellement encaissées : acomptes, soldes, plans à l'unité.
function encaissements(cmds, plans) {
  const L = [];
  for (const c of cmds) {
    const a = c.paiements && c.paiements.acompte, s = c.paiements && c.paiements.solde;
    if (a && a.montant > 0) L.push({date: a.date, type: 'Acompte', ref: c.ref, client: nomDe(c) || c.email, email: c.email, objet: c.nom, montant: a.montant});
    if (s && s.montant > 0 && !s.ancien) L.push({date: s.date, type: 'Solde', ref: c.ref, client: nomDe(c) || c.email, email: c.email, objet: c.nom, montant: s.montant});
    else if (s && s.montant > 0 && s.ancien) L.push({date: s.date, type: 'Paiement', ref: c.ref, client: nomDe(c) || c.email, email: c.email, objet: c.nom, montant: s.montant});
  }
  for (const b of plans) L.push({date: b.paye.date, type: b.paye.formule === 'etude' ? 'Étude' : 'Plan de masse', ref: b.paye.code || b.id, client: b.nom || b.paye.email, email: b.paye.email, objet: b.adresse || '', montant: b.paye.total || 0});
  return L.filter(x => x.date).sort((x, y) => y.date.localeCompare(x.date));
}

function bord(req, res, url) {
  if (!equipe(req, res)) return;
  const n = Math.min(Math.max(parseInt(url.searchParams.get('jours'), 10) || 30, 1), 365);
  const jours = []; for (let i = n - 1; i >= 0; i--) jours.push(jourParis(Date.now() - i * 86400e3));
  const debut = jours[0], avant = jourParis(Date.now() - (2 * n - 1) * 86400e3);
  const dans = d => { const j = d && jourParis(d); return j && j >= debut ? 1 : j && j >= avant ? 0 : -1; }; // 1 = période, 0 = période d'avant
  const cmds = commandes(), plans = plansPayes(), enc = encaissements(cmds, plans);

  const K = [{encaisse: 0, commandes: 0, valeur: 0, plans: 0, crees: 0, visiteurs: 0}, {encaisse: 0, commandes: 0, valeur: 0, plans: 0, crees: 0, visiteurs: 0}];
  const parJour = {}; jours.forEach(j => { parJour[j] = {jour: j, encaisse: 0, commandes: 0}; });
  for (const e of enc) { const p = dans(e.date); if (p < 0) continue; K[1 - p].encaisse += e.montant; if (p === 1) parJour[jourParis(e.date)].encaisse += e.montant; }
  for (const b of plans) { const p = dans(b.paye.date); if (p >= 0) K[1 - p].plans++; }
  const parProjet = {}, parSource = {}, parCode = {};
  let aEncaisser = 0, nbAEncaisser = 0;
  const abandons = [], F = {verifier: 0, retard: 0, corrections: 0, apercu: 0, messages: 0, pieces: 0};
  for (const c of cmds) {
    const a = c.paiements && c.paiements.acompte, pc = dans(c.date);
    if (pc >= 0) K[1 - pc].crees++;
    if (a && !a.gratuit) {
      const p = dans(a.date);
      if (p >= 0) { K[1 - p].commandes++; K[1 - p].valeur += c.total || 0; }
      if (p === 1) {
        parJour[jourParis(a.date)].commandes++;
        const o = parProjet[c.nom] = parProjet[c.nom] || {nom: c.nom, n: 0, total: 0}; o.n++; o.total += c.total || 0;
        const s = parSource[c.origine || 'Inconnue'] = parSource[c.origine || 'Inconnue'] || {nom: c.origine || 'Inconnue', n: 0, total: 0}; s.n++; s.total += c.total || 0;
      }
    }
    if (c.promo && a && dans(a.date) === 1) { const o = parCode[c.promo] = parCode[c.promo] || {nom: c.promo, n: 0, total: 0}; o.n++; o.total += c.total || 0; }
    if (c.archive) continue;
    if (a && !(c.paiements && c.paiements.solde) && c.solde > 0) { aEncaisser += c.solde; nbAEncaisser++; }
    if (c.statut === 'brouillon') abandons.push({ref: c.ref, client: nomDe(c) || c.email, nom: c.nom, total: c.total, date: c.date, relances: (c.relances && c.relances.n) || 0});
    if (['verification'].includes(c.statut)) F.verifier++;
    if (c.statut === 'corrections') F.corrections++;
    if (c.statut === 'apercu') F.apercu++;
    if (c.statut === 'elements') F.pieces++;
    if (['verification', 'preparation'].includes(c.statut) && c.echeance && new Date(c.echeance) < new Date()) F.retard++;
    const m = c.messages && c.messages[c.messages.length - 1]; if (m && m.de === 'client') F.messages++;
  }
  // Visiteurs (suivi des visites) pour le taux de conversion
  for (let i = 0; i < 2 * n; i++) { const j = jourParis(Date.now() - i * 86400e3), d = B.lire('visites', j + '.json'); if (d) K[i < n ? 0 : 1].visiteurs += d.visiteurs || 0; }
  const rappels = B.liste('rappels').filter(f => f.endsWith('.json')).map(f => B.lire('rappels', f)).filter(x => x && !x.traite).length;
  const fini = k => ({encaisse: r2(k.encaisse), commandes: k.commandes, panier: k.commandes ? r2(k.valeur / k.commandes) : 0, plans: k.plans, crees: k.crees, visiteurs: k.visiteurs, conversion: k.visiteurs ? Math.round(k.commandes / k.visiteurs * 1000) / 10 : null});
  const tri = o => Object.values(o).map(x => ({...x, total: r2(x.total)})).sort((a, b) => b.total - a.total || b.n - a.n);
  abandons.sort((a, b) => b.date.localeCompare(a.date));
  repondre(res, 200, {
    jours: n, periode: fini(K[0]), avant: fini(K[1]), serie: jours.map(j => ({...parJour[j], encaisse: r2(parJour[j].encaisse)})),
    aEncaisser: {montant: r2(aEncaisser), n: nbAEncaisser},
    abandons: {n: abandons.length, montant: r2(abandons.reduce((s, x) => s + (x.total || 0), 0)), liste: abandons.slice(0, 8)},
    aFaire: {...F, rappels, mailsEchec: (B.mailsEnEchec() || []).length || 0},
    parProjet: tri(parProjet), parSource: tri(parSource), parCode: tri(parCode), derniers: enc.slice(0, 8)
  });
}

function clients(req, res) {
  if (!equipe(req, res)) return;
  const enc = encaissements(commandes(), []), paye = {};
  for (const e of enc) paye[e.ref] = (paye[e.ref] || 0) + e.montant;
  const L = [];
  for (const f of B.liste('comptes')) {
    if (!/^u\w+\.json$/.test(f)) continue;
    const u = B.lire('comptes', f); if (!u || !u.email) continue;
    const cs = (u.commandes || []).map(D.lireCmd).filter(Boolean);
    const nom = cs.map(nomDe).find(Boolean) || '';
    const actifs = cs.filter(c => c.statut !== 'brouillon');
    L.push({email: u.email, nom, cree: u.cree, dossiers: cs.length, valides: actifs.length, encaisse: r2(cs.reduce((s, c) => s + (paye[c.ref] || 0), 0)),
      projets: (u.projets || []).length, dernier: cs.map(c => c.date).sort().pop() || null, refs: cs.map(c => c.ref).slice(0, 6),
      commune: cs[0] ? (cs[0].adresse || '').split(',').pop().trim() : ''});
  }
  L.sort((a, b) => b.encaisse - a.encaisse || (b.dernier || b.cree || '').localeCompare(a.dernier || a.cree || ''));
  repondre(res, 200, {clients: L, total: {n: L.length, acheteurs: L.filter(x => x.encaisse > 0).length, prospects: L.filter(x => !x.valides).length}});
}

const RAPPEL_RE = /^[\w-]{10,60}\.json$/;
function rappels(req, res) {
  if (!equipe(req, res)) return;
  const L = B.liste('rappels').filter(f => RAPPEL_RE.test(f)).map(f => ({id: f.slice(0, -5), ...(B.lire('rappels', f) || {})})).filter(x => x.date)
    .map(x => ({id: x.id, date: x.date, tel: x.tel, projet: x.projet, motif: x.motif, adresse: x.adresse, traite: x.traite || null}))
    .sort((a, b) => b.date.localeCompare(a.date));
  repondre(res, 200, {rappels: L.slice(0, 300), aFaire: L.filter(x => !x.traite).length});
}
async function rappelTraite(req, res) {
  const qui = C.sessionAdmin(req); if (!qui) return repondre(res, 401, {erreur: 'Connexion équipe requise.'});
  const d = await lireJson(req) || {}, f = String(d.id || '') + '.json';
  const x = RAPPEL_RE.test(f) && B.lire('rappels', f); if (!x) return repondre(res, 404, {erreur: 'Demande introuvable.'});
  x.traite = d.traite ? {date: new Date().toISOString(), par: qui} : null;
  B.ecrire(x, 'rappels', f);
  repondre(res, 200, {ok: true});
}

function plans(req, res) {
  if (!equipe(req, res)) return;
  const tous = B.liste('plans').filter(f => f.endsWith('.json')).map(f => B.lire('plans', f)).filter(Boolean);
  const depuis = new Date(Date.now() - 30 * 86400e3).toISOString();
  const L = tous.filter(b => b.paye).map(b => ({id: b.id, date: b.paye.date, email: b.paye.email, formule: b.paye.formule, total: b.paye.total, code: b.paye.code, adresse: b.adresse, projet: b.projet, etude: b.etude || null}))
    .sort((a, b) => b.date.localeCompare(a.date));
  repondre(res, 200, {plans: L.slice(0, 300), apercus30: tous.filter(b => b.date >= depuis).length, payes30: L.filter(b => b.date >= depuis).length});
}

// ---------- exports ----------
const csv = v => { let t = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return /[";\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
const nombre = n => String(r2(n || 0)).replace('.', ',');
const dateFr = d => d ? new Date(d).toLocaleDateString('fr-FR', {timeZone: 'Europe/Paris'}) : '';
function exporter(req, res, url) {
  if (!equipe(req, res)) return;
  const quoi = url.searchParams.get('quoi'), cmds = commandes();
  let lignes;
  if (quoi === 'encaissements') {
    lignes = [['Date', 'Type', 'Référence', 'Client', 'E-mail', 'Objet', 'Montant TTC']]
      .concat(encaissements(cmds, plansPayes()).map(e => [dateFr(e.date), e.type, e.ref, e.client, e.email, e.objet, nombre(e.montant)]));
  } else if (quoi === 'dossiers') {
    lignes = [['Référence', 'Créé le', 'Client', 'E-mail', 'Projet', 'Démarche', 'Adresse', 'Statut', 'Total TTC', 'Acompte payé', 'Solde payé', 'Reste à encaisser', 'Code promo', 'Origine', 'Archivé']]
      .concat(cmds.sort((a, b) => b.date.localeCompare(a.date)).map(c => { const a = c.paiements.acompte, s = c.paiements.solde; return [c.ref, dateFr(c.date), nomDe(c), c.email, c.nom, c.kind, c.adresse, D.STATUTS[c.statut] || c.statut, nombre(c.total), a ? nombre(a.montant) : '', s ? nombre(s.montant) : '', a && !s ? nombre(c.solde) : '', c.promo || '', c.origine || '', c.archive ? 'oui' : '']; }));
  } else if (quoi === 'clients') {
    const paye = {}; for (const e of encaissements(cmds, [])) paye[e.email] = (paye[e.email] || 0) + e.montant;
    const par = {}; for (const c of cmds) (par[c.email] = par[c.email] || []).push(c);
    lignes = [['E-mail', 'Nom', 'Compte créé le', 'Dossiers', 'Dossiers validés', 'Encaissé TTC', 'Dernier dossier']];
    for (const f of B.liste('comptes')) { if (!/^u\w+\.json$/.test(f)) continue; const u = B.lire('comptes', f); if (!u || !u.email) continue; const cs = par[u.email] || [];
      lignes.push([u.email, cs.map(nomDe).find(Boolean) || '', dateFr(u.cree), cs.length, cs.filter(c => c.statut !== 'brouillon').length, nombre(paye[u.email]), dateFr(cs.map(c => c.date).sort().pop())]); }
  } else return repondre(res, 400, {erreur: 'Export inconnu.'});
  const corps = '﻿' + lignes.map(l => l.map(csv).join(';')).join('\r\n') + '\r\n';
  res.writeHead(200, {'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="bonpermis-${quoi}-${jourParis(Date.now())}.csv"`, 'Cache-Control': 'no-store'});
  res.end(corps);
}

module.exports = {bord, clients, rappels, rappelTraite, plans, exporter, encaissements};
