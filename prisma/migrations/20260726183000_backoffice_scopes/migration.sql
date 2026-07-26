-- AlterEnum: ruolo Backoffice
ALTER TYPE "Role" ADD VALUE 'BACKOFFICE';

-- Scope fornitori per utente
CREATE TABLE "UserSupplierScope" (
    "userId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,

    CONSTRAINT "UserSupplierScope_pkey" PRIMARY KEY ("userId","supplierId")
);

-- Scope collaboratori opzionale per backoffice
CREATE TABLE "UserCollaboratorScope" (
    "userId" TEXT NOT NULL,
    "collaboratorId" TEXT NOT NULL,

    CONSTRAINT "UserCollaboratorScope_pkey" PRIMARY KEY ("userId","collaboratorId")
);

CREATE INDEX "UserSupplierScope_supplierId_idx" ON "UserSupplierScope"("supplierId");
CREATE INDEX "UserCollaboratorScope_collaboratorId_idx" ON "UserCollaboratorScope"("collaboratorId");

ALTER TABLE "UserSupplierScope" ADD CONSTRAINT "UserSupplierScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserSupplierScope" ADD CONSTRAINT "UserSupplierScope_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCollaboratorScope" ADD CONSTRAINT "UserCollaboratorScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserCollaboratorScope" ADD CONSTRAINT "UserCollaboratorScope_collaboratorId_fkey" FOREIGN KEY ("collaboratorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
