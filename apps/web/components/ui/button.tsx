import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/client/cn";

/**
 * Buttons: condensed caps labels, square corners. `default` is the one accent action per view;
 * `outline`/`ghost` for everything else; `destructive` for irreversible actions (pair with a
 * ConfirmDialog). `success` is kept for "approve & pay".
 */
export const buttonVariants = cva(
  "caps inline-flex cursor-pointer items-center justify-center gap-2 rounded-sm font-semibold whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:stroke-[1.75]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-white",
        destructive: "bg-destructive text-status-foreground hover:bg-[#ff7a73]",
        success: "bg-success text-status-foreground hover:bg-[#6ae6a3]",
        outline: "border border-input bg-transparent text-foreground hover:border-muted-foreground hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[#2a2d33]",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 text-[13px] tracking-[0.12em]",
        sm: "h-8 px-3 text-xs tracking-[0.12em]",
        lg: "h-11 px-6 text-sm tracking-[0.14em]",
        icon: "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
