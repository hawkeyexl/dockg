/**
 * Metadata coverage fields (ADR 01011). Coverage answers the ADR 01008
 * question — what can a graph-side consumer see — by counting `dockg:Document`
 * nodes that carry each predicate. The list is fixed and deliberate: a
 * predicate absent from every document still shows as 0%, which a dynamic
 * census could not surface. It is shared between the config parser (which
 * expands a uniform threshold across every field) and `dockg stats` (which
 * reports and gates), and pinned by test/unit/schema-sync.ts against the
 * config schema so it cannot silently drift.
 */
import { NS } from "./vocab.js";

export interface CoverageField {
  /** Config/report key. */
  field: string;
  /** Compact form for the report, e.g. `dcterms:title`. */
  predicate: string;
  /** Full predicate IRI counted against `dockg:Document` subjects. */
  iri: string;
}

/** Report order is this array's order. */
export const COVERAGE_FIELDS: readonly CoverageField[] = [
  { field: "title", predicate: "dcterms:title", iri: `${NS.dcterms}title` },
  {
    field: "description",
    predicate: "dcterms:description",
    iri: `${NS.dcterms}description`,
  },
  {
    field: "creator",
    predicate: "dcterms:creator",
    iri: `${NS.dcterms}creator`,
  },
  {
    field: "created",
    predicate: "dcterms:created",
    iri: `${NS.dcterms}created`,
  },
  {
    field: "modified",
    predicate: "dcterms:modified",
    iri: `${NS.dcterms}modified`,
  },
  {
    field: "subject",
    predicate: "dcterms:subject",
    iri: `${NS.dcterms}subject`,
  },
  {
    field: "prefLabel",
    predicate: "foaf:primaryTopic",
    iri: `${NS.foaf}primaryTopic`,
  },
];

/** The measured field names, in report order. */
export const COVERAGE_FIELD_NAMES: readonly string[] = COVERAGE_FIELDS.map(
  (f) => f.field,
);
