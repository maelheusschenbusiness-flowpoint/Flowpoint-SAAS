export interface StripeTestResourceCleanup {
  registerEmail(email: string): Promise<void>;
  registerCustomer(id: string, email?: string): string | undefined;
  registerSubscription(id: string, customerId: string): string | undefined;
  registerCheckoutSession(id?: string): string | undefined;
  registerEvent(id?: string): string | undefined;
  registerInvoice(id?: string): string | undefined;
  registerPaymentIntent(id?: string): string | undefined;
  registerPaymentMethod(id?: string): string | undefined;
  registerSetupIntent(id?: string): string | undefined;
  registerTestClock(id?: string): string | undefined;
  cleanup(): Promise<void>;
}

export function createStripeTestResourceCleanup(
  stripe: unknown,
  stripeTestKey: string,
  label: string,
): StripeTestResourceCleanup;
