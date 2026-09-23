/**
 * @fastify/multipart is installed at the workspace root (nothing else conflicts with its version,
 * so npm hoists it) rather than inside backend/node_modules. Its own bundled
 * `declare module "fastify"` augmentation lives there too, and resolves the bare specifier
 * "fastify" from ITS location — which has no node_modules/fastify above the workspace root — so
 * the merge silently fails (masked by tsconfig's skipLibCheck) and backend/src never sees
 * `req.file()`/`req.parts()` on FastifyRequest. Re-declared here, inside backend/src, so this
 * augmentation resolves "fastify" the same way every other backend/src file does (finds
 * backend/node_modules/fastify) and actually merges. Only the one method this backend uses.
 */
import type { MultipartFile } from "@fastify/multipart";

declare module "fastify" {
  interface FastifyRequest {
    file(): Promise<MultipartFile | undefined>;
  }
}
