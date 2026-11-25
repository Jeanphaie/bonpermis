"""Le Bon Permis - planches d'un abri de jardin ou d'une annexe simple (rectangle, toit deux pans), depuis projet.json.
usage : python3 abri.py <dossier>"""
import json, math, os, subprocess, sys, textwrap
import numpy as np
from shapely.geometry import Polygon as SP, LineString, box
from shapely.ops import nearest_points
from planche import Planche, ZONE, ENCRE, GRIS, ROUGE, LW_COUPE, LW_VUE, LW_FIN, LW_TRES_FIN

fr = lambda x, d=2: f'{x:.{d}f}'.replace('.', ',')
signe = lambda z: '±0,00' if abs(z) < 0.005 else f'+{fr(z)}'
BOIS, BOIS_L, TOLE, TOLE_L, DALLE, VERT = '#2e2f32', '#5c6066', '#9aa1a8', '#6f777f', '#d9dcdf', '#2f7d4f'

D = sys.argv[1]
d = json.load(open(os.path.join(D, 'projet.json')))
T = json.load(open(os.path.join(D, 'terrain.json')))
ALT = json.load(open(os.path.join(D, 'alti.json')))['elevations']
OUT = os.path.join(D, 'sortie'); os.makedirs(OUT, exist_ok=True)
A = d['abri']
L, l, EG, FA, PL = A['longueur'], A['largeur'], A['egout'], A['faitage'], A['plancher']
DE, DR = A['debord_egout'], A['debord_rive']
PENTE = (FA - EG) / (l / 2)
c0 = d['origine_lonlat']; mLat = 111320.0; mLon = 111320.0 * math.cos(math.radians(c0[1]))
M = lambda q: ((q[0] - c0[0]) * mLon, (q[1] - c0[1]) * mLat)
ang = math.radians(A['angle_deg']); ca, sa = math.cos(ang), math.sin(ang)
du = A.get('decalage_u', 0)
loc = lambda u, v: ((u + du) * ca - v * sa, (u + du) * sa + v * ca)            # repère de l'abri -> plan (m, nord en haut)
PARC = [M(q) for q in T['parcelle']['geometrie']['coordinates'][0][0]]
SPARC = SP(PARC)
COINS = [loc(-L / 2, -l / 2), loc(L / 2, -l / 2), loc(L / 2, l / 2), loc(-L / 2, l / 2)]
SAB = SP(COINS)
BATS = [(b, [M(q) for q in b['contour']]) for b in T['batiments']]
VOIS = [[M(q) for q in v['contour']] for v in T['voisines']]
SEGS = list(zip(SPARC.exterior.coords[:-1], SPARC.exterior.coords[1:]))
DIST = sorted([(SAB.distance(LineString(s)), s) for s in SEGS], key=lambda t: t[0])
EMPRISE = L * l
BATI = sum(b['emprise'] for b, _ in BATS if b['surParcelle'])
# Rien de propre à un dossier n'est écrit en dur : tout vient de projet.json, avec des valeurs par défaut neutres.
REGUL = bool(d.get('regularisation', 'annee' in A))
ETAT = 'à régulariser' if REGUL else 'projetée'
REG = d.get('regles', {})                    # {emprise_max_pct, emprise_ref, implantation, hauteur} : lignes écrites seulement si fournies
MAT = {'murs': 'Murs : madriers bois horizontaux, lasure noire mate', 'portes': 'Portes : bois à lames verticales, lasure noire',
       'couverture': 'Couverture : bac acier nervuré gris', 'rives': 'Rives et bandeaux : bois, lasure noire', 'soubassement': 'Soubassement : dalle béton brut',
       'teinte_murs': BOIS, 'teinte_toit': TOLE, 'plancher': 'Plancher bois sur dalle béton',
       'coupe': ['Murs en madriers de bois emboîtés (45 mm), lasure noire.', 'Charpente bois, couverture en bac acier nervuré gris.', 'Dalle béton, plancher bois.'],
       'note': 'Aucune gouttière : égouts libres, eaux infiltrées sur la parcelle.'}
MAT.update(d.get('materiaux', {}))
BOIS, TOLE = MAT['teinte_murs'], MAT['teinte_toit']
CARD = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ouest', 'ouest', 'nord-ouest']
card = lambda dx, dy: CARD[int(((math.degrees(math.atan2(dx, dy)) + 22.5) % 360) // 45)]     # (est, nord) -> point cardinal
face = lambda u, v: card(u * ca - v * sa, u * sa + v * ca)                                   # orientation d'une face de l'abri
def cote_limite(seg):
    p = nearest_points(SAB.centroid, LineString(seg))[1]
    return card(p.x - SAB.centroid.x, p.y - SAB.centroid.y)
PDFS = []
SOUS = {'PCMI1': 'Localisation du terrain dans la commune',
        'PCMI2': f'Construction {ETAT} cotée dans les trois dimensions, distances aux limites, coupes et prises de vue',
        'PCMI3': f'Profil du terrain naturel, construction {ETAT}, limites de propriété',
        'PCMI5': f'Aspect extérieur de la construction {ETAT}, matériaux et teintes, plan de toiture',
        'PCMI6': "La construction dans son environnement, depuis le point de vue de la photographie proche",
        'PCMI7-8': 'Environnement proche et paysage lointain, angles reportés sur le plan de masse'}


def planche(code, titre, ech):
    return Planche(code, titre, ech, d, sous_titre=SOUS[code])


def fin(pl, code):
    n = os.path.join(OUT, code); pl.enregistrer(n); PDFS.append(n + '.pdf')


def alt(x, y):
    """Altitude IGN au point plan (m) : moyenne pondérée des 4 mesures les plus proches."""
    pts = sorted(((M((e['lon'], e['lat'])), e['z']) for e in ALT), key=lambda t: (t[0][0] - x) ** 2 + (t[0][1] - y) ** 2)[:4]
    w = [1 / (0.25 + (p[0] - x) ** 2 + (p[1] - y) ** 2) for p, _ in pts]
    return sum(wi * z for wi, (_, z) in zip(w, pts)) / sum(w)


TN_NGF = alt(*loc(0, 0))

# ------------------------------------------------------------------ PCMI1
def situation():
    pl = planche('PCMI1', 'Plan de situation', 'voir vues')
    x0, y0, x1, y1 = ZONE
    h = y1 - y0 - 30
    for s, (x, w) in zip(d['situation'], [(x0 + 4, 190), (x0 + 206, 150)]):
        pl.image(os.path.join(D, s['fichier']), x, y0 + 14, w, h)
        px, py = x + w / 2, y0 + 14 + h / 2
        pl.cercle((px, py), 5, ec=ROUGE, lw=LW_COUPE * 1.4, z=30)
        pl.texte(px + 7, py + 4, 'Terrain du projet', 2.2, gras=True, couleur=ROUGE, z=30, bbox=dict(fc='white', ec='none', pad=1.2, alpha=0.85))
        pl.titre_vue(x, y0 + 14 + h + 6, s['titre'], s['echelle'])
        metres, den = s['barre']
        pl.barre_echelle(x, y0 + 6, metres, 1000.0 / den, pas=metres / 5)
        pl.nord(x + w - 8, y0 + 14 + h - 12)
    pl.texte(x0 + 4, y0 + 1, d['situation_source'], 1.6, couleur=GRIS)
    fin(pl, 'PCMI1')


# ------------------------------------------------------------------ PCMI2
def dessin_plan(pl, P, clip, detail=False):
    def pol(pts, **kw):
        g = SP([P(q) for q in pts]).buffer(0).intersection(clip)
        for hh in getattr(g, 'geoms', [g]):
            if hh.geom_type == 'Polygon' and not hh.is_empty:
                pl.poly(list(hh.exterior.coords), **kw)

    def lig(pts, **kw):
        g = LineString([P(q) for q in pts]).intersection(clip)
        for hh in getattr(g, 'geoms', [g]):
            if hh.geom_type == 'LineString' and not hh.is_empty:
                pl.ligne(list(hh.coords), **kw)
    for v in VOIS:
        lig(v, lw=LW_FIN, c=GRIS)
    pol(PARC, fc='#f4f7f1', ec='none', lw=0, z=4)
    lig(PARC, lw=LW_COUPE, c=ENCRE, ls=(0, (10, 2.5, 2, 2.5)), z=15)
    for b, pts in BATS:
        if b['surParcelle']:
            pol(pts, fc='#b9bfc6', ec=ENCRE, lw=LW_COUPE if not detail else LW_VUE, z=18)
        else:
            pol(pts, fc='#e3e5e8', ec=GRIS, lw=LW_FIN, z=9)
    pol(COINS, fc='#f9e3e0', ec=ROUGE, lw=LW_COUPE, z=19, hatch='////')
    return pol, lig


def masse():
    fen = d['fenetre']; ech = 250; k = 1000.0 / ech
    pl = planche('PCMI2', 'Plan de masse', f'1/{ech}')
    x0, y0, x1, y1 = ZONE
    col = 112
    w, h = (fen[2] - fen[0]) * k, (fen[3] - fen[1]) * k
    ox, oy = x0 + (x1 - x0 - col - w) / 2, y0 + (y1 - y0 - h) / 2 + 3
    P = lambda q: (ox + (q[0] - fen[0]) * k, oy + (q[1] - fen[1]) * k)
    clip = box(ox, oy, ox + w, oy + h)
    pl.rect(ox, oy, w, h, lw=LW_TRES_FIN, ec=GRIS)
    dessin_plan(pl, P, clip)
    # libellés
    maison = max((b for b in BATS if b[0]['surParcelle']), key=lambda t: t[0]['emprise'])
    cm = SP(maison[1]).representative_point()
    pl.texte(*P((cm.x, cm.y)), 'MAISON\nEXISTANTE', 1.7, ha='center', va='center', z=24, bbox=dict(fc='white', ec='none', pad=0.8, alpha=0.9), linespacing=1.4)
    lp = loc(0, 0)
    pl.texte(P(lp)[0] - 20, P(lp)[1] - 14, f"ABRI DE JARDIN\n{fr(L)} x {fr(l)} m, {fr(EMPRISE, 1)} m²\négout +{fr(EG)} / faîtage +{fr(FA)}", 1.7, couleur=ROUGE, z=24, va='center', ha='right',
             bbox=dict(fc='white', ec='none', pad=0.8, alpha=0.9), linespacing=1.4)
    pl.ligne([P(loc(-L / 2, -l / 2)), (P(lp)[0] - 19, P(lp)[1] - 12)], lw=LW_TRES_FIN, c=ROUGE, z=24)
    from shapely.ops import polylabel
    libre = SPARC.buffer(-3)
    for b, pts in BATS:
        if b['surParcelle']:
            libre = libre.difference(SP(pts).buffer(4))
    libre = libre.difference(SAB.buffer(9))
    if libre.geom_type != 'Polygon':
        libre = max(libre.geoms, key=lambda g: g.area)
    cp = polylabel(libre, 0.2)
    pl.texte(*P((cp.x, cp.y)), f"PARCELLE {d['parcelle']}\n{d['surface_terrain']:,} m²".replace(',', ' '), 3.0, gras=True, ha='center', va='center', couleur=GRIS)
    pl.texte(*P(d['voie']['pos']), d['voie']['texte'], 2.4, rot=d['voie']['rot'], ha='center', couleur=GRIS, style='italic')
    # traits de coupe
    for nom, a, b, reg in COUPES:
        Aa, Bb = np.array(P(loc(*a))), np.array(P(loc(*b)))
        pl.ligne([Aa, Bb], lw=LW_FIN, c=ENCRE, ls=(0, (12, 3, 2, 3)), z=26)
        dp = np.array(P(loc(*reg))) - np.array(P(loc(0, 0))); dp /= np.linalg.norm(dp)
        tl = (Bb - Aa) / np.linalg.norm(Bb - Aa)
        for E, sg in ((Aa, -1), (Bb, 1)):
            pl.fleche(E, E + dp * 5, lw=LW_VUE, c=ENCRE, z=27, taille=7)
            Lb = E + tl * sg * 3.5
            pl.texte(Lb[0], Lb[1], nom[0], 2.4, gras=True, ha='center', va='center', z=27, bbox=dict(fc='white', ec='none', pad=0.3))
    # prises de vue
    for ph in d['photos']:
        S, C = np.array(P(ph['pos'])), np.array(P(ph['vise']))
        dv = (C - S) / np.linalg.norm(C - S)
        for sgn in (-1, 1):
            a = math.radians(22 * sgn); R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
            pl.ligne([S, S + R @ dv * 14], lw=LW_FIN, c=VERT, z=28)
        pl.cercle(S, 1.2, fc=VERT, ec='none', lw=0, z=28)
        pl.texte(S[0] - dv[0] * 6, S[1] - dv[1] * 6, 'PCMI' + ph['code'], 1.9, gras=True, couleur=VERT, ha='center', va='center', z=28, bbox=dict(fc='white', ec='none', pad=0.6))
    pl.nord(ox + w - 10, oy + h - 14)
    pl.barre_echelle(ox, oy - 8, 20, k, pas=5)
    # colonne de droite
    x = x1 - col + 6; y = y1 - 4
    pl.texte(x, y, 'LÉGENDE', 2.2, gras=True); y -= 7
    for fc, ec, ha, t in [('#b9bfc6', ENCRE, None, 'Construction existante conservée'), ('#f9e3e0', ROUGE, '////', (f"Abri de jardin à régulariser (construit en {A['annee']})" if REGUL and A.get('annee') else f'Abri de jardin {ETAT[:-1] if not REGUL else ETAT}')),
                          ('#e3e5e8', GRIS, None, 'Bâti voisin (IGN BD TOPO)')]:
        pl.rect(x, y - 1, 9, 4.5, fc=fc, ec=ec, lw=LW_VUE, hatch=ha); pl.texte(x + 12, y, t, 1.8); y -= 7
    pl.ligne([(x, y + 1.2), (x + 9, y + 1.2)], lw=LW_COUPE, ls=(0, (10, 2.5, 2, 2.5))); pl.texte(x + 12, y, 'Limite de la parcelle (cadastre)', 1.8); y -= 7
    pl.ligne([(x, y + 1.2), (x + 9, y + 1.2)], lw=LW_FIN, ls=(0, (12, 3, 2, 3))); pl.texte(x + 12, y, 'Trait de coupe (PCMI3)', 1.8); y -= 7
    pl.ligne([(x + 1, y + 1.2), (x + 9, y + 3.2)], lw=LW_FIN, c=VERT); pl.ligne([(x + 1, y + 1.2), (x + 9, y - 0.8)], lw=LW_FIN, c=VERT)
    pl.texte(x + 12, y, 'Prise de vue photographique', 1.8); y -= 11
    pl.texte(x, y, 'SURFACES', 2.2, gras=True); y -= 6
    tot = BATI + EMPRISE; S = d['surface_terrain']
    for a, b in [('Terrain', f"{S:,} m²".replace(',', ' ')), ('Emprise existante (IGN BD TOPO)', f'{fr(BATI, 0)} m²'), ('Emprise de l\'abri', f'{fr(EMPRISE)} m²'),
                 ('Emprise totale', f'{fr(tot, 0)} m², soit {fr(tot / S * 100, 1)} % du terrain'), ] + ([(f"Emprise maximale ({REG.get('emprise_ref') or 'règlement, ' + fr(REG['emprise_max_pct'], 0) + ' %'})", f"{fr(S * REG['emprise_max_pct'] / 100, 0)} m²")] if REG.get('emprise_max_pct') else []) + [
                 ('Surface de plancher de l\'abri', f'{fr(SDP)} m²')]:
        pl.texte(x, y, a, 1.7, couleur=GRIS); pl.texte(x + col - 10, y, b, 1.7, ha='right')
        pl.ligne([(x, y - 1.6), (x + col - 10, y - 1.6)], lw=LW_TRES_FIN, c='#d5d9de'); y -= 5
    y -= 6
    pl.texte(x, y, 'IMPLANTATION', 2.2, gras=True); y -= 6
    notes = [f"Distances aux limites séparatives : {fr(DIST[0][0])} m ({cote_limite(DIST[0][1])}) et {fr(DIST[1][0])} m ({cote_limite(DIST[1][1])}).{' ' + REG['implantation'] if REG.get('implantation') else ''}",
             f"Hauteurs depuis le terrain naturel : égout +{fr(EG)}, faîtage +{fr(FA)}. Terrain naturel à {fr(TN_NGF, 1)} m NGF (IGN RGE ALTI), non modifié.",
             d.get('acces') or f"Accès depuis la voie publique ({d['voie']['texte']}), inchangé.",
             d.get('reseaux') or "Aucun raccordement aux réseaux : abri de rangement.",
             d.get('eaux') or "Eaux de toiture infiltrées sur la parcelle."] + d.get('hypotheses', [])
    for n in notes:
        for i, ll in enumerate(textwrap.wrap(n, 70)):
            pl.texte(x, y, ('- ' if i == 0 else '  ') + ll, 1.55); y -= 3.5
        y -= 1.3
    # détail d'implantation au 1/100
    kd = 1000 / 150.0; dw, dh = col - 10, 58
    dx0, dy0 = x, y0 + 12
    cx, cy = loc(0, 0)
    Pd = lambda q: (dx0 + dw / 2 + (q[0] - cx) * kd, dy0 + dh / 2 + (q[1] - cy) * kd)
    clipd = box(dx0, dy0, dx0 + dw, dy0 + dh)
    pl.rect(dx0, dy0, dw, dh, lw=LW_TRES_FIN, ec=GRIS, fc='white', z=3)
    dessin_plan(pl, Pd, clipd, detail=True)
    pp = [Pd(q) for q in COINS]
    pl.cote(pp[0], pp[1], -5, fr(L), c=ROUGE); pl.cote(pp[1], pp[2], -5, fr(l), c=ROUGE)
    for dist, sg in DIST[:2]:
        pa, pb = nearest_points(SAB, LineString(sg))
        pl.cote(Pd((pa.x, pa.y)), Pd((pb.x, pb.y)), 0, fr(dist), c=ENCRE)
    pl.titre_vue(dx0, dy0 + dh + 6, "Détail de l'implantation", '1/150')
    pl.barre_echelle(dx0, dy0 - 7, 10, kd, pas=2)
    fin(pl, 'PCMI2')


# ------------------------------------------------------------------ PCMI3
SDP = round((L - 0.09) * (l - 0.09), 2)     # murs en madriers de 45 mm déduits
BBV = min((-1.6, 1.6), key=lambda v: LineString([loc(-L / 2, v), loc(-L / 2 - 6, v)]).intersection(SPARC.exterior).distance(__import__('shapely.geometry', fromlist=['Point']).Point(loc(-L / 2, v))))
COUPES = [('AA', (0.8, -l / 2 - 3.2), (0.8, l / 2 + 2.2), (-1, 0)), ('BB', (-L / 2 - 2.2, BBV), (L / 2 + 3.2, BBV), (0, 1))]
EPM, EPT, EPD = 0.045, 0.07, 0.12


def coupe(pl, nom, a, b, reg, X0, Y0, k):
    trans = abs(a[0] - b[0]) < 1e-6
    s_of = (lambda q: q[1]) if trans else (lambda q: q[0])
    s0, s1 = sorted([s_of(a), s_of(b)])
    half = l / 2 if trans else L / 2
    Q = lambda s, z: (X0 + (s - s0) * k, Y0 + z * k)
    # terrain naturel : droite ajustée sur les altitudes IGN le long de la coupe
    ss = np.linspace(s0, s1, 12)
    zz = [alt(*loc(a[0], s) if trans else loc(s, a[1])) - TN_NGF for s in ss]
    p1, p0 = np.polyfit(ss, zz, 1)
    p0 -= p1 * 0 + (p1 * 0 + p0)   # recalé à 0 au droit de l'abri
    tn = lambda s: p1 * s
    pts = [Q(s0, tn(s0)), Q(s1, tn(s1))]
    pl.ligne(pts, lw=LW_COUPE, z=40)
    pl.poly(pts + [Q(s1, -0.55), Q(s0, -0.55)], fc='none', ec='#aab1b9', lw=0, hatch='/////', z=9)
    pl.texte(pts[0][0], Q(s0, -0.55)[1] - 3.2, f'Terrain naturel (IGN RGE ALTI, {fr(TN_NGF, 1)} m NGF au droit de l\'abri), non modifié', 1.4, couleur=GRIS, z=41)
    R = dict(fc='#fbe4e1', ec=ROUGE, lw=LW_VUE, hatch='//////', z=35)
    # dalle, murs
    pl.poly([Q(-half - 0.05, PL - EPD), Q(half + 0.05, PL - EPD), Q(half + 0.05, PL), Q(-half - 0.05, PL)], **R)
    if trans:
        for sg in (-1, 1):
            pl.poly([Q(sg * half, PL), Q(sg * (half - EPM), PL), Q(sg * (half - EPM), EG + EPM * PENTE), Q(sg * half, EG)], **R)
        ze = EG - DE * PENTE
        toit = [Q(-half - DE, ze), Q(0, FA), Q(half + DE, ze), Q(half + DE, ze - EPT), Q(0, FA - EPT), Q(-half - DE, ze - EPT)]
        pl.poly(toit, **R)
        # pignon vu au-delà
        pl.poly([Q(-half + EPM, PL), Q(half - EPM, PL), Q(half - EPM, EG), Q(0, FA - EPT), Q(-half + EPM, EG)], fc='white', ec=ENCRE, lw=LW_FIN, z=30)
        pl.texte(Q(0.75, 0)[0], Q(0, FA + 0.22)[1], f'pente {fr(PENTE * 100, 0)} %', 1.6, couleur=ROUGE, rot=-math.degrees(math.atan(PENTE)), ha='center', z=41)
    else:
        pl.poly([Q(-half, PL), Q(-half + EPM, PL), Q(-half + EPM, FA - EPT), Q(-half, FA - EPT)], **R)
        hp = A['porte']['hauteur'] + PL
        pl.poly([Q(half - EPM, hp), Q(half, hp), Q(half, FA - EPT), Q(half - EPM, FA - EPT)], **R)
        pl.ligne([Q(half - EPM / 2, PL), Q(half - EPM / 2, hp)], lw=LW_FIN, c=ROUGE, ls=(0, (3, 2)), z=36)
        pl.texte(Q(half + 0.12, 1.0)[0], Q(0, 1.0)[1], 'portes', 1.4, couleur=ROUGE, rot=90, va='top', ha='center', z=41)
        pl.poly([Q(-half - DR, FA), Q(half + DR, FA), Q(half + DR, FA - EPT), Q(-half - DR, FA - EPT)], **R)
        pl.ligne([Q(-half - DR, EG - DE * PENTE), Q(half + DR, EG - DE * PENTE)], lw=LW_FIN, c=ENCRE, z=31)
        pl.rect(*Q(-half + EPM, PL), (2 * half - 2 * EPM) * k, (FA - EPT - PL) * k, fc='white', ec='none', lw=0, z=30)
    pl.texte(Q(0, 0)[0], Q(0, 1.05)[1], 'ABRI DE JARDIN\nrangement, non habitable', 1.7, ha='center', va='center', couleur=ROUGE, z=36, linespacing=1.5)
    # limites de propriété rencontrées
    A3, B3 = loc(*a), loc(*b)
    inter = LineString([A3, B3]).intersection(SPARC.exterior)
    for g in getattr(inter, 'geoms', [inter]):
        if g.is_empty:
            continue
        t = math.hypot(g.x - A3[0], g.y - A3[1]); s = s_of(a) + t * (1 if s_of(b) > s_of(a) else -1)
        xp = Q(s, 0)[0]
        pl.ligne([(xp, Q(0, tn(s))[1]), (xp, Q(0, 3.3)[1])], lw=LW_FIN, c=ROUGE, ls=(0, (6, 2, 1.5, 2)), z=37)
        pl.texte(xp - 1.0, Q(0, 2.2)[1], 'Limite de propriété', 1.5, couleur=ROUGE, rot=90, ha='left', z=37)
        mur = half if s > 0 else -half
        pl.cote(Q(min(mur, s), 0.75), Q(max(mur, s), 0.75), 0, fr(abs(s - mur)), c=ROUGE)
    # niveaux
    xr = Q(s1, 0)[0] + 6
    for hgt, lab in [(0.0, f'TN  ({fr(TN_NGF, 1)} NGF)'), (PL, 'plancher'), (EG, 'égout'), (FA, 'faîtage')]:
        y = Q(0, hgt)[1]; ye = y + (1.6 if lab == 'plancher' else 0)
        pl.ligne([(Q(s0, 0)[0] - 3, y), (xr - 1.5, y)], lw=LW_TRES_FIN, c=GRIS, ls=(0, (4, 3)), z=8)
        pl.niveau(xr + 1.2, ye, f"{signe(hgt)}  {lab}", taille=1.6)
    xc = Q(s0, 0)[0] - 8
    pl.cote((xc, Q(0, 0)[1]), (xc, Q(0, EG)[1]), 0, fr(EG)); pl.cote((xc, Q(0, EG)[1]), (xc, Q(0, FA)[1]), 0, fr(FA - EG))
    yb = Q(0, -0.55)[1] - 9
    pl.cote(Q(-half, 0)[0:1] + (yb,), Q(half, 0)[0:1] + (yb,), 0, fr(2 * half), c=ROUGE)
    pl.titre_vue(Q(s0, 0)[0], Q(0, 3.3)[1] + 8, f"Coupe {nom} - {'transversale' if trans else 'longitudinale'}", '1/50')
    return (s1 - s0) * k


def coupes():
    pl = planche('PCMI3', 'Plan en coupe du terrain et de la construction', '1/50')
    x0, y0, x1, y1 = ZONE
    k = 20.0
    coupe(pl, *COUPES[0], x0 + 40, y0 + 132, k)
    coupe(pl, *COUPES[1], x0 + 40, y0 + 32, k)
    x = x1 - 118; y = y1 - 30
    pl.texte(x, y, 'HAUTEURS', 2.2, gras=True); y -= 6
    for t in [f"Hauteur à l'égout : {fr(EG)} m depuis le terrain naturel.", f"Hauteur au faîtage : {fr(FA)} m."] + ([REG['hauteur']] if REG.get('hauteur') else []) + [
              f"Pente de toiture : {fr(PENTE * 100, 0)} % ({fr(math.degrees(math.atan(PENTE)), 0)}°).", f"{MAT['plancher']}, à +{fr(PL)} m du terrain naturel.",
              "Le terrain naturel n'a pas été modifié : ni déblai, ni remblai."]:
        for i, ll in enumerate(textwrap.wrap(t, 64)):
            pl.texte(x, y, ('- ' if i == 0 else '  ') + ll, 1.7); y -= 4
        y -= 1
    y -= 5
    pl.texte(x, y, 'CONSTRUCTION', 2.2, gras=True); y -= 6
    for t in MAT['coupe'] + [f"Construction {ETAT} dessinée en rouge."]:
        pl.texte(x, y, '- ' + t, 1.7); y -= 4.5
    fin(pl, 'PCMI3')


# ------------------------------------------------------------------ PCMI5
def sol(pl, xa, xb, y, k):
    pl.ligne([(xa - 6, y), (xb + 6, y)], lw=LW_COUPE, z=40)
    pl.rect(xa - 6, y - 0.30 * k, xb - xa + 12, 0.30 * k, fc='none', ec='#aab1b9', lw=0, hatch='/////', z=9)


def madriers(pl, poly, k, y0):
    g = SP(poly)
    z = 0.135
    while z < FA:
        seg = LineString([(g.bounds[0] - 1, y0 + (PL + z) * k), (g.bounds[2] + 1, y0 + (PL + z) * k)]).intersection(g)
        for h in getattr(seg, 'geoms', [seg]):
            if not h.is_empty and h.length > 0:
                pl.ligne(list(h.coords), lw=LW_TRES_FIN, c=BOIS_L, z=12)
        z += 0.135


def niveaux(pl, xr, xl, y0, k):
    for hgt, lab in [(0.0, 'TN'), (EG, 'égout'), (FA, 'faîtage')]:
        y = y0 + hgt * k
        pl.ligne([(xl - 3, y), (xr - 1.5, y)], lw=LW_TRES_FIN, c=GRIS, ls=(0, (4, 3)), z=8)
        pl.niveau(xr + 1.2, y, f"{signe(hgt)}  {lab}", taille=1.6)


def facade_long(pl, X0, Y0, k, titre):
    Q = lambda s, z: (X0 + (s + L / 2 + DR) * k, Y0 + z * k)
    mur = [Q(-L / 2, PL), Q(L / 2, PL), Q(L / 2, EG), Q(-L / 2, EG)]
    pl.poly([Q(-L / 2 - 0.05, 0), Q(L / 2 + 0.05, 0), Q(L / 2 + 0.05, PL), Q(-L / 2 - 0.05, PL)], fc=DALLE, ec=ENCRE, lw=LW_FIN, z=11)
    pl.poly(mur, fc=BOIS, ec=ENCRE, lw=LW_VUE, z=11); madriers(pl, mur, k, Y0)
    for sg in (-1, 1):   # têtes de madriers croisés aux angles
        pl.rect(Q(sg * L / 2, PL)[0] - (0.10 * k if sg < 0 else 0), Q(0, PL)[1], 0.10 * k, (EG - PL) * k, fc=BOIS, ec=ENCRE, lw=LW_FIN, z=12.5)
    ze = EG - DE * PENTE
    pan = [Q(-L / 2 - DR, ze), Q(L / 2 + DR, ze), Q(L / 2 + DR, FA), Q(-L / 2 - DR, FA)]
    pl.poly(pan, fc=TOLE, ec=ENCRE, lw=LW_VUE, z=13)
    s = -L / 2 - DR + 0.25
    while s < L / 2 + DR - 0.05:
        pl.ligne([Q(s, ze), Q(s, FA)], lw=LW_TRES_FIN, c=TOLE_L, z=13.1); s += 0.25
    sol(pl, Q(-L / 2 - DR, 0)[0], Q(L / 2 + DR, 0)[0], Y0, k)
    niveaux(pl, Q(L / 2 + DR, 0)[0] + 6, Q(-L / 2 - DR, 0)[0], Y0, k)
    yb = Y0 - 0.30 * k - 5
    pl.cote((Q(-L / 2, 0)[0], yb), (Q(L / 2, 0)[0], yb), 0, fr(L))
    pl.titre_vue(Q(-L / 2 - DR, 0)[0], Y0 + FA * k + 9, titre)


def pignon(pl, X0, Y0, k, titre, porte):
    Q = lambda s, z: (X0 + (s + l / 2 + DE) * k, Y0 + z * k)
    mur = [Q(-l / 2, PL), Q(l / 2, PL), Q(l / 2, EG), Q(0, FA), Q(-l / 2, EG)]
    pl.poly([Q(-l / 2 - 0.05, 0), Q(l / 2 + 0.05, 0), Q(l / 2 + 0.05, PL), Q(-l / 2 - 0.05, PL)], fc=DALLE, ec=ENCRE, lw=LW_FIN, z=11)
    pl.poly(mur, fc=BOIS, ec=ENCRE, lw=LW_VUE, z=11); madriers(pl, mur, k, Y0)
    for sg in (-1, 1):
        pl.rect(Q(sg * l / 2, PL)[0] - (0.10 * k if sg < 0 else 0), Q(0, PL)[1], 0.10 * k, (EG - PL) * k, fc=BOIS, ec=ENCRE, lw=LW_FIN, z=12.5)
    ze = EG - DE * PENTE; e = 0.14
    rive = [Q(-l / 2 - DE, ze), Q(0, FA), Q(l / 2 + DE, ze), Q(l / 2 + DE, ze - e), Q(0, FA - e), Q(-l / 2 - DE, ze - e)]
    pl.poly(rive, fc=BOIS, ec=ENCRE, lw=LW_VUE, z=14)
    pl.ligne([Q(-l / 2 - DE - 0.02, ze + 0.02), Q(0, FA + 0.03), Q(l / 2 + DE + 0.02, ze + 0.02)], lw=LW_COUPE, c=TOLE_L, z=14.2)
    if porte:
        w, h = A['porte']['largeur'], A['porte']['hauteur']
        pl.rect(*Q(-w / 2 - 0.08, PL), (w + 0.16) * k, (h + 0.08) * k, fc=BOIS, ec=BOIS_L, lw=LW_VUE, z=15)
        for i in (0, 1):
            xa = Q(-w / 2 + i * w / 2, 0)[0]
            pl.rect(xa, Q(0, PL)[1], w / 2 * k, h * k, fc=BOIS, ec=BOIS_L, lw=LW_VUE, z=15.1)
            n = 6
            for j in range(1, n):
                pl.ligne([(xa + j * w / 2 * k / n, Q(0, PL)[1]), (xa + j * w / 2 * k / n, Q(0, PL + h)[1])], lw=LW_TRES_FIN, c=BOIS_L, z=15.2)
            for zz in (0.25, h / 2, h - 0.25):
                x1_, x2_ = (xa, xa + w / 2 * k * 0.85) if i == 0 else (xa + w / 2 * k * 0.15, xa + w / 2 * k)
                pl.ligne([(x1_, Q(0, PL + zz)[1]), (x2_, Q(0, PL + zz)[1])], lw=LW_VUE, c='#8a8f96', z=15.3)
        pl.cercle(Q(0, PL + h + 0.22), 0.09 * k, fc='#e9e6da', ec=ENCRE, lw=LW_FIN, z=15.4)
        yb = Y0 - 0.30 * k - 12
        pl.cote((Q(-w / 2, 0)[0], yb), (Q(w / 2, 0)[0], yb), 0, f'{fr(w)} portes')
    sol(pl, Q(-l / 2 - DE, 0)[0], Q(l / 2 + DE, 0)[0], Y0, k)
    niveaux(pl, Q(l / 2 + DE, 0)[0] + 6, Q(-l / 2 - DE, 0)[0], Y0, k)
    yb = Y0 - 0.30 * k - 5
    pl.cote((Q(-l / 2, 0)[0], yb), (Q(l / 2, 0)[0], yb), 0, fr(l))
    pl.titre_vue(Q(-l / 2 - DE, 0)[0], Y0 + FA * k + 9, titre)


def facades():
    pl = planche('PCMI5', 'Façades et toitures', '1/50')
    x0, y0, x1, y1 = ZONE
    k = 20.0
    ya, yb = y0 + 150, y0 + 52
    xa = x0 + 6; xb = xa + (L + 2 * DR) * k + 40
    facade_long(pl, xa, ya, k, f'Façade {face(0, -1)}')
    pignon(pl, xb, ya, k, f'Pignon {face(1, 0)} (accès)', True)
    facade_long(pl, xa, yb, k, f'Façade {face(0, 1)}')
    pignon(pl, xb, yb, k, f'Pignon {face(-1, 0)}', False)
    # plan de toiture 1/100
    kt = 10.0
    tx = xb + (l + 2 * DE) * k + 34; ty = ya + 4
    Q = lambda u, v: (tx + (u + L / 2 + DR) * kt, ty + (v + l / 2 + DE) * kt)
    pl.poly([Q(-L / 2 - DR, -l / 2 - DE), Q(L / 2 + DR, -l / 2 - DE), Q(L / 2 + DR, l / 2 + DE), Q(-L / 2 - DR, l / 2 + DE)], fc=TOLE, ec=ENCRE, lw=LW_COUPE, z=10)
    u = -L / 2 - DR + 0.25
    while u < L / 2 + DR - 0.05:
        pl.ligne([Q(u, -l / 2 - DE), Q(u, l / 2 + DE)], lw=LW_TRES_FIN, c=TOLE_L, z=10.1); u += 0.25
    pl.ligne([Q(-L / 2 - DR, 0), Q(L / 2 + DR, 0)], lw=LW_COUPE, c=ENCRE, z=11)
    pl.poly([Q(-L / 2, -l / 2), Q(L / 2, -l / 2), Q(L / 2, l / 2), Q(-L / 2, l / 2)], fc='none', ec='white', lw=LW_FIN, ls=(0, (4, 2)), z=11)
    for sg in (-1, 1):
        a_, b_ = np.array(Q(0, sg * 0.5)), np.array(Q(0, sg * (l / 2 - 0.2)))
        pl.fleche(a_, b_, lw=LW_FIN, c='white', z=12, taille=7)
        pl.texte(Q(1.0, sg * 1.2)[0], Q(0, sg * 1.2)[1], f'{fr(PENTE * 100, 0)} %', 1.8, couleur='white', gras=True, ha='center', va='center', z=12.1)
    pp = [Q(-L / 2 - DR, -l / 2 - DE), Q(L / 2 + DR, -l / 2 - DE), Q(L / 2 + DR, l / 2 + DE)]
    pl.cote(pp[0], pp[1], -5, fr(L + 2 * DR)); pl.cote(pp[1], pp[2], -5, fr(l + 2 * DE))
    pl.nord(Q(L / 2 + DR, 0)[0] + 16, Q(0, l / 2)[1], angle_deg=-A['angle_deg'], taille=8)
    pl.titre_vue(tx, Q(0, l / 2 + DE)[1] + 9, 'Plan de toiture', '1/100')
    pl.texte(tx, Q(0, -l / 2 - DE)[1] - 14, 'Toit à deux pans, faîtage dans la longueur.\nPointillé blanc : nu extérieur des murs.', 1.6, couleur=GRIS, va='top', linespacing=1.5)
    # matériaux
    x = tx; y = yb + 44
    pl.texte(x, y, 'MATÉRIAUX ET TEINTES', 2.2, gras=True); y -= 7
    for fc, t in [(BOIS, MAT['murs']), (BOIS, MAT['portes']), (TOLE, MAT['couverture']), (BOIS, MAT['rives']), (DALLE, MAT['soubassement'])]:
        pl.rect(x, y - 0.8, 6, 3.6, fc=fc, ec=ENCRE, lw=LW_FIN); pl.texte(x + 9, y, t, 1.6); y -= 6
    pl.texte(x, y - 2, "\n".join(textwrap.wrap(f"Aucune ouverture autre que les portes du pignon {face(1, 0)}. {MAT['note']}", 48)), 1.6, couleur=GRIS, va='top', linespacing=1.5)
    pl.texte(x0 + 6, y0 + 3, ("Construction existante, à régulariser : les façades décrivent l'abri tel qu'il est construit. " if REGUL else '') + (d.get('hypotheses') or [''])[0], 1.6, couleur=GRIS)
    fin(pl, 'PCMI5')


# ------------------------------------------------------------------ PCMI6, PCMI7-8
def insertion():
    pl = planche('PCMI6', "Insertion dans l'environnement", 'sans')
    x0, y0, x1, y1 = ZONE
    h = 186
    ins = d['insertion']
    pl.image(os.path.join(D, ins['photos'][0]), x0 + 4, y0 + 20, h * 0.75, h)
    pl.image(os.path.join(D, ins['photos'][1]), x0 + 12 + h * 0.75, y0 + 20, h * 0.75, h)
    x = x0 + 24 + 2 * h * 0.75; y = y0 + 20 + h - 3
    pl.texte(x, y, 'ÉTAT ACTUEL', 2.4, gras=True); y -= 8
    for t in ins['textes']:
        for ll in textwrap.wrap(t, 52):
            pl.texte(x, y, ll, 1.8); y -= 4.6
        y -= 3
    fin(pl, 'PCMI6')


def photos():
    pl = planche('PCMI7-8', 'Photographies - environnement proche et lointain', 'sans')
    x0, y0, x1, y1 = ZONE
    lw_ = (x1 - x0 - 16) / 2
    for i, ph in enumerate(d['photos']):
        x = x0 + 4 + i * (lw_ + 8)
        pl.image(os.path.join(D, ph['fichier']), x, y0 + 30, lw_, lw_ * 0.86, mode='contain')
        pl.texte(x, y0 + 30 + lw_ * 0.86 + 5, f"PCMI{ph['code']} - {ph['titre']}", 2.1, gras=True)
        pl.texte(x, y0 + 24, 'Position et angle de prise de vue : voir plan de masse.', 1.7, couleur=GRIS)
    fin(pl, 'PCMI7-8')


situation(); masse(); coupes(); facades(); insertion(); photos()
json.dump({'emprise': EMPRISE, 'sdp': SDP, 'bati': BATI, 'dist': [round(x[0], 2) for x in DIST[:2]], 'tn_ngf': round(TN_NGF, 2), 'pente_pct': PENTE * 100, 'hors_parcelle': not SPARC.contains(SAB)}, open(os.path.join(OUT, 'chiffres.json'), 'w'))
print(json.dumps(json.load(open(os.path.join(OUT, 'chiffres.json')))))
