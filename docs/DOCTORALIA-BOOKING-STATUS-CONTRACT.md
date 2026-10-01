# Doctoralia booking status -> standalone CRM

This contract applies only to `https://intranet.centroamalia.com/crm/`. It does not write to the Orkestra-module CRM. Deploy CRM migration `0025_doctoralia_booking_status.sql` before enabling the website sender. The same private Bearer secret as booking creation authenticates this server-to-server endpoint; never include it in a URL, log, PR, or chat.

## Request

`POST https://intranet.centroamalia.com/crm/api/integrations/doctoralia/bookings/status`

Headers: `Authorization: Bearer <CRM_BOOKING_INGRESS_SECRET>` and `Content-Type: application/json`.

Cancellation:

```json
{
  "event_id": "doctoralia-change-89959009-2026-10-01T11:00:00Z",
  "booking_id": "89959009",
  "status": "canceled",
  "occurred_at": "2026-10-01T11:00:00Z"
}
```

Time change, same Doctoralia ID:

```json
{
  "event_id": "doctoralia-change-89959009-2026-10-01T12:00:00Z",
  "booking_id": "89959009",
  "status": "moved",
  "occurred_at": "2026-10-01T12:00:00Z",
  "new_starts_at": "2026-10-05T09:00:00+02:00"
}
```

If Doctoralia assigns a new booking ID, also send `"new_booking_id": "90000000"`; `booking_id` remains the prior ID. A subsequent status update can use the new ID. The CRM links both IDs to **one** booking/contact/deal. `event_id` must be stable across retries and unique per actual change. `occurred_at` and `new_starts_at` require an explicit timezone (`Z` or offset). The sender must verify the change against Doctoralia before sending it. Send no patient details, clinical reason, or full provider response.

## Responses

Applied (`200`):

```json
{
  "status": "applied",
  "event_id": "doctoralia-change-89959009-2026-10-01T11:00:00Z",
  "booking_id": "89959009",
  "crm_booking_id": "<uuid>",
  "contact_id": "<uuid>",
  "deal_id": "<uuid>",
  "booking_status": "canceled",
  "current_booking_id": "89959009",
  "starts_at": "2026-10-05T07:00:00.000Z",
  "status_changed_at": "2026-10-01T11:00:00.000Z"
}
```

- `200 status=duplicate`: the same `event_id` and content were already accepted. Stop retrying.
- `200 status=stale`: an older change was retained in history but did not overwrite a newer state. Stop retrying.
- `202 status=pending`: the original confirmed booking has not arrived yet. The CRM retains the change and applies it when the booking is imported. Stop retrying; surface a reconciliation alert if the booking never appears.
- `400 invalid_booking_status`: malformed payload, including missing timezone. Fix the sender; do not retry unchanged.
- `401 unauthorized` or `503 integration_unavailable`: check the private secret/configuration. Retain the event in the website outbox; retry only after configuration is corrected.
- `409 event_id_conflict`: the same `event_id` was reused with different content. Manual intervention; never generate a new ID just to bypass this.
- `409 status_conflict`: same timestamp with a different event, a change referencing an obsolete ID, or an ID already belonging to another CRM booking. Manual reconciliation; no booking/deal is created.
- Transient `5xx` or network timeout: retry the **same** `event_id` and payload with backoff.

The existing booking-creation endpoint may respond `409 booking_move_unresolved` if a new Doctoralia ID is submitted before the pending move from its prior ID can be linked. Resolve/import the prior booking first; do not create a second deal.

## State and operations

The CRM keeps the original booking row and its contact/deal. It records each accepted change in `booking_status_events`, stores old/new Doctoralia IDs in `booking_aliases`, and updates the booking's current status, appointment time, and current provider ID. The contact page shows the current booking status and time; the deal page shows the booking and applied change history. **The deal's commercial stage is never changed automatically.** A canceled appointment does not erase the contact or imply a lost lead.

Pending changes remain in `booking_status_events` with `resolution='pending'` until the confirmed booking is imported; `resolution='conflict'` needs human review. Operational queries must use IDs/timestamps/status only and must not log patient details or secrets. Direct Doctoralia-dashboard cancellations and time changes must be detected by the website/Doctoralia side too, not only changes initiated on the website.
