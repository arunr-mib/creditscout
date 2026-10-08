import { notFound } from "next/navigation";
import { CovenantSetup } from "@/components/CovenantSetup";
import { anonReader } from "@/lib/supabase/anon";
import { loadCovenantSetupProps } from "@/lib/covenant-setup-data";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CovenantSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const props = await loadCovenantSetupProps(anonReader(), id);
  if (!props) notFound();
  return <CovenantSetup {...props} />;
}
