/**
 * Razorpay adapter — orders, signature verification, webhooks.
 * Uses raw HTTPS + Node crypto (no SDK) to keep the bundle lean.
 * All functions throw a clear error when keys are missing so misconfig
 * surfaces loudly instead of silently skipping payments.
 */
import crypto from "crypto";

const API = "https://api.razorpay.com/v1";

export function isPaymentsConfigured(): boolean {
  return Boolean(
    process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
  );
}

function basicAuth(): string {
  const id = process.env.RAZORPAY_KEY_ID!;
  const secret = process.env.RAZORPAY_KEY_SECRET!;
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

/** Create a Razorpay order for a booking. Amount in paise. */
export async function createRazorpayOrder(opts: {
  amountPaise: number;
  currency: string;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrder> {
  if (!isPaymentsConfigured()) throw new Error("Razorpay is not configured.");
  const res = await fetch(`${API}/orders`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: opts.amountPaise,
      currency: opts.currency,
      receipt: opts.receipt,
      notes: opts.notes ?? {},
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Razorpay order creation failed: ${text}`);
  }
  return (await res.json()) as RazorpayOrder;
}

/**
 * Verify the signature Razorpay Checkout hands the browser after payment.
 * Proves the payment actually happened — always check this server-side.
 */
export function verifyPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(args.signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Verify a webhook's X-Razorpay-Signature header against the raw body. */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
