/**
 * Some guards prove an invariant over the client's real 2026 workbooks (the round trip of 986 receipts, the jute ledgers'
 * 298/367 rows, the measured data-quality counts): they only mean anything on a database that holds that import. Since Oct 2026
 * the seeder loads nothing (the team starts from an empty database), so on a fresh database they have nothing to check, and
 * a test that cannot run says so by being skipped, instead of failing on every run and hiding the failures that matter.
 *
 * To run them, load the 2026 workbooks into the test database through the app's own upload (docs/UPLOAD_GUIDE.md); this check
 * then turns on by itself.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
/** The 2026 import was 986 receipts; a database with a few entered trucks is not it. */
export const WORKBOOK_DATA: boolean = (await prisma.receipt.count({ where: { source: "imported" } })) >= 400;
await prisma.$disconnect();
