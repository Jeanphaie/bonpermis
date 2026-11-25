"""Le Bon Permis - notice descriptive PCMI4 (R.431-8) en PDF A4. usage : python3 notice.py <dossier>"""
import json, os, sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
D = sys.argv[1]
n = json.load(open(os.path.join(D, 'notice.json')))
import glob
def police(*noms):
    for nom in noms:
        r = glob.glob('/usr/share/fonts/**/' + nom, recursive=True)
        if r:
            return r[0]
    raise SystemExit('Police introuvable : ' + ', '.join(noms))
pdfmetrics.registerFont(TTFont('LS', police('LiberationSans-Regular.ttf', 'DejaVuSans.ttf')))
pdfmetrics.registerFont(TTFont('LS-B', police('LiberationSans-Bold.ttf', 'DejaVuSans-Bold.ttf')))
pdfmetrics.registerFontFamily('LS', normal='LS', bold='LS-B', italic='LS', boldItalic='LS-B')
E, G = '#1d232b', '#7a828c'
P = ParagraphStyle('p', fontName='LS', fontSize=9.6, leading=14, textColor=E, spaceAfter=5)
H = ParagraphStyle('h', fontName='LS-B', fontSize=11.5, leading=15, textColor=E, spaceBefore=11, spaceAfter=4)
T = ParagraphStyle('t', fontName='LS-B', fontSize=17, leading=21, textColor=E)
S = ParagraphStyle('s', fontName='LS', fontSize=9, leading=13, textColor=G)
C = ParagraphStyle('c', fontName='LS', fontSize=8.4, leading=11.2, textColor=E)
CB = ParagraphStyle('cb', parent=C, fontName='LS-B')


def pied(c, doc):
    c.setFont('LS', 7.5); c.setFillColor(colors.HexColor(G))
    c.drawString(18 * mm, 10 * mm, n['pied']); c.drawRightString(192 * mm, 10 * mm, f"PCMI4  -  page {doc.page}")


doc = SimpleDocTemplate(os.path.join(D, 'sortie', 'PCMI4.pdf'), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=18 * mm,
                        title='PCMI4 - Notice descriptive', author=n['auteur'])
f = [Paragraph('NOTICE DESCRIPTIVE', T), Paragraph(n['sous_titre'], S), Spacer(1, 5 * mm)]
for bloc in n['blocs']:
    if 'h' in bloc:
        f.append(Paragraph(bloc['h'], H))
    for p in bloc.get('p', []):
        f.append(Paragraph(p, P))
    if 'note' in bloc:
        f += [Paragraph(bloc['note'], S), Spacer(1, 2 * mm)]
data = [[Paragraph(c, CB if i == 0 else C) for c in r] for i, r in enumerate([['Règle du PLUi', 'Page', 'Construction']] + n['plu'])]
t = Table(data, colWidths=[78 * mm, 17 * mm, 79 * mm], repeatRows=1)
t.setStyle(TableStyle([('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#eef0f3')), ('LINEBELOW', (0, 0), (-1, -1), 0.3, colors.HexColor('#c9ced4')),
                       ('LINEABOVE', (0, 0), (-1, 0), 0.8, colors.HexColor(E)), ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('TOPPADDING', (0, 0), (-1, -1), 4),
                       ('BOTTOMPADDING', (0, 0), (-1, -1), 4), ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4)]))
f += [t, Spacer(1, 4 * mm), Paragraph(n['sources'], S)]
doc.build(f, onFirstPage=pied, onLaterPages=pied)
