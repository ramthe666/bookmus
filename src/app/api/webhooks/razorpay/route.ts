import { NextResponse } from "next/server";
import { verifyWebhookSignature } from "@/lib/integrations/payments";
import { createServiceClient } from "@/lib/supabase/server";

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
      await supabase
        .from("payments")
        .update({
          status: "captured",
          provider_payment_id: entity.id,
          raw_webhook: event,
        })
        .eq("provider_order_id", entity.order_id)
        .eq("status", "pending");
    } else if (event.event === "payment.failed" && entity) {
      await supabase
        .from("payments")
        .update({ status: "failed", raw_webhook: event })
        .eq("provider_order_id", entity.order_id)
        .eq("status", "pending");
    }
  } catch (e) {
    console.error("Razorpay webhook handling failed:", e);
    // 500 so Razorpay retries.
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
