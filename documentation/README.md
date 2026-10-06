# Documentation

The [Docusaurus](https://docusaurus.io/) site of the Clever Cloud Reaper extension for Otoroshi.

```bash
npm install
npm start          # dev server on http://localhost:3000/otoroshi-clevercloud-reaper/
npm run build      # static build into ./build
npm run serve      # serve the built site
```

The build output is **not committed**. Pushing to `main` with changes under `documentation/`
triggers `.github/workflows/documentation.yaml`, which builds the site and publishes it straight to
GitHub Pages as an artifact.

The screenshots in `static/img/screenshots` come from a real Otoroshi:
[`screenshots/`](./screenshots) holds the Playwright script that takes them.

The video that loops on the landing page (`static/video`) is a motion design drawn in a browser:
[`motion/`](./motion) holds the page, the renderer that turns it into a video frame by frame, and the
script that encodes it for the web (`node render.mjs && node web.mjs`).
