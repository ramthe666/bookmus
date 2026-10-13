import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/integrations/payments";
import { createServiceClient } from "@/lib/supabase/server";
import { finalizePaidBooking } from "@/lib/booking-lifecycle";
import { triggerWebhooks } from "@/lib/webhooks";

async function bookingOwner(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  bookingId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("bookings")
    .select("event_types!inner(owner_profile_id)")
    .eq("id", bookingId)
    .maybeSingle();
  return (
    (data?.event_types as unknown as { owner_profile_id: string } | undefined)
      ?.owner_profile_id ?? null
  );
}

/**
 * Razorpay webhook — signature-verified, idempotent.
 * Configure in Razorpay Dashboard → Settings → Webhooks:
 *   payment.captured, payment.failed → https://<app>/api/webhooks/razorpay
 */
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get("x-razorpay-signature");

  if (!verifyWebhookSignature(raw, signature)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let event: {
    event: string;
    payload: { payment: { entity: { id: string; order_id: string } } };
  };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  try {
    const supabase = await createServiceClient();
    const entity = event.payload?.payment?.entity;

    if (event.event === "payment.captured" && entity) {
      const { data: payment } = await supabase
        .from("payments")
        .select("id, booking_id")
        .eq("provider_order_id", entity.order_id)
        .maybeSingle();
      if (payment) {
        await supabase
          .from("payments")
          .update({
            status: "captured",
            provider_payment_id: entity.id,
            raw_webhook: event,
          })
          .eq("id", payment.id)
          .eq("status", "pending");
        // Confirm the booking (idempotent — no-op if already confirmed).
        await finalizePaidBooking(supabase, payment.booking_id as string);
        const owner = await bookingOwner(
          supabase,
          payment.booking_id as string
        );
        if (owner) {
          await triggerWebhooks(supabase, owner, "payment.captured", {
            booking_id: payment.booking_id,
            payment_id: entity.id,
          });
        }
      }
    } else if (event.event === "payment.failed" && entity) {
      const { data: failedPayment } = await supabase
        .from("payments")
        .select("id, booking_id")
        .eq("provider_order_id", entity.order_id)
        .maybeSingle();
      await supabase
        .from("payments")
        .update({ status: "failed", raw_webhook: event })
        .eq("provider_order_id", entity.order_id)
        .eq("status", "pending");
      if (failedPayment?.booking_id) {
        const owner = await bookingOwner(
          supabase,
          failedPayment.booking_id as string
        );
        if (owner) {
          await triggerWebhooks(supabase, owner, "payment.failed", {
            booking_id: failedPayment.booking_id,
            payment_id: entity.id,
          });
        }
      }
    }
  } catch (e) {
    console.error("Razorpay webhook handling failed:", e);
    // 500 so Razorpay retries.
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
