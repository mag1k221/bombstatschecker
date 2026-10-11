import type { Metadata } from "next";
import { Analyzer } from "@/components/Analyzer";
import { loadShare } from "@/lib/server/share-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Boomsquad — shared battle results", robots: { index: false } };

export default async function SharedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const share = await loadShare(id);
  return <Analyzer demoEnabled={process.env.NEXT_PUBLIC_ENABLE_DEMO !== "false"} initialShare={share} shareMissing={!share} />;
}
