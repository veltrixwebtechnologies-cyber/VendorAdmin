// Synced from @localshore/core 0.1.0; edit packages/localshore-core/src in the Shopper repository.
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
