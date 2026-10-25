import { createFileRoute } from "@tanstack/react-router";
import { RecordPaymentPage } from "~/features/clients/record-payment-page.component";
import { ClientsQuery } from "~/features/clients/clients.query";
import { PackagesQuery } from "~/features/packages/packages.query";
import { pageData, prefetch } from "~/core/utils/page-data.util";

export const Route = createFileRoute("/clients/$id_/payment")({
  loader: () => pageData(prefetch(ClientsQuery.list()), prefetch(PackagesQuery.list(true))),
  component: PaymentRoute,
});

function PaymentRoute() {
  const { id } = Route.useParams();
  return <RecordPaymentPage key={id} id={id} />;
}
