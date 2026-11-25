"""Le Bon Permis - remplit un Cerfa depuis cerfa.json {formulaire, champs, coches}. usage : python3 cerfa.py <dossier>"""
import json, os, sys
from pypdf import PdfReader, PdfWriter
from pypdf.generic import NameObject
D = sys.argv[1]
c = json.load(open(os.path.join(D, 'cerfa.json')))
FORMS = {'13406': 'cerfa_13406-17.pdf', '13703': 'cerfa_13703-12.pdf', '16702': 'cerfa_16702-03.pdf'}
src = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'cerfa', FORMS[str(c['formulaire'])])
r = PdfReader(src); w = PdfWriter(); w.append(r)
F = r.get_fields()
champs = {k: str(v) for k, v in c['champs'].items() if k in F and v not in (None, '')}
coches = [k for k in c['coches'] if k in F]
absents = [k for k in list(c['champs']) + list(c['coches']) if k not in F]
for p in w.pages:
    try:
        w.update_page_form_field_values(p, champs, auto_regenerate=False)
    except Exception:
        pass
    for a in p.get('/Annots', []) or []:
        a = a.get_object()
        if a.get('/T') in coches:
            a[NameObject('/V')] = NameObject('/Oui'); a[NameObject('/AS')] = NameObject('/Oui')
w.set_need_appearances_writer(True)
w.write(os.path.join(D, 'sortie', 'CERFA.pdf'))
print(json.dumps({'cerfa_champs_absents': absents}))
