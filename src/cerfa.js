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

  // ---------- lecture « au mieux » des réponses libres du client ----------
  const rep = (d, id) => ((d.pieces || []).find(p => p.id === id) || {}).texte || '';
  function decouperAdresse(s) {
    const m = String(s || '').replace(/\s+/g, ' ').trim().match(/^(\d+\s?(?:bis|ter|quater|[A-Da-d])?)?[\s,]*(.*?)[\s,]*(\d{5})\s+(.+)$/i);
    return m ? {numero: (m[1] || '').trim(), voie: m[2].trim(), code: m[3], localite: m[4].trim()} : {numero: '', voie: String(s || '').trim(), code: '', localite: ''};
  }
  function lire(d, t) {
    const o = {};
    const nom = rep(d, 'cerfa-nom').split(/[\n,;]| et /)[0].trim(), mots = nom.split(/\s+/).filter(Boolean);
    const maj = mots.filter(m => m.length > 1 && m === m.toUpperCase());
    if (maj.length && maj.length < mots.length) { o.nom = maj.join(' '); o.prenom = mots.filter(m => !maj.includes(m)).join(' '); }
    else { o.nom = mots.slice(-1).join(' '); o.prenom = mots.slice(0, -1).join(' '); }
    const na = rep(d, 'cerfa-naissance'), dn = na.match(/(\d{1,2})[\/.\- ](\d{1,2})[\/.\- ](\d{4})/);
    o.naissance = dn ? `${dn[1].padStart(2, '0')}/${dn[2].padStart(2, '0')}/${dn[3]}` : '';
    const lieu = na.replace(dn ? dn[0] : '', '').replace(/^[\s,àa]+(?=[A-ZÀ-Ý])/, '').trim(), dp = lieu.match(/\((\d{2,3}|2[AB])\)/i);
    o.naissCommune = lieu.replace(/\(.*?\)/g, '').replace(/^à\s+/i, '').trim(); o.naissDept = dp ? dp[1] : ''; o.naissPays = o.naissCommune ? 'France' : '';
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
    txt('E1L_lieu', v.lieuSignature); txt('E1D_date', v.dateSignature, true);
    return {pdf: await doc.save(), rate};
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
        <p class="form-err" role="alert" hidden data-err></p>
      </form>
      <div class="plan-pied"><button type="button" class="btn blue-btn" data-gen="dl">Télécharger le PDF pré-rempli</button>${o.deposer ? '<button type="button" class="btn ghost" data-gen="depot">Déposer dans « Pièces à livrer »</button>' : ''}</div></div>`;
    document.body.appendChild(fen);
    const fermer = () => fen.remove(); fen.querySelector('.plan-x').onclick = fermer;
    const err = fen.querySelector('[data-err]'), F = fen.querySelector('form');
    fen.querySelectorAll('[data-gen]').forEach(b => b.onclick = async () => {
      const vals = {}; new FormData(F).forEach((x, k) => vals[k] = String(x).trim()); vals.okMail = F.okMail.checked;
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
  window.BPCerfa = {ouvrir, _test: {lire, remplir, decouperAdresse}};
})();
