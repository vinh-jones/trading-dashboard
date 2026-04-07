export function formatDollars(n) {
  if (n == null) return "—";
  const neg = n < 0;
  const abs = Math.abs(n);
  const str = abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${abs.toLocaleString()}`;
  return neg ? `-${str}` : str;
}

export function formatDollarsFull(n) {
  if (n == null) return "—";
  const neg = n < 0;
  return `${neg ? "-" : ""}$${Math.abs(n).toLocaleString()}`;
}

export function formatExpiry(expiryISO) {
  if (!expiryISO) return "—";
  return new Date(expiryISO + "T12:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
