/**
 * iiRDS Core + Software-domain term IRIs and the frontmatter-value → IRI maps
 * (ADR 01012). Every IRI here is byte-verified against the published
 * `iirds-core.rdf` / `iirds-software.rdf` in iirds-consortium/models. dockg
 * references these IRIs; it never redefines or re-types them (iiRDS is
 * CC BY-ND). This is the single source of truth shared by the schema
 * (via the schema-sync drift guard), derive, and shapes.
 */
import { NS } from "./vocab.js";

/** Predicates (Core). */
export const IIRDS_HAS_TOPIC_TYPE = `${NS.iirds}has-topic-type`;
export const IIRDS_RELATES_TO_PRODUCT_VARIANT = `${NS.iirds}relates-to-product-variant`;
export const IIRDS_RELATES_TO_LIFECYCLE_PHASE = `${NS.iirds}relates-to-product-lifecycle-phase`;
export const IIRDS_HAS_SUBJECT = `${NS.iirds}has-subject`;

/** Class minted for `kg.appliesTo` nodes. */
export const IIRDS_PRODUCT_VARIANT = `${NS.iirds}ProductVariant`;

/** `kg.topicType` value → `iirds:has-topic-type` object IRI. */
export const TOPIC_TYPE_IRIS: Readonly<Record<string, string>> = {
  task: `${NS.iirds}GenericTask`,
  concept: `${NS.iirds}GenericConcept`,
  reference: `${NS.iirds}GenericReference`,
  learning: `${NS.iirds}GenericLearning`,
  troubleshooting: `${NS.iirds}GenericTroubleshooting`,
  form: `${NS.iirds}GenericForm`,
};

/**
 * `kg.softwareLifecyclePhase` value → `iirds:relates-to-product-lifecycle-phase`
 * object IRI (Software domain: iirds:Use/PuttingToUse/AfterUse instances).
 */
export const SOFTWARE_LIFECYCLE_IRIS: Readonly<Record<string, string>> = {
  administration: `${NS.iirdsSft}Administration`,
  customization: `${NS.iirdsSft}Customization`,
  update: `${NS.iirdsSft}Update`,
  deployment: `${NS.iirdsSft}Deployment`,
  integration: `${NS.iirdsSft}Integration`,
  deinstallation: `${NS.iirdsSft}Deinstallation`,
};

/**
 * `kg.softwareSubject` value → `iirds:has-subject` object IRI (Software domain:
 * iirds:TechnicalOverview/TechnicalData instances).
 */
export const SOFTWARE_SUBJECT_IRIS: Readonly<Record<string, string>> = {
  architecture: `${NS.iirdsSft}Architecture`,
  interface: `${NS.iirdsSft}Interface`,
  "system-requirement": `${NS.iirdsSft}SystemRequirement`,
};
