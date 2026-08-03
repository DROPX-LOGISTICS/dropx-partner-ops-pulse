import { ReportUploadPageContent } from "@/components/report-upload-page-content";

export default async function ReportUploadPage(
  props: { searchParams?: Promise<{ date?: string; report?: string; shipment?: string }> }
) {
  const searchParams = await props.searchParams;
  return <ReportUploadPageContent active="Report Imports" pageCode="imports" selectedDate={searchParams?.date} selectedReport={searchParams?.report} showShipmentCoverage={searchParams?.shipment === "1"} />;
}
