# Viewer de circuits

Ce projet expérimental permet d'explorer dans un navigateur des données de circuits de jeux vidéo. Il utilise Three.js et propose trois modes :

- **Ridge Racer 1** : affichage du circuit depuis `MAP.RRM`, placement des sections avec `IDX.HED`, textures TMS, décors issus de `OBJ.RRO` et ciel panoramique.
- **Gran Turismo** : affichage du circuit `DESERT.MDL`, avec un mode de texture expérimental.
- **Ridge Racer Type 4** : aperçu des huit circuits avec ruban routier reconstruit. Les modes wireframe, shaded et texturé (asphalte procédural expérimental) sont disponibles, ainsi que l'extraction individuelle des ressources.

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
ridge_racer_4/
  R4.BIN
```

Le circuit Ridge Racer 1 nécessite `MAP.RRM` et `IDX.HED`. Les banques TMS servent aux textures et au ciel ; `OBJ.RRO` et `SCUS-943.00` servent aux décors du circuit complet. Pour les placements, seule la version de `SCUS-943.00` reconnue par le viewer est prise en charge. Le mode Gran Turismo utilise aussi les banques TMS de `ridge_racer/` pour son affichage texturé expérimental.

Les fichiers MAP, IDX et MDL peuvent également être sélectionnés depuis l'interface ; les textures et les décors sont recherchés dans `ridge_racer/`.
Le mode Ridge Racer Type 4 lit l'index de secteurs de `R4.BIN` et reconstruit un ruban routier approximatif pour chacun des huit circuits. Les ressources d'objets de piste ne sont pas encore rendues : elles mélangent plusieurs chemins de soumission, dont des objets animés, et leur table de modèles référence une banque RRO qui n'est pas encore décodée. Le mode texturé ajoute seulement un asphalte procédural expérimental à la route. L'interface permet aussi de télécharger individuellement les ressources sous leur nom extrait (`R4.BIN.00000`, etc.). Les fichiers déjà extraits ne sont pas nécessaires.

## Lancement

Depuis la racine du projet, lancez un serveur HTTP, par exemple :

```sh
python3 -m http.server 8000
```

Ouvrez ensuite [http://localhost:8000/](http://localhost:8000/) dans un navigateur compatible WebGL. Le mode Ridge Racer 1 est sélectionné par défaut. L'interface permet de changer de mode, de choisir un bloc ou le circuit complet, de modifier le rendu et de passer en vue de dessus. En mode Ridge Racer Type 4, chargez `R4.BIN`, choisissez l'un des huit circuits puis cliquez sur « Afficher le circuit ». Double-cliquez sur une surface affichée pour y centrer la caméra et son pivot de rotation, sans changer l'angle ni la distance de vue.

## Tests

Avec Node.js et les fichiers Ridge Racer 1 et Ridge Racer Type 4 en place :

```sh
node tests/map.test.js
node tests/map-vram.test.js
node tests/objects.test.js
node tests/sceneview.test.js
node tests/rr4.test.js
```
