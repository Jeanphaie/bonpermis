/* Le Bon Permis - préremplissage du formulaire officiel (Cerfa) dans l'espace équipe.
   Les trois formulaires (13406 permis maison, 13703 déclaration maison, 16702 déclaration autres travaux) partagent les mêmes
   noms de champs pour le demandeur (D1…, D2…, D3…, D5…), le terrain (T2…) et le projet (C2Z…, C5Z…).
   Le PDF vierge officiel est lu depuis /assets/cerfa/, rempli dans le navigateur avec pdf-lib (/assets/pdf-lib.min.js),
   puis téléchargé ou déposé dans « Pièces à livrer ». Tout est relu par l'équipe avant : rien n'est envoyé au client tel quel. */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const FORMS = {
    '13703': {f: 'cerfa_13703-12.pdf', n: 'Déclaration préalable, maison individuelle (13703*12)'},
    '16702': {f: 'cerfa_16702-03.pdf', n: 'Déclaration préalable, autres travaux (16702*03)'},
    '13406': {f: 'cerfa_13406-17.pdf', n: 'Permis de construire, maison individuelle (13406*17)'}
  };
  // Cases « nature du projet » par type de projet du site.
  const NATURE = {
    abri: ['C2ZA1_nouvelle', 'C5ZE4_abri'], piscine: ['C2ZA1_nouvelle', 'C5ZE1_piscine'], veranda: ['C2ZA1_nouvelle', 'C5ZE3_veranda'],
    carport: ['C2ZA1_nouvelle'], annexe: ['C2ZA1_nouvelle'], pergola: ['C2ZA1_nouvelle'], maison: ['C2ZA1_nouvelle'],
    extension: ['C2ZB1_existante', 'C5ZK1_extension'], surelevation: ['C2ZB1_existante', 'C5ZK2_surelevation'], combles: ['C2ZB1_existante', 'C5ZK3_supplementaires'],
    cloture: ['C2ZC3_cloture'], portail: ['C2ZC3_cloture']
  };
  const AUTRE_NEUF = {carport: 'Carport', annexe: 'Annexe', pergola: 'Pergola'};
  const AUTRE_EXIST = {garage: 'Transformation du garage en pièce habitable', menuiseries: 'Remplacement de menuiseries extérieures', velux: 'Pose de fenêtres de toit', lucarne: 'Création d\'une lucarne', toiture: 'Réfection de la toiture', facade: 'Ravalement de façade', solaire: 'Pose de panneaux solaires', terrasse: 'Terrasse', usage: 'Changement de destination'};

  // Bordereau des pièces jointes : case à cocher de chaque pièce, relevée sur les PDF officiels.
  const BORD = {"13703":{"DP1":"P5PA1","DP2":"P5PB1","DP3":"P3GE1","DP4":"P3GD1","DP5":"P5PC1","DP6":"P3GF1","DP7":"P3GG1","DP8":"P3GH1","DP8-1":"P4LC1","DP11":"P4CD1","DP11-1":"P4CF1","DP11-2":"P4EC1","DP12-2":"P4GF1","DP14":"P4LA1","DP15":"P4LD1","DP16":"P4LE1","DP17":"P5PE1","DP22":"P4HG1","DP23":"P4EG1","DP24":"P4MA1","DP25":"P8EA1","DP12-1":"P4GE1"},"16702":{"DPC1":"P5PA2","DPC2":"P5PB1","DPC3":"P3GE1","DPC4":"P3GD1","DPC5":"P5PC1","DPC6":"P3GF1","DPC7":"P3GG1","DPC8":"P3GH1","DPC11":"P4CD1","DPC11-1":"P4CF1","DPC11-2":"P4EC1","DPC12":"P4EH1","DPC12-1":"P4GE1","DPC12-2":"P4GF1","DPC14":"P4LA1","DPC14-1":"P4LG1","DPC15":"P4LD1","DP16":"P4LE1","DPC16-1":"P5PD1","DPC17":"P5PE1","DPC18":"P6PF1","DPC21":"P1FP1","DPC22":"P4HG1","DPC23":"P4EG1","DPC25":"P8EA1","DPC26":"P9ZA1","DPC29":"P4FJ1","DPC32":"P4FK1","DPC33":"P4FK2","DPC34":"P4KB2","DPC35":"P4KB3","DPC36":"P4KB4","DPC37":"P3FA1"},"13406":{"PCMI1":"P3GA1","PCMI2":"P3GC1","PCMI3":"P3GE1","PCMI4":"P3GB1","PCMI5":"P3GD1","PCMI6":"P3GF1","PCMI7":"P3GG1","PCMI8":"P3GH1","PCMI9":"P7LC1","PCMI10":"P4HC1","PCMI11":"P4HE1","PCMI12":"P4HF1","PCMI12-1":"P4EC1","PCMI12-2":"P4ED1","PCMI13":"P4EE1","PCMI14":"P4EF1","PCMI14-1":"P4EK1","PCMI15":"P4GE1","PCMI16":"P4GF1","PCMI17":"P4GG1","PCMI18":"P4HA1","PCMI19":"P4HB1","PCMI20":"P4CC1","PCMI21":"P4CD1","PCMI21-1":"P4CF1","PCMI22":"P4KA1","PCMI23":"P4KB1","PCMI23-1":"P4LA1","PCMI23-2":"P4LB1","PCMI23-3":"P4LC1","PCMI23-4":"P4LG1","PCMI24":"P4LD1","PCMI25":"P4LE1","PCMI26":"P4HG1","PCMI28":"P8EA1"}};
  const PREFIXE = {'13703': 'DP', '16702': 'DPC', '13406': 'PCMI'};
  const PIECES_J = ['1', '2', '3', '4', '5', '6', '7', '8', '11'];
  const NOM_PJ = {1: 'Plan de situation', 2: 'Plan de masse', 3: 'Plan en coupe', 4: 'Façades et toitures (notice en permis)', 5: 'Aspect extérieur (façades en permis)', 6: 'Insertion', 7: 'Photo proche', 8: 'Photo lointaine', 11: 'Notice matériaux (secteur protégé)'};
  // Projets qui créent de la surface de plancher (clos et couverts), avec la part de l'emprise retenue comme première estimation (murs déduits).
  const PLANCHER = {extension: 0.88, veranda: 0.93, annexe: 0.88, abri: 0.93, surelevation: 0.88, maison: 0.85};
  const nbr = s => { const m = String(s || '').replace(',', '.').match(/\d+(\.\d+)?/); return m ? +m[0] : null; };
  const m2 = x => x == null || !Number.isFinite(x) ? '' : String(Math.round(x * 100) / 100).replace('.', ',');

  // ---------- lecture « au mieux » des réponses libres du client ----------
  const rep = (d, id) => ((d.pieces || []).find(p => p.id === id) || {}).texte || '';
  function decouperAdresse(s) {
    const m = String(s || '').replace(/\s+/g, ' ').trim().match(/^(\d+\s?(?:bis|ter|quater|[A-Da-d])?)?[\s,]*(.*?)[\s,]*(\d{5})\s+(.+)$/i);
    return m ? {numero: (m[1] || '').trim(), voie: m[2].trim(), code: m[3], localite: m[4].replace(/[\s,;.-]+$/, '').trim()} : {numero: '', voie: String(s || '').trim(), code: '', localite: ''};
  }
  function lire(d, t) {
    const o = {};
    const nom = rep(d, 'cerfa-nom').split(/[\n,;]| et /)[0].trim(), mots = nom.split(/\s+/).filter(Boolean);
    const maj = mots.filter(m => m.length > 1 && m === m.toUpperCase());
    if (maj.length && maj.length < mots.length) { o.nom = maj.join(' '); o.prenom = mots.filter(m => !maj.includes(m)).join(' '); }
    else { let i = mots.findIndex((m, k) => k > 0 && /^(de|du|des|le|la|d'.*|von|van)$/i.test(m)); if (i < 0) i = mots.length - 1; o.nom = mots.slice(i).join(' '); o.prenom = mots.slice(0, i).join(' '); }
    const na = rep(d, 'cerfa-naissance'), dn = na.match(/(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{4})/);
    o.naissance = dn ? `${dn[1].padStart(2, '0')}/${dn[2].padStart(2, '0')}/${dn[3]}` : '';
    const lieu = na.replace(dn ? dn[0] : '', '').replace(/^[\s,àa]+(?=[A-ZÀ-Ý])/, '').trim(), dp = lieu.match(/\((\d{2,3}|2[AB])\)/i);
    o.naissCommune = lieu.replace(/\(.*?\)/g, '').replace(/n[ée]e?\s+le/i, '').replace(/^[\s,;:.-]*(à\s+)?/i, '').replace(/[\s,;.-]+$/, '').trim(); o.naissDept = dp ? dp[1] : ''; o.naissPays = o.naissCommune ? 'France' : '';
    const ad = rep(d, 'cerfa-adresse'), tel = ad.replace(/[.\s-]/g, '').match(/(?:\+33|0)(\d{9})/);
    o.tel = tel ? '0' + tel[1] : '';
    const terrain = decouperAdresse(d.adresse), meme = !ad || /m[êe]me/i.test(ad);
    const post = meme ? terrain : decouperAdresse(ad.replace(/(?:\+33|0)\s?\d(?:[\s.-]?\d{2}){4}/, '').replace(/[,;]\s*$/, ''));
    Object.assign(o, {pNumero: post.numero, pVoie: post.voie, pCode: post.code, pLocalite: post.localite, tNumero: terrain.numero, tVoie: terrain.voie, tCode: terrain.code, tLocalite: terrain.localite});
    o.email = d.email || '';
    o.okMail = /^\s*oui/i.test(rep(d, 'cerfa-courriel'));
    const res = rep(d, 'cerfa-residence'); o.residence = /second/i.test(res) ? 'secondaire' : /princip/i.test(res) ? 'principale' : '';
    const p = t && t.parcelle;
    if (p) { o.section = p.section || ''; o.numero = String(p.numero || ''); o.prefixe = p.idu && p.idu.length >= 14 ? p.idu.slice(5, 8) : '000'; o.superficie = String(p.contenance || p.surfaceCalculee || ''); if (!o.tLocalite) o.tLocalite = p.commune || ''; }
    o.description = rep(d, 'projet');
    // Surfaces : emprise existante au cadastre, emprise créée d'après le plan placé par le client, plancher estimé.
    const bats = ((t && t.batiments) || []).filter(b => b.surParcelle), plan = ((d.pieces || []).find(x => x.type === 'plan') || {}).plan;
    const cree = plan && plan.mesures && plan.mesures.surface ? plan.mesures.surface : null;
    o.emprAvant = bats.length ? m2(bats.reduce((a, b) => a + (b.emprise || 0), 0)) : '';
    o.emprCreee = ['cloture', 'portail', 'menuiseries', 'velux', 'lucarne', 'toiture', 'facade', 'solaire', 'combles', 'garage', 'usage', 'surelevation'].includes(d.projet) ? '0' : m2(cree);
    const dit = nbr(rep(d, 'surface')), est = bats.filter(b => !b.leger && b.emprise >= 20).reduce((a, b) => a + b.emprise * Math.max(1, b.etages || (b.hauteur > 5 ? 2 : 1)) * 0.85, 0);
    o.spExist = d.projet === 'maison' ? '0' : dit ? m2(dit) : est ? m2(Math.round(est)) : ''; o.spExistSource = dit ? 'donnée par le client' : est ? 'estimée d\'après le cadastre' : '';
    const k = PLANCHER[d.projet];
    o.spCreee = d.projet === 'combles' ? m2(nbr(rep(d, 'surface-combles'))) : d.projet === 'garage' ? m2((() => { const g = rep(d, 'dimensions-du-garage').replace(/,/g, '.').match(/(\d+(?:\.\d+)?)\s*m?\s*[x×]\s*(\d+(?:\.\d+)?)/i); return g ? g[1] * g[2] * 0.9 : null; })()) : k && cree ? m2(cree * k) : k ? '' : '0';
    const pr = (t && t.protections) || [];
    o.mh = pr.some(x => x.type === 'ac1'); o.spr = pr.some(x => x.type === 'ac4'); o.classe = pr.some(x => x.type === 'ac2' && /class/i.test((x.libelle || '') + (x.detail || '')));
    // Pièces jointes : celles déjà déposées dans « Pièces à livrer », sinon le jeu habituel du projet.
    const dep = (d.livrables || []).map(l => (String(l.code).match(/^(?:DP|PC)(\d+)$/) || [])[1]).filter(Boolean);
    o.pj = dep.length ? dep : ['1', '2', '4', '6', '7', '8'].concat(d.kind === 'pc' || ['piscine', 'extension', 'maison', 'surelevation', 'annexe'].includes(d.projet) ? ['3'] : [], d.kind === 'pc' ? ['5'] : [], pr.length && d.kind !== 'pc' ? ['11'] : []);
    o.pjSource = dep.length ? 'd\'après les PDF déposés' : 'jeu habituel pour ce projet, à ajuster';
    o.lieuSignature = o.pLocalite || ''; const j = new Date(); o.dateSignature = `${String(j.getDate()).padStart(2, '0')}/${String(j.getMonth() + 1).padStart(2, '0')}/${j.getFullYear()}`;
    return o;
  }

  // ---------- remplissage ----------
  const WIN = /[^ -~ -ÿŒœŠšŸŽž–—‘’“”•…€]/g; // hors police standard du PDF
  const propre = s => String(s == null ? '' : s).replace(/’/g, "'").replace(/\r/g, '').replace(WIN, '');
  async function remplir(code, v, projet) {
    const octets = await (await fetch('/assets/cerfa/' + FORMS[code].f)).arrayBuffer();
    const doc = await window.PDFLib.PDFDocument.load(octets), form = doc.getForm(), rate = [];
    const txt = (nom, val, chiffres) => {
      if (val == null || val === '') return;
      let f; try { f = form.getTextField(nom); } catch (e) { return; } // champ absent de ce formulaire
      let s = propre(val); if (chiffres) s = s.replace(/[^0-9A-Za-z]/g, '');
      const max = f.getMaxLength(); if (max && s.length > max) { rate.push(`${nom} : « ${s} » coupé à ${max} caractères`); s = s.slice(0, max); }
      try { f.setText(s); } catch (e) { rate.push(nom); }
    };
    const coche = (nom, oui) => { if (!oui) return; try { form.getCheckBox(nom).check(); } catch (e) {} };
    if (v.societe) { txt('D2D_denomination', v.societe); txt('D2S_siret', v.siret, true); txt('D2N_nom', v.nom); txt('D2P_prenom', v.prenom); }
    else { txt('D1N_nom', v.nom); txt('D1P_prenom', v.prenom); txt('D1A_naissance', v.naissance, true); txt('D1C_commune', v.naissCommune); txt('D1D_dept', v.naissDept, true); txt('D1E_pays', v.naissPays); }
    txt('D3N_numero', v.pNumero); txt('D3V_voie', v.pVoie); txt('D3W_lieudit', v.pLieudit); txt('D3L_localite', v.pLocalite); txt('D3C_code', v.pCode, true); txt('D3T_telephone', v.tel, true);
    const [a, b] = String(v.email || '').split('@'); if (b) { txt('D5GE1_email', a); txt('D5GE2_email', b); }
    coche('D5A_acceptation', v.okMail);
    txt('T2Q_numero', v.tNumero); txt('T2V_voie', v.tVoie); txt('T2W_lieudit', v.tLieudit); txt('T2L_localite', v.tLocalite); txt('T2C_code', v.tCode, true);
    txt('T2F_prefixe', v.prefixe, true); txt('T2S_section', v.section, true); txt('T2N_numero', String(v.numero || '').replace(/\D/g, '').padStart(4, '0').slice(-4), true); txt('T2T_superficie', v.superficie, true); txt('D5T_total', v.superficie, true);
    (NATURE[projet] || (AUTRE_EXIST[projet] ? ['C2ZB1_existante'] : [])).forEach(n => coche(n, true));
    if (AUTRE_NEUF[projet]) txt('C2ZA7_autres', AUTRE_NEUF[projet]);
    if (AUTRE_EXIST[projet]) txt('C2ZB5_travaux', AUTRE_EXIST[projet]);
    txt('C2ZD1_description', v.description);
    coche('C2ZF1_principale', v.residence === 'principale'); coche('C2ZF2_secondaire', v.residence === 'secondaire');
    // Surfaces : trois cases sur le 13703, ligne « Logement » et ligne des totaux du tableau sur les deux autres.
    const A = nbr(v.spExist), Bc = nbr(v.spCreee);
    if (v.spCreee !== '' && Bc != null) {
      txt('C7A_surface', v.spExist); txt('C7U_creee', v.spCreee);
      const tot = m2((A || 0) + Bc);
      [['W2LA1', v.spExist], ['W2LB1', v.spCreee], ['W2LF1', tot], ['W2SA1', v.spExist], ['W2SB1', v.spCreee], ['W2SF1', tot]].forEach(([n, x]) => txt(n, x));
      if (code === '13406' && !v.societe && (A || 0) + Bc <= 150) coche('H1H_honneur', true);
    }
    txt('W3ES1_avanttravaux', v.emprAvant); txt('W3ES2_creee', v.emprCreee);
    coche('X2H_historique', v.mh); coche('X2R_remarquable', v.spr); coche('X2C_classe', v.classe);
    (v.pj || []).forEach(n => { if (code === '13406' && +n > 8) return; const c = BORD[code][PREFIXE[code] + n]; if (c) coche(c, true); });
    txt('E1L_lieu', v.lieuSignature); txt('E1D_date', v.dateSignature, true);
    return {pdf: await doc.save(), rate};
  }

  // ---------- surfaces lues dans le projet.json du générateur de planches ----------
  // Priorité au tableau « SURFACES » imprimé sur le plan de masse (le Cerfa doit dire la même chose que le plan),
  // puis, à défaut, calcul sur les volumes.
  function depuisPlans(j) {
    const o = {}, pris = [], manque = [];
    const fr2 = x => String(Math.round(x * 100) / 100).replace('.', ',');
    const lu = re => { const l = (j.surfaces || []).find(x => re.test(String(x[0]))); const m = l && String(l[1]).match(/(\d+(?:[.,]\d+)?)\s*m²/); return m ? m[1].replace('.', ',') : ''; };
    const vol = etat => (j.volumes || []).filter(x => (x.etat || 'existant') === etat && Array.isArray(x.rect)).reduce((a, x) => a + Math.abs((x.rect[2] - x.rect[0]) * (x.rect[3] - x.rect[1])), 0);
    const pose = (k, lib, tab, calc) => { if (tab) { o[k] = tab; pris.push(lib + ' ' + tab + ' m² (tableau du plan)'); } else if (calc != null) { o[k] = fr2(calc); pris.push(lib + ' ' + o[k] + ' m² (calculée sur les volumes)'); } else manque.push(lib); };
    const aVol = (j.volumes || []).length > 0;
    pose('emprAvant', 'emprise existante', lu(/emprise\s+existante/i), aVol ? vol('existant') : null);
    pose('emprCreee', 'emprise créée', lu(/emprise\s+cr[ée]{2}e/i), aVol ? vol('projet') : null);
    const sp = j.surface_plancher || {};
    pose('spExist', 'surface de plancher existante', sp.existante != null ? fr2(sp.existante) : lu(/plancher\s+existante/i), null);
    pose('spCreee', 'surface de plancher créée', sp.creee != null ? fr2(sp.creee) : lu(/plancher\s+cr[ée]{2}e/i), null);
    if (j.surface_terrain) { o.superficie = String(j.surface_terrain); pris.push('terrain ' + o.superficie + ' m²'); }
    const pc = String(j.parcelle || '').trim().match(/^([A-Z0-9]{1,2})\s*0*(\d{1,4})$/i);
    if (pc) { o.section = pc[1].toUpperCase(); o.numero = pc[2]; }
    return {o, pris, manque};
  }

  // ---------- fenêtre de relecture ----------
  const CHAMPS = [
    ['Demandeur', [['prenom', 'Prénom'], ['nom', 'Nom'], ['naissance', 'Né(e) le (JJ/MM/AAAA)'], ['naissCommune', 'Commune de naissance'], ['naissDept', 'Département'], ['naissPays', 'Pays'], ['societe', 'Société (si le demandeur est une société)'], ['siret', 'SIRET']]],
    ['Où la mairie écrit', [['pNumero', 'Numéro'], ['pVoie', 'Voie'], ['pLieudit', 'Lieu-dit'], ['pCode', 'Code postal'], ['pLocalite', 'Commune'], ['tel', 'Téléphone'], ['email', 'E-mail']]],
    ['Terrain', [['tNumero', 'Numéro'], ['tVoie', 'Voie'], ['tLieudit', 'Lieu-dit'], ['tCode', 'Code postal'], ['tLocalite', 'Commune'], ['prefixe', 'Préfixe'], ['section', 'Section'], ['numero', 'Numéro de parcelle'], ['superficie', 'Superficie (m²)']]],
    ['Signature', [['lieuSignature', 'Fait à'], ['dateSignature', 'Le (JJ/MM/AAAA)']]]
  ];
  function ouvrir(o) {
    const d = o.dossier, v = lire(d, o.terrain);
    const defaut = d.kind === 'pc' ? '13406' : '13703';
    const fen = document.createElement('div'); fen.className = 'plan-fen'; fen.setAttribute('role', 'dialog'); fen.setAttribute('aria-modal', 'true'); fen.setAttribute('aria-label', 'Formulaire Cerfa');
    const champ = ([k, lib]) => `<label class="field cf-c"><span>${esc(lib)}</span><input name="${k}" value="${esc(v[k] || '')}"></label>`;
    const brut = ['cerfa-nom', 'cerfa-naissance', 'cerfa-adresse', 'cerfa-residence', 'cerfa-courriel'].map(id => { const p = (d.pieces || []).find(x => x.id === id); return p ? `<dt>${esc(p.nom)}</dt><dd>${esc(p.texte) || '<i>pas de réponse</i>'}</dd>` : ''; }).join('');
    fen.innerHTML = `<div class="plan-boite"><div class="plan-tete"><b>Formulaire Cerfa · ${esc(d.ref)}</b><button type="button" class="plan-x" aria-label="Fermer">×</button></div>
      <form class="plan-corps cf">
        <p class="note" style="margin-top:0">Relisez chaque case : elles sont remplies au mieux d'après les réponses du client et le cadastre. Le reste du formulaire (surfaces, pièces jointes, taxe) se complète ensuite dans le PDF.</p>
        ${brut ? `<details class="cf-brut"><summary>Ce que le client a écrit</summary><dl class="dl">${brut}</dl></details>` : '<p class="form-err">Ce dossier n\'a pas les questions « Pour le formulaire de la mairie » : demandez-les au client ou remplissez à la main.</p>'}
        <label class="field"><span>Formulaire</span><select name="code">${Object.entries(FORMS).map(([k, f]) => `<option value="${k}"${k === defaut ? ' selected' : ''}>${esc(f.n)}</option>`).join('')}</select></label>
        ${CHAMPS.map(([t, l]) => `<fieldset class="cf-g"><legend>${t}</legend>${l.map(champ).join('')}</fieldset>`).join('')}
        <fieldset class="cf-g"><legend>Projet</legend>
          <label class="field" style="flex:1 1 100%"><span>Courte description (reprise sur le formulaire)</span><textarea name="description" rows="3" maxlength="1000">${esc(v.description)}</textarea></label>
          <label class="field cf-c"><span>Résidence</span><select name="residence"><option value="">Non précisé</option><option value="principale"${v.residence === 'principale' ? ' selected' : ''}>Principale</option><option value="secondaire"${v.residence === 'secondaire' ? ' selected' : ''}>Secondaire</option></select></label>
          <label class="cf-coche"><input type="checkbox" name="okMail"${v.okMail ? ' checked' : ''}> Le demandeur accepte les courriers de la mairie par e-mail</label></fieldset>
        <fieldset class="cf-g"><legend>Surfaces</legend>
          <label class="field cf-c"><span>Surface de plancher existante (m²)${v.spExistSource ? ' · ' + v.spExistSource : ''}</span><input name="spExist" value="${esc(v.spExist)}"></label>
          <label class="field cf-c"><span>Surface de plancher créée (m²)${PLANCHER[d.projet] && v.spCreee ? ' · estimée d\'après le plan' : ''}</span><input name="spCreee" value="${esc(v.spCreee)}"></label>
          <label class="field cf-c"><span>Emprise au sol existante (m²) · cadastre</span><input name="emprAvant" value="${esc(v.emprAvant)}"></label>
          <label class="field cf-c"><span>Emprise au sol créée (m²)${v.emprCreee && v.emprCreee !== '0' ? ' · plan du client' : ''}</span><input name="emprCreee" value="${esc(v.emprCreee)}"></label>
          <div style="flex:1 1 100%;margin:0 0 10px"><label class="btn ghost" style="cursor:pointer">Reprendre les surfaces des plans (projet.json)<input type="file" accept=".json,application/json" data-plans hidden></label><p class="note" data-plans-note hidden style="margin:8px 0 0"></p></div>
          <p class="note" style="flex:1 1 100%;margin:0 0 10px">Estimations de départ : remplacez-les par les surfaces des plans définitifs. Depuis 2022 la taxe d'aménagement ne se déclare plus sur ce formulaire, mais sur impots.gouv.fr après les travaux.</p></fieldset>
        <fieldset class="cf-g"><legend>Protections (données du Géoportail)</legend>
          ${[['mh', 'Abords d\'un monument historique'], ['spr', 'Site patrimonial remarquable'], ['classe', 'Site classé']].map(([k, l]) => `<label class="cf-coche" style="flex:1 1 220px"><input type="checkbox" name="${k}"${v[k] ? ' checked' : ''}> ${l}</label>`).join('')}</fieldset>
        <fieldset class="cf-g"><legend>Pièces jointes cochées au bordereau · ${esc(v.pjSource)}</legend>
          ${PIECES_J.map(n => `<label class="cf-coche" style="flex:1 1 220px"><input type="checkbox" name="pj" value="${n}"${v.pj.includes(n) ? ' checked' : ''}> ${n} · ${NOM_PJ[n]}</label>`).join('')}</fieldset>
        <p class="form-err" role="alert" hidden data-err></p>
      </form>
      <div class="plan-pied"><button type="button" class="btn blue-btn" data-gen="dl">Télécharger le PDF pré-rempli</button>${o.deposer ? '<button type="button" class="btn ghost" data-gen="depot">Déposer dans « Pièces à livrer »</button>' : ''}</div></div>`;
    document.body.appendChild(fen);
    const fermer = () => fen.remove(); fen.querySelector('.plan-x').onclick = fermer;
    const err = fen.querySelector('[data-err]'), F = fen.querySelector('form');
    fen.querySelector('[data-plans]').onchange = async e => {
      const f = e.target.files[0], n = fen.querySelector('[data-plans-note]'); if (!f) return;
      try {
        const r = depuisPlans(JSON.parse(await f.text()));
        if (!r.pris.length) throw 0;
        Object.entries(r.o).forEach(([k, x]) => { if (F[k]) F[k].value = x; });
        n.textContent = 'Repris des plans : ' + r.pris.join(', ') + '.' + (r.manque.length ? ' Absent des plans, à vérifier : ' + r.manque.join(', ') + '.' : '');
      } catch (_) { n.textContent = 'Ce fichier n\'est pas un projet.json du générateur de planches.'; }
      n.hidden = false; e.target.value = '';
    };
    fen.querySelectorAll('[data-gen]').forEach(b => b.onclick = async () => {
      const vals = {}; new FormData(F).forEach((x, k) => vals[k] = String(x).trim()); vals.okMail = F.okMail.checked; ['mh', 'spr', 'classe'].forEach(k => vals[k] = F[k].checked); vals.pj = [...F.querySelectorAll('[name=pj]:checked')].map(x => x.value);
      const lib = b.textContent; b.disabled = true; b.textContent = 'Préparation…'; err.hidden = true;
      try {
        const r = await remplir(vals.code, vals, d.projet), nomF = `${d.ref}-cerfa-${vals.code}.pdf`;
        const blob = new Blob([r.pdf], {type: 'application/pdf'});
        if (b.dataset.gen === 'depot') { const ok = await o.deposer(new File([blob], nomF, {type: 'application/pdf'})); if (ok) return fermer(); throw new Error('depot'); }
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomF; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        if (r.rate.length) { err.textContent = 'À vérifier dans le PDF : ' + r.rate.join(' ; '); err.hidden = false; }
      } catch (e) { err.textContent = e.message === 'depot' ? 'Le dépôt n\'a pas marché. Téléchargez le PDF et déposez-le à la main.' : 'Le formulaire n\'a pas pu être rempli. Rechargez la page et réessayez.'; err.hidden = false; }
      b.disabled = false; b.textContent = lib;
    });
  }
  window.BPCerfa = {ouvrir, _test: {lire, remplir, decouperAdresse, depuisPlans}};
})();
