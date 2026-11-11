'use strict';
/* Codes promo, gérés depuis l'espace équipe (/admin/#promos). Stockés dans DATA_DIR/promos.json (jamais dans le dépôt).
   Types : « pourcent » (remise en %), « montant » (remise en euros), « prix » (prix final fixe, pratique pour tester à 1 €).
   Le code est vérifié côté serveur à chaque commande ; il est compté comme utilisé quand l'acompte est payé.
   Prix minimum après remise : 1 € (Stripe refuse les paiements sous 0,50 €, et la commande se paie en deux fois). */

const B = require('./base');
const {lire, ecrire, repondre, lireJson, texte, journal} = B;

const FICHIER = 'promos.json';
const normal = c => String(c || '').trim().toUpperCase().replace(/\s+/g, '');
const CODE_RE = /^[A-Z0-9_-]{3,30}$/;
const tous = () => (lire(FICHIER) || {codes: []}).codes;
const sauver = codes => ecrire({codes}, FICHIER);
const arrondi = n => Math.round(n * 100) / 100;

// Renvoie {code, remise, total, libelle} ou {erreur}.
function appliquer(code, total) {
  const c = normal(code); if (!c) return null;
  const p = tous().find(x => x.code === c);
  const refus = {erreur: 'Ce code promo n\'est pas valable.'};
  if (!p || !p.actif) return refus;
  if (p.expire && p.expire < new Date().toISOString().slice(0, 10)) return {erreur: 'Ce code promo a expiré.'};
  if (p.max && (p.utilises || 0) >= p.max) return {erreur: 'Ce code promo a déjà été utilisé le nombre de fois prévu.'};
  let nouveau = p.type === 'pourcent' ? total * (1 - p.valeur / 100) : p.type === 'montant' ? total - p.valeur : p.valeur;
  nouveau = Math.max(1, Math.min(total, arrondi(nouveau)));
  const remise = arrondi(total - nouveau);
  return {code: c, remise, total: nouveau, libelle: `Code promo ${c}`};
}

function compterUtilisation(code) {
  const c = normal(code); if (!c) return;
  const codes = tous(), p = codes.find(x => x.code === c); if (!p) return;
  p.utilises = (p.utilises || 0) + 1; sauver(codes);
  journal('code promo utilisé', c, p.utilises + (p.max ? '/' + p.max : ''));
}

// ---------- routes équipe ----------
function admin(req, res) { const C = require('./comptes'); if (!C.sessionAdmin(req)) { repondre(res, 401, {erreur: 'Connexion équipe requise.'}); return null; } return C.sessionAdmin(req); }
function liste(req, res) { if (!admin(req, res)) return; repondre(res, 200, {codes: tous()}); }
async function enregistrer(req, res) {
  const qui = admin(req, res); if (!qui) return;
  const d = await lireJson(req) || {};
  const code = normal(d.code);
  if (!CODE_RE.test(code)) return repondre(res, 400, {erreur: 'Code : 3 à 30 lettres, chiffres, tirets.'});
  if (!['pourcent', 'montant', 'prix'].includes(d.type)) return repondre(res, 400, {erreur: 'Type inconnu.'});
  const valeur = +d.valeur;
  if (!(valeur > 0) || (d.type === 'pourcent' && valeur > 100) || valeur > 100000) return repondre(res, 400, {erreur: 'Valeur invalide.'});
  if (d.type === 'prix' && valeur < 1) return repondre(res, 400, {erreur: 'Prix final : 1 € minimum.'});
  const max = d.max ? Math.max(0, Math.floor(+d.max)) : 0;
  const expire = /^\d{4}-\d{2}-\d{2}$/.test(d.expire || '') ? d.expire : '';
  const codes = tous(), exist = codes.find(x => x.code === code);
  const p = {code, type: d.type, valeur: arrondi(valeur), max, expire, actif: d.actif !== false, note: texte(d.note, 200),
    utilises: exist ? exist.utilises || 0 : 0, cree: exist ? exist.cree : new Date().toISOString(), par: exist ? exist.par : qui};
  if (exist) Object.assign(exist, p); else codes.unshift(p);
  sauver(codes); journal('code promo enregistré', code, 'par', qui);
  repondre(res, 200, {ok: true, codes});
}
async function basculer(req, res) {
  if (!admin(req, res)) return;
  const d = await lireJson(req) || {}; const codes = tous(), p = codes.find(x => x.code === normal(d.code));
  if (!p) return repondre(res, 404, {erreur: 'Code introuvable.'});
  p.actif = !!d.actif; sauver(codes); repondre(res, 200, {ok: true, codes});
}

// Code créé par le service lui-même (plan de masse déduit du dossier complet).
function creerCode({code, type, valeur, max, expire, note}) {
  const c = normal(code); if (!CODE_RE.test(c)) throw new Error('code invalide');
  const codes = tous(); if (codes.find(x => x.code === c)) return;
  codes.unshift({code: c, type, valeur: arrondi(valeur), max: max || 0, expire: expire || '', actif: true, note: texte(note, 200), utilises: 0, cree: new Date().toISOString(), par: 'service'});
  sauver(codes); journal('code promo créé par le service', c);
}

module.exports = {appliquer, compterUtilisation, liste, enregistrer, basculer, normal, creerCode};
