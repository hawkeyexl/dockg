/**
 * Graph derivation: DocModel[] → deduplicated Quad[]. This file is the
 * vocabulary mapping — the deterministic rules for what documentation
 * structure becomes which triples.
 */
import type { DocModel } from "../types.js";
import type { DeriveSource } from "./config.js";
import { hasScheme, resolveRelative } from "./analyze.js";
import {
  encodeSegment,
  mintAgentIri,
  mintBuildActivityIri,
  mintConceptIri,
  mintDocIri,
  mintGraphIri,
  mintSchemeIri,
  mintSectionIri,
  normalizeDocPath,
} from "./iri.js";
import { NS, RDF_TYPE } from "./vocab.js";

export type Term =
  | { kind: "iri"; value: string }
  | { kind: "literal"; value: string; datatype?: string };

export interface Quad {
  s: string;
  p: string;
  o: Term;
}

export interface DeriveOptions {
  baseIri: string;
  derive: DeriveSource[];
  /** dockg's own version, stamped on the build agent (provenance source). */
  toolVersion?: string;
  /** ISO 8601 corpus HEAD committer date; set only under `provenance.gitTime`. */
  gitTime?: string;
}

const iri = (value: string): Term => ({ kind: "iri", value });
const lit = (value: string): Term => ({ kind: "literal", value });
const typedLit = (value: string, datatype: string): Term => ({
  kind: "literal",
  value,
  datatype,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/** Type a frontmatter date value; plain literal when unrecognized. */
function dateTerm(value: string): Term {
  if (DATE_RE.test(value)) return typedLit(value, `${NS.xsd}date`);
  if (DATETIME_RE.test(value)) return typedLit(value, `${NS.xsd}dateTime`);
  return lit(value);
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string" && v.length > 0) return v;
  if (typeof v === "number") return String(v);
  // TOML frontmatter yields Date instances (smol-toml TomlDate). String(date)
  // is locale/timezone-dependent and would break byte-identical output;
  // ISO 8601 is stable everywhere.
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  }
  return undefined;
}

function asStringArray(v: unknown): string[] {
  if (typeof v === "string") return v.length > 0 ? [v] : [];
  if (Array.isArray(v)) {
    return v.flatMap((item) => {
      const s = asString(item);
      return s === undefined ? [] : [s];
    });
  }
  return [];
}

/** First defined frontmatter value among aliases. */
function fmValue(fm: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (fm[key] !== undefined && fm[key] !== null) return fm[key];
  }
  return undefined;
}

/** The `kg` sub-map of frontmatter, or undefined. */
function kgObject(fm: Record<string, unknown>): Record<string, unknown> | undefined {
  const kg = fm["kg"];
  return kg && typeof kg === "object" && !Array.isArray(kg)
    ? (kg as Record<string, unknown>)
    : undefined;
}

export function deriveGraph(docs: DocModel[], options: DeriveOptions): Quad[] {
  const { baseIri } = options;
  const sources = new Set(options.derive);
  const quads: Quad[] = [];
  const add = (s: string, p: string, o: Term) => quads.push({ s, p, o });
  let mintedConcepts = false;

  /** Concept node + membership triples; returns the concept IRI. */
  const concept = (label: string): string => {
    const c = mintConceptIri(baseIri, label);
    add(c, RDF_TYPE, iri(`${NS.skos}Concept`));
    add(c, `${NS.skos}prefLabel`, lit(label));
    add(c, `${NS.skos}inScheme`, iri(mintSchemeIri(baseIri)));
    mintedConcepts = true;
    return c;
  };

  const docByPath = new Map(docs.map((d) => [normalizeDocPath(d.path), d]));
  const prov = sources.has("provenance");

  /** Agent node (person or software agent); dedupe converges repeats. */
  const agentNode = (name: string, type: "Person" | "SoftwareAgent"): string => {
    const a = mintAgentIri(baseIri, name);
    add(a, RDF_TYPE, iri(`${NS.prov}${type}`));
    add(a, `${NS.foaf}name`, lit(name));
    return a;
  };

  for (const doc of docs) {
    const docIri = mintDocIri(baseIri, doc.path);
    const fm = doc.frontmatter;
    const kg = kgObject(fm);

    add(docIri, RDF_TYPE, iri(`${NS.dockg}Document`));
    if (prov) add(docIri, RDF_TYPE, iri(`${NS.prov}Entity`));
    add(docIri, `${NS.dockg}path`, lit(normalizeDocPath(doc.path)));

    if (sources.has("frontmatter")) {
      const title = asString(fmValue(fm, ["title"])) ?? doc.firstH1;
      if (title) add(docIri, `${NS.dcterms}title`, lit(title));

      const description = asString(fmValue(fm, ["description"]));
      if (description) add(docIri, `${NS.dcterms}description`, lit(description));

      for (const author of asStringArray(fmValue(fm, ["author", "authors"]))) {
        if (prov) {
          const a = agentNode(author, "Person");
          add(docIri, `${NS.dcterms}creator`, iri(a));
          add(docIri, `${NS.prov}wasAttributedTo`, iri(a));
        } else {
          add(docIri, `${NS.dcterms}creator`, lit(author));
        }
      }

      const created = asString(fmValue(fm, ["date", "created"]));
      if (created) {
        add(docIri, `${NS.dcterms}created`, dateTerm(created));
        if (prov) add(docIri, `${NS.prov}generatedAtTime`, dateTerm(created));
      }

      const modified = asString(fmValue(fm, ["updated", "lastmod", "modified"]));
      if (modified) add(docIri, `${NS.dcterms}modified`, dateTerm(modified));

      const language = asString(fmValue(fm, ["lang", "language"]));
      if (language) add(docIri, `${NS.dcterms}language`, lit(language));

      // kg sub-key: SKOS fields dockg owns (frontmatter key `kg`, RDF ns `dockg:`).
      if (kg) {
        const k = kg;
        const prefLabel = asString(k["prefLabel"]);
        if (prefLabel) {
          const topic = concept(prefLabel);
          add(docIri, `${NS.foaf}primaryTopic`, iri(topic));
          for (const alt of asStringArray(k["altLabels"])) {
            add(topic, `${NS.skos}altLabel`, lit(alt));
          }
          for (const rel of ["broader", "narrower", "related"] as const) {
            for (const label of asStringArray(k[rel])) {
              add(topic, `${NS.skos}${rel}`, iri(concept(label)));
            }
          }
        }
      }
    }

    if (sources.has("tags")) {
      const kgSubjects = kg ? asStringArray(kg["subjects"]) : [];
      const labels = [
        ...asStringArray(fmValue(fm, ["tags", "keywords"])),
        ...kgSubjects,
      ];
      for (const label of labels) {
        add(docIri, `${NS.dcterms}subject`, iri(concept(label)));
      }
    }

    if (sources.has("sections")) {
      for (const section of doc.sections) {
        const secIri = mintSectionIri(docIri, section.slug);
        const parentIri = section.parentSlug
          ? mintSectionIri(docIri, section.parentSlug)
          : docIri;
        add(secIri, RDF_TYPE, iri(`${NS.dockg}Section`));
        add(secIri, `${NS.dcterms}title`, lit(section.title));
        add(secIri, `${NS.dockg}level`, typedLit(String(section.level), `${NS.xsd}integer`));
        add(secIri, `${NS.dockg}order`, typedLit(String(section.order), `${NS.xsd}integer`));
        add(parentIri, `${NS.dcterms}hasPart`, iri(secIri));
      }
    }

    if (sources.has("links")) {
      for (const link of doc.links) {
        if (link.kind === "external" && link.url) {
          add(docIri, `${NS.dcterms}references`, iri(link.url));
        } else if (link.kind === "internal" && link.resolvedPath) {
          const targetIri = mintDocIri(baseIri, link.resolvedPath);
          const target = docByPath.get(link.resolvedPath);
          const anchorResolves =
            link.anchor !== undefined &&
            target !== undefined &&
            target.sections.some((s) => s.slug === link.anchor);
          add(
            docIri,
            `${NS.dcterms}references`,
            iri(anchorResolves ? mintSectionIri(targetIri, link.anchor!) : targetIri),
          );
        } else if (link.kind === "broken") {
          add(docIri, `${NS.dockg}brokenLink`, lit(link.raw));
        }
      }
    }

    if (sources.has("images")) {
      for (const image of doc.images) {
        const target = image.external
          ? image.target
          : `${baseIri}file/${normalizeDocPath(image.target)
              .split("/")
              .map(encodeSegment)
              .join("/")}`;
        add(docIri, `${NS.schema}image`, iri(target));
      }
    }

    if (sources.has("code")) {
      for (const language of doc.codeLanguages) {
        add(docIri, `${NS.dockg}codeLanguage`, lit(language));
      }
    }

    if (prov) {
      // kg.derivedFrom: doc-relative path, repo-relative path, or URL.
      for (const raw of kg ? asStringArray(kg["derivedFrom"]) : []) {
        if (hasScheme(raw)) {
          add(docIri, `${NS.prov}wasDerivedFrom`, iri(raw));
          continue;
        }
        const docRelative = resolveRelative(doc.path, raw);
        const target =
          docRelative !== null && docByPath.has(docRelative)
            ? docRelative
            : docByPath.has(normalizeDocPath(raw))
              ? normalizeDocPath(raw)
              : null;
        if (target) {
          add(docIri, `${NS.prov}wasDerivedFrom`, iri(mintDocIri(baseIri, target)));
        } else {
          add(docIri, `${NS.dockg}brokenLink`, lit(raw));
        }
      }

      // Whole-page generation: kg.generatedBy, falling back to the page-level
      // `generatedBy` convention shared with docevals.
      const generatedBy =
        (kg && asString(kg["generatedBy"])) ?? asString(fmValue(fm, ["generatedBy"]));
      if (generatedBy) {
        const activity = `${docIri}#generation`;
        add(docIri, `${NS.prov}wasGeneratedBy`, iri(activity));
        add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
        add(activity, `${NS.prov}wasAssociatedWith`, iri(agentNode(generatedBy, "SoftwareAgent")));
      }

      // kg.provenance (written by `dockg fill`): attribute the machine-filled
      // fields to a per-doc activity. Only the doc's own topic concept is
      // prov:generated — shared subject/tag concepts are never attributed,
      // or one doc's LLM would taint every doc using the same tag.
      const provenanceEntry =
        kg && kg["provenance"] && typeof kg["provenance"] === "object" && !Array.isArray(kg["provenance"])
          ? (kg["provenance"] as Record<string, unknown>)
          : undefined;
      if (provenanceEntry) {
        const model = asString(provenanceEntry["generatedBy"]);
        if (model) {
          const activity = `${docIri}#kg-fill`;
          add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
          add(activity, `${NS.prov}wasAssociatedWith`, iri(agentNode(model, "SoftwareAgent")));
          const filledFields = asStringArray(provenanceEntry["fields"]);
          for (const field of filledFields) {
            add(activity, `${NS.dockg}filledField`, lit(field));
          }
          const prefLabel = kg ? asString(kg["prefLabel"]) : undefined;
          if (prefLabel && filledFields.includes("prefLabel")) {
            add(activity, `${NS.prov}generated`, iri(mintConceptIri(baseIri, prefLabel)));
          }
        }
      }
    }
  }

  if (prov) {
    const graphIri = mintGraphIri(baseIri);
    const activity = mintBuildActivityIri(baseIri);
    const tool = agentNode("dockg", "SoftwareAgent");
    add(graphIri, RDF_TYPE, iri(`${NS.prov}Entity`));
    add(graphIri, `${NS.prov}wasGeneratedBy`, iri(activity));
    add(activity, RDF_TYPE, iri(`${NS.prov}Activity`));
    add(activity, `${NS.prov}wasAssociatedWith`, iri(tool));
    if (options.toolVersion) {
      add(tool, `${NS.dockg}version`, lit(options.toolVersion));
    }
    for (const doc of docs) {
      add(activity, `${NS.prov}used`, iri(mintDocIri(baseIri, doc.path)));
    }
    if (options.gitTime) {
      add(activity, `${NS.prov}endedAtTime`, typedLit(options.gitTime, `${NS.xsd}dateTime`));
    }
  }

  if (mintedConcepts) {
    const scheme = mintSchemeIri(baseIri);
    add(scheme, RDF_TYPE, iri(`${NS.skos}ConceptScheme`));
    add(scheme, `${NS.dcterms}title`, lit("dockg concepts"));
  }

  return dedupe(quads);
}

function quadKey(q: Quad): string {
  const o =
    q.o.kind === "iri"
      ? `i:${q.o.value}`
      : `l:${q.o.value}|${q.o.datatype ?? ""}`;
  return `${q.s}|${q.p}|${o}`;
}

function dedupe(quads: Quad[]): Quad[] {
  const seen = new Set<string>();
  const out: Quad[] = [];
  for (const q of quads) {
    const key = quadKey(q);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}
