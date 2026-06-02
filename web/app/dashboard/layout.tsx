import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 bg-gray-900 text-white p-6">
        <h2 className="text-xl font-bold mb-8">Anu</h2>
        <nav className="space-y-2">
          <Link href="/dashboard" className="block py-2 px-3 rounded hover:bg-gray-800">
            Dashboard
          </Link>
          <Link href="/dashboard/reports" className="block py-2 px-3 rounded hover:bg-gray-800">
            Reports
          </Link>
          <Link href="/dashboard/new" className="block py-2 px-3 rounded hover:bg-gray-800">
            New Report
          </Link>
          <Link href="/dashboard/settings" className="block py-2 px-3 rounded hover:bg-gray-800">
            Settings
          </Link>
        </nav>
        <div className="mt-auto pt-8 text-sm text-gray-400">
          {session.user.email}
        </div>
      </aside>
      <main className="flex-1 p-8 bg-gray-50 text-black">{children}</main>
    </div>
  );
}
