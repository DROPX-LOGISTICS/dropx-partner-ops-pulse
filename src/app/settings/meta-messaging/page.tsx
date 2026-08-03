import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MetaMessagingSettingsPage(
  props: {
    searchParams?: Promise<{ section?: string; platform?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const platform = searchParams?.platform ?? searchParams?.section;
  redirect(`/settings/meta${platform ? `?platform=${encodeURIComponent(platform)}` : ""}`);
}
