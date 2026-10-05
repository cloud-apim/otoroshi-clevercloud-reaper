# TODO

## Livrables à venir

- [ ] Documentation Docusaurus, publiée comme artefact de déploiement (build en CI, déployée sur GitHub Pages via artefact), pas de site buildé commité dans le code
- [ ] README complet : présentation, installation (jar + config), variables d'environnement, fonctionnement, topologies supportées, limites
- [ ] Logo : une faux
- [ ] Illustration : Otoroshi, la mort avec sa faux, et le logo Clever Cloud
- [ ] Script Playwright qui prend des screenshots « en pleine action » pour la doc (page du reaper avec des apps dans tous les états, panneau de config, historique, page d'attente, formulaire du plugin dans le route designer), sur le modèle de `../otoroshi-waf-extension/documentation/screenshots`

## CI

- [ ] Job CI pour la doc : build Docusaurus puis déploiement GitHub Pages via artefact
- [ ] Job CI de release déclenché à la main (workflow_dispatch) : build du jar, tag, release GitHub avec le jar

## Fonctionnel

- [x] Sélecteur d'app Clever dans le formulaire du plugin (options chargées depuis l'API Clever)
- [ ] Calcul des économies et rapports (hors v1)
