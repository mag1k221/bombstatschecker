import { Analyzer } from "@/components/Analyzer";

export default function Page() {
  return <Analyzer demoEnabled={process.env.NEXT_PUBLIC_ENABLE_DEMO !== "false"} />;
}
