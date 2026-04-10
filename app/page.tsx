import { redirect } from "next/navigation";
import { getDashboardSession } from "@/lib/auth";

export default async function Home() {
  const session = await getDashboardSession();
  redirect(session ? "/dashboard" : "/login");
}
