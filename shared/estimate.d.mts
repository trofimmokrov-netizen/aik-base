export function calculateEstimate(
  input: {
    serviceId: string;
    metal: string;
    width: number;
    height: number;
    quantity: number;
    onsite: boolean;
  },
  table: {
    configured: boolean;
    servicePerSquareMeter: Record<string, number | null>;
    metalMultipliers: Record<string, number | null>;
    visitFee: number | null;
    minimumOrder: number | null;
  },
): { amount: number | null; currency: string; message: string };
