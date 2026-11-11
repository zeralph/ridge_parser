# Viewer de circuits

Ce projet expérimental permet d'explorer dans un navigateur des données de circuits de jeux vidéo. Il utilise Three.js et propose deux modes :

- **Ridge Racer 1** : affichage du circuit depuis `MAP.RRM`, placement des sections avec `IDX.HED`, textures TMS, décors issus de `OBJ.RRO` et ciel panoramique.
- **Gran Turismo** : affichage du circuit `DESERT.MDL`, avec un mode de texture expérimental.

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
```

Le circuit Ridge Racer 1 nécessite `MAP.RRM` et `IDX.HED`. Les banques TMS servent aux textures et au ciel ; `OBJ.RRO` et `SCUS-943.00` servent aux décors du circuit complet. Pour les placements, seule la version de `SCUS-943.00` reconnue par le viewer est prise en charge. Le mode Gran Turismo utilise aussi les banques TMS de `ridge_racer/` pour son affichage texturé expérimental.

Les fichiers MAP, IDX et MDL peuvent également être sélectionnés depuis l'interface ; les textures et les décors sont recherchés dans `ridge_racer/`.

## Lancement

Depuis la racine du projet, lancez un serveur HTTP, par exemple :

```sh
python3 -m http.server 8000
```

Ouvrez ensuite [http://localhost:8000/](http://localhost:8000/) dans un navigateur compatible WebGL. Le mode Ridge Racer 1 est sélectionné par défaut. L'interface permet de changer de mode, de choisir un bloc ou le circuit complet, de modifier le rendu et de passer en vue de dessus.

## Tests

Avec Node.js et les fichiers Ridge Racer 1 en place :

```sh
node tests/map.test.js
node tests/map-vram.test.js
node tests/objects.test.js
```
