import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("premium-skeleton rounded-md bg-primary/10", className)} {...props} />;
}

export { Skeleton };
