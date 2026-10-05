# TODO

## Livrables

- [x] Documentation Docusaurus (`documentation/`), publiée comme artefact de déploiement GitHub Pages, sans site buildé commité
- [x] README complet
- [x] Logo SVG (une faux dont la lame est un croissant de lune) : `documentation/static/img/logo.svg`, repris comme icône de l'extension
- [ ] Logo « final » et illustration (Otoroshi, la mort avec sa faux, le logo Clever Cloud) : à générer avec un modèle de diffusion
- [x] Script Playwright de screenshots « en pleine action » contre un faux Clever Cloud : `documentation/screenshots`
- [ ] Lancer le script sur l'Otoroshi local (démarré avec `CLEVER_CLOUD_API_URL=http://127.0.0.1:9990 CLEVER_CLOUD_API_TOKEN=demo`) et commiter les captures

## CI

- [x] Job CI pour la doc : `.github/workflows/documentation.yaml` (build Docusaurus, déploiement GitHub Pages via artefact)
- [x] Job CI de release déclenché à la main : `.github/workflows/release.yaml` (tests, jar, tag, release GitHub avec le jar et son sha256)
- [ ] Activer GitHub Pages sur le dépôt (Settings → Pages → Source : GitHub Actions). Le dépôt étant privé, Pages demande un plan qui l'autorise, ou de le passer public

## Fonctionnel

- [x] Sélecteur d'app Clever dans le formulaire du plugin (options chargées depuis l'API Clever)
- [x] Mode `client_poll` retiré : redondant avec la page d'attente des navigateurs
- [ ] Calcul des économies et rapports (hors v1)
