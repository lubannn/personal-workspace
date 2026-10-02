export type CorosProvenance = {
  kind: "coros_mcp";
  source_id: string;
  source_sha256: string;
  mapping_version: 1;
  retrieved_at: string;
};

export type AutomaticCorosFields = {
  import_mode: "automatic";
  review_status: "validated";
  source: CorosProvenance;
  confirmation_status?: never;
  staging_record_id?: never;
};

export function validCorosProvenance(value: CorosProvenance): boolean {
  return Boolean(value && typeof value === "object"
    && Object.keys(value).sort().join(",") === "kind,mapping_version,retrieved_at,source_id,source_sha256"
    && value.kind === "coros_mcp" && value.mapping_version === 1
    && typeof value.source_id === "string" && value.source_id.trim() === value.source_id
    && value.source_id.length > 0 && value.source_id.length <= 256 && !/[\u0000-\u001f\u007f]/u.test(value.source_id)
    && typeof value.source_sha256 === "string" && /^[0-9a-f]{64}$/u.test(value.source_sha256)
    && typeof value.retrieved_at === "string" && Number.isFinite(Date.parse(value.retrieved_at)));
}

export function validAutomaticCorosFields(value: AutomaticCorosFields): boolean {
  return value.import_mode === "automatic" && value.review_status === "validated" && validCorosProvenance(value.source);
}
