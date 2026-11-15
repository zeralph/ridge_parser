# Viewer de circuits

Ce projet expérimental permet d'explorer dans un navigateur des données de circuits de jeux vidéo. Il utilise Three.js et propose quatre modes :

- **Ridge Racer 1** : affichage du circuit depuis `MAP.RRM`, placement des sections avec `IDX.HED`, textures TMS, décors issus de `OBJ.RRO` et ciel panoramique.
- **Ridge Racer Revolution** : aperçu des cinq variantes depuis les fichiers `CRS_*.DAT` et `*_PCT.DAT`, avec décors, ciel et textures expérimentaux.
- **Gran Turismo** : affichage du circuit `DESERT.MDL`, avec un mode de texture expérimental.
- **Ridge Racer Type 4** : aperçu des huit circuits avec décors fixes, ciel, textures et couleurs natives. Les modes wireframe, shaded et texturé sont disponibles, ainsi que l'extraction individuelle des ressources.

Le placement, les textures et le ciel sont des reconstitutions en cours d'étude et ne reproduisent pas nécessairement le rendu des jeux. Consultez [data.md](data.md) pour les détails techniques et les limites connues.

## Fichiers des jeux

Les fichiers des jeux ne sont pas inclus dans le dépôt. Utilisez vos propres copies obtenues légalement et placez les fichiers suivants aux chemins indiqués, en respectant les majuscules :

```text
DESERT.MDL                    # mode Gran Turismo
ridge_racer/
  MAP.RRM
  IDX.HED
  OBJ.RRO
  SCUS-943.00
  TEX0.TMS
  TEX1.TMS
  TEX2.TMS
  TEX4.TMS
ridge_racer_revolution/
  CRS_EASY.DAT
  CRS_MID.DAT
  CRS_HIGH.DAT
  CRS_OLDE.DAT
  CRS_OLDH.DAT
  EASY_PCT.DAT
  MID_PCT.DAT
  HIGH_PCT.DAT
  OLD_PCT.DAT
  BIG0.TMS
  BIG1.TMS
  BIG2.TMS
  BIG3.TMS
  BIG4.TMS
ridge_racer_4/
  R4.BIN
```

Le circuit Ridge Racer 1 nécessite `MAP.RRM` et `IDX.HED`. Les banques TMS servent aux textures et au ciel ; `OBJ.RRO` et `SCUS-943.00` servent aux décors du circuit complet, et l'exécutable fournit aussi le tracé de la caméra. Pour les placements et le tracé, seule la version de `SCUS-943.00` reconnue par le viewer est prise en charge. Le mode Gran Turismo utilise aussi les banques TMS de `ridge_racer/` pour son affichage texturé expérimental.

Pour Revolution, choisissez Easy, Mid, High, Old Easy ou Old High dans le sélecteur. Le CRS, son PCT et les banques `BIG0.TMS` à `BIG4.TMS` sont recherchés dans `ridge_racer_revolution/`. Ces banques sont nécessaires au mode texturé pour identifier les textures d'origine. Le circuit, une partie de ses décors et les nuages propres au circuit sont affichés. Le fond bleu du ciel et sa projection sont approximatifs ; certaines variantes et primitives de décor ne sont pas encore interprétées. L'interface indique le nombre de primitives dont la texture n'a pas pu être vérifiée contre les banques TMS.
Le mode Ridge Racer Type 4 lit l'index de secteurs de `R4.BIN` et affiche les principaux flux de géométrie fixe (quads et triangles) et les sprites de décor, notamment les arbres, de chacun des huit circuits, avec un ruban routier approximatif. Les sprites s'orientent horizontalement selon la caméra. Le ciel utilise les couches de géométrie colorée et texturée du circuit, avec un rendu expérimental. Le mode shaded affiche les couleurs des primitives sans éclairage ; le ruban approximatif reste de couleur uniforme. Le mode texturé reconstruit les textures TIM, les module par les couleurs des primitives et masque par défaut le ruban approximatif pour laisser apparaître la chaussée originale. La case « Afficher le ruban routier approximatif » permet de choisir son affichage dans tous les modes ; ce choix reste actif lors des changements de mode ou de circuit. La première couleur ambiante du circuit, modifiable dans le panneau, est utilisée pour le fond derrière la géométrie du ciel. Elle peut aussi être ajoutée aux couleurs du décor texturé ; cet effet approximatif est désactivé par défaut et indépendant du fond. Les autres formats ne sont pas affectés. Les faces du décor fixe et les superpositions exactement coplanaires sont traitées selon une approximation des priorités PS1 pour limiter le Z-fighting. La visibilité et le tri originaux ne sont pas entièrement émulés : des superpositions peuvent subsister, notamment avec le ruban approximatif. Le brouillard, les variantes de sprites selon la distance et la semi-transparence originales ne sont pas encore émulés. Les objets de piste, dont certains sont animés, ne sont pas encore rendus. L'interface permet aussi de télécharger individuellement les ressources sous leur nom extrait (`R4.BIN.00000`, etc.). Les fichiers déjà extraits ne sont pas nécessaires.

## Lancement

Depuis la racine du projet, lancez un serveur HTTP, par exemple :

```sh
python3 -m http.server 8000
```

Ouvrez ensuite [http://localhost:8000/](http://localhost:8000/) dans un navigateur compatible WebGL. Sans préférence enregistrée, Ridge Racer Type 4 démarre avec le premier circuit en mode texturé. Choisissez le jeu puis le circuit : celui-ci se charge automatiquement depuis les chemins indiqués ci-dessus. Des cookies conservés un an mémorisent le dernier jeu et circuit chargés ainsi que la position et l'orientation de la caméra pour chaque circuit. Le fly-through ne redémarre pas automatiquement ; si les cookies sont refusés ou invalides, un message s'affiche et la vue par défaut est utilisée. Les commandes de rendu et de caméra suivent les sélecteurs ; les informations de géométrie et de textures figurent en dessous. Double-cliquez sur une surface affichée pour y centrer la caméra et son pivot de rotation, sans changer l'angle ni la distance de vue.

En sélectionnant Ridge Racer 1 ou Revolution, le rendu démarre en mode texturé sans soleil. Il reste modifiable dans le panneau de rendu.

En mode R4 ou sur un circuit Ridge Racer 1 ou Revolution, « Démarrer le fly-through » place la caméra au point de la trajectoire le plus proche de sa position horizontale actuelle, puis parcourt le circuit en boucle. Une interpolation lisse relie les points du tracé et le regard anticipe les virages. Réglez la vitesse en unités du viewer par seconde, la hauteur au-dessus de la route et le sens de parcours ; ces réglages restent modifiables pendant le trajet. La vitesse n'est pas exprimée en km/h. « Arrêter le fly-through » rend le contrôle à la caméra orbitale. La vue de dessus, le changement de circuit ou de jeu arrêtent également le trajet ; les réglages sont conservés. En Ridge Racer 1, le parcours utilise les 256 points natifs du circuit principal, sans tracer de ruban. Il nécessite les versions reconnues de `MAP.RRM`, `IDX.HED` et `SCUS-943.00`. Pour Revolution, les cinq circuits utilisent leurs trajectoires natives contenues dans les fichiers CRS.

## Tests

Avec Node.js et les fichiers des trois jeux Ridge Racer en place :

```sh
node tests/map.test.js
node tests/map-vram.test.js
node tests/revolution.test.js
node tests/objects.test.js
node tests/sceneview.test.js
node tests/persistence.test.js
node tests/rr4.test.js
```
