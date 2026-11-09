# Tandem DJ

Mixer DJ a due deck, mobile-first e installabile come PWA. La modalità locale usa file audio
del dispositivo e li analizza interamente nel browser; la modalità YouTube usa esclusivamente
l'**IFrame Player API ufficiale**. L'interfaccia è in italiano.

> **Privacy prima di tutto.** I file locali non vengono caricati su nessun server. Non ci sono
> account, telemetria o backend applicativo.

## Funzioni

### Deck locali

- Due deck con play/pausa, cue, seek, crossfader e master volume.
- Tre bande di EQ, filtro passa-basso, gain e volume per deck.
- Waveform in canvas con playhead verde e anteprima affiancata dei due brani.
- Analisi locale in Web Worker: BPM, primo beat, tonalità stimata, Camelot e picchi waveform.
- Transizioni beat-aware con snap al beat, presets **Auto**, **Fade**, **Rise**, **Custom** e
  durata selezionabile (1, 2, 4, 8, 16 o 32 battute; default 16).
- Curve di volume, EQ e filtro configurabili nel preset Custom.
- Auto mix: avvia la transizione al mix point quando il deck corrente è in riproduzione.
- Coda locale con caricamento automatico del brano successivo a fine transizione.
- Cronologia degli ultimi mix, con BPM e Camelot quando disponibili.

### Deck YouTube

- Due player IFrame ufficiali, controlli play/pausa/cue/seek e crossfader.
- Ricerca e playlist pubbliche tramite YouTube Data API v3, se configurata.
- Accesso opzionale alle playlist personali con Google Identity Services e scope
  `youtube.readonly`.
- Transizione **solo fade** con le stesse durate in battute (a 120 BPM di riferimento).

### PWA e persistenza

- Installabile su desktop e mobile, con service worker e precache dell'app.
- Preferenze, sessione/coda e cronologia persistite in `localStorage`; metadati della libreria e
  waveform in IndexedDB. I blob audio sono opzionali e soggetti a un limite configurabile
  (default **220 MB**, massimo file **160 MB**, durata massima **15 minuti**).
- Se la cache non è disponibile o il file è stato rimosso dal browser, il brano resta in
  libreria ma va reimportato per essere riprodotto.

## Limiti della modalità YouTube

Il player IFrame **non espone il flusso audio** alla pagina. Di conseguenza, per scelta e per
limite tecnico:

- non sono disponibili EQ, filtro, gain, waveform, BPM, key o beatgrid;
- la transizione è un crossfade di volume, non è beat-matched;
- non è possibile registrare, scaricare o estrarre l'audio;
- ricerca e playlist richiedono una API key valida e una connessione;
- i video possono essere non incorporabili o rimossi: l'errore viene mostrato nell'interfaccia.

Tandem DJ non usa scraping, `yt-dlp`, API non ufficiali o bypass DRM. Non ci sono loghi,
asset o marchi Spotify: l'identità visiva è originale.

## Stack

- React 19 + TypeScript strict + Vite 8
- Zustand per lo stato applicativo
- Web Audio API per grafo audio, automazioni e crossfader
- Web Worker custom per analisi BPM/key/waveform
- IndexedDB (`idb`) per metadati e blob locali
- `vite-plugin-pwa` + Workbox per manifest, precache e aggiornamenti
- Vitest per i test di transizioni, Camelot e analisi
- CSS custom, font Manrope e Space Grotesk self-hosted

## Avvio

Requisiti: Node.js 20.19+ oppure 22.12+ e npm.

```bash
npm install
npm run dev
```

Apri `http://localhost:5173`.

### Variabili d'ambiente (opzionali)

Copia `.env.example` in `.env.local`:

```bash
VITE_YOUTUBE_API_KEY=
VITE_GOOGLE_CLIENT_ID=
```

- **`VITE_YOUTUBE_API_KEY`** abilita ricerca e playlist pubbliche tramite YouTube Data API v3.
  In Google Cloud abilita la YouTube Data API v3, crea una API key e restringila all'API e ai
  referrer del sito. Senza chiave restano utilizzabili i link diretti ai video.
- **`VITE_GOOGLE_CLIENT_ID`** abilita l'accesso Google per leggere le playlist personali.
  Configura un OAuth Web Client con le origini autorizzate e lo scope
  `https://www.googleapis.com/auth/youtube.readonly`. Il token resta solo in memoria e non
  viene salvato in `localStorage`.

Le variabili sono lette a build time da Vite: dopo averle cambiate riavvia il dev server o
rigenera il build. Non inserire mai client secret nel frontend.

## Comandi

```bash
npm run dev          # dev server con HMR
npm run build        # typecheck + build di produzione + service worker
npm run preview      # serve dist/ per provare la PWA
npm run typecheck    # TypeScript strict, senza emit
npm run lint         # oxlint
npm run test         # Vitest in watch
npm run test:run     # Vitest una tantum
npm run format       # Prettier
```

## Controlli

### Touch / mouse

- **Play/Pausa** e **CUE** nel dock in basso.
- **Mix** avvia la transizione; i preset sono nel dock e nel pannello Transizione.
- La waveform è cliccabile per il seek; il playhead è verde.
- La finestra di transizione è trascinabile: corpo per spostarla, maniglie per la durata.
- La libreria apre i controlli per deck, impostazioni, coda e ricerca YouTube.

### Tastiera (desktop)

| Tasto    | Azione                                         |
| -------- | ---------------------------------------------- |
| `Spazio` | Play/pausa del deck corrente                   |
| `M`      | Avvia il mix                                   |
| `C`      | Cue del deck corrente                          |
| `L`      | Apri la libreria                               |
| `Y`      | Apri il pannello YouTube (in modalità YouTube) |
| `1`–`4`  | Preset Auto, Fade, Rise, Custom                |

Le scorciatoie sono ignorate quando un pannello o un campo di testo è attivo.

## Come funziona il mix locale

1. Il file viene decodificato con `AudioContext.decodeAudioData` e il buffer resta in memoria.
2. Un Web Worker analizza il brano (fino a 150 secondi, 120 per il profilo tonale): stima BPM
   e fase del primo beat, profilo tonale e picchi della waveform. I risultati vengono salvati
   in IndexedDB.
3. `buildTransitionPlan` genera curve campionate per volume, bassi e filtri in base al preset,
   alle battute e al BPM del deck uscente. Se il BPM non è valido, usa 120 BPM e lo segnala.
4. `AudioParam.setValueCurveAtTime` applica le curve ai nodi Web Audio; un oscillatore
   inudibile fa da clock per rilevare la fine della transizione.
5. Al completamento, il deck entrante diventa corrente, il crossfader torna a zero e la coda
   carica automaticamente il brano successivo nel deck appena liberato.

Grafo audio locale:

```text
source → gate → trim → EQ utente → EQ transizione (bassi/LP/HP)
       → filtro utente → volume → fader → master compressor → destination
```

La modalità YouTube usa due player IFrame separati e regola il volume via API: nessun nodo
Web Audio può accedere allo stream.

## Struttura

```text
src/
  audio/
    engine.ts             # grafo Web Audio, play/seek/cue, transizioni
    youtube-engine.ts     # wrapper IFrame Player API
  components/             # UI, sheets, waveform, dock, pannelli
  hooks/                  # clock UI e deck
  lib/
    db.ts                 # IndexedDB (tracce + blob)
    keys.ts               # Camelot, compatibilità armonica
    transitions.ts        # durate, curve, snap, piano di transizione
    youtube-api.ts        # Data API v3 + Google Identity Services
  state/
    controller.ts         # orchestrazione import, play, mix, coda
    store.ts              # Zustand persistito
  workers/
    analysis-core.ts      # BPM/key/waveform (testabile in Node)
    analysis.worker.ts    # bridge del worker
  index.css               # design system completo
```

## Test

```bash
npm run test:run
```

La suite copre:

- durate in battute, fallback BPM, snap al beat e conteggi;
- curve di volume/EQ/filtro e preset Auto/Fade/Rise/Custom;
- crossfader equal-power e lineare;
- mappatura completa del cerchio di Camelot e compatibilità armonica;
- rilevamento BPM e waveform su campioni sintetici.

I test girano in Node e non richiedono browser. La verifica end-to-end manuale usa Chromium con
file WAV reali: import → analisi → play → mix → fine transizione → caricamento coda → auto mix.

## PWA e offline

Dopo il primo caricamento il service worker precacha l'app. Per provare il comportamento di
produzione:

```bash
npm run build
npm run preview
```

La modalità locale può funzionare offline se i blob sono ancora nella cache del browser. La
modalità YouTube richiede sempre rete. L'aggiornamento dell'app è esplicito: viene mostrato un
avviso con azione **Aggiorna** quando è disponibile una nuova versione.

## Privacy e note legali

- I file audio locali non vengono mai inviati a un server.
- Non vengono usati cookie di analytics o tracker.
- YouTube è incorporato con il player ufficiale; l'uso del servizio è soggetto ai termini di
  YouTube e alle impostazioni di incorporamento dei singoli video.
- L'analisi BPM/key è una stima euristica, non una verifica professionale: usa il tuo orecchio
  per i set dal vivo.
- L'app non aggira protezioni tecnologiche e non distribuisce contenuti protetti.

## Browser consigliati

Chrome/Edge recenti, Safari 17+ e Firefox recenti. Servono Web Audio, Web Worker, IndexedDB e
service worker. Su iOS l'audio richiede un gesto esplicito dell'utente: il primo play sblocca
il contesto audio. La UI è progettata per portrait, landscape e desktop, con aree sicure per
notch e home indicator.
