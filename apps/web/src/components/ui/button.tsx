import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-white hover:bg-primary/90',
        outline: 'border border-stroke bg-white text-dark hover:bg-gray-2 dark:border-stroke-dark dark:bg-transparent dark:text-white dark:hover:bg-white/5',
        ghost: 'text-dark hover:bg-gray-2 dark:text-white dark:hover:bg-white/5',
        danger: 'bg-red text-white hover:bg-red/90',
        success: 'bg-green text-white hover:bg-green/90',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-5', lg: 'h-12 px-6 text-base', icon: 'h-9 w-9' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
));
Button.displayName = 'Button';
