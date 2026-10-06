import { useEffect, useRef } from 'react';
import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import CodeBlock from '@theme/CodeBlock';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './index.module.css';

const steps = [
  {
    num: '01',
    name: 'It watches',
    desc: 'Every request through a route under the reaper is an access, recorded in memory on the node that served it, and flushed every few seconds. No log pipeline, no analytics backend.',
  },
  {
    num: '02',
    name: 'It reaps',
    desc: 'An app without traffic for its grace period, outside its must-be-up hours, is stopped through the Clever Cloud API. Its instances stop costing anything.',
  },
  {
    num: '03',
    name: 'It wakes',
    desc: 'The next request starts it again. A browser gets a page that reloads itself once the app answers; an API call is held until the app is up, or gets a clean 503.',
  },
];

const capabilities = [
  {
    kicker: 'Per route',
    title: 'All the settings in one plugin',
    body: 'Grace period, must-be-up hours, monitoring requests to ignore, what callers get while the app boots, a custom waiting page. Add the plugin to a route and you are done: no other entity to create.',
  },
  {
    kicker: 'Waking up',
    title: 'A waiting page that knows when to reload',
    body: 'The page polls its own URL and reloads the moment your app really answers it: not when a deployment says it is done, and not on a timer. Bring your own HTML if you like.',
  },
  {
    kicker: 'Waking up',
    title: 'Held requests for APIs',
    body: 'An API call on a sleeping app can simply wait, held open before the backend call, and go through once the app is up. To the caller it is a slow response, not an error.',
  },
  {
    kicker: 'Staying awake',
    title: 'Office hours and uptime checks',
    body: 'Keep apps up during the hours people use them, started before they arrive. Tell uptime checks and health probes apart from traffic: they neither keep an app awake nor wake it up.',
  },
  {
    kicker: 'Console',
    title: 'Every route, in the backoffice',
    body: 'A table of every route with the state of its app, and a page per route with its settings, its actions (wake up, put to sleep, reset) and the history of its app.',
  },
  {
    kicker: 'Cluster',
    title: 'Built for Otoroshi clusters',
    body: 'One job per cluster drives the apps, with a lock per app so nothing is ever started twice. Workers serve from memory and report their traffic to the leaders.',
  },
  {
    kicker: 'Safety',
    title: 'Hands off when in doubt',
    body: 'An app whose last deployment failed is never stopped. An app that fails to stop or start goes into error, raises an alert, and is left alone until someone looks at it.',
  },
  {
    kicker: 'Safety',
    title: 'Dry-run and a kill switch',
    body: 'Start in dry-run to read what would be put to sleep. Flip the kill switch from the console to stop all reaping across the cluster, at once, without a restart.',
  },
  {
    kicker: 'Observability',
    title: 'History, events, alerts',
    body: 'Every transition is kept per app and sent as an Otoroshi event, to route through any data exporter. An app in error raises an alert.',
  },
];

const quickstart = `# a clever cloud api token, for the reaper
clever tokens create "otoroshi reaper"

# otoroshi and the extension
curl -L -o otoroshi.jar \\
  'https://github.com/MAIF/otoroshi/releases/download/v18.0.0-preview9/otoroshi.jar'
curl -L -o reaper.jar \\
  '.../otoroshi-clevercloud-reaper/releases/download/<version>/otoroshi-clevercloud-reaper_3-<version>.jar'

# run them together
CLEVER_CLOUD_API_TOKEN='...' java -cp "./reaper.jar:./otoroshi.jar" \\
  play.core.server.ProdServerStart`;

function Hero() {
  const illustration = useBaseUrl('/img/illustration.webp');
  return (
    <header
      className={styles.hero}
      style={{
        backgroundImage: `linear-gradient(90deg, rgba(8, 8, 10, 0.94) 0%, rgba(8, 8, 10, 0.82) 38%, rgba(8, 8, 10, 0.25) 75%, rgba(8, 8, 10, 0.1) 100%), url(${illustration})`,
      }}>
      <div className="container">
        <div className={styles.heroLayout}>
          <img className={styles.heroLogo} src={useBaseUrl('/img/logo-band.webp')} alt="Clever Cloud Reaper" />
          <div className={styles.heroEyebrow}>Cloud APIM · Otoroshi extension</div>
          <Heading as="h1" className={styles.heroTitle}>
            Put the Clever Cloud apps <span className={styles.heroAccent}>nobody uses</span> to sleep
          </Heading>
          <p className={styles.heroSubtitle}>
            Staging, demo and preview apps spend their nights and weekends waiting for someone. The
            Clever Cloud Reaper stops your <a className={styles.heroLink} href="https://www.clever.cloud">Clever Cloud</a>{' '}
            apps when they get no traffic, and wakes them up on the next request, right from the{' '}
            <a className={styles.heroLink} href="https://www.otoroshi.io">Otoroshi</a> routes that serve them.
          </p>
          <div className={styles.heroButtons}>
            <Link className={styles.buttonPrimary} to="/docs/overview">
              Read the docs
            </Link>
            <Link className={styles.buttonGhost} to="/docs/quickstart">
              Quickstart
            </Link>
            <Link className={styles.buttonGhost} href="https://github.com/cloud-apim/otoroshi-clevercloud-reaper">
              GitHub
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

function Showreel() {
  const video = useRef(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return undefined;
    // react does not always render the muted attribute, and a browser only autoplays a muted video
    v.muted = true;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      v.controls = true;
      return undefined;
    }
    // it plays while it is on screen, and only loads once it gets there
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) v.play().catch(() => {});
        else v.pause();
      },
      { threshold: 0.2 },
    );
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <section className={styles.showreel}>
      <div className="container">
        <div className={styles.showreelFrame}>
          <video
            ref={video}
            className={styles.showreelVideo}
            muted
            loop
            playsInline
            preload="none"
            poster={useBaseUrl('/video/reaper-loop-poster.jpg')}
            aria-label="The Clever Cloud Reaper in one minute: idle apps burning money all week, the reaper putting them to sleep, a request waking one up, and what it saved.">
            <source src={useBaseUrl('/video/reaper-loop.webm')} type='video/webm; codecs="av01.0.08M.08"' />
            <source src={useBaseUrl('/video/reaper-loop.mp4')} type="video/mp4" />
          </video>
        </div>
      </div>
    </section>
  );
}

function Steps() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionTag}>How it works</div>
        <Heading as="h2" className={styles.sectionTitle}>
          Watch, reap, wake
        </Heading>
        <p className={styles.sectionLede}>
          The reaper is a plugin on the routes of your apps, and a job that drives them through
          their lifecycle with the Clever Cloud API. Nothing else to deploy.
        </p>
        <div className={styles.layers}>
          {steps.map((step) => (
            <div className={styles.layer} key={step.num}>
              <span className={styles.layerNum}>{step.num}</span>
              <span className={styles.layerName}>{step.name}</span>
              <p className={styles.layerDesc}>{step.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Screens() {
  return (
    <section className={`${styles.section} ${styles.sectionAlt}`}>
      <div className="container">
        <div className={styles.sectionTag}>In the backoffice</div>
        <Heading as="h2" className={styles.sectionTitle}>
          Every route, and where its app stands
        </Heading>
        <p className={styles.sectionLede}>
          A table of every route with the state of its app, and a page per route to tune it, act on
          it and read its history.
        </p>
        <div className={styles.screens}>
          <img
            className={styles.screen}
            src={useBaseUrl('/img/screenshots/reaper-routes.png')}
            alt="The routes table of the Clever Cloud Reaper"
          />
          <img
            className={styles.screen}
            src={useBaseUrl('/img/screenshots/reaper-waiting-page.png')}
            alt="The waiting page a browser gets while its app wakes up"
          />
        </div>
      </div>
    </section>
  );
}

function CleverCloud() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionTag}>Otoroshi × Clever Cloud</div>
        <Heading as="h2" className={styles.sectionTitle}>
          On Clever Cloud since day one
        </Heading>
        <div className={styles.cleverLayout}>
          <div>
            <p className={styles.cleverText}>
              Otoroshi has been deployed on <a href="https://www.clever.cloud">Clever Cloud</a> since
              its very first day, and Clever Cloud now runs it as a managed service,{' '}
              <a href="https://www.clever.cloud/developers/doc/deploy/services/otoroshi/">Otoroshi with LLM</a>.
              An Otoroshi in front of Clever Cloud apps is a common setup: it already sees every
              request those apps get, so it is the natural place to notice the ones nobody uses, and
              to wake them up when someone does.
            </p>
            <p className={styles.cleverText}>
              The reaper talks to the Clever Cloud API with an{' '}
              <a href="https://github.com/CleverCloud/clever-tools">API token</a>, counts what sleeping
              saved with the <a href="https://www.clever.cloud/pricing/">Clever Cloud prices</a> of each
              zone, and links every app to its page in the{' '}
              <a href="https://console.clever-cloud.com/">Clever Cloud console</a>.
            </p>
          </div>
          <div className={styles.cleverLinks}>
            <a className={styles.cleverLink} href="https://www.clever.cloud">
              <strong>Clever Cloud</strong>
              <span>The platform the reaper puts to sleep and wakes up</span>
            </a>
            <a className={styles.cleverLink} href="https://www.clever.cloud/developers/doc/deploy/services/otoroshi/">
              <strong>Otoroshi with LLM</strong>
              <span>Otoroshi, managed by Clever Cloud</span>
            </a>
            <a className={styles.cleverLink} href="https://maif.github.io/otoroshi/manual/docs/deploy/clever-cloud">
              <strong>Deploy Otoroshi on Clever Cloud</strong>
              <span>The Otoroshi manual, step by step</span>
            </a>
            <a className={styles.cleverLink} href="https://www.clever.cloud/developers/doc/">
              <strong>Clever Cloud documentation</strong>
              <span>Apps, add-ons, the CLI and the API</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Capabilities() {
  return (
    <section className={`${styles.section} ${styles.sectionAlt}`}>
      <div className="container">
        <div className={styles.sectionTag}>Capabilities</div>
        <Heading as="h2" className={styles.sectionTitle}>
          What the reaper gives you
        </Heading>
        <div className={styles.grid}>
          {capabilities.map((c) => (
            <div className={styles.card} key={c.title}>
              <div className={styles.cardKicker}>{c.kicker}</div>
              <div className={styles.cardTitle}>{c.title}</div>
              <p className={styles.cardBody}>{c.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Start() {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.sectionTag}>Get going</div>
        <Heading as="h2" className={styles.sectionTitle}>
          Five minutes to a first sleeping app
        </Heading>
        <p className={styles.sectionLede}>
          Download the jar, give it a Clever Cloud API token, and enable the reaper on a route from
          the console. The <Link to="/docs/quickstart">quickstart</Link> walks through it with a two
          minute grace period, so you see it happen.
        </p>
        <div className={styles.snippet}>
          <CodeBlock language="bash">{quickstart}</CodeBlock>
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  return (
    <Layout
      title="Put the Clever Cloud apps nobody uses to sleep"
      description="An Otoroshi extension that stops the Clever Cloud apps without traffic and wakes them up on the next request, with a waiting page, held requests, must-be-up hours and a console in the Otoroshi backoffice.">
      <Hero />
      <Showreel />
      <main>
        <Steps />
        <Screens />
        <CleverCloud />
        <Capabilities />
        <Start />
      </main>
    </Layout>
  );
}
