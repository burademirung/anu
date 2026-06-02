export default function PlanBadge({ plan }: { plan: string }) {
  const isPremium = plan === "premium";
  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${isPremium ? "bg-purple-100 text-purple-800" : "bg-gray-100 text-gray-800"}`}>
      {isPremium ? "Premium" : "Free"}
    </span>
  );
}
