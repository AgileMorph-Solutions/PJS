/**
 * A truck's CCA fiche: upload a photo or scan, see what was read off it, and get the file back to show it
 * (services/ficheDocuments.ts). Warehouse Incharge / admin only: auth/policy.ts lists none of these for the narrower roles.
 */
import type { FastifyInstance } from "fastify";
import { currentUser } from "../auth/plugin.js";
import { getFiche, getFicheFile, rereadFiche, uploadFiche } from "../services/ficheDocuments.js";
import { requireReceipt } from "./receipts.js";

/** A filename safe inside a Content-Disposition header: the original's letters and digits, never its quotes or line breaks. */
const headerSafeName = (name: string) => name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "fiche";

export async function ficheRoutes(app: FastifyInstance) {
  app.get("/api/receipts/:id/fiche", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    return getFiche(id);
  });

  app.get("/api/receipts/:id/fiche/file", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    const file = await getFicheFile(id);
    if (!file) return reply.code(404).send({ error: "No fiche has been uploaded for this truck." });
    return reply
      .type(file.mimeType)
      // Shown in the page, never run: the type was checked against the file's bytes on upload, and the browser must not
      // guess another one.
      .header("X-Content-Type-Options", "nosniff")
      // The receipt page shows a PDF fiche in a frame of its own; no other site may.
      .header("Content-Security-Policy", "frame-ancestors 'self'")
      .header("Content-Disposition", `inline; filename="${headerSafeName(file.fileName)}"`)
      .header("Cache-Control", "private, no-cache")
      .send(Buffer.from(file.data));
  });

  /**
   * Multipart field "file". Keeps the fiche (replacing an earlier one), reads it, and fills the step's empty fields from it;
   * a failed read still keeps the file.
   */
  app.post("/api/receipts/:id/fiche", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    const file = await req.file();
    if (!file) return reply.code(400).send({ error: 'No file uploaded — expected multipart field "file".' });
    const data = await file.toBuffer();
    const u = currentUser(req);
    return uploadFiche(id, { fileName: file.filename, mimeType: file.mimetype, data }, { id: u.id, role: u.role });
  });

  /** Reads the kept fiche again, e.g. after a read failed because the reader was busy. */
  app.post("/api/receipts/:id/fiche/read", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!(await requireReceipt(id, reply, req))) return;
    const u = currentUser(req);
    return (await rereadFiche(id, { id: u.id, role: u.role })) ?? reply.code(404).send({ error: "No fiche has been uploaded for this truck." });
  });
}
