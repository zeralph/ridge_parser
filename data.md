# DESERT.MDL

## Structure lue

- Fichier de 242 868 octets (`0x3b4b4`), base d'adresses observee `0x06048000`. Son lien avec les fichiers Ridge Racer PlayStation n'est pas etabli.
- Au debut: 128 pointeurs big-endian 32 bits vers des en-tetes d'objet. Un pointeur se convertit en offset en soustrayant la base.
- En-tete d'objet (12 octets): nombre de vertices (u16 BE), nombre de primitives (u16 BE), pointeur vertices (u32 BE), pointeur primitives (u32 BE).
- Vertex: 6 octets, trois entiers signes 16 bits big-endian `X,Y,Z`.
- Primitive: longueur variable. Prefixe de 4 octets; l'interpretation actuelle est deux coins UV `(u0,v0),(u1,v1)`, mais une autre piste est un TPAGE u16 suivi d'un UV. Puis 4 indices u16 BE pour un quad (12 octets au total) ou 3 indices pour un triangle (10 octets). Les indices sont des offsets de 16 octets: index = offset / 16.
- Les quads sont coupes en deux triangles selon la diagonale qui donne la meilleure forme. Le parseur trouve 128 objets, 17 032 vertices, 11 047 quads et 161 triangles.

## UV et textures

Les TMS ne sont pas du RGBA brut. Les blocs observes ont `flags=8`, une CLUT 16x1 de 16 mots RGB555, et un payload egal a `4 * widthWords * height`. Le viewer l'interprete comme deux plans 4-bpp; chaque plan fait `widthWords * height * 2` octets et decode en `widthWords * 4` pixels par ligne, nibble bas en premier. La disposition reelle du double payload reste a confirmer. Le mode Texture du viewer decode la CLUT RGB555 et rend transparente la couleur `0x0000`; le bit STP n'est pas encore interprete.

Le viewer utilise actuellement TEX0 #24, plan 0, sans eclairage additionnel. L'association UV/page n'est pas resolue et le lien entre ce MDL et les banques TMS PlayStation n'est pas etabli. L'interpretation du prefixe comme deux coins UV reste une hypothese; une interpretation TPAGE/UV a egalement ete exploree, sans preuve suffisante. Ne pas presenter le mapping comme definitif.

# Ridge Racer PlayStation: MAP.RRM et TMS

L'executable `ridge_racer/SCUS-943.00` est un PS-X EXE contenant les noms `RIDGE RACER`, `MAP.RRM` et `TEX0.TMS` a `TEX4.TMS`. Il existe une copie identique de `MAP.RRM` a la racine.

References externes: [MAP.RRM format, rr-decomp](https://github.com/kazuyette/rr-decomp/blob/main/MAP_RRM_FORMAT.md) pour les records, et [idx_hed.c, rr-pc-port](https://github.com/kazuyette/rr-pc-port/blob/main/tools/mapparse/idx_hed.c) pour une analyse plus recente du placement des sections.

## Structure de MAP.RRM

Les observations suivantes concernent le fichier fourni; elles ne prouvent pas encore le format de toutes les cartes du jeu.

- A l'offset `0`, un u16 little-endian vaut 258; les deux octets suivants sont du padding.
- A partir de `0x4`, 258 entrees de 8 octets contiennent chacune quatre u16 little-endian. Les sommes des quatre colonnes sont respectivement 622, 5 420, 695 et 0. Chaque section contient successivement ses records de types A, B et C; le quatrieme compteur reste non explique et est nul dans ce fichier.
- La somme des trois premieres colonnes donne 6 737. La suite commence a `0x814` et contient exactement 6 737 records de 40 octets: `0x814 + 6737 * 40 = 0x424bc`, soit la fin du fichier.
- Dans chaque record, les octets `0..23` correspondent a quatre triplets de coordonnees signees little-endian 16 bits. Les quatre paires d'UV, en octets, sont aux offsets `24`, `28`, `32` et `36`.
- Le mot little-endian a `26` est un identifiant CLUT PS1: `x = (clut & 63) * 16`, `y = (clut >> 6) & 511`. Le mot a `30` est un TPAGE PS1: pour les records observes, `x = (tpage & 15) * 64`, `y = ((tpage >> 4) & 1) * 256`; les bits de profondeur indiquent tous du 4-bpp. Le mot a `34` est un biais de profondeur; celui a `38` est un ensemble de flags dont le role reste inconnu.
- L'ordre des UV observes est compatible avec un quad en ordre de bande, pas necessairement avec l'ordre de contour utilise par le viewer MDL.
- `IDX.HED` contient 32 x 32 indices signes little-endian. `-1` indique une cellule vide; chaque valeur de 0 a 257 designe une section MAP unique. L'origine dans le repere du mesh est `(30 - colonne) * 2048` sur X et `ligne * 2048` sur Z. Il faut ajouter **un quart** des coordonnees locales, sans rotation par section: le code du moteur multiplie la translation de cellule par 4 avant projection ([func_80012C14](https://github.com/kazuyette/rr-decomp/blob/main/src/fn/func_80012C14.c)). Le viewer convertit aussi X par `61440 - x_mesh`, comme le repere physique du port, et inverse Y pour avoir le haut positif.
- Verification locale de l'echelle: apres cette transformation, les sections 31 et 32 partagent exactement deux sommets, formant une arete commune. Les echelles 1, 1/2 et 1/8 ne produisent aucune jonction exacte entre ces sections. La vue de dessus obtenue presente des bandes de circuit reconnaissables; elle n'est pas une validation complete de toutes les surfaces.

### Exemple verifiable

Le deuxieme record, a `0x83c`, possede les UV `(0,128)`, `(127,128)`, `(0,255)`, `(127,255)`, la CLUT `0x7800` et le TPAGE `0x0016`. Cela donne une CLUT en VRAM `(0,480)` et une page commencant en `(384,256)` en mots de 16 bits. En 4-bpp, les quatre coins tombent dans le rectangle VRAM `(384,384)` de largeur 32 mots et de hauteur 128: c'est exactement le bloc `TEX0.TMS #32`, dont l'en-tete CLUT indique aussi `(0,480)`.

En comparant les cinq banques fournies, 3 088 primitives sur 6 737 ont une coordonnee CLUT presente dans les en-tetes TMS analyses; 3 060 ont en plus leurs quatre coins UV dans un rectangle d'image associe a cette meme CLUT, en utilisant la largeur indiquee dans l'en-tete. Ce rapprochement ne suppose pas que toutes les banques soient chargees simultanement et ne prouve pas l'absence des autres palettes: leur source, les eventuels chargements dynamiques et la disposition exacte du double payload TMS restent a etudier.

## Viewer

`index.html` demarre en mode Ridge Racer 1 avec `ridge_racer/MAP.RRM` et `ridge_racer/IDX.HED`, en mode texture et eclairage solaire. Le mode texture sans eclairage reste disponible. Les 258 sections sont placees selon la grille IDX.HED. Le chemin de l'index peut etre modifie ou un fichier local selectionne; un index tronque, incomplet ou contenant des indices invalides ou dupliques est refuse. Chaque primitive est decoupee selon l'ordre `(0,1,2)` et `(2,1,3)`, conformement aux UV de type bande. Le mode Gran Turismo conserve le chargement actuel de `DESERT.MDL` et de son circuit complet.

**Limite :** les 258 sections et tous les types A/B/C sont affiches ensemble; leurs surfaces, le decor et les variantes de circuit peuvent se superposer. Le placement et l'orientation sont a verifier plus largement, notamment avec les parcours de l'executable.

En mode Texture MAP, le viewer reconstruit une VRAM de 1024 x 512 mots a partir des blocs TMS: les palettes et les images sont chargees independamment aux coordonnees indiquees, puis chaque primitive utilise sa page et sa CLUT. Le parcours des records suit leur longueur externe et non la longueur declaree du bloc image: celle-ci vaut le double de la taille des pixels. Pour le circuit, les banques TEX0, TEX1, TEX2 et TEX4 sont chargees dans cet ordre. TEX3 contient des images de menus qui occupent les memes adresses VRAM que des decors de TEX2: la charger apres TEX2 remplace notamment une facade et l'herbe par des elements d'interface. TEX4 fournit notamment des palettes necessaires a 297 primitives. Cette composition statique reste une hypothese et les remplacements dynamiques du jeu restent a verifier. Les donnees VRAM absentes apparaissent en magenta; les 6 737 primitives du fichier fourni sont couvertes. La couverture ne prouve pas l'exactitude visuelle de chaque texture et la semi-transparence STP reste a implementer. Le mode MDL conserve son ancien selecteur de plan experimental.

En mode MAP, le ciel est extrait de TEX0.TMS #95 (TPAGE `0x15`, CLUT `0x7983`) dans une VRAM dediee, avant tout ecrasement par les autres banques. Ses deux moities de 256 x 128 sont assemblees en un panorama de 512 x 128 et affichees sur une sphere en arriere-plan, qui suit la rotation de la camera sans suivre sa position. Sous l'horizon, une couleur uniforme extrapolee evite d'etirer les nuages. La projection et l'orientation sont une approximation du viewer, pas une reconstitution certifiee du rendu PS1. Le mode MDL conserve son fond precedent.

### Immeubles OBJ.RRO

En circuit complet, le viewer charge 65 elements de decor depuis `OBJ.RRO` et deux listes de placements dans `SCUS-943.00`. Les primitives de 40 octets ont le meme format que MAP; celles de 48 octets ajoutent une fenetre de texture PS1 (coordonnees et dimensions en pixels). Les 753 primitives des instances sont couvertes par deux VRAM: celle du circuit et une seconde contenant TEX0, TEX1 et TEX4. TEX2 ecraserait les facades de TEX1 si elles partageaient la VRAM du circuit. La fenetre est appliquee par masquage aux UV avant echantillonnage.

Les positions ne sont pas dans OBJ.RRO. L'executable local contient a l'adresse `0x8006EAFC` une liste terminee par -1 d'entrees de 24 octets: modele s16, padding, X/Y/Z s32, argument s32, rotation s16 en 4096 unites par tour, padding. Une seconde liste a `0x8006E9AC` ajoute six elements de decor, dont les modeles 64, 62 et 63 qui composent le grand batiment pres du depart. Ses primitives texturees comprennent aussi des quads de 64 et 72 octets avec normales Q12, UV a l'offset 48 et, pour les 72 octets, fenetre de texture a l'offset 64. Le viewer calcule ses normales pour l'eclairage plutot que d'emuler l'eclairage PS1. Les modeles 176, 177 et 179 utilisent la VRAM du circuit, tandis que le batiment utilise la VRAM TEX1 des immeubles. Les positions et la rotation sont exploitees selon les fonctions [func_8001602C](https://github.com/kazuyette/rr-decomp/blob/main/src/fn/func_8001602C.c), [func_800366FC](https://github.com/kazuyette/rr-decomp/blob/main/src/fn/func_800366FC.c), [func_800129AC](https://github.com/kazuyette/rr-decomp/blob/main/src/fn/func_800129AC.c) et [func_800185F0](https://github.com/kazuyette/rr-decomp/blob/main/src/fn/func_800185F0.c). Les adresses de la decompilation different de celles de l'executable local. Le viewer n'utilise ces listes que pour l'executable dont le SHA-256 est `bde353330bf4032d8c4b86a04dbcc78c95e6b2c5aa17dc15b79de613b52cf8c5`; toute autre version signale explicitement que le placement est indisponible. Ce n'est pas encore l'ensemble des objets de decor ni la gestion des variantes du jeu.

Les tests sont executables avec `node tests/map.test.js`, `node tests/map-vram.test.js`, `node tests/objects.test.js` et `node tests/rr4.test.js` depuis la racine.

## Ridge Racer Type 4 : objets de piste et modèles RRO

Le viewer ne rend pour l'instant que le ruban routier reconstruit depuis les ressources impaires de circuit. Le chemin précédent traitait `TrackObjectFile` comme un inventaire de décors statiques et interprétait son champ `f4 % 10` comme une simple catégorie d'objet. La décompilation du jeu montre au contraire que `DrawTrackObjects` dispatch plusieurs fonctions de rendu selon cette valeur; le cas 5 appelle notamment `DrawAnimatedTrackObject`. La présence d'un modèle et de nœuds de placement ne suffit donc pas à établir qu'il s'agit d'un décor statique.

La table de modèles du circuit n'est pas une série de buffers autonomes : chaque entrée du `RroModelTable` contient trois mots qui référencent des données de mesh. Celles-ci sont résolues dans la `RroModelBank` associée, laquelle possède des pools de sommets et normales ainsi que des flux de commandes. Les catégories `f4 % 10 == 0` et `== 1` empruntent des chemins distincts (`SubmitCourseModel2` et `SubmitModel`). Les records de visibilité du fichier relatif sélectionnent en outre des plages de primitives par vue/segment. Aucun décor RR4 n'est donc actuellement affiché comme tel tant que ces références, catégories et plages de visibilité ne sont pas décodées correctement.

Références de structure et de rendu : [objrec.h](https://github.com/khasinski/ridge-racer-type-4-decomp/blob/d38852eedcd2bebe4a690e7d01891a7817daf8d1/include/game/race/objrec.h), [model_table.h](https://github.com/khasinski/ridge-racer-type-4-decomp/blob/d38852eedcd2bebe4a690e7d01891a7817daf8d1/include/rr/model_table.h), [objdraw.c](https://github.com/khasinski/ridge-racer-type-4-decomp/blob/d38852eedcd2bebe4a690e7d01891a7817daf8d1/src/main/PAL/game/race/objdraw.c) et [course_view_types.h](https://github.com/khasinski/ridge-racer-type-4-decomp/blob/d38852eedcd2bebe4a690e7d01891a7817daf8d1/include/rr/course_view_types.h).

## Inconnu: trailer

A l'offset `0x3a7c4`, le trailer commence par `01 9d 00 00 00 00 00 00`: compte 413, puis 413 records de 8 octets jusqu'a EOF. Les **143 derniers records** sont les indices 270-412, offsets `0x3b03c` a `0x3b4b4` (fin exclusive). Ils ont le meme prefixe `14 88` que les 270 precedents; aucune frontiere de sous-format n'est visible.

Leur role n'est pas identifie. Les pistes eclairage (413 sources) et trajet IA restent hypothetique: le mot initial est constant et les coordonnees ne se rattachent pas au mesh sous les endian/axes simples testes. Ne pas les presenter comme des vertex colors.

## Couleurs

Aucun attribut couleur par vertex n'a ete identifie dans les records XYZ/primitives. Le mode `Vertex color` du viewer calcule des couleurs a partir des normales et du soleil; ce n'est pas une donnee native du MDL.
