# Doctoralia bookings into the standalone Centro Amalia CRM

This integration is for the CRM at `https://intranet.centroamalia.com/crm/` while that CRM and the Orkestra CRM module run in parallel. The website backend submits only Doctoralia-confirmed bookings, including confirmations discovered by reconciliation. During this coexistence period, the website has **one destination: the standalone intranet CRM**; it must not dual-write to the Orkestra CRM module. This endpoint does **not** send to Orkestra or synchronize the two CRM databases.

## Website handoff

`POST https://intranet.centroamalia.com/crm/api/integrations/doctoralia/bookings`

Send JSON over HTTPS with `Authorization: Bearer <CRM_BOOKING_INGRESS_SECRET>`. Use the same payload contract as the tested Orkestra-module CRM `BOOKING-INTEGRATION.md`: `booking_id` is Doctoralia's stable confirmed-booking ID, `patient`, `service`, `professional`, `starts_at` with timezone, `source`, explicit `marketing_attribution_consented`, optional `attribution`, and optional `is_test`. The website must retain failed deliveries and retry the **same** booking ID. Never send clinical notes or the full Doctoralia response.

First delivery returns `201 created`; repeats return `200 duplicate` with the same `contact_id`, `crm_booking_id`, and `deal_id`. An ID associated with another phone returns `409 booking_identity_conflict` for manual review. Invalid payloads return `400`, bad credentials `401`, missing integration configuration `503`. Retry transient `5xx`; do not retry `400` or `409` blindly.

The CRM stores one booking per Doctoralia ID and links it to a contact identified by normalized phone. Every new booking also creates exactly one deal in **Leads -> Nou Lead**; contact detail shows both. Production must configure `DOCTORALIA_DEFAULT_PIPELINE_ID=00000000-0000-0000-0000-000000000001` and `DOCTORALIA_DEFAULT_STAGE_ID=00000000-0000-0000-0001-000000000001`, verified against the live stage listing on 2026-09-30. Missing configuration returns `503` before any write. Attribution is retained only when the request says marketing consent was granted.

## Release gate

1. Start from deployed CRM commit `0615641` or a verified descendant. The additive migration is `0024_booking_imports.sql`; `0021` is already used by form tracking in this CRM. Never apply the Orkestra-module migration with the same number here.
2. Verify a restorable PostgreSQL backup and record a rollback plan before rebuilding. The API image runs migrations automatically when started.
3. Install a dedicated 32+ character Bearer secret on the standalone CRM and the website backend through a secure channel. Do not reuse the Orkestra-module staging secret or put the value in git/chat. Do not enable the public website sender yet.
4. Configure and verify the production Leads / Nou Lead pipeline and stage IDs above. A booking may not be accepted without its deal.
5. Test one controlled booking, then retry its `booking_id`: one booking, one contact association, and at most one deal. Confirm the booking in the CRM contact detail. Keep both CRM databases independent until a separate migration plan is approved.
