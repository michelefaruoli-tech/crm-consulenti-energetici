# Backup versioni funzionanti

Ogni rilascio stabile:

```bash
npm run snapshot -- "descrizione"
git tag -a working-YYYYMMDD -m "versione funzionante"
git push origin working-YYYYMMDD
```

I file JSON restano in `backups/` (non su GitHub, dati personali).
Il codice si ripristina con il tag git.
- `working-2026-07-23T21-40-44-005Z-bdd55fd.json` — 2026-07-23T21:40:55.666Z — git bdd55fd — working dopo provvigioni compatte e data fornitura (210 contratti)
- `working-2026-07-23T21-50-51-794Z-aaf17d9.json` — 2026-07-23T21:51:03.445Z — git aaf17d9 — archivio storico + celle editabili contratti (210 contratti)
- `working-2026-07-23T22-03-24-684Z-b36228c.json` — 2026-07-23T22:03:36.338Z — git b36228c — dopo import utenze aprile Michele (429 contratti)
