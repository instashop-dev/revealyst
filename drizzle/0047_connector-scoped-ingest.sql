-- Connector-scoped ingest (ADR 0060 / D-DA-8): add `source_connector` to the
-- metric_records natural key so each on-device source restates only its own
-- rows. NO data backfill is required: `source_connector` has been NOT NULL and
-- populated on every row since the table's first migration, and the OLD key
-- (org, subject, metric, day, dim) was already UNIQUE — so widening it can only
-- make keys MORE unique. No existing row collides, and nothing is merged or
-- lost. This is a pure PK swap (the PK index is rebuilt in place).
ALTER TABLE "metric_records" DROP CONSTRAINT "metric_records_org_id_subject_id_metric_key_day_dim_pk";--> statement-breakpoint
ALTER TABLE "metric_records" ADD CONSTRAINT "metric_records_org_id_subject_id_metric_key_day_dim_source_connector_pk" PRIMARY KEY("org_id","subject_id","metric_key","day","dim","source_connector");