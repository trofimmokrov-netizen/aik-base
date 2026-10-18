export function calculateEstimate(input, table) {
  const unitRate = table.servicePerSquareMeter[input.serviceId];
  const factor = table.metalMultipliers[input.metal];
  if (
    !table.configured ||
    !Number.isFinite(unitRate) ||
    unitRate <= 0 ||
    !Number.isFinite(factor) ||
    factor <= 0 ||
    (input.onsite && (!Number.isFinite(table.visitFee) || table.visitFee < 0))
  ) {
    return {
      amount: null,
      currency: "RUB",
      message: "Стоимость рассчитывается индивидуально",
    };
  }
  const amount = Math.max(
    table.minimumOrder ?? 0,
    input.width * input.height * input.quantity * unitRate * factor +
      (input.onsite ? table.visitFee : 0),
  );
  return {
    amount: Math.round(amount),
    currency: "RUB",
    message:
      "Предварительная оценка. Окончательную стоимость мастер согласует после уточнения задачи.",
  };
}
