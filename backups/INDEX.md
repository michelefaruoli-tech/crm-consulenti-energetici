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
