#!/usr/bin/env node
/**
 * Audit OpenClaw knowledge_base: stats, index alignment, OCR placeholders, ontology gaps.
 *
 *   node scripts/claworks-kb-audit-openclaw.mjs
 *   node scripts/claworks-kb-audit-openclaw.mjs --kb-root "/Volumes/Macintosh HD-1/..."
 *   node scripts/claworks-kb-audit-openclaw.mjs --write-report
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import {
  OPENCLAW_KB_CONTENT_DIRS,
  OPENCLAW_KB_NAMESPACE_MAP,
  resolveOpenclawKbRoot,
} from "./lib/openclaw-kb.mjs";

const { values } = parseArgs({
  options: {
    "kb-root": { type: "string" },
    "write-report": { type: "boolean", default: false },
    "sample-size": { type: "string", default: "5" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help) {
  console.log(`Usage: node scripts/claworks-kb-audit-openclaw.mjs [--kb-root PATH] [--write-report]

Writes optional report to <kb-root>/metadata/claworks_audit.json when --write-report is set.
`);
  process.exit(0);
}

const kbRoot = values["kb-root"]?.trim() || resolveOpenclawKbRoot();
const sampleSize = Math.max(1, Number.parseInt(values["sample-size"] ?? "5", 10) || 5);

if (!existsSync(kbRoot)) {
  console.error(`[kb-audit] KB root not found: ${kbRoot}`);
  process.exit(1);
}

const OCR_MARKERS = ["需要 OCR", "需要 OCR 识别", "PDF - 需要 OCR", "占位标题"];
const SOURCE_PATTERNS = [/^\*\*来源\*\*:/m, /^source:/im, /^original_path:/im];

function walkMdFiles(dir) {
  const out = [];
  if (!existsSync(dir)) {
    return out;
  }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkMdFiles(full));
    } else if (entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function analyzeMd(filePath) {
  const rel = relative(kbRoot, filePath).replace(/\\/g, "/");
  const text = readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const title =
    lines
      .find((l) => l.startsWith("# "))
      ?.slice(2)
      .trim() ?? "";
  const size = statSync(filePath).size;
  const hasSource = SOURCE_PATTERNS.some((p) => p.test(text));
  const needsOcr = OCR_MARKERS.some((m) => text.includes(m));
  const bodyChars = text
    .replace(/^---[\s\S]*?---\n?/, "")
    .replace(/^#.*$/m, "")
    .trim().length;
  const truncated = size < 600 && bodyChars < 200;
  const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
  return { rel, title, size, hasSource, needsOcr, truncated, bodyChars, hash };
}

function loadJson(path) {
  if (!existsSync(path)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function scoreOntology(doc, filename) {
  const hasObjectTypes = Boolean(
    doc?.object_types?.length ||
    doc?.objectTypes?.length ||
    (doc?.types && typeof doc.types === "object"),
  );
  const entityCount =
    (Array.isArray(doc?.entities) && doc.entities.length) ||
    (Array.isArray(doc?.instances) && doc.instances.length) ||
    (Array.isArray(doc?.objects) && doc.objects.length) ||
    0;
  const hasRelationshipTypes = Boolean(doc?.relationship_types);
  const hasCategories = Boolean(doc?.categories);
  const hasCompanyInfo = Boolean(doc?.company_info);
  return {
    file: filename,
    hasObjectTypes,
    entityCount,
    hasRelationshipTypes,
    hasCategories,
    hasCompanyInfo,
    importableViaBootstrap: hasObjectTypes,
    importableViaImport: entityCount > 0,
  };
}

console.log(`[kb-audit] kb_root=${kbRoot}`);

const categories = {};
const allFiles = [];
const hashIndex = new Map();
const duplicates = [];

for (const cat of OPENCLAW_KB_CONTENT_DIRS) {
  const dir = join(kbRoot, "content", cat);
  const files = walkMdFiles(dir);
  const stats = {
    category: cat,
    namespace: OPENCLAW_KB_NAMESPACE_MAP[cat] ?? cat,
    md_count: files.length,
    with_source: 0,
    needs_ocr: 0,
    truncated: 0,
    missing_title: 0,
    samples: [],
  };

  for (const fp of files) {
    const info = analyzeMd(fp);
    allFiles.push(info);
    if (info.hasSource) {
      stats.with_source++;
    }
    if (info.needsOcr) {
      stats.needs_ocr++;
    }
    if (info.truncated) {
      stats.truncated++;
    }
    if (!info.title) {
      stats.missing_title++;
    }
    const prev = hashIndex.get(info.hash);
    if (prev) {
      duplicates.push({ hash: info.hash, a: prev, b: info.rel });
    } else {
      hashIndex.set(info.hash, info.rel);
    }
  }

  stats.samples = files.slice(0, sampleSize).map((fp) => analyzeMd(fp));
  categories[cat] = stats;
}

const fileIndex = loadJson(join(kbRoot, "metadata", "file_index.json"));
let indexEntries = 0;
let indexWithSource = 0;
const indexedPaths = new Set();
const orphanIndexKeys = [];

if (fileIndex) {
  const entries = Array.isArray(fileIndex)
    ? fileIndex
    : typeof fileIndex === "object"
      ? Object.values(fileIndex)
      : [];
  indexEntries = Array.isArray(fileIndex)
    ? fileIndex.length
    : typeof fileIndex === "object"
      ? Object.keys(fileIndex).length
      : 0;

  for (const [key, row] of Object.entries(fileIndex)) {
    const pathVal = row?.path ?? row?.relative_path ?? key;
    indexedPaths.add(String(pathVal).replace(/\\/g, "/"));
    if (row?.source || row?.original_path || row?.source_path) {
      indexWithSource++;
    }
  }
}

const contentPaths = new Set(allFiles.map((f) => f.rel));
const missingFromIndex = [...contentPaths].filter((p) => !indexedPaths.has(p));
const missingFromContent = [...indexedPaths].filter((p) => !contentPaths.has(p));

const ontologyDir = join(kbRoot, "ontology");
const ontologyScores = [
  "enterprise_ontology.json",
  "relationship_ontology.json",
  "industry_ontology.json",
].map((name) => {
  const doc = loadJson(join(ontologyDir, name));
  return doc ? scoreOntology(doc, name) : { file: name, missing: true };
});

const tenderWorkflowTypes = [
  "TenderDocument",
  "BidPackage",
  "Quote",
  "BidSubmission",
  "TenderPlatform",
];
const extractedTypes = new Set();
for (const o of ontologyScores) {
  const doc = loadJson(join(ontologyDir, o.file));
  if (!doc) {
    continue;
  }
  const ots = doc?.object_types ?? doc?.objectTypes ?? [];
  if (Array.isArray(ots)) {
    for (const t of ots) {
      if (t?.name) {
        extractedTypes.add(t.name);
      }
    }
  }
}
const missingWorkflowTypes = tenderWorkflowTypes.filter((t) => !extractedTypes.has(t));

const linkageScore =
  allFiles.length > 0
    ? Math.round((allFiles.filter((f) => f.hasSource).length / allFiles.length) * 100)
    : 0;
const ocrRate =
  allFiles.length > 0
    ? Math.round((allFiles.filter((f) => f.needsOcr).length / allFiles.length) * 100)
    : 0;
const indexAlignScore =
  allFiles.length > 0
    ? Math.round(((allFiles.length - missingFromIndex.length) / allFiles.length) * 100)
    : 0;
const ontologyScore = ontologyScores.filter(
  (o) => o.importableViaBootstrap || o.importableViaImport || o.hasCompanyInfo,
).length;

const report = {
  generated_at: new Date().toISOString(),
  kb_root: kbRoot,
  totals: {
    md_files: allFiles.length,
    categories: Object.keys(categories).length,
    duplicates: duplicates.length,
    linkage_score_pct: linkageScore,
    ocr_placeholder_pct: ocrRate,
    index_align_score_pct: indexAlignScore,
    ontology_files_scored: ontologyScore,
  },
  categories,
  file_index: {
    entries: indexEntries,
    with_explicit_source_field: indexWithSource,
    missing_from_index: missingFromIndex.length,
    orphan_index_paths: missingFromContent.length,
    sample_missing_from_index: missingFromIndex.slice(0, 20),
    sample_orphan_index: missingFromContent.slice(0, 20),
  },
  duplicates: duplicates.slice(0, 50),
  ontology: {
    files: ontologyScores,
    missing_tender_workflow_types: missingWorkflowTypes,
    extracted_type_names: [...extractedTypes].slice(0, 50),
  },
  recommendations: [],
};

if (categories.other?.md_count > 500) {
  report.recommendations.push(
    "other/ 超过 500 文件 — 建议拆分子类（资质/专利误放/员工证书）并写入 _review/",
  );
}
if (ocrRate > 30) {
  report.recommendations.push(
    `约 ${ocrRate}% 文件为 OCR 占位 — 优先处理 tender/product 高价值 PDF`,
  );
}
if (missingWorkflowTypes.length > 0) {
  report.recommendations.push(
    `本体缺少投标工作流类型: ${missingWorkflowTypes.join(", ")} — bootstrap 无法驱动 quote/bid playbook`,
  );
}
if (!ontologyScores.some((o) => o.importableViaImport)) {
  report.recommendations.push(
    "ontology/*.json 无 entities/instances — cw_import_objects 无法导入实例",
  );
}
if (linkageScore < 80) {
  report.recommendations.push("frontmatter 来源链接覆盖不足 — 依赖 file_index 或 OCR 后补全");
}

console.log("\n=== KB Audit Summary ===");
console.log(`MD files: ${report.totals.md_files}`);
for (const [cat, s] of Object.entries(categories)) {
  console.log(
    `  ${cat} → ${s.namespace}: ${s.md_count} md, source=${s.with_source}, ocr=${s.needs_ocr}, truncated=${s.truncated}`,
  );
}
console.log(
  `\nScores: linkage=${linkageScore}% index_align=${indexAlignScore}% ocr_placeholder=${ocrRate}%`,
);
console.log(`Duplicates (content hash): ${duplicates.length}`);
console.log(
  `file_index: ${indexEntries} entries, missing_from_index=${missingFromIndex.length}, orphan=${missingFromContent.length}`,
);
console.log(
  `Ontology: ${ontologyScore}/3 files useful; missing workflow types: ${missingWorkflowTypes.join(", ") || "none"}`,
);
if (report.recommendations.length) {
  console.log("\nRecommendations:");
  for (const r of report.recommendations) {
    console.log(`  - ${r}`);
  }
}

if (values["write-report"]) {
  const metaDir = join(kbRoot, "metadata");
  if (!existsSync(metaDir)) {
    mkdirSync(metaDir, { recursive: true });
  }
  const outPath = join(metaDir, "claworks_audit.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`\n[kb-audit] wrote ${outPath}`);
}
