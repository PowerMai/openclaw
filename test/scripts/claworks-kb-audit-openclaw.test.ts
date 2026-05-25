import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const auditScript = join(root, "scripts/claworks-kb-audit-openclaw.mjs");

describe("claworks-kb-audit-openclaw", () => {
  it("reports stats for a minimal KB tree", () => {
    const kbRoot = mkdtempSync(join(tmpdir(), "kb-audit-"));
    mkdirSync(join(kbRoot, "content", "product_manual"), { recursive: true });
    mkdirSync(join(kbRoot, "metadata"), { recursive: true });
    writeFileSync(
      join(kbRoot, "content/product_manual/sample.md"),
      `# Sample\n\n**来源**: /tmp/original.pdf\n\nBody text here.\n`,
      "utf8",
    );
    writeFileSync(
      join(kbRoot, "metadata/file_index.json"),
      JSON.stringify({
        "product_manual/sample.md": {
          path: "content/product_manual/sample.md",
          category: "product_manual",
        },
      }),
      "utf8",
    );

    const r = spawnSync(process.execPath, [auditScript, "--kb-root", kbRoot], {
      cwd: root,
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("MD files: 1");
    expect(r.stdout).toContain("product_manual");
    expect(r.stdout).toContain("linkage=100%");
  });

  it("exits non-zero when kb root missing", () => {
    const r = spawnSync(process.execPath, [auditScript, "--kb-root", "/nonexistent/kb-root"], {
      cwd: root,
      encoding: "utf8",
    });
    expect(r.status).toBe(1);
  });
});
