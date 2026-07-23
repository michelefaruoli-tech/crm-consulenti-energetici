# CRM Gestionale per Consulenti Energetici

MVP online: clienti, contratti, provvigioni, dashboard, report e ruoli.
Hosting consigliato: **Vercel + Neon + sottodominio Tophost** (0 €).

## Deploy online (scelta confermata)

Segui la guida passo-passo: **[DEPLOY.md](./DEPLOY.md)**

In sintesi:
1. Neon (DB gratis)
2. Vercel (app gratis)
3. Su Tophost: CNAME `crm` → Vercel
4. URL: `https://crm.fmconsulenza.it`

## Sviluppo locale

1. Copia `.env.example` → `.env`
2. Incolla `DATABASE_URL` da Neon e un `AUTH_SECRET` lungo
3. Comandi:

```bash
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Apri http://localhost:3000

### Account demo

| Ruolo | Email | Password |
|-------|-------|----------|
| Admin | admin@crm.local | Admin123! |
| Segreteria | segreteria@crm.local | Segreteria123! |
| Collaboratore | collaboratore@crm.local | Collab123! |
| Commerciale | commerciale@crm.local | Comm123! |

## Stack

- Next.js 16 + React 19
- PostgreSQL su Neon (serverless)
- Prisma 7 + adapter Neon
- Auth JWT cookie
- Export Excel/PDF

## Cosa c’è nell’MVP

Login a ruoli, clienti, contratti (12 stati), provvigioni, dashboard, report, backup JSON, email opzionale (SMTP).
