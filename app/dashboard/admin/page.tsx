import { redirect } from "next/navigation";
import AdminConsole from "@/app/components/dashboard/AdminConsole";
import { requireDashboardSession } from "@/lib/auth";

export default async function AdminPage() {
  const session = await requireDashboardSession();
  if (session.role !== "admin") {
    redirect("/dashboard");
  }

  return <AdminConsole />;
}
