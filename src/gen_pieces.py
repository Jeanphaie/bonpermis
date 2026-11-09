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
               "que l'on voit sur la photo. Rien à mesurer sur ce mur ? Donnez sa longueur au sol. "
               "Inutile si vous envoyez vos plans.")
EX_REPERE = "Exemple : porte d'entrée, 2,15 m de haut et 0,90 m de large"
def repere(ou='sur la façade concernée'):
    return T('porte', f'Une mesure de repère {ou}', AIDE_REPERE, EX_REPERE, sauf='plans')
def surface():
    return T('surface', 'Surface de votre maison',
             "Elle est écrite sur l'acte de vente, le diagnostic, l'annonce, ou sur impots.gouv.fr (rubrique Gérer mes biens immobiliers). À peu près suffit. Inutile si vous envoyez vos plans.",
             'Exemple : 95 m² environ', sauf='plans')
def limite():
    return T('limite', 'Distance au terrain voisin le plus proche',
             "Au mètre ruban, de la construction prévue jusqu'à la clôture ou la borne. Si vous ne savez pas, on la lit sur le cadastre.",
             'Exemple : 1,50 m de la clôture du voisin de droite', fac=True)
def facade(nom='La façade concernée, vue de face'):
    return P('facade', nom, "Placez-vous bien en face, à 10 ou 15 m, la façade entière dans la photo, sans grand angle.")
def facades(debut):
    return P('facades', 'Chaque côté de la maison, vu de face', f"Une photo par côté, la maison entière. Commencez par {debut}.")
def materiaux():
    return T('materiaux-et-couleurs', 'Matériaux et couleurs', 'Les murs, le toit, les fenêtres.',
             'Exemple : murs enduits beige comme la maison, toit en tuiles rouges, fenêtres alu gris')
def modele(detail):
    return F('modele', 'La fiche du modèle choisi', f"Capture d'écran, lien ou devis : on y lit {detail}.", fac=True)

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
           T('dimensions-et-hauteur', 'Dimensions et hauteur', 'Longueur, largeur, hauteur au point le plus haut, matériau. Inutile si vous envoyez la fiche du modèle.',
             'Exemple : 3 m x 2 m, 2,20 m de haut, bois naturel', sauf='modele'),
           limite()],
  'annexe': [F('croquis', 'Un croquis ou les plans', 'Même dessiné à la main sur une feuille, avec les mesures écrites dessus. Prenez-le en photo.'),
             T('usage', 'À quoi servira-t-elle', "Et les raccordements prévus : eau, électricité.", 'Exemple : garage pour une voiture, avec l\'électricité'),
             materiaux(), limite()],
  'carport': [modele('les dimensions, la hauteur et la couleur'),
              T('dimensions-et-hauteur', 'Dimensions et hauteur', 'Longueur, largeur, hauteur, matériau. Fixé à la maison ou posé seul ? Inutile si vous envoyez la fiche du modèle.',
                'Exemple : 5 m x 3 m, 2,40 m de haut, alu gris, fixé au mur du garage', sauf='modele'),
              limite()],
  'pergola': [modele('les dimensions, le type de toit et la couleur'),
              T('dimensions-et-hauteur', 'Dimensions et hauteur', 'Longueur, largeur, hauteur, type de toit (lames, toile, vitré), couleur. Inutile si vous envoyez la fiche du modèle.',
                'Exemple : 4 m x 3 m, 2,50 m de haut, alu gris foncé, toit à lames', sauf='modele'),
              T('adossee-ou-autoportante', 'Fixée à la maison ou posée seule ?', '', 'Exemple : fixée au mur de la terrasse'),
              facade(), repere()],
  'piscine': [T('dimensions', 'Dimensions et profondeur du bassin', 'Et sa forme.', 'Exemple : 8 m x 4 m, 1,50 m de profondeur, rectangle'),
              T('enterree', 'Enterrée ou hors-sol ? Un abri ?', 'Si un abri est prévu : sa hauteur.', 'Exemple : enterrée, sans abri'),
              T('plage', 'Plage et local technique', "S'ils sont prévus : où et quelles dimensions.", 'Exemple : plage en bois de 1 m autour, local technique de 2 m x 1,5 m à côté', fac=True),
              limite()],
  'terrasse': [T('ce-que-vous-faites', 'Ce que vous faites', 'Une terrasse, un mur ou une climatisation.', 'Exemple : une terrasse en bois surélevée derrière la maison'),
               T('dimensions', 'Les mesures', 'Terrasse : surface et hauteur au-dessus du sol. Mur : longueur et hauteur. Clim : la taille du groupe extérieur et où il sera fixé.',
                 'Exemple : terrasse 5 m x 4 m, 40 cm au-dessus du jardin'),
               F('fiche-clim', 'Pour une clim : la fiche du groupe extérieur', "La notice, ou une photo de l'étiquette.", fac=True),
               facade("La façade ou l'endroit concerné, vu de face")],
  'cloture': [T('longueur-hauteur-et-type', 'Longueur, hauteur et type de clôture', '', 'Exemple : 25 m le long de la rue, 1,60 m de haut, muret de 40 cm avec grillage rigide dessus'),
              T('couleur', 'Couleur', 'La référence RAL si vous l\'avez.', 'Exemple : gris anthracite (RAL 7016)'),
              P('rue', 'La clôture actuelle vue de la rue', 'Tout le long concerné, en plusieurs photos si besoin.')],
  'portail': [modele('la largeur, la hauteur et la couleur'),
              T('largeur-et-hauteur', 'Largeur, hauteur et matériau', 'Battant ou coulissant ? Inutile si vous envoyez la fiche du modèle.',
                'Exemple : 3,50 m de large, 1,60 m de haut, alu gris, coulissant', sauf='modele'),
              P('rue', "L'entrée actuelle vue de la rue", 'Là où se trouvera le portail.')],
  'extension': [surface(),
                F('croquis', "Un croquis de l'extension", 'Même à la main : la forme vue de dessus avec les mesures, la hauteur, et le toit (plat ou en pente). Prenez-le en photo.'),
                materiaux(), facades("le côté où se fera l'extension"), repere('sur le côté des travaux'), limite()],
  'veranda': [surface(),
              F('devis', 'Plans ou devis du vérandaliste', 'Si vous en avez un : on y trouve les dimensions et les couleurs.', fac=True),
              T('dimensions-et-hauteur', 'Dimensions et hauteur', 'Longueur, largeur, hauteur contre la maison, couleur, type de toit. Inutile si vous envoyez le devis.',
                'Exemple : 4 m x 3 m, 2,80 m de haut contre la maison, alu blanc, toit en polycarbonate', sauf='devis'),
              facade(), repere(), limite()],
  'combles': [surface(),
              T('surface-combles', "Surface des combles où l'on tient debout", 'La partie à plus de 1,80 m sous le toit, et la hauteur au plus haut.', 'Exemple : 35 m² environ, 2,60 m au plus haut'),
              T('fenetres', 'Fenêtres de toit ou lucarnes prévues', 'Combien, quelle taille, de quel côté.', 'Exemple : 2 fenêtres de toit côté jardin, 78 x 98 cm'),
              P('photos-toit', "Le toit et l'intérieur des combles", "Chaque côté du toit depuis l'extérieur, et l'intérieur des combles.")],
  'surelevation': [surface(),
                   F('croquis', "Un croquis de l'étage voulu", 'Même à la main : la hauteur ajoutée, la forme du toit, les fenêtres.'),
                   facades('la façade sur rue'), repere('sur la façade de devant')],
  'garage': [surface(),
             T('dimensions-du-garage', 'Dimensions du garage', 'Longueur, largeur, hauteur sous plafond. Inutile si vous envoyez vos plans.', 'Exemple : 6 m x 3 m, 2,40 m sous plafond', sauf='plans'),
             T('ce-qui-remplace-la-porte', 'Ce qui remplace la porte de garage', '', 'Exemple : une grande fenêtre et un mur enduit comme le reste'),
             T('stationnement', 'Où se gareront les voitures ensuite', 'La mairie vérifie qu\'il reste de la place sur le terrain.', 'Exemple : 2 voitures devant la maison'),
             facade(), repere()],
  'menuiseries': [T('liste', 'Ce que vous changez', 'Quelles fenêtres, portes ou volets, en quelle matière et quelle couleur.',
                    'Exemple : les 3 fenêtres côté rue et la porte d\'entrée, PVC blanc remplacé par alu gris foncé'),
                  F('devis', 'Le devis du menuisier', "Si vous l'avez : tout y est.", fac=True),
                  facade('Chaque façade où quelque chose change, vue de face'),
                  P('photo-rapprochee', 'Une photo de près de ce qui sera changé', 'Une fenêtre ou un volet actuel, de près.'),
                  repere()],
  'velux': [T('nombre-et-reference', 'Combien, et quel modèle', 'La référence du fabricant donne la taille. Sinon la taille approximative.', 'Exemple : 2 Velux GGL MK04 (78 x 98 cm)'),
            P('photo-du-pan-de-toit', 'Le côté du toit concerné', 'Depuis le jardin ou la rue, tout le pan de toit.'),
            T('position', 'Où sur le toit', '', 'Exemple : côté jardin, au-dessus de la chambre, à mi-hauteur du toit')],
  'lucarne': [T('type', 'Ce que vous imaginez', 'Même approximatif.', 'Exemple : une lucarne à 2 pans de 1,20 m de large, comme chez le voisin'),
              P('photos-toit', 'Le toit et la façade concernés, vus de face', ''),
              repere()],
  'toiture': [T('materiau', 'Couverture actuelle et future', 'Type de tuiles ou d\'ardoises, couleur.', 'Exemple : tuiles rouges anciennes, remplacées par des tuiles rouges neuves du même type'),
              T('pente', 'Le toit change-t-il de hauteur ou de pente ?', "Par exemple une isolation par l'extérieur : son épaisseur.", 'Exemple : non. Ou : isolation de 20 cm posée sur le toit', fac=True),
              P('photos-toit', 'Tous les côtés du toit visibles', '')],
  'facade': [T('teinte', 'La nouvelle couleur', 'La référence du nuancier si vous l\'avez, sinon décrivez-la.', 'Exemple : enduit beige clair, volets et porte gris foncé'),
             T('isolation', "Isolation par l'extérieur ?", 'Si oui : son épaisseur.', 'Exemple : oui, 14 cm', fac=True),
             P('facade', 'Chaque façade à refaire, vue de face', 'Placez-vous bien en face, la façade entière dans la photo.'),
             repere()],
  'solaire': [T('panneaux', 'Nombre et dimensions des panneaux', 'La référence du fabricant si vous l\'avez.', 'Exemple : 8 panneaux de 1,70 m x 1,10 m, noirs'),
              T('pose', 'Comment sont-ils posés', 'Sur les tuiles, encastrés dans le toit, ou au sol.', 'Exemple : posés sur les tuiles'),
              P('photo-du-pan-de-toit', 'Le côté du toit concerné', 'Depuis le jardin ou la rue, tout le pan de toit.'),
              P('rue', 'Votre maison vue de la rue', 'Pour voir si les panneaux seront visibles depuis la rue.')],
  'maison': [F('plans-de-la-maison', 'Les plans de la maison', 'Du constructeur ou les vôtres : chaque niveau, les façades, une coupe. PDF ou DWG.'),
             F('plan-du-terrain', 'Le plan du terrain', 'Plan de bornage du géomètre ou plan de vente du lot : il donne les limites exactes.'),
             F('notice', 'La notice du constructeur', "Isolation, chauffage, fenêtres : il nous la faut pour l'attestation énergétique.", fac=True),
             F('reglement-de-lotissement', 'Le règlement du lotissement', 'Si le terrain est dans un lotissement.', fac=True),
             T('assainissement', 'Les eaux usées', "Tout-à-l'égout ou fosse ? Si fosse : l'attestation du SPANC (service de la mairie).", "Exemple : tout-à-l'égout"),
             P('photos-terrain', 'Le terrain et son accès', "Depuis la rue et depuis l'intérieur du terrain : l'entrée, les compteurs, les arbres.")],
  'usage': [F('preuve-usage', "Un papier qui montre l'usage actuel", "Acte de vente ou taxe foncière : on y lit si c'est un commerce, un bureau, un logement."),
            T('surfaces', 'Les surfaces', 'Pièce par pièce. Inutile si vous envoyez vos plans.', 'Exemple : boutique 40 m², réserve 15 m², WC 2 m²', sauf='plans'),
            P('photos', 'Photos dedans et dehors', ''),
            T('modifs-facade', 'Ce qui change sur la façade', '', 'Exemple : la vitrine devient une fenêtre et une porte', fac=True),
            T('assainissement', 'Les eaux usées', "Tout-à-l'égout ou fosse ?", "Exemple : tout-à-l'égout")],
  'demolition': [T('ce-qui-est-demoli', 'Ce qui est démoli', 'En entier ou en partie, avec la surface.', 'Exemple : le garage de 20 m² au fond du jardin, en entier'),
                 P('photos', 'La construction à démolir, et autour', '')],
  'cu': [T('type-de-certificat', 'Quel certificat ?', "Simple information sur le terrain, ou faisabilité d'un projet précis.", 'Exemple : savoir si je peux construire une maison de 120 m²'),
         T('description-du-projet', 'Le projet, pour la faisabilité', 'Usage, surface, nombre de logements.', 'Exemple : une maison de 120 m² avec garage', fac=True),
         F('croquis', "Un croquis d'implantation", 'Pour la faisabilité, si vous en avez un.', fac=True)],
  'modif': [F('arrete', "La décision de la mairie (l'arrêté) du permis accordé", ''),
            F('dossier', "Le dossier déposé à l'époque", 'Le formulaire et les plans.'),
            T('ce-qui-change', 'Ce qui change', 'Les plans de l\'entreprise si vous les avez.', 'Exemple : la fenêtre de la cuisine devient une porte-fenêtre')],
  'daact': [F('arrete', "La décision de la mairie (l'arrêté)", 'Son numéro y figure.'),
            T('date-de-fin', 'Date de fin des travaux', '', 'Exemple : fin mars 2026'),
            F('attestation-energetique', "L'attestation énergétique de fin de travaux", 'Seulement pour une maison neuve ou une grosse extension.', fac=True)],
 },
 'regul': [T('regul-date', 'Quand les travaux ont-ils été faits ?', 'À peu près suffit.', 'Exemple : été 2019'),
           F('regul-factures', 'Les factures', 'Si vous les avez : elles datent les travaux.', fac=True),
           P('regul-photos', "L'état actuel", 'Sous tous les angles.')],
 'situations': {
  'secteur_protege': [T('secte-references', 'Les références exactes des matériaux et couleurs', "L'Architecte des Bâtiments de France les exige : RAL, nom du nuancier, fiche du fabricant.",
                        'Exemple : tuiles terre cuite rouge vieilli, volets bois peints RAL 6005'),
                      P('secte-photos', 'Photos de près des fenêtres, volets et murs actuels', '')],
  'copropriete': [T('copro-ag', "Où en est l'accord de la copropriété ?", 'Les travaux visibles de l\'extérieur doivent être votés en assemblée générale.', 'Exemple : voté à l\'AG du 12 mars 2026. Ou : prochaine AG en juin'),
                  F('copro-pv', "Le procès-verbal de l'assemblée qui autorise les travaux", '', fac=True),
                  F('copro-reglement', 'Le règlement de copropriété', '', fac=True),
                  F('copro-plan', 'Le plan de votre lot', '', fac=True)],
  'lotissement': [F('lotis-reglement', 'Règlement et cahier des charges du lotissement', '')],
  'locataire': [F('locat-accord', 'Accord écrit du propriétaire', '')]
 },
 'modes': {'abri': 'rect', 'annexe': 'rect', 'carport': 'rect', 'pergola': 'accole', 'piscine': 'rect', 'terrasse': 'polygone', 'cloture': 'limites',
           'portail': 'point', 'extension': 'accole', 'veranda': 'accole', 'combles': 'batiment', 'surelevation': 'batiment', 'garage': 'batiment',
           'menuiseries': 'facades', 'velux': 'toit', 'lucarne': 'toit', 'toiture': 'batiment', 'facade': 'facades', 'solaire': 'toit', 'maison': 'rects',
           'usage': 'batiment', 'demolition': 'batiment', 'cu': 'parcelle'}
}
out = pathlib.Path(__file__).with_name('pieces.json')
out.write_text(json.dumps(D, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
print(out, sum(len(v) for v in D['projets'].values()), 'pièces projet')
