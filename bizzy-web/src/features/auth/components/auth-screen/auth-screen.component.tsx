import { AmplifyService } from "../../amplify.service";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";

interface AuthScreenProps {
  status: "signed-out" | "no-access";
}

export function AuthScreen({ status }: AuthScreenProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Bizzy</CardTitle>
          <CardDescription>
            {status === "signed-out"
              ? "Sign in to manage sessions and invoices."
              : "This Google account doesn't have access."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "signed-out" ? (
            <Button className="w-full" onClick={() => void AmplifyService.signIn()}>
              Sign in with Google
            </Button>
          ) : (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => void AmplifyService.signOut()}
            >
              Sign out and try another account
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
