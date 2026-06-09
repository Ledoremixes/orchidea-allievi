# Logo web app Orchidea Allievi

Copia questi file dentro il progetto React/Vite mantenendo gli stessi percorsi:

- public/manifest.webmanifest
- public/favicon.ico
- public/icons/icon-192.png
- public/icons/icon-512.png
- public/icons/icon-maskable-512.png
- public/icons/icon-180.png

Nel file index.html, dentro <head>, assicurati di avere:

<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#d9a441" />
<link rel="icon" href="/favicon.ico" />
<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-180.png" />

Dopo il deploy, rimuovi la vecchia web app dalla Home del telefono e aggiungila di nuovo.
Android e iPhone spesso tengono in cache la vecchia icona grigia con la lettera.
