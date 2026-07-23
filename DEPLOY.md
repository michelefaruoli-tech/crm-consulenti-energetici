# Guida deploy FREE: Vercel + Neon + dominio Tophost
# Target: https://crm.fmconsulenza.it

## 1) Neon (database gratis)

1. Vai su https://console.neon.tech e crea un account (gratis)
2. Crea un progetto, regione **Europe (Frankfurt)** se disponibile
3. Copia la **connection string** (tipo `postgresql://...@...neon.tech/neondb?sslmode=require`)
   - Per Vercel preferisci la versione **pooled** (host con `-pooler`)

## 2) Configura il progetto in locale

Nel file `.env` (nella cartella del CRM):

```env
DATABASE_URL="incolla-qui-la-stringa-neon"
AUTH_SECRET="una-stringa-segreta-lunga-almeno-32-caratteri"
```

Poi esegui:

```bash
npm install
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

Verifica login: `admin@crm.local` / `Admin123!`

## 3) GitHub (necessario per Vercel)

1. Crea un repository privato su GitHub
2. Dal progetto:

```bash
git add .
git commit -m "CRM pronto per Vercel + Neon"
git branch -M main
git remote add origin https://github.com/TUO-USER/crm-consulenti-energetici.git
git push -u origin main
```

## 4) Vercel (hosting app gratis)

1. Vai su https://vercel.com → Login con GitHub
2. **Add New Project** → importa il repo del CRM
3. Framework: Next.js (rilevato in automatico)
4. In **Environment Variables** aggiungi:
   - `DATABASE_URL` = stessa stringa Neon (pooled)
   - `AUTH_SECRET` = stessa chiave del `.env`
5. Deploy

Dopo il primo deploy, se le tabelle non esistono ancora, da locale (con `.env` puntato a Neon):

```bash
npm run db:migrate
npm run db:seed
```

Oppure in Vercel → Settings → Environment Variables ok, poi in un secondo deploy.

Build command consigliato (già in `package.json` / Vercel default ok):

```
prisma generate && next build
```

## 5) Sottodominio su Tophost (`crm.fmconsulenza.it`)

### A. Su Vercel
1. Project → **Settings** → **Domains**
2. Aggiungi `crm.fmconsulenza.it`
3. Vercel ti mostra un record DNS (di solito `CNAME` verso `cname.vercel-dns.com`)

### B. Su Tophost (pannello CP)
1. Apri **Gestione DNS** / Zone DNS del dominio `fmconsulenza.it`
2. Crea record:
   - **Tipo:** `CNAME`
   - **Nome/Host:** `crm`
   - **Valore/Destinazione:** quello indicato da Vercel (es. `cname.vercel-dns.com`)
3. Salva e attendi propagazione (da pochi minuti a qualche ora)

### C. Verifica
Apri `https://crm.fmconsulenza.it` → login.

Il sito principale `fmconsulenza.it` su Topweb resta invariato.

## 6) Sicurezza consigliata subito dopo il go-live

1. Cambia la password di `admin@crm.local` (o crea un admin reale e disattiva i demo)
2. Non condividere mai `DATABASE_URL` / `AUTH_SECRET`
3. Repository GitHub: **privato**
4. Fai un backup periodico dalla pagina Report del CRM

## Riepilogo costi

| Servizio | Costo tipico |
|----------|--------------|
| Neon free | 0 € |
| Vercel Hobby | 0 € |
| Dominio già su Tophost | già pagato |
| Totale | **0 €** |

## Problemi comuni

- **Errore DB in produzione:** controlla che `DATABASE_URL` su Vercel sia quella **pooled** e con `sslmode=require`
- **Dominio non apre:** DNS CNAME non ancora propagato, o record sbagliato su Tophost
- **Login non funziona:** `AUTH_SECRET` diverso tra locale e Vercel, oppure seed non eseguito
