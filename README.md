# Viewer de circuits

Ce projet expérimental permet d'explorer dans un navigateur des données de circuits de jeux vidéo. Il utilise Three.js et propose trois modes :

- **Ridge Racer 1** : affichage du circuit depuis `MAP.RRM`, placement des sections avec `IDX.HED`, textures TMS, décors issus de `OBJ.RRO` et ciel panoramique.
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
ridge_racer_4/
  R4.BIN
```

Le circuit Ridge Racer 1 nécessite `MAP.RRM` et `IDX.HED`. Les banques TMS servent aux textures et au ciel ; `OBJ.RRO` et `SCUS-943.00` servent aux décors du circuit complet. Pour les placements, seule la version de `SCUS-943.00` reconnue par le viewer est prise en charge. Le mode Gran Turismo utilise aussi les banques TMS de `ridge_racer/` pour son affichage texturé expérimental.

Les fichiers MAP, IDX et MDL peuvent également être sélectionnés depuis l'interface ; les textures et les décors sont recherchés dans `ridge_racer/`.
Le mode Ridge Racer Type 4 lit l'index de secteurs de `R4.BIN` et affiche les principaux flux de géométrie fixe de chacun des huit circuits, avec un ruban routier approximatif. Le ciel utilise les couches de géométrie colorée et texturée du circuit, avec un rendu expérimental. Le mode shaded affiche les couleurs des primitives sans éclairage ; le ruban approximatif reste de couleur uniforme. Le mode texturé reconstruit les textures TIM, les module par les couleurs des primitives et masque le ruban approximatif pour laisser apparaître la chaussée originale. Il ajoute par défaut aux couleurs du décor la première couleur ambiante du circuit : le panneau permet de la modifier ou de désactiver cet effet approximatif. Le ciel et les autres modes ne sont pas affectés. La visibilité, le brouillard et la semi-transparence originales ne sont pas encore émulés ; certaines surfaces peuvent se superposer. Les objets de piste, dont certains sont animés, ne sont pas encore rendus. L'interface permet aussi de télécharger individuellement les ressources sous leur nom extrait (`R4.BIN.00000`, etc.). Les fichiers déjà extraits ne sont pas nécessaires.

## Lancement

Depuis la racine du projet, lancez un serveur HTTP, par exemple :

```sh
python3 -m http.server 8000
```

Ouvrez ensuite [http://localhost:8000/](http://localhost:8000/) dans un navigateur compatible WebGL. Ridge Racer Type 4 démarre par défaut avec le premier circuit en mode texturé. L'interface permet de changer de mode, de choisir un bloc ou le circuit complet, de modifier le rendu et de passer en vue de dessus. Pour changer de circuit R4, choisissez l'un des huit circuits puis cliquez sur « Afficher le circuit ». Double-cliquez sur une surface affichée pour y centrer la caméra et son pivot de rotation, sans changer l'angle ni la distance de vue.

## Tests

Avec Node.js et les fichiers Ridge Racer 1 et Ridge Racer Type 4 en place :

```sh
node tests/map.test.js
node tests/map-vram.test.js
node tests/objects.test.js
node tests/sceneview.test.js
node tests/rr4.test.js
```
