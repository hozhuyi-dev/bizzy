import { AuthMutation } from "../../auth.mutation";
import { Logo } from "~/components/shared/layout/logo/logo.component";
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
  const signIn = AuthMutation.useSignIn();
  const signOut = AuthMutation.useSignOut();

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <Logo className="text-xl" />
          </CardTitle>
          <CardDescription>
            {status === "signed-out"
              ? "Your practice, minus the busywork."
              : "This Google account doesn't have access."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === "signed-out" ? (
            <Button className="w-full" onClick={() => signIn.mutate()}>
              Sign in with Google
            </Button>
          ) : (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => signOut.mutate()}
            >
              Sign out and try another account
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
