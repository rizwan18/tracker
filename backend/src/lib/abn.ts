/** Australian Business Number: 11 digits; valid when the weighted sum (first digit minus 1) is divisible by 89. */
export function normaliseAbn(input: string): string {
  return input.replace(/\s+/g, "");
}

export function isValidAbn(input: string): boolean {
  const digits = normaliseAbn(input);
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const nums = digits.split("").map(Number);
  nums[0] = (nums[0] ?? 0) - 1;
  const sum = nums.reduce((total, n, i) => total + n * (weights[i] ?? 0), 0);
  return sum % 89 === 0;
}

/** 12 345 678 901 style, for display. */
export function formatAbn(input: string): string {
  const d = normaliseAbn(input);
  return /^\d{11}$/.test(d) ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : input;
}
