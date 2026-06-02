import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import PlanBadge from "@/components/PlanBadge";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const db = getDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, session.user.id) });
  if (!user) redirect("/login");

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>
      <div className="bg-white rounded-lg border p-6 mb-4">
        <h2 className="font-semibold mb-4">Profile</h2>
        <p><span className="text-gray-500">Name:</span> {user.name}</p>
        <p><span className="text-gray-500">Email:</span> {user.email}</p>
        {user.companyName && <p><span className="text-gray-500">Company:</span> {user.companyName}</p>}
        <div className="mt-2">
          <PlanBadge plan={user.plan} />
        </div>
      </div>
      <a href="/dashboard/settings/billing" className="text-blue-600 hover:underline">Manage billing</a>
    </div>
  );
}
