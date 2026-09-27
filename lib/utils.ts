import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 站点基址，用于拼接 Stripe 回跳地址与 OAuth redirect_uri。
 * 优先级：BASE_URL（生产已配置）> VERCEL_URL（Preview 由 Vercel 自动注入）
 * > localhost（本地开发）。
 */
export function getBaseUrl() {
  if (process.env.BASE_URL) return process.env.BASE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
