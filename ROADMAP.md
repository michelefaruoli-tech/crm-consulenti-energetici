# Roadmap CRM Energia

Priorità concordate dopo analisi Excel `Rendiconto_Contratti_Database.xlsx`.

## Fatto / in corso

1. **Import foglio Dati** (520 contratti) → clienti, fornitori, collaboratori, contratti, provvigioni
2. Hosting online Vercel + Neon + dominio `crm.fmconsulenza.it`

## Prossimi step (in ordine)

### A. Modifica contratto + conferma gettone ✅
- Collaboratore: può modificare anagrafica cliente (se è collab sul contratto) e dati contratto
- Può modificare il gettone sui **propri** contratti → riga **gialla** finché Admin/Segreteria non conferma → **verde**
- Admin/Segreteria: modifica gettone = auto-verde; pulsante **Conferma** sulle righe gialle in Provvigioni

### B. Colori da date / storno / ricorrenza ✅
- Mesi di storno configurabili per fornitore (`/fornitori`)
- Conteggio da **ingresso in fornitura**
- Colori in **Contratti** e **Provvigioni**: fuori storno (verde), ricorrente (salvia), in scadenza (giallo), in storno/scaduto (rosso), KO/cessato (grigio)
- Stesso cliente + stesso POD → conta solo il contratto **più recente**
- Popup di avviso se si modifica un contratto non fuori storno

### C. OCR da fattura/documento ✅ (in uso)
Estrazione automatica CI/bolletta con fallback:
- Groq → Gemini (gratis) → **OpenRouter + Cloudflare AI** (PDF gratis) → OpenAI → OCR.space
- **Mistral OCR** (a pagamento): solo **Admin**, e solo se spunta la casella in «Analizza documenti»

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
