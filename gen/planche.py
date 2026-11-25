"""Le Bon Permis - gabarit de planche A3 paysage (cartouche, styles, outils de dessin).
Repris de claude/bonpermis-generateur/planche.py (sans l'enregistrement pour le DXF)."""
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.patches import Polygon, Circle
import numpy as np

import glob, os
for f in glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fonts', '*.otf')):   # Inter fournie avec le générateur
    font_manager.fontManager.addfont(f)
plt.rcParams['font.family'] = 'Inter'
plt.rcParams['pdf.fonttype'] = 42
plt.rcParams['hatch.linewidth'] = 0.35

W, H = 420.0, 297.0
MARGE = 10.0
CART_H = 18.0
ENTETE_H = 16.0
ZONE = (MARGE + 2, MARGE + CART_H + 4, W - MARGE - 2, H - MARGE - ENTETE_H - 2)
MM = 72 / 25.4
LW_COUPE = 0.50 * MM
LW_VUE = 0.25 * MM
LW_FIN = 0.13 * MM
LW_TRES_FIN = 0.08 * MM
ENCRE = '#1d232b'
GRIS = '#7a828c'
ROUGE = '#c8372d'


def pt(mm):
    return mm * MM / 0.72


class Planche:
    def __init__(self, code, titre, echelle, projet, public=False, sous_titre=''):
        self.code, self.titre, self.echelle, self.p, self.public = code, titre, echelle, projet, public
        self.sous_titre = sous_titre
        self.fig = plt.figure(figsize=(W / 25.4, H / 25.4))
        self.ax = self.fig.add_axes([0, 0, 1, 1])
        self.ax.set_xlim(0, W); self.ax.set_ylim(0, H); self.ax.set_aspect('equal'); self.ax.axis('off')
        self._cadre()

    def texte(self, x, y, s, taille=2.0, gras=False, couleur=ENCRE, ha='left', va='baseline', rot=0, z=20, **kw):
        return self.ax.text(x, y, s, fontsize=pt(taille), fontweight='bold' if gras else 'normal', color=couleur,
                            ha=ha, va=va, rotation=rot, rotation_mode='anchor', zorder=z, **kw)

    def ligne(self, pts, lw=LW_VUE, c=ENCRE, ls='-', z=10, **kw):
        a = np.array(pts)
        self.ax.plot(a[:, 0], a[:, 1], lw=lw, color=c, ls=ls, zorder=z, solid_capstyle='butt', solid_joinstyle='miter', **kw)

    def poly(self, pts, fc='none', ec=ENCRE, lw=LW_VUE, z=10, hatch=None, ls='-', alpha=1.0):
        pa = Polygon(pts, closed=True, fc=fc, ec=ec, lw=lw, zorder=z, hatch=hatch, ls=ls, joinstyle='miter', alpha=alpha)
        self.ax.add_patch(pa)
        return pa

    def rect(self, x, y, w, h, **kw):
        return self.poly([(x, y), (x + w, y), (x + w, y + h), (x, y + h)], **kw)

    def image(self, chemin, x, y, w, h, mode='cover'):
        from PIL import Image, ImageOps
        im = ImageOps.exif_transpose(Image.open(chemin)).convert('RGB')
        iw, ih = im.size
        rc, ri = w / h, iw / ih
        if mode == 'cover':
            if ri > rc:
                nw = int(ih * rc); im = im.crop(((iw - nw) // 2, 0, (iw - nw) // 2 + nw, ih))
            else:
                nh = int(iw / rc); im = im.crop((0, (ih - nh) // 2, iw, (ih - nh) // 2 + nh))
            ext = (x, x + w, y, y + h)
        else:
            if ri > rc:
                hh = w / ri; ext = (x, x + w, y + (h - hh) / 2, y + (h + hh) / 2)
            else:
                ww = h * ri; ext = (x + (w - ww) / 2, x + (w + ww) / 2, y, y + h)
        im.thumbnail((2600, 2600))
        self.ax.imshow(np.asarray(im), extent=ext, zorder=5, interpolation='lanczos')
        self.ax.set_xlim(0, W); self.ax.set_ylim(0, H)
        self.rect(ext[0], ext[2], ext[1] - ext[0], ext[3] - ext[2], lw=LW_FIN, z=6)
        return ext

    def titre_vue(self, x, y, s, echelle=None):
        self.texte(x, y, s.upper(), 2.6, gras=True)
        if echelle:
            self.texte(x, y - 4.0, f'Échelle {echelle}', 1.8, couleur=GRIS)

    def nord(self, x, y, angle_deg=0.0, taille=9.0, legende='N'):
        a = np.radians(angle_deg)
        R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
        demi = [(0, taille / 2), (-taille * 0.22, -taille / 2), (0, -taille * 0.25)]
        demi2 = [(0, taille / 2), (taille * 0.22, -taille / 2), (0, -taille * 0.25)]
        self.poly([tuple(np.array([x, y]) + R @ np.array(p)) for p in demi], fc=ENCRE, lw=LW_FIN, z=30)
        self.poly([tuple(np.array([x, y]) + R @ np.array(p)) for p in demi2], fc='white', lw=LW_FIN, z=30)
        tx, ty = np.array([x, y]) + R @ np.array([0, taille / 2 + 2.2])
        self.texte(tx, ty, legende, 2.4, gras=True, ha='center', va='center', z=30)

    def barre_echelle(self, x, y, metres, mm_par_m, pas=None):
        pas = pas or (1 if metres <= 5 else 5 if metres <= 25 else 10 if metres <= 50 else 100)
        n = int(metres / pas)
        for i in range(n):
            self.rect(x + i * pas * mm_par_m, y, pas * mm_par_m, 1.2, fc=ENCRE if i % 2 == 0 else 'white', lw=LW_FIN, z=30)
        for i in range(n + 1):
            self.texte(x + i * pas * mm_par_m, y + 2.2, f'{i * pas:g}', 1.6, ha='center', z=30)
        self.texte(x + n * pas * mm_par_m + 2.5, y, 'm', 1.6, z=30)

    def cote(self, a, b, decal, texte=None, taille=1.8, c=ENCRE, z=25):
        a, b = np.array(a, float), np.array(b, float)
        t = b - a
        L = np.linalg.norm(t)
        if L < 1e-6:
            return
        t /= L
        n = np.array([-t[1], t[0]])
        a2, b2 = a + n * decal, b + n * decal
        if decal:
            self.ligne([a + n * np.sign(decal) * 0.8, a2 + n * np.sign(decal) * 1.2], lw=LW_TRES_FIN, c=c, z=z)
            self.ligne([b + n * np.sign(decal) * 0.8, b2 + n * np.sign(decal) * 1.2], lw=LW_TRES_FIN, c=c, z=z)
        self.ligne([a2, b2], lw=LW_FIN, c=c, z=z)
        for p in (a2, b2):
            d = (t + n) * 0.9
            self.ligne([p - d, p + d], lw=LW_VUE, c=c, z=z)
        ang0 = np.degrees(np.arctan2(t[1], t[0])); ang = ang0
        if ang > 90.5 or ang < -89.5:
            ang += 180
        m = (a2 + b2) / 2 + n * 0.9 * (1 if decal >= 0 else -1)
        va = 'bottom' if decal >= 0 else 'top'
        if ang != ang0:
            va = 'top' if va == 'bottom' else 'bottom'
        self.texte(m[0], m[1], texte, taille, couleur=c, ha='center', va=va, rot=ang, z=z,
                   bbox=dict(fc='white', ec='none', pad=0.4, alpha=0.85))

    def cercle(self, c, r, fc='none', ec=ENCRE, lw=LW_VUE, z=30):
        self.ax.add_patch(Circle(c, r, fc=fc, ec=ec, lw=lw, zorder=z, fill=fc != 'none'))

    def fleche(self, a, b, lw=LW_VUE, c=ENCRE, z=27, taille=8):
        self.ax.annotate('', xy=tuple(b), xytext=tuple(a), zorder=z, arrowprops=dict(arrowstyle='-|>', lw=lw, color=c, mutation_scale=taille))

    def niveau(self, x, y, s, taille=1.8):
        self.poly([(x - 1.2, y + 1.6), (x + 1.2, y + 1.6), (x, y)], fc=ENCRE, lw=LW_FIN, z=30)
        self.texte(x + 2.2, y + 0.3, s, taille, z=30)

    def _lab(self, x, y, s):
        self.texte(x, y, s.upper(), 1.25, couleur='#8a929b', z=13)

    def _cadre(self):
        p = self.p
        self.rect(MARGE, MARGE, W - 2 * MARGE, H - 2 * MARGE, lw=LW_VUE)
        yh = H - MARGE - 8.5
        self.texte(MARGE + 6, yh, self.titre.upper(), 4.0, gras=True, z=13)
        if self.sous_titre:
            self.texte(MARGE + 6, yh - 5.2, self.sous_titre, 1.9, couleur=GRIS, z=13)
        y0, y1 = MARGE, MARGE + CART_H
        self.rect(MARGE, y1 - 0.9, W - 2 * MARGE, 0.9, fc=ENCRE, ec=ENCRE, lw=0, z=12)
        dem = 'Masqué' if self.public else p['demandeur']
        adr = p['adresse_public'] if self.public else p['adresse']
        par = 'Masquée' if self.public else f"{p['parcelle']}  ({p['surface_terrain']:,} m²)".replace(',', ' ')
        cells = [(50, 'Demandeur', [dem]), (70, 'Adresse du terrain', [adr]), (40, 'Parcelle', [par]),
                 (66, 'Projet', [p['titre'], p['plu']]), (74, 'Document', [self.titre]), (24, 'Échelle', [self.echelle]),
                 (16, 'Format', ['A3']), (22, 'Date', [p['date']])]
        x = MARGE
        for w, lab, vals in cells:
            self._lab(x + 3, y1 - 5.2, lab)
            for i, v in enumerate(vals):
                self.texte(x + 3, y1 - 10.0 - i * 4.2, v, 2.0 if i == 0 else 1.6, gras=(lab == 'Document'),
                           couleur=ENCRE if i == 0 else GRIS, z=13)
            x += w
            self.ligne([(x, y0), (x, y1 - 0.9)], lw=LW_TRES_FIN, c='#b8bec5', z=12)
        self._lab(x + 3, y1 - 5.2, 'Pièce')
        self.texte((x + W - MARGE) / 2, y0 + 3.6, self.code, 5.2, gras=True, couleur=ENCRE, ha='center', z=13)

    def enregistrer(self, chemin_sans_ext, png=True):
        self.fig.savefig(chemin_sans_ext + '.pdf')
        if png:
            self.fig.savefig(chemin_sans_ext + '.png', dpi=110)
        plt.close(self.fig)
