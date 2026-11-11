#!/usr/bin/env python3
"""Génère src/pieces.json : les pièces demandées au client, projet par projet.
Règle d'écriture : des mots de tous les jours, un exemple concret dans chaque champ texte,
et jamais deux fois la même demande. `sauf` : la pièce devient facultative dès que le client
a envoyé un fichier pour la pièce citée (ses plans, la fiche du modèle…)."""
import json, pathlib

def T(id, nom, aide='', exemple='', fac=False, sauf=None):
    p = {'id': id, 'nom': nom, 'type': 'texte', 'aide': aide}
    if exemple: p['exemple'] = exemple
    if fac: p['facultatif'] = True
    if sauf: p['sauf'] = sauf
    return p
def F(id, nom, aide='', fac=False):
    p = {'id': id, 'nom': nom, 'type': 'fichier', 'aide': aide}
    if fac: p['facultatif'] = True
    return p
def P(id, nom, aide=''):
    return {'id': id, 'nom': nom, 'type': 'photo', 'aide': aide}

AIDE_REPERE = ("Au mètre ruban : la hauteur et la largeur d'une porte, d'une fenêtre ou d'une porte de garage "
               "que l'on voit sur la photo. Ça nous sert à mettre la photo à l'échelle. "
               "Si vous ne pouvez pas, on se débrouille avec le cadastre.")
EX_REPERE = "Exemple : porte d'entrée, 2,15 m de haut et 0,90 m de large"
def repere(ou='sur la façade concernée'):
    return T('porte', f'Une mesure de repère {ou}', AIDE_REPERE, EX_REPERE, fac=True)
def surface():
    return T('surface', 'Surface de votre maison, si vous la connaissez',
             "Elle est sur l'acte de vente, le diagnostic ou impots.gouv.fr (rubrique Gérer mes biens immobiliers). Sinon, on l'estime d'après le cadastre.",
             'Exemple : 95 m² environ', fac=True)
def facade(nom='La façade concernée, vue de face'):
    return P('facade', nom, "Placez-vous bien en face, à 10 ou 15 m, la façade entière dans la photo, sans grand angle.")
def facades(debut):
    return P('facades', 'Chaque côté de la maison, vu de face', f"Une photo par côté, la maison entière. Commencez par {debut}.")
def materiaux():
    return T('materiaux-et-couleurs', 'Matériaux et couleurs, si différents de la maison', 'Sans réponse, on prévoit comme l\'existant : même enduit, mêmes tuiles, mêmes fenêtres.',
             'Exemple : bardage bois naturel, toit plat', fac=True)
def modele(detail):
    return F('modele', 'La fiche du modèle choisi', f"Une photo du catalogue, une capture d'écran ou le devis : on y lit {detail}. Si vous n'avez qu'un lien internet, écrivez-le dans « Le projet en quelques mots ».", fac=True)

D = {
 '_doc': "Pièces demandées au client, par projet. Généré par src/gen_pieces.py (modifier le .py puis relancer). "
         "Types : texte, photo, fichier. facultatif : non bloquant. sauf : devient facultatif dès qu'un fichier existe pour la pièce citée. "
         "exemple : texte grisé du champ vide. L'API ajoute « Le projet en quelques mots », le plan interactif (modes) et « Autres documents ».",
 'commun': {
  'debut': [F('plans', 'Vos plans, si vous en avez',
              "C'est ce qui nous aide le plus : plans du constructeur, de l'ancien permis, du notaire ou du diagnostic, même anciens. Avec eux, plusieurs mesures ci-dessous deviennent inutiles.", fac=True)],
  'fin': [P('rue', 'Votre maison vue de la rue', "Depuis le trottoir d'en face : la maison entière et un bout des voisines."),
          P('endroit', "L'endroit des travaux", "À quelques mètres : l'endroit exact où se feront les travaux.")]
 },
 'sansCommun': ['cu', 'daact', 'modif', 'maison'],
 'projets': {
  'abri': [modele('les dimensions, la hauteur et la couleur'),
           T('dimensions-et-hauteur', 'Dimensions, hauteur, matériau', 'Longueur, largeur, hauteur au plus haut, matériau, toit plat ou en pente. Inutile si vous envoyez la fiche du modèle.',
             'Exemple : 3 m x 2 m, 2,20 m de haut, bois naturel, toit à 2 pentes', sauf='modele'),
           ],
  'annexe': [T('dimensions-et-hauteur', 'Dimensions, hauteur, toit', 'Longueur, largeur, hauteur au plus haut, toit plat ou en pente. Un croquis à la main pris en photo fait aussi l\'affaire, dans « Autres documents ».', 'Exemple : 6 m x 4 m, 3 m de haut, toit à 2 pentes'),
             T('usage', 'À quoi servira-t-elle', "Et les raccordements prévus : eau, électricité.", 'Exemple : garage pour une voiture, avec l\'électricité'),
             materiaux()],
  'carport': [modele('les dimensions, la hauteur et la couleur'),
              T('dimensions-et-hauteur', 'Dimensions, hauteur, matériau', 'Longueur, largeur, hauteur, matériau. Fixé à la maison ou posé seul ? Inutile si vous envoyez la fiche du modèle.',
                'Exemple : 5 m x 3 m, 2,40 m de haut, alu gris, fixé au mur du garage', sauf='modele'),
              ],
  'pergola': [modele('les dimensions, le type de toit et la couleur'),
              T('dimensions-et-hauteur', 'Dimensions et hauteur', 'Longueur, largeur, hauteur, type de toit (lames, toile, vitré), couleur, fixée à la maison ou posée seule. Inutile si vous envoyez la fiche du modèle.',
                'Exemple : 4 m x 3 m, 2,50 m de haut, alu gris foncé, toit à lames, fixée au mur de la terrasse', sauf='modele'),
              facade('Le mur où elle sera fixée, vu de face'), repere()],
  'piscine': [T('dimensions', 'Dimensions et profondeur du bassin', 'Et sa forme.', 'Exemple : 8 m x 4 m, 1,50 m de profondeur, rectangle, liner gris clair, margelles en pierre'),
              T('enterree', 'Enterrée ou hors-sol ? Un abri ?', 'Hors-sol : sa hauteur. Si un abri est prévu : sa hauteur.', 'Exemple : enterrée, sans abri'),
              T('plage', 'Plage et local technique', "S'ils sont prévus : où et quelles dimensions.", 'Exemple : plage en bois de 1 m autour, local technique de 2 m x 1,5 m à côté', fac=True)],
  'terrasse': [T('ce-que-vous-faites', 'Ce que vous faites', 'Une terrasse, un mur ou une climatisation.', 'Exemple : une terrasse en bois surélevée derrière la maison'),
               T('dimensions', 'Les mesures', 'Terrasse : surface, hauteur au-dessus du sol et matériau (bois, carrelage, pierre). Mur : longueur, hauteur et matériau. Clim : la taille du groupe extérieur et où il sera fixé.',
                 'Exemple : terrasse en bois de 5 m x 4 m, 40 cm au-dessus du jardin'),
               F('fiche-clim', 'Pour une clim : la fiche du groupe extérieur', "La notice, ou une photo de l'étiquette.", fac=True),
               facade("La façade ou l'endroit concerné, vu de face")],
  'cloture': [T('cloture', 'Hauteur, type et couleur de la clôture', 'Et sa longueur si vous ne la tracez pas sur le plan.', 'Exemple : 1,60 m de haut, muret de 40 cm avec grillage rigide gris anthracite dessus, 25 m le long de la rue'),
              P('rue', 'La clôture actuelle vue de la rue', 'Tout le long concerné, en plusieurs photos si besoin.')],
  'portail': [modele('la largeur, la hauteur et la couleur'),
              T('largeur-et-hauteur', 'Largeur, hauteur et matériau', 'Battant ou coulissant ? Inutile si vous envoyez la fiche du modèle.',
                'Exemple : 3,50 m de large, 1,60 m de haut, alu gris, coulissant', sauf='modele'),
              P('rue', "L'entrée actuelle vue de la rue", 'Là où se trouvera le portail.')],
  'extension': [surface(),
                T('forme', "L'extension en quelques mots", 'Hauteur (plain-pied ou étage), toit plat ou en pente, fenêtres et portes voulues. Sa place et sa taille : sur le plan ci-dessus. Un croquis à la main pris en photo est bienvenu, dans « Autres documents » : on dessine une proposition, vous la validez.', 'Exemple : plain-pied, toit plat, une grande baie vitrée côté jardin'),
                materiaux(), facades("le côté où se fera l'extension"), repere('sur le côté des travaux')],
  'veranda': [surface(),
              F('devis', 'Plans ou devis du vérandaliste', 'Si vous en avez un : on y trouve les dimensions et les couleurs.', fac=True),
              T('dimensions-et-hauteur', 'Dimensions et hauteur', 'Longueur, largeur, hauteur contre la maison, couleur, type de toit. Inutile si vous envoyez le devis.',
                'Exemple : 4 m x 3 m, 2,80 m de haut contre la maison, alu blanc, toit en polycarbonate', sauf='devis'),
              facade(), repere()],
  'combles': [surface(),
              T('surface-combles', "Surface des combles où l'on tient debout", 'La partie à plus de 1,80 m sous le toit, et la hauteur au plus haut. À peu près suffit.', 'Exemple : 35 m² environ, 2,60 m au plus haut', sauf='plans'),
              T('fenetres', 'Fenêtres de toit ou lucarnes prévues', 'Combien, quelle taille, de quel côté.', 'Exemple : 2 fenêtres de toit côté jardin, 78 x 98 cm'),
              P('combles-photos', "Le toit et l'intérieur des combles", "Chaque côté du toit depuis l'extérieur, et l'intérieur des combles."),
              repere('sur la façade, sous le toit')],
  'surelevation': [surface(),
                   T('forme', "L'étage voulu en quelques mots", 'Sur toute la maison ou une partie, forme du toit, fenêtres. Un croquis à la main pris en photo est bienvenu, dans « Autres documents » : on dessine une proposition, vous la validez.', 'Exemple : un étage complet, même toit en tuiles, 3 fenêtres côté rue comme en bas'),
                   materiaux(), facades('la façade sur rue'), repere('sur la façade de devant')],
  'garage': [surface(),
             T('dimensions-du-garage', 'Dimensions du garage', 'Longueur et largeur. Inutile si vous envoyez vos plans.', 'Exemple : 6 m x 3 m', sauf='plans'),
             T('ce-qui-remplace-la-porte', 'Ce qui remplace la porte de garage', '', 'Exemple : une fenêtre de 1,80 m x 1,20 m en alu gris, et un mur enduit comme le reste'),
             T('stationnement', 'Où se gareront les voitures ensuite', 'La mairie vérifie qu\'il reste de la place sur le terrain.', 'Exemple : 2 voitures devant la maison'),
             facade(), repere()],
  'menuiseries': [T('liste', 'Ce que vous changez', 'Quelles fenêtres, portes ou volets, en quelle matière et quelle couleur.',
                    'Exemple : les 3 fenêtres côté rue et la porte d\'entrée, PVC blanc remplacé par alu gris foncé'),
                  F('devis', 'Le devis du menuisier', "Si vous l'avez : tout y est.", fac=True),
                  facade('Chaque façade où quelque chose change, vue de face'),
                  repere()],
  'velux': [T('nombre-et-reference', 'Combien, et quel modèle', 'La référence du fabricant donne la taille. Sinon la taille approximative.', 'Exemple : 2 Velux GGL MK04 (78 x 98 cm)'),
            T('position', 'Où sur le toit', 'Inutile si vous les placez sur le plan.', 'Exemple : côté jardin, au-dessus de la chambre, à mi-hauteur du toit', sauf='plan'),
            P('photo-du-pan-de-toit', 'Le côté du toit concerné', 'Depuis le jardin ou la rue, tout le pan de toit et la façade en dessous.'),
            repere('sur la façade, sous le toit')],
  'lucarne': [T('type', 'Ce que vous imaginez', 'Même approximatif : forme, largeur, et en quoi (tuiles comme la maison, zinc, bois).', 'Exemple : une lucarne à 2 pans de 1,20 m de large en tuiles, comme chez le voisin'),
              P('lucarne-photos', 'Le toit et la façade concernés, vus de face', ''),
              repere()],
  'toiture': [T('materiau', 'Couverture actuelle et future', 'Type de tuiles ou d\'ardoises, couleur.', 'Exemple : tuiles rouges anciennes, remplacées par des tuiles rouges neuves du même type'),
              T('pente', 'Le toit change-t-il de hauteur ou de pente ?', "Oui si vous isolez par l'extérieur : donnez l'épaisseur.", 'Exemple : non, à l\'identique', fac=True),
              P('toiture-photos', 'Tous les côtés du toit visibles', '')],
  'facade': [T('teinte', 'La nouvelle couleur', 'La référence du nuancier si vous l\'avez, sinon décrivez-la.', 'Exemple : enduit beige clair, volets et porte gris foncé'),
             T('isolation', "Isolation par l'extérieur ?", 'Si oui : son épaisseur.', 'Exemple : oui, 14 cm', fac=True),
             P('facade', 'Chaque façade à refaire, vue de face', 'Placez-vous bien en face, la façade entière dans la photo.'),
             repere()],
  'solaire': [T('panneaux', 'Nombre et dimensions des panneaux', 'La référence du fabricant si vous l\'avez.', 'Exemple : 8 panneaux de 1,70 m x 1,10 m, noirs, en 2 rangées de 4'),
              T('pose', 'Comment sont-ils posés', 'Sur les tuiles, encastrés dans le toit, ou au sol.', 'Exemple : posés sur les tuiles'),
              P('photo-du-pan-de-toit', 'Le côté du toit concerné', 'Depuis le jardin ou la rue, tout le pan de toit.'),
              P('rue', 'Votre maison vue de la rue', 'Pour voir si les panneaux seront visibles depuis la rue.')],
  'maison': [F('plans-de-la-maison', 'Les plans de la maison', "Du constructeur ou les vôtres : chaque niveau, les façades, une coupe. En PDF, ou le fichier de dessin (DWG) si le constructeur vous l'a donné."),
             F('plan-du-terrain', 'Le plan du terrain', 'Plan de bornage du géomètre ou plan de vente du lot : il donne les limites exactes.'),
             F('notice', 'La notice du constructeur', "Isolation, chauffage, fenêtres : elle sert à l'attestation énergétique jointe au permis. Si vous ne l'avez pas, on vous la demandera plus tard.", fac=True),
             T('maison-materiaux', 'Matériaux et couleurs', 'Les murs, le toit, les fenêtres, les volets, la clôture si elle est prévue.', 'Exemple : enduit blanc cassé, tuiles rouges, menuiseries alu gris, volets roulants'),
             T('pente-terrain', 'Votre terrain est-il plat ou en pente ?', "Si vous avez un relevé du géomètre avec les niveaux, envoyez-le dans « Autres documents ».", 'Exemple : plat. Ou : il descend vers le fond, environ 1 m sur toute la longueur'),
             T('assainissement', 'Les eaux usées', "Tout-à-l'égout ou fosse ? Si fosse : l'attestation du SPANC (service de la mairie).", "Exemple : tout-à-l'égout"),
             P('photos-terrain', 'Le terrain et son accès', "Depuis la rue et depuis l'intérieur du terrain : l'entrée, les compteurs, les arbres.")],
  'usage': [T('nouvel-usage', "Aujourd'hui et demain", "Ce qu'est le local aujourd'hui, ce qu'il devient, pour combien de logements ou de pièces.", 'Exemple : aujourd\'hui une boutique, demain un logement de 2 pièces'),
            F('preuve-usage', "Un papier qui montre l'usage actuel", "Acte de vente ou taxe foncière, si vous l'avez sous la main : on y lit si c'est un commerce, un bureau, un logement.", fac=True),
            T('surfaces', 'Les surfaces', 'Pièce par pièce. Inutile si vous envoyez vos plans.', 'Exemple : boutique 40 m², réserve 15 m², WC 2 m²', sauf='plans'),
            P('usage-photos', 'Photos dedans et dehors', ''),
            T('modifs-facade', 'Ce qui change sur la façade', '', 'Exemple : la vitrine devient une fenêtre et une porte', fac=True),
            T('assainissement', 'Les eaux usées', "Tout-à-l'égout ou fosse ? Si fosse : l'attestation du SPANC (service de la mairie).", "Exemple : tout-à-l'égout")],
  'demolition': [T('ce-qui-est-demoli', 'Ce qui est démoli', 'En entier ou en partie, avec la surface.', 'Exemple : le garage de 20 m² au fond du jardin, en entier'),
                 P('demolition-photos', 'La construction à démolir, et autour', '')],
  'cu': [T('type-de-certificat', 'Quel certificat ?', "Simple information sur le terrain, ou faisabilité d'un projet précis.", 'Exemple : simple information sur le terrain. Ou : savoir si je peux construire une maison de 120 m²'),
         F('croquis', "Un croquis d'implantation", 'Pour la faisabilité, si vous en avez un.', fac=True)],
  'modif': [F('arrete', "La décision de la mairie (l'arrêté) du permis accordé", ''),
            F('dossier', "Le dossier déposé à l'époque", 'Le formulaire et les plans.'),
            T('ce-qui-change', 'Ce qui change', 'Si vous avez des plans de ce qui change, mettez-les dans « Autres documents ».', 'Exemple : la fenêtre de la cuisine devient une porte-fenêtre')],
  'daact': [F('arrete', "La décision de la mairie (l'arrêté)", 'Son numéro y figure.'),
            T('date-de-fin', 'Date de fin des travaux', 'Et si tout est terminé, ou une partie seulement.', 'Exemple : fin mars 2026, tout est terminé'),
            F('attestation-energetique', "L'attestation énergétique de fin de travaux", 'Seulement pour une maison neuve ou une grosse extension.', fac=True)],
 },
 'regul': [T('regul-date', 'Quand les travaux ont-ils été faits ?', "À peu près suffit. Si la mairie vous a écrit, joignez son courrier dans « Autres documents ».", 'Exemple : été 2019'),
           F('regul-factures', 'Les factures', 'Si vous les avez : elles datent les travaux.', fac=True),
           P('regul-photos', "Les travaux tels qu'ils sont aujourd'hui", 'Sous tous les angles, de près et de loin.')],
 'formulaire': [T('cerfa-nom', 'Nom et prénom du propriétaire', "La personne qui signera la demande. Plusieurs propriétaires ? Écrivez tous les noms. Pour une société : son nom, son numéro SIRET et le nom de son représentant.", 'Exemple : Jeanne Martin'),
                T('cerfa-naissance', 'Date et lieu de naissance', "Le formulaire de la mairie les demande pour chaque propriétaire. Inutile pour une société.", 'Exemple : 12/03/1961 à Bayonne (64)'),
                T('cerfa-adresse', 'Votre adresse postale et votre téléphone', "Là où la mairie doit vous écrire, si ce n'est pas l'adresse des travaux.", 'Exemple : même adresse que les travaux, 06 12 34 56 78'),
                T('cerfa-residence', 'Résidence principale ou secondaire ?', "La mairie s'en sert pour calculer la taxe.", 'Exemple : résidence principale'),
                T('cerfa-courriel', 'La mairie peut-elle vous répondre par e-mail ?', "C'est plus rapide que le courrier. Sans réponse de votre part, on cochera non.", 'Exemple : oui', fac=True)],
 'situations': {
  'secteur_protege': [T('secte-references', "Précisions pour l'Architecte des Bâtiments de France", "Il exige les références exactes de ce que vous avez décrit plus haut : RAL, nom du nuancier, fiche du fabricant.",
                        'Exemple : tuiles terre cuite rouge vieilli, volets bois peints RAL 6005'),
                      P('secte-photos', 'Photos de près des fenêtres, volets et murs actuels', '')],
  'copropriete': [T('copro-ag', "Où en est l'accord de la copropriété ?", 'Les travaux visibles de l\'extérieur doivent être votés en assemblée générale.', 'Exemple : voté à l\'AG du 12 mars 2026. Ou : prochaine AG en juin'),
                  F('copro-pv', "Le procès-verbal de l'assemblée qui autorise les travaux", 'Le syndic vous l\'envoie après chaque assemblée.', fac=True)],
  'lotissement': [F('lotis-reglement', 'Règlement et cahier des charges du lotissement', '')],
  'locataire': [F('locat-accord', 'Accord écrit du propriétaire', 'Une lettre signée ou un mail du propriétaire suffit.')]
 },
 'modes': {'abri': 'rect', 'annexe': 'rect', 'carport': 'rect', 'pergola': 'accole', 'piscine': 'rect', 'terrasse': 'polygone', 'cloture': 'limites',
           'portail': 'point', 'extension': 'accole', 'veranda': 'accole', 'combles': 'batiment', 'surelevation': 'batiment', 'garage': 'batiment',
           'menuiseries': 'facades', 'velux': 'toit', 'lucarne': 'toit', 'toiture': 'batiment', 'facade': 'facades', 'solaire': 'toit', 'maison': 'rects',
           'usage': 'batiment', 'demolition': 'batiment', 'cu': 'parcelle'}
}
out = pathlib.Path(__file__).with_name('pieces.json')
out.write_text(json.dumps(D, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(out, sum(len(v) for v in D['projets'].values()), 'pièces projet')
