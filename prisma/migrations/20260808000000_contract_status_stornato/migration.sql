-- AlterEnum: stato contratto «Stornato» (storno applicato e incassato)
ALTER TYPE "ContractStatus" ADD VALUE IF NOT EXISTS 'STORNATO';
