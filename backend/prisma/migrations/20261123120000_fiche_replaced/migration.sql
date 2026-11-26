-- What the Verify supplier documents fields held before a fiche's values were put in over them (23 Nov 2026): the fiche
-- now fills the form, and the panel shows what differed so the person can put it back.
ALTER TABLE "FicheDocument" ADD COLUMN "replaced" JSONB;
