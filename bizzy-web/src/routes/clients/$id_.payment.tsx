import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/clients/$id_/payment')({
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/clients/$id_/payment"!</div>
}
