# Clever Cloud Reaper — the loop

A 64 second motion design that loops on the landing page of the docs: what the reaper does, told with a fleet of
Clever Cloud apps. The apps are blocks of blackened steel that glow molten orange and leak money while they run,
whether anyone uses them or not. The reaper's scythe puts the idle ones to sleep, and the next request wakes them
up. The film goes through a week of staging apps without the reaper, the name, the reaper at work, the wake up, the
must-be-up hours and the uptime checks, the savings, a feature wall and an end card. Then the fleet wakes back up
where the hook picks it up.

```
out/reaper-loop-1080p60.mp4             the master, 1080p60
../static/video/reaper-loop.webm        what the landing page plays (vp9, 1080p30)
../static/video/reaper-loop.mp4         the same in h.264, for the browsers without vp9
../static/video/reaper-loop-poster.jpg  shown before it plays, and instead of it with reduced motion
```

## How it is made

It uses the same machinery as the Cloud APIM booth loops. The film is an html page (`src/`) whose every frame is a
pure function of time: nothing animates on its own, and `window.__seek(t)` draws the frame at `t`. The same page
plays live in a browser and is rendered frame by frame by Playwright into ffmpeg, so the video is exact whatever
the machine. There is no capture and no screenshot: everything is drawn.

| | |
|---|---|
| `src/fleet.js` | the fleet: 24 apps on a 6 × 4 grid, as boxes in 3d drawn on a 2d canvas (faces filled dark, edges stroked in neon, sorted back to front). It also draws what rises from them (embers and € from the running apps, z from the sleeping ones), the requests from the gateway, and the swing of the scythe |
| `src/story.js` | what happens to every app over the film, as a pure function of time. It holds the replayed week of the hook (simulated office hours, the idle cost hour by hour), the requests, and the state of each app (running, between two states, booting, flashing) |
| `src/timing.js` | when each scene is on screen, and the moments of the story |
| `src/main.js` | the camera on the fleet over the film, the background, the transitions |
| `src/scenes/*.js` | one file per scene, shared helpers in `scenes/common.js` |
| `src/text.js` | every word |
| `src/engine.js` | tweening and dom helpers, shared with the other loops |
| `render.mjs` | renders the frames and pipes them into ffmpeg through parallel workers |
| `web.mjs` | encodes the master for the docs |
| `serve.mjs` | a static server, to watch it live |

The loop closes on itself. Every motion visible at the seam (the orbit of the camera, the grid, the embers, the
breathing leds) makes a whole number of turns over the 64 seconds. The particles read the state of their app at
the time they were emitted, wrapped around the film, so the embers on screen at the end are the ones on screen at
the start.

What the film says of the reaper is what it does, checked against the code:

- the states and their labels in the console;
- the words of the default waiting page, and its poll every five seconds;
- the default grace period of one hour;
- `DELETE …/applications/{app}/instances` to stop an app;
- requests held until the app is up, or a `503` with `Retry-After: 30`;
- must-be-up ranges, and monitoring filters that neither wake an app up nor keep it up;
- the savings: today, this month, this year, in all and right now, counted as hours asleep × min instances × the
  hourly price of the flavor, from the public prices of Clever Cloud.

The apps, domains, traffic and amounts are made up. The prices of the flavors are the real ones in the `par` zone,
in euros (XS €0.0222/h, S €0.0444/h, M €0.1056/h).

## Commands

```sh
npm install                        # node 18+

node serve.mjs                     # then http://localhost:5178/src/index.html (?t=30, ?t=30&pause)
                                   # space pauses, ←/→ jump 2 s

node render.mjs                    # out/reaper-loop-1080p60.mp4, a few minutes
node render.mjs --stills 4,22.5    # a few frames as png, to look at
node render.mjs --from 20 --to 31  # a part of it
node render.mjs --scale 2 --fps 30 # 4k

node web.mjs                       # the files of the landing page, from the master
```

## Scenes

| | |
|---|---|
| 0 – 8.3 s | **Hook**: "Your apps run 24/7. Your users don't." A week of 24 staging apps replayed as a time-lapse, night and day. The requests only come through the gateway during office hours, but every app keeps running and leaking money. The counter runs on what the idle apps were billed |
| 7.9 – 13.5 | **Title**: the artwork in the dark, then the logo slams in with a burst of embers. What it does, an Otoroshi extension by Cloud APIM |
| 13.2 – 24.4 | **It reaps**: shop-staging has had no request for an hour. The reaper checks it may stop it, calls Clever Cloud, and the app is asleep. Then the scythe swings through the fleet: the idle apps fall asleep, the busy ones stay up, and the bill of the fleet drops live |
| 24.1 – 35.5 | **It wakes**: someone opens shop-staging and gets the waiting page, which reloads itself once the app answers. An API call is held at the gateway, then answered `200` |
| 35.2 – 44.4 | **Stays awake when it should**: a week of three apps, with must-be-up ranges, requests and the grace period, and the uptime checks that change nothing |
| 44.1 – 52.9 | **Savings**: the tiles of the console, the last 30 days, and how a sleep is counted |
| 52.6 – 58.4 | **Feature wall** |
| 58.1 – 64 | **End card**: the logo, the promise, where to start, who makes it. Then the fleet wakes back up for the hook |
