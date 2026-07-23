# Backup versioni funzionanti

Ogni rilascio stabile:

```bash
npm run snapshot -- "descrizione"
git tag -a working-YYYYMMDD -m "versione funzionante"
git push origin working-YYYYMMDD
```

I file JSON restano in `backups/` (non su GitHub, dati personali).
Il codice si ripristina con il tag git.
