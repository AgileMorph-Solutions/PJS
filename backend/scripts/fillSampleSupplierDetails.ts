/**
 * Fills the LBA register details (zone, contact, RCCM, bank, …) of suppliers that have NONE yet with DEMO values,
 * so the supplier pages can be shown before the client sends the real ones (client's decision, Oct 2026: this
 * deployment is a demo).
 *
 * Every supplier it touches is marked detailsSource = "sample", which the supplier page shows as a badge, and the
 * mark is cleared the moment anyone saves real details (in the app or by Excel). A supplier with any detail already
 * entered is left alone, so this never overwrites a real value. Deterministic and safe to re-run.
 *
 *   npx tsx scripts/fillSampleSupplierDetails.ts          # show what would change
 *   npx tsx scripts/fillSampleSupplierDetails.ts --apply  # write it
 */
import { PROFILE_FIELDS } from "@anagroci/contract/domain/supplierProfile";
import { prisma } from "../src/db.js";

const apply = process.argv.includes("--apply");

// Cashew-growing areas of Côte d'Ivoire: [zone, region, town].
const AREAS: [string, string, string][] = [
  ["Centre", "Gbêkê", "Bouaké"], ["Centre-Nord", "Hambol", "Katiola"], ["Nord", "Poro", "Korhogo"], ["Nord", "Tchologo", "Ferkessédougou"],
  ["Nord-Ouest", "Bagoué", "Boundiali"], ["Centre-Ouest", "Worodougou", "Séguéla"], ["Nord-Ouest", "Béré", "Mankono"], ["Nord-Est", "Gontougo", "Bondoukou"],
];
const FIRST = ["Kouassi", "Yao", "Koné", "Traoré", "Ouattara", "Coulibaly", "Bamba", "Diabaté", "Konaté", "Soro", "N'Guessan", "Touré"];
const LAST = ["Adama", "Mariam", "Seydou", "Aminata", "Lassina", "Fatou", "Ibrahim", "Awa", "Moussa", "Salimata", "Drissa", "Kadiatou"];
const POSITIONS = ["Président", "Gérant", "Directeur", "Secrétaire général", "Responsable commercial"];
const BANKS = ["SGBCI", "Ecobank Côte d'Ivoire", "NSIA Banque", "BICICI", "Société Ivoirienne de Banque", "Banque Atlantique"];

/** The same supplier always gets the same sample values, so a re-run changes nothing. */
function sampleFor(n: number, name: string, code: string) {
  const [zone, region, town] = AREAS[n % AREAS.length]!;
  const person = `${FIRST[n % FIRST.length]} ${LAST[(n * 5 + 3) % LAST.length]}`;
  const digits = (seed: number, len: number) => String(1000000000 + ((seed * 7919) % 900000000)).slice(-len);
  const slug = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]+/g, "").slice(0, 16) || code.toLowerCase();
  return {
    zone, region,
    managerName: person,
    managerPosition: POSITIONS[n % POSITIONS.length]!,
    phonePrimary: `+225 07 ${digits(n + 11, 2)} ${digits(n + 23, 2)} ${digits(n + 37, 2)} ${digits(n + 41, 2)}`,
    phoneSecondary: n % 3 === 0 ? `+225 05 ${digits(n + 53, 2)} ${digits(n + 61, 2)} ${digits(n + 73, 2)} ${digits(n + 83, 2)}` : null,
    email: `contact@${slug}.ci`,
    address: `Quartier Commerce, BP ${100 + n}, ${town}`,
    registrationRef: `CI-${town.slice(0, 3).toUpperCase()}-${2018 + (n % 7)}-B-${digits(n + 97, 5)}`,
    bankAccountHolder: name,
    bankName: BANKS[n % BANKS.length]!,
    bankAccountRef: `CI${digits(n + 101, 3)} ${digits(n + 103, 5)} ${digits(n + 107, 10)} ${digits(n + 109, 2)}`,
  };
}

async function main() {
  const detailKeys = PROFILE_FIELDS.map((f) => f.key).filter((k) => k !== "name");
  const suppliers = await prisma.supplier.findMany({ orderBy: { supplierNo: "asc" } });
  // Only suppliers with no register detail at all: anything already entered is someone's real data.
  const empty = suppliers.filter((s) => detailKeys.every((k) => !((s as Record<string, unknown>)[k] as string | null)?.trim()));
  console.log(`${suppliers.length} suppliers; ${empty.length} have no register details yet${apply ? "" : " (dry run — nothing written)"}.`);
  for (const [n, s] of empty.entries()) {
    const data = sampleFor(n, s.name, s.code);
    if (apply) await prisma.supplier.update({ where: { code: s.code }, data: { ...data, detailsSource: "sample" } });
    if (n < 3) console.log(`  ${s.supplierNo} ${s.code} ${s.name}: ${data.zone} / ${data.region}, ${data.managerName}, ${data.bankName}`);
  }
  if (empty.length > 3) console.log(`  … and ${empty.length - 3} more`);
  console.log(apply ? `Filled ${empty.length} supplier(s), each marked "sample".` : "Re-run with --apply to write.");
}

main().then(() => prisma.$disconnect(), (e) => { console.error(e); process.exit(1); });
