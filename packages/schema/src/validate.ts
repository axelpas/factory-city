import type { ValidateFunction } from "ajv";
import { Ajv } from "ajv";
import type { CcJson } from "./ccjson.js";
import { bodyChecksum } from "./ccjson.js";
import ccSchema from "./schemas/cc-json-2.0.schema.json" with { type: "json" };

let compiled: ValidateFunction | undefined;

function validator(): ValidateFunction {
  if (!compiled) {
    const ajv = new Ajv({ strict: false, allErrors: true });
    compiled = ajv.compile(ccSchema);
  }
  return compiled;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validates a snapshot against CodeCharta's published schema, then checks the checksum. */
export function validateCcJson(doc: unknown): ValidationResult {
  const v = validator();
  if (!v(doc)) {
    const errors = (v.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? "is invalid"}`);
    return { valid: false, errors };
  }
  const cc = doc as CcJson;
  const expected = bodyChecksum(cc.files, cc.lenses);
  if (cc.meta.checksum !== expected) {
    return { valid: false, errors: ["/meta/checksum does not match the serialized body"] };
  }
  return { valid: true, errors: [] };
}
