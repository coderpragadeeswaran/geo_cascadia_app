import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-[16px] w-[28px] shrink-0 cursor-pointer items-center rounded-full transition-colors',
      'bg-line-strong data-[state=checked]:bg-sodium disabled:cursor-not-allowed disabled:opacity-40',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-3 translate-x-0.5 rounded-full bg-bg0 transition-transform data-[state=checked]:translate-x-[14px]" />
  </SwitchPrimitive.Root>
))
Switch.displayName = 'Switch'
