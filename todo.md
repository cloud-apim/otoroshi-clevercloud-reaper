# TODO

## Livrables

- [x] Documentation Docusaurus (`documentation/`), publiée comme artefact de déploiement GitHub Pages, sans site buildé commité
- [x] README complet
- [x] Logos et illustration (sources dans `resources/`) : logo « groupe de metal » en tête du README et de l'accueil de la doc, emblème recadré pour le favicon, la barre de la doc et l'icône de l'extension, illustration en bannière
- [ ] Incruster le vrai logo Clever Cloud dans l'illustration (après vérification de leur charte)
- [x] Script Playwright de screenshots « en pleine action » contre un faux Clever Cloud : `documentation/screenshots`
- [x] Lancer le script sur l'Otoroshi local (démarré avec `CLEVER_CLOUD_API_URL=http://127.0.0.1:9990 CLEVER_CLOUD_API_TOKEN=demo`) et commiter les captures

## CI

- [x] Job CI pour la doc : `.github/workflows/documentation.yaml` (build Docusaurus, déploiement GitHub Pages via artefact)
- [x] Job CI de release déclenché à la main : `.github/workflows/release.yaml` (tests, jar, tag, release GitHub avec le jar et son sha256)
- [ ] Activer GitHub Pages sur le dépôt (Settings → Pages → Source : GitHub Actions). Le dépôt étant privé, Pages demande un plan qui l'autorise, ou de le passer public

## Fonctionnel

- [x] Sélecteur d'app Clever dans le formulaire du plugin (options chargées depuis l'API Clever)
- [x] Mode `client_poll` retiré : redondant avec la page d'attente des navigateurs
- [x] Calcul des économies : coût de chaque app (taille × prix Clever de sa zone) stocké et relu toutes les 6 h, chaque sommeil comptabilisé une fois à sa fin, totaux par app et par jour stockés
- [ ] Refaire les captures avec les économies (`reaper-route-savings.png` manque, les autres n'ont pas encore les tuiles et la colonne)
