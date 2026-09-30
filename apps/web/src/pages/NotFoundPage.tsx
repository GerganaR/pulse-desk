import { Card, EmptyState, buttonStyles } from "@pulsedesk/ui";
import { Compass } from "lucide-react";
import { Link } from "react-router";
import { PageHeader } from "@/components/PageHeader";

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" />
      <Card>
        <EmptyState
          icon={<Compass className="size-5" />}
          title="We couldn't find that page"
          description="The link may be broken or the page may have moved."
          action={
            <Link to="/dashboard" className={buttonStyles({ variant: "primary" })}>
              Go to dashboard
            </Link>
          }
        />
      </Card>
    </>
  );
}
