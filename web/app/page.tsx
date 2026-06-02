import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <h1 className="text-xl font-bold">Anu</h1>
          <div className="flex gap-4">
            <Link href="/login" className="text-gray-600 hover:text-gray-900">Sign in</Link>
            <Link href="/register" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">Get started</Link>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-20">
        <h2 className="text-4xl font-bold mb-4">Roof measurements from aerial imagery</h2>
        <p className="text-xl text-gray-600 mb-8 max-w-2xl">
          Anu generates accurate roof measurement reports using NAIP aerial imagery and 3DEP LiDAR data.
          Get area, pitch, facets, and waste factor — all from a property address.
        </p>
        <Link href="/register" className="px-6 py-3 bg-blue-600 text-white rounded-md text-lg hover:bg-blue-700">
          Create free account
        </Link>
        <div className="mt-16 grid grid-cols-3 gap-8">
          <div>
            <h3 className="font-semibold mb-2">Accurate</h3>
            <p className="text-gray-600 text-sm">LiDAR-based 3D roof geometry with 90-95% accuracy for pitch and facet measurements.</p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Fast</h3>
            <p className="text-gray-600 text-sm">Reports generated in 60-90 seconds. No site visit required.</p>
          </div>
          <div>
            <h3 className="font-semibold mb-2">Free to start</h3>
            <p className="text-gray-600 text-sm">5 reports per month free. Upgrade to premium for unlimited reports at $49/month.</p>
          </div>
        </div>
      </main>
    </div>
  );
}
