"""Le Bon Permis - fabrique les pièces d'un dossier sur le serveur. usage : python3 run.py <dossier de travail>
Le dossier contient projet.json, notice.json, cerfa.json, terrain.json et images/ (photos du client).
Les fonds IGN (plan de situation) et les altitudes sont lus ici, puis gardés dans le dossier."""
import json, math, os, subprocess, sys, urllib.request
D = sys.argv[1]
ICI = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(D, 'projet.json')))
os.makedirs(os.path.join(D, 'images'), exist_ok=True); os.makedirs(os.path.join(D, 'sortie'), exist_ok=True)
lon, lat = d['origine_lonlat']; mLat = 111320.0; mLon = mLat * math.cos(math.radians(lat))


def lire(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'bonpermis.fr (planches)'}), timeout=40).read()


alti = os.path.join(D, 'alti.json')
if not os.path.exists(alti):
    lons, lats = [], []
    for j in range(-5, 6):
        for i in range(-5, 6):
            lons.append(f'{lon + i * 3 / mLon:.7f}'); lats.append(f'{lat + j * 3 / mLat:.7f}')
    open(alti, 'wb').write(lire('https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?lon=' + '|'.join(lons) + '&lat=' + '|'.join(lats) + '&resource=ign_rge_alti_wld&zonly=false'))
# plan de situation : deux fonds Plan IGN centrés sur le terrain, au format des cadres de la planche (190 et 150 mm de large, 207 de haut)
for s, (w_mm, den, px) in zip(d['situation'], [(190, 25000, 1100), (150, 5000, 900)]):
    f = os.path.join(D, s['fichier'])
    if os.path.exists(f):
        continue
    wm, hm = w_mm * den / 1000.0, 207 * den / 1000.0
    bbox = f'{lat - hm / 2 / mLat},{lon - wm / 2 / mLon},{lat + hm / 2 / mLat},{lon + wm / 2 / mLon}'
    open(f, 'wb').write(lire('https://data.geopf.fr/wms-r?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLES=&CRS=EPSG:4326'
                             f'&BBOX={bbox}&WIDTH={px}&HEIGHT={round(px * 207 / w_mm)}&FORMAT=image/jpeg'))
out = {}
for script in ('abri.py', 'notice.py', 'cerfa.py'):
    r = subprocess.run([sys.executable, os.path.join(ICI, script), D], capture_output=True, text=True, cwd=ICI)
    if r.returncode:
        sys.stderr.write(f'{script} : {r.stderr[-1500:]}'); sys.exit(1)
    try:
        out.update(json.loads(r.stdout.strip().splitlines()[-1].replace("'", '"')))
    except Exception:
        pass
S = os.path.join(D, 'sortie')
pieces = [('CERFA', 'Formulaire', 'CERFA.pdf'), ('PC1', 'Plan de situation', 'PCMI1.pdf'), ('PC2', 'Plan de masse', 'PCMI2.pdf'), ('PC3', 'Plan en coupe', 'PCMI3.pdf'),
          ('PC4', 'Notice descriptive', 'PCMI4.pdf'), ('PC5', 'Plan des façades et toitures', 'PCMI5.pdf'), ('PC6', "Insertion dans l'environnement", 'PCMI6.pdf'),
          ('PC7', 'Photos proche et lointaine (PCMI7 et PCMI8)', 'PCMI7-8.pdf')]
print(json.dumps({'pieces': [dict(code=c, nom=n, fichier=os.path.join(S, f)) for c, n, f in pieces if os.path.exists(os.path.join(S, f))], 'chiffres': out}))
