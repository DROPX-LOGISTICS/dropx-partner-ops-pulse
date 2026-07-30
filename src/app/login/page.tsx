import { redirect } from "next/navigation";
import { DocumentTitle } from "@/components/document-title";
import { SubmitButton } from "@/components/submit-button";
import { firstAllowedHref } from "@/lib/app-navigation";
import { getAuthorization } from "@/lib/authorization";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { signInWithGoogle } from "./actions";

type LoginPageProps = {
  searchParams?: { error?: string; next?: string; reason?: string };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = createServerSupabaseClient(undefined, true);
  const { data } = supabase
    ? await supabase.auth.getUser()
    : { data: { user: null } };
  if (data.user) {
    const authorization = await getAuthorization();
    redirect(authorization ? firstAllowedHref(authorization) ?? "/unauthorized" : "/");
  }

  const message = searchParams?.error ?? searchParams?.reason;

  return (
    <main className="login-page">
      <DocumentTitle pageName="Login" productName="OpsPulse · DropX" />
      <section className="login-panel">
        <img className="login-logo" src="/dropx-logo.png" alt="DropX" />
        <div className="login-copy">
          <h1>Sign in to OpsPulse</h1>
          <p>Sign in with your Google account</p>
        </div>

        {message ? <div className="login-error">{message}</div> : null}
        <form className="google-signin-form" action={signInWithGoogle}>
          <input name="next" type="hidden" value={searchParams?.next ?? ""} />
          <SubmitButton className="google-asset-button" pendingText="Opening Google">
            <img
              className="google-signin-asset"
              src="/google-signin-light.svg"
              alt="Sign in with Google"
            />
          </SubmitButton>
        </form>
      </section>
    </main>
  );
}
