import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const fmt = new Intl.NumberFormat('en-IN')
export const fmt1 = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 1 })
