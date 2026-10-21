const SGD = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD", maximumFractionDigits: 0 });

export const formatPrice = (value: number | string | null, kind?: string | null) =>
  value == null ? "—" : `${SGD.format(Number(value))}${kind === "rent" ? "/mo" : ""}`;

export const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("en-SG", { day: "numeric", month: "short", year: "numeric" }) : "—";
