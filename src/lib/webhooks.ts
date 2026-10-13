import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueOutbox } from "@/lib/outbox-enqueue";

/**
 * Outgoing webhooks (spec §8.6). Owners subscribe HTTPS endpoints to events;
 * deliveries are HMAC-SHA256 signed and sent through the outbox with retries.
 */

export const WEBHOOK_EVENTS = [
  { key: "booking.created", label: "Booking created" },
  { key: "booking.confirmed", label: "Booking confirmed" },
  { key: "booking.cancelled", label: "Booking cancelled" },
  { key: "booking.rescheduled", label: "Booking rescheduled" },
  { key: "payment.captured", label: "Payment captured" },
  { key: "payment.failed", label: "Payment failed" },
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["key"];

export interface WebhookDeliveryPayload {
  endpoint_id: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
}

function sign(secret: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/**
 * Enqueue deliveries for every active endpoint of this owner subscribed to
 * the event. Call from lifecycle code — never throws.
 */
export async function triggerWebhooks(
  supabase: SupabaseClient,
  ownerProfileId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const { data: endpoints } = await supabase
      .from("webhook_endpoints")
      .select("id")
      .eq("owner_profile_id", ownerProfileId)
      .eq("is_active", true)
      .contains("events", [event]);
    for (const ep of endpoints ?? []) {
      await enqueueOutbox(
        supabase,
        "webhook.deliver",
        {
          endpoint_id: ep.id,
          event,
          payload: {
            event,
            delivered_at: new Date().toISOString(),
            ...payload,
          },
        },
        `webhook:${ep.id}:${event}:${(payload as { booking_id?: string }).booking_id ?? Date.now()}`
      );
    }
  } catch (e) {
    console.error("webhook trigger failed:", e);
  }
}

/**
 * Outbox handler: POST the signed payload, record the delivery.
 * Throws on non-2xx so the outbox retries with backoff.
 */
export async function deliverWebhook(
  supabase: SupabaseClient,
  p: WebhookDeliveryPayload
): Promise<void> {
  const { data: ep } = await supabase
    .from("webhook_endpoints")
    .select("id, url, secret, is_active")
    .eq("id", p.endpoint_id)
    .maybeSingle();
  if (!ep || !(ep.is_active as boolean)) return; // endpoint removed/disabled

  const body = JSON.stringify(p.payload);
  const signature = sign(ep.secret as string, body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(ep.url as string, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-BookMus-Event": p.event,
        "X-BookMus-Signature": `sha256=${signature}`,
        "User-Agent": "BookMus-Webhooks/1.0",
      },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Webhook returned HTTP ${res.status}`);
    }
    await supabase.from("webhook_deliveries").insert({
      endpoint_id: ep.id,
      event: p.event,
      payload: p.payload,
      status: "delivered",
      attempts: 1,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Record a failed attempt (called by the outbox on final failure). */
export async function recordWebhookFailure(
  supabase: SupabaseClient,
  p: WebhookDeliveryPayload,
  attempts: number,
  error: unknown
): Promise<void> {
  try {
    await supabase.from("webhook_deliveries").insert({
      endpoint_id: p.endpoint_id,
      event: p.event,
      payload: p.payload,
      status: "failed",
      attempts,
      last_error:
        error instanceof Error
          ? error.message.slice(0, 500)
          : String(error).slice(0, 500),
    });
  } catch (e) {
    console.error("webhook failure log failed:", e);
  }
}
