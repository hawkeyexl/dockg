import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../src/core/analyze.js";
import { deriveGraph } from "../../src/core/derive.js";
import { NS } from "../../src/core/vocab.js";
import type { Quad, Term } from "../../src/core/derive.js";
import type { DeriveSource } from "../../src/core/config.js";

const BASE = "https://example.com/kg/";
const ALL_SOURCES: DeriveSource[] = [
  "frontmatter",
  "sections",
  "links",
  "tags",
  "images",
  "code",
  "provenance",
];

function docs(files: Record<string, string>) {
  const paths = new Set(Object.keys(files));
  return Object.entries(files).map(([path, content]) =>
    analyzeDoc(content, path, paths),
  );
}

function graph(
  files: Record<string, string>,
  sources = ALL_SOURCES,
  extra: { toolVersion?: string; gitTime?: string } = {},
): Quad[] {
  return deriveGraph(docs(files), {
    baseIri: BASE,
    derive: sources,
    toolVersion: extra.toolVersion ?? "0.0.0-test",
    gitTime: extra.gitTime,
  });
}

function has(quads: Quad[], s: string, p: string, o: Term): boolean {
  return quads.some(
    (q) =>
      q.s === s &&
      q.p === p &&
      q.o.kind === o.kind &&
      q.o.value === o.value &&
      (q.o.kind === "iri" ||
        (q.o as { datatype?: string }).datatype ===
          (o as { datatype?: string }).datatype),
  );
}

const iri = (value: string): Term => ({ kind: "iri", value });
const lit = (value: string, datatype?: string): Term =>
  datatype ? { kind: "literal", value, datatype } : { kind: "literal", value };

const DOC = `${BASE}doc/docs/a.md`;

describe("deriveGraph — document basics", () => {
  it("types every doc and records its path", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(has(g, DOC, `${NS.rdf}type`, iri(`${NS.dockg}Document`))).toBe(true);
    expect(has(g, DOC, `${NS.dockg}path`, lit("docs/a.md"))).toBe(true);
  });

  it("maps frontmatter title, falling back to first H1", () => {
    const g1 = graph({ "docs/a.md": "---\ntitle: FM Title\n---\n\n# H1 Title\n" });
    expect(has(g1, DOC, `${NS.dcterms}title`, lit("FM Title"))).toBe(true);
    const g2 = graph({ "docs/a.md": "# H1 Title\n" });
    expect(has(g2, DOC, `${NS.dcterms}title`, lit("H1 Title"))).toBe(true);
  });

  it("maps description, creator (as agent node), dates, and language", () => {
    const g = graph({
      "docs/a.md":
        "---\ndescription: Desc\nauthor: Jane Doe\ndate: 2026-05-01\nupdated: 2026-07-01\nlang: en\n---\n",
    });
    const agent = `${BASE}agent/jane-doe`;
    expect(has(g, DOC, `${NS.dcterms}description`, lit("Desc"))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}creator`, iri(agent))).toBe(true);
    expect(has(g, DOC, `${NS.prov}wasAttributedTo`, iri(agent))).toBe(true);
    expect(has(g, agent, `${NS.rdf}type`, iri(`${NS.prov}Person`))).toBe(true);
    expect(has(g, agent, `${NS.foaf}name`, lit("Jane Doe"))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}created`, lit("2026-05-01", `${NS.xsd}date`))).toBe(true);
    expect(has(g, DOC, `${NS.prov}generatedAtTime`, lit("2026-05-01", `${NS.xsd}date`))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}modified`, lit("2026-07-01", `${NS.xsd}date`))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}language`, lit("en"))).toBe(true);
  });

  it("serializes Date frontmatter values as ISO 8601 (TOML frontmatter)", () => {
    const g = graph({
      "docs/a.md": "+++\ntitle = \"T\"\ndate = 2024-01-05T10:00:00Z\n+++\n",
    });
    expect(
      has(g, DOC, `${NS.dcterms}created`, lit("2024-01-05T10:00:00.000Z", `${NS.xsd}dateTime`)),
    ).toBe(true);
  });

  it("supports authors arrays (agent node per author, converging)", () => {
    const g = graph({
      "docs/a.md": "---\nauthors: [Jane, Sam]\n---\n",
      "docs/b.md": "---\nauthor: Jane\n---\n",
    });
    expect(has(g, DOC, `${NS.dcterms}creator`, iri(`${BASE}agent/jane`))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}creator`, iri(`${BASE}agent/sam`))).toBe(true);
    const janeTypes = g.filter(
      (q) => q.s === `${BASE}agent/jane` && q.p === `${NS.rdf}type`,
    );
    expect(janeTypes).toHaveLength(1);
  });

  it("falls back to creator literals when the provenance source is off", () => {
    const g = graph({ "docs/a.md": "---\nauthor: Jane\n---\n" }, ["frontmatter"]);
    expect(has(g, DOC, `${NS.dcterms}creator`, lit("Jane"))).toBe(true);
    expect(g.some((q) => q.p === `${NS.prov}wasAttributedTo`)).toBe(false);
    expect(g.some((q) => q.s.startsWith(`${BASE}agent/`))).toBe(false);
  });
});

describe("deriveGraph — provenance", () => {
  it("types every doc as prov:Entity when the source is on", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(has(g, DOC, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(true);
    const off = graph({ "docs/a.md": "# A\n" }, ["frontmatter"]);
    expect(has(off, DOC, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(false);
  });

  it("maps kg.derivedFrom to resolved docs, URLs, and broken links", () => {
    const g = graph({
      "docs/a.md":
        '---\nkg:\n  derivedFrom: [b.md, "https://example.org/spec", missing.md]\n---\n',
      "docs/b.md": "# B\n",
    });
    expect(has(g, DOC, `${NS.prov}wasDerivedFrom`, iri(`${BASE}doc/docs/b.md`))).toBe(true);
    expect(has(g, DOC, `${NS.prov}wasDerivedFrom`, iri("https://example.org/spec"))).toBe(true);
    expect(has(g, DOC, `${NS.dockg}brokenLink`, lit("missing.md"))).toBe(true);
  });

  it("maps kg.generatedBy (and page-level generatedBy fallback) to a generation activity", () => {
    const g = graph({
      "docs/a.md": "---\nkg:\n  generatedBy: claude-sonnet-4-5\n---\n",
      "docs/b.md": "---\ngeneratedBy: gpt-4o\n---\n",
    });
    const activity = `${DOC}#generation`;
    const model = `${BASE}agent/claude-sonnet-4-5`;
    expect(has(g, DOC, `${NS.prov}wasGeneratedBy`, iri(activity))).toBe(true);
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(true);
    expect(has(g, activity, `${NS.prov}wasAssociatedWith`, iri(model))).toBe(true);
    expect(has(g, model, `${NS.rdf}type`, iri(`${NS.prov}SoftwareAgent`))).toBe(true);
    expect(has(g, model, `${NS.foaf}name`, lit("claude-sonnet-4-5"))).toBe(true);
    // page-level fallback
    expect(
      has(g, `${BASE}doc/docs/b.md`, `${NS.prov}wasGeneratedBy`, iri(`${BASE}doc/docs/b.md#generation`)),
    ).toBe(true);
  });

  it("maps kg.provenance to a fill activity attributing the topic concept, not shared subjects", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  prefLabel: Config\n  subjects: [shared-tag]\n  provenance:\n    generatedBy: claude-sonnet-4-5\n    fields: [prefLabel, subjects]\n---\n",
      "docs/b.md": "---\ntags: [shared-tag]\n---\n",
    });
    const activity = `${DOC}#kg-fill`;
    const topic = `${BASE}concept/config`;
    const shared = `${BASE}concept/shared-tag`;
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(true);
    expect(has(g, activity, `${NS.prov}wasAssociatedWith`, iri(`${BASE}agent/claude-sonnet-4-5`))).toBe(true);
    expect(has(g, activity, `${NS.prov}generated`, iri(topic))).toBe(true);
    expect(has(g, activity, `${NS.dockg}filledField`, lit("prefLabel"))).toBe(true);
    expect(has(g, activity, `${NS.dockg}filledField`, lit("subjects"))).toBe(true);
    // the shared concept itself is never attributed
    expect(g.some((q) => q.s === shared && q.p.startsWith(NS.prov))).toBe(false);
    expect(g.some((q) => q.p === `${NS.prov}generated` && q.o.value === shared)).toBe(false);
  });

  it("emits the graph-level build activity with tool agent and prov:used edges", () => {
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, { toolVersion: "1.2.3" });
    const graphNode = `${BASE}graph`;
    const activity = `${BASE}activity/build`;
    const tool = `${BASE}agent/dockg`;
    expect(has(g, graphNode, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(true);
    expect(has(g, graphNode, `${NS.prov}wasGeneratedBy`, iri(activity))).toBe(true);
    expect(has(g, activity, `${NS.prov}used`, iri(DOC))).toBe(true);
    expect(has(g, activity, `${NS.prov}wasAssociatedWith`, iri(tool))).toBe(true);
    expect(has(g, tool, `${NS.rdf}type`, iri(`${NS.prov}SoftwareAgent`))).toBe(true);
    expect(has(g, tool, `${NS.dockg}version`, lit("1.2.3"))).toBe(true);
  });

  it("adds prov:endedAtTime only when gitTime is provided", () => {
    const time = "2026-07-20T12:00:00-07:00";
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, { gitTime: time });
    expect(
      has(g, `${BASE}activity/build`, `${NS.prov}endedAtTime`, lit(time, `${NS.xsd}dateTime`)),
    ).toBe(true);
    const without = graph({ "docs/a.md": "# A\n" });
    expect(without.some((q) => q.p === `${NS.prov}endedAtTime`)).toBe(false);
  });

  it("emits no graph-level block when the provenance source is off", () => {
    const g = graph({ "docs/a.md": "# A\n" }, ["frontmatter", "tags"]);
    expect(g.some((q) => q.s === `${BASE}graph`)).toBe(false);
    expect(g.some((q) => q.s === `${BASE}activity/build`)).toBe(false);
  });
});

describe("deriveGraph — tags and concepts", () => {
  it("mints one concept per tag with subject edges and a scheme", () => {
    const g = graph({ "docs/a.md": "---\ntags: [setup]\n---\n" });
    const concept = `${BASE}concept/setup`;
    expect(has(g, DOC, `${NS.dcterms}subject`, iri(concept))).toBe(true);
    expect(has(g, concept, `${NS.rdf}type`, iri(`${NS.skos}Concept`))).toBe(true);
    expect(has(g, concept, `${NS.skos}prefLabel`, lit("setup"))).toBe(true);
    expect(has(g, concept, `${NS.skos}inScheme`, iri(`${BASE}scheme`))).toBe(true);
    expect(has(g, `${BASE}scheme`, `${NS.rdf}type`, iri(`${NS.skos}ConceptScheme`))).toBe(true);
  });

  it("identical tags across docs converge on one concept", () => {
    const g = graph({
      "docs/a.md": "---\ntags: [setup]\n---\n",
      "docs/b.md": "---\nkeywords: [setup]\n---\n",
    });
    const conceptQuads = g.filter(
      (q) => q.s === `${BASE}concept/setup` && q.p === `${NS.rdf}type`,
    );
    expect(conceptQuads).toHaveLength(1);
  });

  it("emits no scheme when no concepts exist", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(g.some((q) => q.s === `${BASE}scheme`)).toBe(false);
  });
});

describe("deriveGraph — sections", () => {
  it("nests sections under doc and parent sections with level and order", () => {
    const g = graph({ "docs/a.md": "# A\n\n## B\n" });
    const secA = `${DOC}#a`;
    const secB = `${DOC}#b`;
    expect(has(g, secA, `${NS.rdf}type`, iri(`${NS.dockg}Section`))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}hasPart`, iri(secA))).toBe(true);
    expect(has(g, secA, `${NS.dcterms}hasPart`, iri(secB))).toBe(true);
    expect(has(g, secB, `${NS.dockg}level`, lit("2", `${NS.xsd}integer`))).toBe(true);
    expect(has(g, secB, `${NS.dockg}order`, lit("1", `${NS.xsd}integer`))).toBe(true);
  });
});

describe("deriveGraph — links", () => {
  it("maps internal links to doc references, resolving anchors to sections", () => {
    const g = graph({
      "docs/a.md": "[to b](b.md)\n[to sec](b.md#setup)\n[dead anchor](b.md#nope)\n",
      "docs/b.md": "## Setup\n",
    });
    const target = `${BASE}doc/docs/b.md`;
    expect(has(g, DOC, `${NS.dcterms}references`, iri(target))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}references`, iri(`${target}#setup`))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}references`, iri(`${target}#nope`))).toBe(false);
  });

  it("maps external links and broken links", () => {
    const g = graph({
      "docs/a.md": "[x](https://example.org/x)\n[gone](missing.md)\n",
    });
    expect(has(g, DOC, `${NS.dcterms}references`, iri("https://example.org/x"))).toBe(true);
    expect(has(g, DOC, `${NS.dockg}brokenLink`, lit("missing.md"))).toBe(true);
  });
});

describe("deriveGraph — kg sub-key (SKOS fields)", () => {
  it("mints a primary topic concept with labels and relations", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  prefLabel: Configuration\n  altLabels: [config]\n  broader: [Administration]\n  related: [Installation]\n  subjects: [reference]\n---\n",
    });
    const c = `${BASE}concept/configuration`;
    expect(has(g, DOC, `${NS.foaf}primaryTopic`, iri(c))).toBe(true);
    expect(has(g, c, `${NS.skos}prefLabel`, lit("Configuration"))).toBe(true);
    expect(has(g, c, `${NS.skos}altLabel`, lit("config"))).toBe(true);
    expect(has(g, c, `${NS.skos}broader`, iri(`${BASE}concept/administration`))).toBe(true);
    expect(has(g, c, `${NS.skos}related`, iri(`${BASE}concept/installation`))).toBe(true);
    expect(has(g, `${BASE}concept/administration`, `${NS.rdf}type`, iri(`${NS.skos}Concept`))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/reference`))).toBe(true);
  });
});

describe("deriveGraph — images, code, derive toggles", () => {
  it("maps images and code languages", () => {
    const g = graph({
      "docs/a.md": "![i](img/x.png)\n\n```python\np\n```\n",
    });
    expect(has(g, DOC, `${NS.schema}image`, iri(`${BASE}file/docs/img/x.png`))).toBe(true);
    expect(has(g, DOC, `${NS.dockg}codeLanguage`, lit("python"))).toBe(true);
  });

  it("respects derive source toggles", () => {
    const g = graph(
      { "docs/a.md": "---\ntitle: T\ntags: [x]\n---\n\n## S\n" },
      ["frontmatter"],
    );
    expect(has(g, DOC, `${NS.dcterms}title`, lit("T"))).toBe(true);
    expect(g.some((q) => q.p === `${NS.dcterms}subject`)).toBe(false);
    expect(g.some((q) => q.p === `${NS.dcterms}hasPart`)).toBe(false);
  });

  it("deduplicates repeated quads", () => {
    const g = graph({ "docs/a.md": "[x](b.md)\n[y](b.md)\n", "docs/b.md": "# B\n" });
    const refs = g.filter(
      (q) => q.s === DOC && q.p === `${NS.dcterms}references`,
    );
    expect(refs).toHaveLength(1);
  });
});
