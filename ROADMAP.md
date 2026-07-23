# Roadmap CRM Energia

Priorità concordate dopo analisi Excel `Rendiconto_Contratti_Database.xlsx`.

## Fatto / in corso

1. **Import foglio Dati** (520 contratti) → clienti, fornitori, collaboratori, contratti, provvigioni
2. Hosting online Vercel + Neon + dominio `crm.fmconsulenza.it`

## Prossimi step (in ordine)

### A. Modifica contratto (subito dopo import)
- Collaboratore: può modificare anagrafica cliente e dati contratto
- Provvigione: se la inserisce/modifica resta **gialla** finché admin non conferma → **verde**
- Admin può modificare e confermare (verde)

### B. Colori da date / storno / ricorrenza
Regole da definire con te:
- fuori storno → verde
- in scadenza → giallo
- scaduti → rosso
- pagamento ricorrente → verde salvia

### C. OCR da fattura/documento
Estrazione automatica: nome, CF/P.IVA, POD/PDR, indirizzi, tipo contratto, consumi per fasce, fisso/variabile, PCV/spread

### D. Report fornitori → assegnazione provvigioni
Ogni fornitore ha format diverso → soluzione prevista:
- **Template per fornitore** (mapping colonne)
- Upload report → matching POD/CF/contratto → calcolo da Listino
- Review umana prima della conferma

### E. Produzione PDF/Excel + email
- Download produzione collaboratore / aziendale
- Backup giornaliero file + email a te
- Fine mese: email a ogni collaboratore (produzione + fuori storno + ricorrenze)

### F. Sezione CTE / offerte
Archivio CTE, ranking miglior fisso → miglior variabile, notifica consulenti ad ogni aggiornamento

## Note Excel

- Foglio1 / Listino: regole da raffinare in seguito (ignorate nell’import attuale)
- Foglio Dati: fonte ufficiale contratti
