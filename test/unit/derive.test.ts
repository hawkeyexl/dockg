import { describe, expect, it } from "vitest";
import { analyzeDoc } from "../../src/core/analyze.js";
import { deriveGraph } from "../../src/core/derive.js";
import { NS, ROLE } from "../../src/core/vocab.js";
import type { Quad, Term } from "../../src/core/derive.js";
import type { DeriveSource } from "../../src/core/config.js";
import type { GitHistory } from "../../src/core/git.js";

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
  extra: {
    toolVersion?: string;
    gitHistory?: GitHistory;
    qualified?: boolean;
  } = {},
): Quad[] {
  return deriveGraph(docs(files), {
    baseIri: BASE,
    derive: sources,
    toolVersion: extra.toolVersion ?? "0.0.0-test",
    gitHistory: extra.gitHistory,
    qualified: extra.qualified,
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
    const g1 = graph({
      "docs/a.md": "---\ntitle: FM Title\n---\n\n# H1 Title\n",
    });
    expect(has(g1, DOC, `${NS.dcterms}title`, lit("FM Title"))).toBe(true);
    const g2 = graph({ "docs/a.md": "# H1 Title\n" });
    expect(has(g2, DOC, `${NS.dcterms}title`, lit("H1 Title"))).toBe(true);
  });

  it("maps description, creator (as agent node), dates, and language", () => {
    const g = graph({
      "docs/a.md":
        "---\ndescription: Desc\nauthor: Jane Doe\ndate: 2026-05-01\nupdated: 2026-07-01\nlang: en\n---\n",
    });
    const agent = `${BASE}agent/person/jane-doe`;
    expect(has(g, DOC, `${NS.dcterms}description`, lit("Desc"))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}creator`, iri(agent))).toBe(true);
    expect(has(g, DOC, `${NS.prov}wasAttributedTo`, iri(agent))).toBe(true);
    expect(has(g, agent, `${NS.rdf}type`, iri(`${NS.prov}Person`))).toBe(true);
    expect(has(g, agent, `${NS.foaf}name`, lit("Jane Doe"))).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}created`, lit("2026-05-01", `${NS.xsd}date`)),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.prov}generatedAtTime`,
        lit("2026-05-01", `${NS.xsd}date`),
      ),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}modified`, lit("2026-07-01", `${NS.xsd}date`)),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}language`, lit("en"))).toBe(true);
  });

  it("serializes Date frontmatter values as ISO 8601 (TOML frontmatter)", () => {
    const g = graph({
      "docs/a.md": '+++\ntitle = "T"\ndate = 2024-01-05T10:00:00Z\n+++\n',
    });
    expect(
      has(
        g,
        DOC,
        `${NS.dcterms}created`,
        lit("2024-01-05T10:00:00.000Z", `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
  });

  it("supports authors arrays (agent node per author, converging)", () => {
    const g = graph({
      "docs/a.md": "---\nauthors: [Jane, Sam]\n---\n",
      "docs/b.md": "---\nauthor: Jane\n---\n",
    });
    expect(
      has(g, DOC, `${NS.dcterms}creator`, iri(`${BASE}agent/person/jane`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}creator`, iri(`${BASE}agent/person/sam`)),
    ).toBe(true);
    const janeTypes = g.filter(
      (q) => q.s === `${BASE}agent/person/jane` && q.p === `${NS.rdf}type`,
    );
    expect(janeTypes).toHaveLength(1);
  });

  it("falls back to creator literals when the provenance source is off", () => {
    const g = graph({ "docs/a.md": "---\nauthor: Jane\n---\n" }, [
      "frontmatter",
    ]);
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
    expect(
      has(g, DOC, `${NS.prov}wasDerivedFrom`, iri(`${BASE}doc/docs/b.md`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.prov}wasDerivedFrom`, iri("https://example.org/spec")),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dockg}brokenLink`, lit("missing.md"))).toBe(true);
  });

  it("maps kg.generatedBy (and page-level generatedBy fallback) to a generation activity", () => {
    const g = graph({
      "docs/a.md": "---\nkg:\n  generatedBy: claude-sonnet-4-5\n---\n",
      "docs/b.md": "---\ngeneratedBy: gpt-4o\n---\n",
    });
    // fragment uses a "." separator so heading slugs can never collide
    const activity = `${DOC}#prov.generation`;
    const model = `${BASE}agent/software/claude-sonnet-4-5`;
    expect(has(g, DOC, `${NS.prov}wasGeneratedBy`, iri(activity))).toBe(true);
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(
      true,
    );
    expect(has(g, activity, `${NS.prov}wasAssociatedWith`, iri(model))).toBe(
      true,
    );
    expect(has(g, model, `${NS.rdf}type`, iri(`${NS.prov}SoftwareAgent`))).toBe(
      true,
    );
    expect(has(g, model, `${NS.foaf}name`, lit("claude-sonnet-4-5"))).toBe(
      true,
    );
    // page-level fallback
    expect(
      has(
        g,
        `${BASE}doc/docs/b.md`,
        `${NS.prov}wasGeneratedBy`,
        iri(`${BASE}doc/docs/b.md#prov.generation`),
      ),
    ).toBe(true);
  });

  it("keeps a '## Generation' heading distinct from the generation activity", () => {
    const g = graph({
      "docs/a.md": "---\ngeneratedBy: gpt-4o\n---\n\n## Generation\n",
    });
    const section = `${DOC}#generation`;
    const activity = `${DOC}#prov.generation`;
    expect(has(g, section, `${NS.rdf}type`, iri(`${NS.dockg}Section`))).toBe(
      true,
    );
    expect(has(g, section, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(
      false,
    );
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.prov}Activity`))).toBe(
      true,
    );
    expect(has(g, activity, `${NS.rdf}type`, iri(`${NS.dockg}Section`))).toBe(
      false,
    );
  });

  it("maps kg.provenance entries to per-model fill activities, not shared subjects", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  prefLabel: Config\n  subjects: [shared-tag]\n  provenance:\n    - generatedBy: claude-sonnet-4-5\n      fields: [prefLabel]\n    - generatedBy: gpt-4o\n      fields: [subjects]\n---\n",
      "docs/b.md": "---\ntags: [shared-tag]\n---\n",
    });
    const claudeActivity = `${DOC}#prov.kg-fill.claude-sonnet-4-5`;
    const gptActivity = `${DOC}#prov.kg-fill.gpt-4o`;
    const topic = `${BASE}concept/config`;
    const shared = `${BASE}concept/shared-tag`;
    expect(
      has(g, claudeActivity, `${NS.rdf}type`, iri(`${NS.prov}Activity`)),
    ).toBe(true);
    expect(
      has(
        g,
        claudeActivity,
        `${NS.prov}wasAssociatedWith`,
        iri(`${BASE}agent/software/claude-sonnet-4-5`),
      ),
    ).toBe(true);
    expect(
      has(g, claudeActivity, `${NS.dockg}filledField`, lit("prefLabel")),
    ).toBe(true);
    // prefLabel's concept is generated by the model that proposed it, not the other
    expect(has(g, claudeActivity, `${NS.prov}generated`, iri(topic))).toBe(
      true,
    );
    expect(has(g, gptActivity, `${NS.prov}generated`, iri(topic))).toBe(false);
    expect(has(g, gptActivity, `${NS.dockg}filledField`, lit("subjects"))).toBe(
      true,
    );
    // the shared concept itself is never attributed
    expect(g.some((q) => q.s === shared && q.p.startsWith(NS.prov))).toBe(
      false,
    );
    expect(
      g.some((q) => q.p === `${NS.prov}generated` && q.o.value === shared),
    ).toBe(false);
  });

  it("still accepts the legacy single-object kg.provenance form", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  provenance:\n    generatedBy: claude-sonnet-4-5\n    fields: [subjects]\n---\n",
    });
    const activity = `${DOC}#prov.kg-fill.claude-sonnet-4-5`;
    expect(has(g, activity, `${NS.dockg}filledField`, lit("subjects"))).toBe(
      true,
    );
  });

  it("emits the graph-level build activity with tool agent and prov:used edges", () => {
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, {
      toolVersion: "1.2.3",
    });
    const graphNode = `${BASE}graph`;
    const activity = `${BASE}activity/build`;
    const tool = `${BASE}agent/software/dockg`;
    expect(has(g, graphNode, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(
      true,
    );
    expect(has(g, graphNode, `${NS.prov}wasGeneratedBy`, iri(activity))).toBe(
      true,
    );
    expect(has(g, activity, `${NS.prov}used`, iri(DOC))).toBe(true);
    expect(has(g, activity, `${NS.prov}wasAssociatedWith`, iri(tool))).toBe(
      true,
    );
    expect(has(g, tool, `${NS.rdf}type`, iri(`${NS.prov}SoftwareAgent`))).toBe(
      true,
    );
    expect(has(g, tool, `${NS.dockg}version`, lit("1.2.3"))).toBe(true);
  });

  it("adds prov:endedAtTime only when git history provides a head time", () => {
    const time = "2026-07-20T12:00:00-07:00";
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, {
      gitHistory: { headTime: time, files: new Map() },
    });
    expect(
      has(
        g,
        `${BASE}activity/build`,
        `${NS.prov}endedAtTime`,
        lit(time, `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
    const without = graph({ "docs/a.md": "# A\n" });
    expect(without.some((q) => q.p === `${NS.prov}endedAtTime`)).toBe(false);
  });

  it("maps declared kg.revisionOf like derivedFrom: resolved, URL, or broken", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  revisionOf: [old.md, https://example.org/v1, gone.md]\n---\n",
      "docs/old.md": "# Old\n",
    });
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri(`${BASE}doc/docs/old.md`)),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri("https://example.org/v1")),
    ).toBe(true);
    expect(has(g, DOC, `${NS.dockg}brokenLink`, lit("gone.md"))).toBe(true);
  });

  it("fills dates from git history only when frontmatter has none", () => {
    const gitHistory: GitHistory = {
      files: new Map([
        [
          "docs/a.md",
          {
            created: "2026-01-01T10:00:00+00:00",
            modified: "2026-02-02T10:00:00+00:00",
            authors: ["Git Author"],
            renamedFrom: [],
          },
        ],
      ]),
    };
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, { gitHistory });
    expect(
      has(
        g,
        DOC,
        `${NS.dcterms}created`,
        lit("2026-01-01T10:00:00+00:00", `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.dcterms}modified`,
        lit("2026-02-02T10:00:00+00:00", `${NS.xsd}dateTime`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.prov}wasAttributedTo`,
        iri(`${BASE}agent/person/git-author`),
      ),
    ).toBe(true);

    const fmWins = graph(
      { "docs/a.md": "---\ndate: 2025-05-05\nupdated: 2025-06-06\n---\n" },
      ALL_SOURCES,
      { gitHistory },
    );
    expect(
      fmWins.some(
        (q) => q.p === `${NS.dcterms}created` && q.o.value.startsWith("2026"),
      ),
    ).toBe(false);
    expect(
      has(
        fmWins,
        DOC,
        `${NS.dcterms}created`,
        lit("2025-05-05", `${NS.xsd}date`),
      ),
    ).toBe(true);
  });

  it("derives prov:wasRevisionOf edges from git renames", () => {
    const gitHistory: GitHistory = {
      files: new Map([
        [
          "docs/a.md",
          {
            authors: ["X"],
            renamedFrom: ["docs/old-name.md", "docs/older.md"],
          },
        ],
      ]),
    };
    const g = graph({ "docs/a.md": "# A\n" }, ALL_SOURCES, { gitHistory });
    const old = `${BASE}doc/docs/old-name.md`;
    expect(has(g, DOC, `${NS.prov}wasRevisionOf`, iri(old))).toBe(true);
    expect(
      has(g, DOC, `${NS.prov}wasRevisionOf`, iri(`${BASE}doc/docs/older.md`)),
    ).toBe(true);
    expect(has(g, old, `${NS.rdf}type`, iri(`${NS.prov}Entity`))).toBe(true);
  });

  it("emits no graph-level block when the provenance source is off", () => {
    const g = graph({ "docs/a.md": "# A\n" }, ["frontmatter", "tags"]);
    expect(g.some((q) => q.s === `${BASE}graph`)).toBe(false);
    expect(g.some((q) => q.s === `${BASE}activity/build`)).toBe(false);
  });
});

describe("deriveGraph — qualified provenance", () => {
  it("qualifies author attribution with a deterministic node and role", () => {
    const g = graph(
      { "docs/a.md": "---\nauthor: Jane Doe\n---\n" },
      ALL_SOURCES,
      {
        qualified: true,
      },
    );
    const node = `${DOC}#prov.attribution.jane-doe`;
    expect(has(g, DOC, `${NS.prov}qualifiedAttribution`, iri(node))).toBe(true);
    expect(has(g, node, `${NS.rdf}type`, iri(`${NS.prov}Attribution`))).toBe(
      true,
    );
    expect(
      has(g, node, `${NS.prov}agent`, iri(`${BASE}agent/person/jane-doe`)),
    ).toBe(true);
    expect(has(g, node, `${NS.prov}hadRole`, iri(ROLE.author))).toBe(true);
    // direct property remains
    expect(
      has(
        g,
        DOC,
        `${NS.prov}wasAttributedTo`,
        iri(`${BASE}agent/person/jane-doe`),
      ),
    ).toBe(true);
  });

  it("qualifies generation and build associations", () => {
    const g = graph(
      { "docs/a.md": "---\ngeneratedBy: model-x\n---\n" },
      ALL_SOURCES,
      { qualified: true },
    );
    // association nodes carry the agent slug so two agents on one activity
    // can never merge into a single node
    const genAssoc = `${DOC}#prov.generation.assoc.model-x`;
    expect(
      has(
        g,
        `${DOC}#prov.generation`,
        `${NS.prov}qualifiedAssociation`,
        iri(genAssoc),
      ),
    ).toBe(true);
    expect(
      has(g, genAssoc, `${NS.rdf}type`, iri(`${NS.prov}Association`)),
    ).toBe(true);
    expect(
      has(g, genAssoc, `${NS.prov}agent`, iri(`${BASE}agent/software/model-x`)),
    ).toBe(true);
    expect(has(g, genAssoc, `${NS.prov}hadRole`, iri(ROLE.generator))).toBe(
      true,
    );

    const buildAssoc = `${BASE}activity/build.assoc.dockg`;
    expect(
      has(
        g,
        `${BASE}activity/build`,
        `${NS.prov}qualifiedAssociation`,
        iri(buildAssoc),
      ),
    ).toBe(true);
    expect(has(g, buildAssoc, `${NS.prov}hadRole`, iri(ROLE.tool))).toBe(true);
  });

  it("emits zero qualified triples when the flag is off", () => {
    const g = graph({
      "docs/a.md": "---\nauthor: Jane\ngeneratedBy: m\n---\n",
    });
    expect(g.some((q) => q.p.includes("qualified"))).toBe(false);
    expect(g.some((q) => q.p === `${NS.prov}hadRole`)).toBe(false);
  });
});

describe("deriveGraph — tags and concepts", () => {
  it("mints one concept per tag with subject edges and a scheme", () => {
    const g = graph({ "docs/a.md": "---\ntags: [setup]\n---\n" });
    const concept = `${BASE}concept/setup`;
    expect(has(g, DOC, `${NS.dcterms}subject`, iri(concept))).toBe(true);
    expect(has(g, concept, `${NS.rdf}type`, iri(`${NS.skos}Concept`))).toBe(
      true,
    );
    expect(has(g, concept, `${NS.skos}prefLabel`, lit("setup"))).toBe(true);
    expect(has(g, concept, `${NS.skos}inScheme`, iri(`${BASE}scheme`))).toBe(
      true,
    );
    expect(
      has(g, `${BASE}scheme`, `${NS.rdf}type`, iri(`${NS.skos}ConceptScheme`)),
    ).toBe(true);
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
    expect(has(g, secB, `${NS.dockg}level`, lit("2", `${NS.xsd}integer`))).toBe(
      true,
    );
    expect(has(g, secB, `${NS.dockg}order`, lit("1", `${NS.xsd}integer`))).toBe(
      true,
    );
  });
});

describe("deriveGraph — links", () => {
  it("maps internal links to doc references, resolving anchors to sections", () => {
    const g = graph({
      "docs/a.md":
        "[to b](b.md)\n[to sec](b.md#setup)\n[dead anchor](b.md#nope)\n",
      "docs/b.md": "## Setup\n",
    });
    const target = `${BASE}doc/docs/b.md`;
    expect(has(g, DOC, `${NS.dcterms}references`, iri(target))).toBe(true);
    expect(has(g, DOC, `${NS.dcterms}references`, iri(`${target}#setup`))).toBe(
      true,
    );
    expect(has(g, DOC, `${NS.dcterms}references`, iri(`${target}#nope`))).toBe(
      false,
    );
  });

  it("maps external links and broken links", () => {
    const g = graph({
      "docs/a.md": "[x](https://example.org/x)\n[gone](missing.md)\n",
    });
    expect(
      has(g, DOC, `${NS.dcterms}references`, iri("https://example.org/x")),
    ).toBe(true);
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
    expect(
      has(g, c, `${NS.skos}broader`, iri(`${BASE}concept/administration`)),
    ).toBe(true);
    expect(
      has(g, c, `${NS.skos}related`, iri(`${BASE}concept/installation`)),
    ).toBe(true);
    expect(
      has(
        g,
        `${BASE}concept/administration`,
        `${NS.rdf}type`,
        iri(`${NS.skos}Concept`),
      ),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.dcterms}subject`, iri(`${BASE}concept/reference`)),
    ).toBe(true);
  });
});

describe("deriveGraph — iiRDS Core/Software typing (ADR 01012)", () => {
  it("references the published topic-type IRI", () => {
    const g = graph({ "docs/a.md": "---\nkg:\n  topicType: task\n---\n" });
    expect(
      has(g, DOC, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`)),
    ).toBe(true);
  });

  it("mints a ProductVariant node per appliesTo label", () => {
    const g = graph({
      "docs/a.md": "---\nkg:\n  appliesTo: [SP-X100, SP-X200]\n---\n",
    });
    for (const [slug, label] of [
      ["sp-x100", "SP-X100"],
      ["sp-x200", "SP-X200"],
    ] as const) {
      const v = `${BASE}product/${slug}`;
      expect(has(g, DOC, `${NS.iirds}relates-to-product-variant`, iri(v))).toBe(
        true,
      );
      expect(has(g, v, `${NS.rdf}type`, iri(`${NS.iirds}ProductVariant`))).toBe(
        true,
      );
      expect(has(g, v, `${NS.dcterms}title`, lit(label))).toBe(true);
    }
  });

  it("splits software-domain values across their two predicates", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  softwareLifecyclePhase: [deployment, update]\n  softwareSubject: [interface]\n---\n",
    });
    expect(
      has(
        g,
        DOC,
        `${NS.iirds}relates-to-product-lifecycle-phase`,
        iri(`${NS.iirdsSft}Deployment`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        DOC,
        `${NS.iirds}relates-to-product-lifecycle-phase`,
        iri(`${NS.iirdsSft}Update`),
      ),
    ).toBe(true);
    expect(
      has(g, DOC, `${NS.iirds}has-subject`, iri(`${NS.iirdsSft}Interface`)),
    ).toBe(true);
  });

  it("emits no iiRDS triples when the kg key is absent", () => {
    const g = graph({ "docs/a.md": "# A\n" });
    expect(g.some((q) => q.p.startsWith(NS.iirds))).toBe(false);
    expect(
      g.some((q) => q.o.kind === "iri" && q.o.value.startsWith(NS.iirdsSft)),
    ).toBe(false);
  });
});

describe("deriveGraph — section-level metadata (ADR 01013)", () => {
  const SEC = `${DOC}#install`;

  it("attaches iiRDS typing and subjects to the matching section node", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  sections:\n    install:\n      topicType: reference\n      appliesTo: [SP-X200]\n      softwareSubject: [interface]\n      subjects: [setup]\n---\n\n# A\n\n## Install\n",
    });
    expect(
      has(
        g,
        SEC,
        `${NS.iirds}has-topic-type`,
        iri(`${NS.iirds}GenericReference`),
      ),
    ).toBe(true);
    expect(
      has(
        g,
        SEC,
        `${NS.iirds}relates-to-product-variant`,
        iri(`${BASE}product/sp-x200`),
      ),
    ).toBe(true);
    expect(
      has(g, SEC, `${NS.iirds}has-subject`, iri(`${NS.iirdsSft}Interface`)),
    ).toBe(true);
    expect(
      has(g, SEC, `${NS.dcterms}subject`, iri(`${BASE}concept/setup`)),
    ).toBe(true);
  });

  it("emits dockg:brokenSectionRef for a key naming no heading", () => {
    const g = graph({
      "docs/a.md":
        "---\nkg:\n  sections:\n    nope:\n      topicType: task\n---\n\n# A\n\n## Install\n",
    });
    expect(has(g, DOC, `${NS.dockg}brokenSectionRef`, lit("nope"))).toBe(true);
    // The unmatched key attaches nothing to any section node.
    expect(g.some((q) => q.p === `${NS.iirds}has-topic-type`)).toBe(false);
  });

  it("does not leak the document's typing onto sections (explicit-only)", () => {
    const g = graph({
      "docs/a.md": "---\nkg:\n  topicType: task\n---\n\n# A\n\n## Install\n",
    });
    // The doc is typed; the section is not.
    expect(
      has(g, DOC, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`)),
    ).toBe(true);
    expect(
      g.some((q) => q.s === SEC && q.p === `${NS.iirds}has-topic-type`),
    ).toBe(false);
  });

  it("emits no section metadata when kg.sections is absent", () => {
    const g = graph({ "docs/a.md": "# A\n\n## Install\n" });
    expect(g.some((q) => q.p === `${NS.dockg}brokenSectionRef`)).toBe(false);
    expect(g.some((q) => q.s === SEC && q.p.startsWith(NS.iirds))).toBe(false);
  });

  it("requires the sections source (no section nodes, no metadata or broken ref)", () => {
    const g = graph(
      {
        "docs/a.md":
          "---\nkg:\n  sections:\n    install:\n      topicType: task\n    nope:\n      topicType: task\n---\n\n# A\n\n## Install\n",
      },
      ["frontmatter"],
    );
    // Sections source off: no section nodes, and no brokenSectionRef either
    // (every key would falsely read as broken without sections to match).
    expect(g.some((q) => q.p === `${NS.dockg}brokenSectionRef`)).toBe(false);
    expect(g.some((q) => q.s === SEC)).toBe(false);
  });

  it("gates section typing on the sections source, independent of frontmatter", () => {
    // ADR 01013's deliberate asymmetry: with `frontmatter` off but `sections`
    // on, the section still gets its iiRDS typing even though the document's
    // own kg typing (under `frontmatter`) does not.
    const g = graph(
      {
        "docs/a.md":
          "---\nkg:\n  topicType: concept\n  sections:\n    install:\n      topicType: task\n---\n\n# A\n\n## Install\n",
      },
      ["sections"],
    );
    expect(
      has(g, SEC, `${NS.iirds}has-topic-type`, iri(`${NS.iirds}GenericTask`)),
    ).toBe(true);
    // Document-level typing is gated by `frontmatter`, which is off here.
    expect(
      has(
        g,
        DOC,
        `${NS.iirds}has-topic-type`,
        iri(`${NS.iirds}GenericConcept`),
      ),
    ).toBe(false);
  });
});

describe("deriveGraph — images, code, derive toggles", () => {
  it("maps images and code languages", () => {
    const g = graph({
      "docs/a.md": "![i](img/x.png)\n\n```python\np\n```\n",
    });
    expect(
      has(g, DOC, `${NS.schema}image`, iri(`${BASE}file/docs/img/x.png`)),
    ).toBe(true);
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
    const g = graph({
      "docs/a.md": "[x](b.md)\n[y](b.md)\n",
      "docs/b.md": "# B\n",
    });
    const refs = g.filter(
      (q) => q.s === DOC && q.p === `${NS.dcterms}references`,
    );
    expect(refs).toHaveLength(1);
  });
});
