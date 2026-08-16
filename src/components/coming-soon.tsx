import { Link } from "@tanstack/react-router";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center animate-fade-in">
      <Card className="w-full max-w-2xl hover-lift">
        <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary animate-scale-in">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
            <p className="mt-1 text-xs text-muted-foreground">Coming in Phase 2.</p>
          </div>
          <Link to="/seller">
            <Button variant="outline" className="hover-scale">
              Back to dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
